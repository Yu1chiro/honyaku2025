const express = require('express');
const path = require('path');
const QRCode = require('qrcode');
require('dotenv').config();
const NodeCache = require('node-cache');
const rateLimit = require('express-rate-limit');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));
const myCache = new NodeCache({ stdTTL: 1200 }); 

// --- 3. KONFIGURASI RATE LIMITER (Satpam Anti Spam) ---
// Batasi 30 request per 1 menit per IP
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 menit
  max: 25,
  message: { error: "To many request! please wait for 1 minute" },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', apiLimiter);
// --- MAPPING 1: UI Frontend ---
const supportedLanguages = {
  'id': 'Bahasa Indonesia',
  'en': 'English',
  'ja': '日本語 (Japanese)',
  'zh': '中文 (Mandarin)',
  'ko': '한국어 (Korean)',
  'my': 'မြန်မာစာ (Burmese)',
  'th': 'ไทย (Thai)',
  'tl': 'Filipino (Tagalog)',
  'fr': 'Français (French)'
};

// --- MAPPING 2: AI Prompt (Untuk Akurasi Target) ---
const aiLanguageMap = {
  'id': 'Indonesian',
  'en': 'English',
  'ja': 'Japanese',
  'zh': 'Chinese (Mandarin)',
  'ko': 'Korean',
  'my': 'Burmese',
  'th': 'Thai',
  'tl': 'Filipino',
  'fr': 'French'
};

// --- ROUTES ---

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/404', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', '404.html'));
});
app.get('/translate', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'view.html'));
});

app.get('/realtime-translation', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'realtime.html'));
});

app.get('/sw', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});
app.get('/manifest', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'manifest.json'));
});

app.get('/api/languages', (req, res) => res.json(supportedLanguages));

// API: Generate QR Code
app.post('/api/generate-qr', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });
    const qrImage = await QRCode.toDataURL(url);
    res.json({ qrImage });
  } catch (error) {
    console.error('QR Gen Error:', error);
    res.status(500).json({ error: 'Failed to generate QR' });
  }
});

// --- API TRANSLATE (PERBAIKAN LOGIC JSON) ---
app.post('/api/translate', async (req, res) => {
    try {
        const { text, fromLang, toLang } = req.body;

        // [STRATEGI 3] Validasi Input Hemat Kuota
        if (!text || text.trim() === "") return res.json({ translatedText: "", transliteration: "" });
        // Jika bahasa sama, balikan langsung (Hemat API)
        if (fromLang === toLang) {
            return res.json({
                translatedText: text,
                transliteration: "",
                originalText: text,
                fromLang,
                toLang
            });
        }

        if (!process.env.GEMINI_APIKEY) return res.status(500).json({ error: 'API Key Missing' });

        // [STRATEGI 1] Cek Cache Dulu
        const cacheKey = `trans_${fromLang}_${toLang}_${text.trim().toLowerCase()}`;
        const cachedData = myCache.get(cacheKey);
        if (cachedData) {
            return res.json(cachedData); // Return dari RAM
        }

        // --- LOGIC ASLI ANDA MULAI DARI SINI (TIDAK DIUBAH) ---
        
        // 1. Pastikan Nama Bahasa Jelas
        const sourceLangName = aiLanguageMap[fromLang] || 'Indonesian';
        const targetLangName = aiLanguageMap[toLang] || 'English';

        const prompt = `
    Translate the following text strictly from ${sourceLangName} to ${targetLangName}.

    INPUT TEXT: "${text}"

    GUIDELINES:
    1. **Style**: Casual conversation (friend-to-friend). Use natural spoken language.
    2. **Context**: 
       - If Target is Indonesian, use "aku/kamu" (never "saya/anda" unless formal context implies it).
       - Keep it short and authentic.
    3. **Forbidden**: Do NOT output Javanese or regional dialects. Standard ${targetLangName} only.
    4. **Pronunciation**: 
       - REQUIRED for: Japanese, Korean, Thai, Chinese, Burmese (Romanization).
       - NULL for: Indonesian, English, French, Tagalog.
    
    OUTPUT FORMAT:
    Respond ONLY with a raw JSON object. Do not add markdown block markers (like \`\`\`json).
    
    { 
      "translatedText": "...", 
      "pronunciation": "..." 
    }
    `;

        const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': process.env.GEMINI_APIKEY
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    responseMimeType: "application/json",
                    temperature: 0.4 
                }
            })
        });

        const data = await response.json();
        if (!data.candidates) throw new Error("Gemini API Error");

        let resultText = data.candidates[0].content.parts[0].text
            .replace(/```json/g, '')
            .replace(/```/g, '')
            .trim();

        let jsonResult = {};

        try {
            jsonResult = JSON.parse(resultText);
        } catch (e) {
            console.error("JSON Parse Fail, Raw:", resultText);
            jsonResult = { translatedText: text, pronunciation: null };
        }

        // Construct Final Object
        const finalResponse = {
            translatedText: jsonResult.translatedText || text,
            transliteration: jsonResult.pronunciation || "",
            originalText: text,
            fromLang,
            toLang
        };

        // --- LOGIC ASLI BERAKHIR DI SINI ---

        // [STRATEGI 1] Simpan ke Cache sebelum return
        myCache.set(cacheKey, finalResponse);

        res.json(finalResponse);

    } catch (error) {
        console.error('Translation Error:', error);
        res.json({ error: true, translatedText: req.body.text, transliteration: "" });
    }
});

// --- API JISHO (Logic Inti Tetap, Ditambah Cache) ---
app.post('/api/jisho', async (req, res) => {
    try {
        const { text, fromLang, toLang } = req.body;

        // [STRATEGI 3] Validasi
        if (!text || !fromLang || !toLang) return res.status(400).json({ error: 'Missing parameters' });
        if (!supportedLanguages[fromLang] || !supportedLanguages[toLang]) return res.status(400).json({ error: 'Language not supported' });

        if (fromLang === toLang) {
            return res.json({
                translatedText: text,
                fromLanguage: supportedLanguages[fromLang],
                toLanguage: supportedLanguages[toLang]
            });
        }

        // [STRATEGI 1] Cek Cache
        const cacheKey = `jisho_${fromLang}_${toLang}_${text.trim().toLowerCase()}`;
        const cachedData = myCache.get(cacheKey);
        if (cachedData) return res.json(cachedData);

        // --- LOGIC ASLI ANDA MULAI DARI SINI (TIDAK DIUBAH) ---

        const fromName = supportedLanguages[fromLang];
        const toName = supportedLanguages[toLang];

        const complexLangs = ['my', 'th', 'ja', 'zh', 'ko', 'km', 'lo'];
        const needsReading = complexLangs.includes(toLang);

        let prompt;

        if (needsReading) {
            prompt = `Translate this text from ${fromName} to ${toName}.
        
        IMPORTANT OUTPUT FORMAT:
        Write the translation, followed by " ||| ", followed by the pronunciation in Latin alphabet.
        Example output: สวัสดี ||| Sawasdee
        
        Text to translate: "${text}"`;
        } else {
            prompt = `Translate this text from ${fromName} to ${toName}. Output ONLY the translation. Text: "${text}"`;
        }

        if (!process.env.GEMINI_APIKEY) throw new Error('GEMINI_APIKEY missing');

        const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': process.env.GEMINI_APIKEY
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.3,
                    maxOutputTokens: 1000
                }
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || 'Gemini API Error');

        let rawResult = data.candidates[0]?.content?.parts[0]?.text?.trim();
        if (!rawResult) throw new Error('No translation found');

        let translatedText = rawResult;
        let transliteration = '';

        if (needsReading && rawResult.includes('|||')) {
            const parts = rawResult.split('|||');
            translatedText = parts[0].trim();
            transliteration = parts[1].trim();
        } else if (needsReading) {
            const match = rawResult.match(/(.*?)\s*\((.*?)\)/);
            if (match) {
                translatedText = match[1].trim();
                transliteration = match[2].trim();
            }
        }

        translatedText = translatedText.replace(/^"|"$/g, '');

        const finalResponse = {
            translatedText,
            transliteration,
            fromLanguage: fromName,
            toLanguage: toName
        };

        // --- LOGIC ASLI BERAKHIR DI SINI ---

        // [STRATEGI 1] Simpan ke Cache
        myCache.set(cacheKey, finalResponse);

        res.json(finalResponse);

    } catch (error) {
        console.error('Translation Error:', error);
        res.status(500).json({ error: 'Translation failed', details: error.message });
    }
});

// --- API DETECT (Logic Inti Tetap, Ditambah Cache) ---
app.post('/api/detect-language', async (req, res) => {
    try {
        const { text } = req.body;

        // [STRATEGI 3] Validasi
        if (!text) return res.status(400).json({ error: 'Text harus diisi' });

        // [STRATEGI 1] Cek Cache (Cukup 50 karakter awal agar hemat key)
        const cacheKey = `detect_${text.trim().substr(0, 50).toLowerCase()}`;
        const cachedData = myCache.get(cacheKey);
        if (cachedData) return res.json(cachedData);

        // --- LOGIC ASLI ANDA MULAI DARI SINI (TIDAK DIUBAH) ---

        if (!process.env.GEMINI_APIKEY) {
            return res.status(500).json({ error: 'GEMINI_APIKEY tidak dikonfigurasi' });
        }

        const prompt = `Deteksi bahasa dari teks berikut dan berikan HANYA kode bahasa (id, en, ja, zh, ko, my, th, tl, fr):

"${text}"`;

        const geminiResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': process.env.GEMINI_APIKEY
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.3,
                    topK: 1,
                    topP: 1,
                    maxOutputTokens: 2048
                }
            })
        });

        const geminiData = await geminiResponse.json();

        if (!geminiResponse.ok) {
            console.error('Gemini API Error Details:', geminiData);
            throw new Error(`Gemini API error: ${geminiResponse.status} - ${geminiData.error?.message || 'Unknown error'}`);
        }
        let detectedLang = geminiData.candidates[0]?.content?.parts[0]?.text?.trim().toLowerCase();

        if (detectedLang.includes('id') || detectedLang.includes('indonesia')) {
            detectedLang = 'id';
        } else if (detectedLang.includes('en') || detectedLang.includes('english')) {
            detectedLang = 'en';
        } else if (detectedLang.includes('ja') || detectedLang.includes('japanese')) {
            detectedLang = 'ja';
        } else if (detectedLang.includes('zh') || detectedLang.includes('chinese') || detectedLang.includes('mandarin')) {
            detectedLang = 'zh';
        } else if (detectedLang.includes('ko') || detectedLang.includes('korean')) {
            detectedLang = 'ko';
        } else if (detectedLang.includes('my') || detectedLang.includes('burmese') || detectedLang.includes('myanmar')) {
            detectedLang = 'my';
        } else if (detectedLang.includes('th') || detectedLang.includes('thai')) {
            detectedLang = 'th';
        } else if (detectedLang.includes('tl') || detectedLang.includes('tagalog') || detectedLang.includes('filipino')) {
            detectedLang = 'tl';
        } else if (detectedLang.includes('fr') || detectedLang.includes('french')) {
            detectedLang = 'fr';
        } else {
            detectedLang = 'en';
        }

        const finalResponse = {
            detectedLanguage: detectedLang,
            languageName: supportedLanguages[detectedLang]
        };

        // --- LOGIC ASLI BERAKHIR DI SINI ---

        // [STRATEGI 1] Simpan ke Cache
        myCache.set(cacheKey, finalResponse);

        res.json(finalResponse);

    } catch (error) {
        console.error('Language detection error:', error);
        res.status(500).json({
            error: 'Terjadi kesalahan saat mendeteksi bahasa',
            details: error.message
        });
    }
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Terjadi kesalahan server' });
});

app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'public', '404.html'));
});

app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});