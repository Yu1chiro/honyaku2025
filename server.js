const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

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

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/sw', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});
app.get('/manifest', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'manifest.json'));
});

app.get('/api/languages', (req, res) => {
  res.json(supportedLanguages);
});

// Route untuk translate text
app.post('/api/translate', async (req, res) => {
  try {
    const { text, fromLang, toLang } = req.body;

    // Validasi input
    if (!text || !fromLang || !toLang) {
      return res.status(400).json({ 
        error: 'Text, fromLang, dan toLang harus diisi' 
      });
    }

    if (!supportedLanguages[fromLang] || !supportedLanguages[toLang]) {
      return res.status(400).json({ 
        error: 'Bahasa tidak didukung' 
      });
    }

    if (fromLang === toLang) {
      return res.json({ 
        translatedText: text,
        fromLanguage: supportedLanguages[fromLang],
        toLanguage: supportedLanguages[toLang]
      });
    }

    const fromLanguageName = supportedLanguages[fromLang];
    const toLanguageName = supportedLanguages[toLang];
    
    // --- LOGIKA PROMPT BARU ---
    // Daftar bahasa yang butuh cara baca (transliterasi) agar TTS jalan
    const complexScripts = ['my', 'th', 'ja', 'zh', 'ko'];
    const needsTransliteration = complexScripts.includes(toLang);

    let prompt;
    
    if (needsTransliteration) {
        // Prompt khusus meminta format JSON berisi terjemahan DAN cara baca
        prompt = `Role: Penerjemah profesional.
Tugas: Terjemahkan teks "${text}" dari ${fromLanguageName} ke ${toLanguageName}.

Instruksi Output:
Berikan respon HANYA dalam format JSON valid (tanpa markdown code block).
Struktur JSON:
{
  "translatedText": "hasil terjemahan dalam aksara asli",
  "transliteration": "cara baca dalam huruf latin/alphabet agar orang asing bisa membacanya"
}`;
    } else {
        // Prompt standar untuk bahasa latin
        prompt = `Terjemahkan teks berikut dari ${fromLanguageName} ke ${toLanguageName}. 
Berikan HANYA hasil terjemahan tanpa penjelasan tambahan:

"${text}"`;
    }

    // Validasi API key
    if (!process.env.GEMINI_APIKEY) {
      throw new Error('GEMINI_APIKEY tidak ditemukan di file .env');
    }

    // Request ke Gemini API
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
          maxOutputTokens: 2048,
          responseMimeType: needsTransliteration ? "application/json" : "text/plain"
        }
      })
    });

    const geminiData = await geminiResponse.json();

    if (!geminiResponse.ok) {
      console.error('Gemini API Error Details:', geminiData);
      throw new Error(`Gemini API error: ${geminiResponse.status} - ${geminiData.error?.message || 'Unknown error'}`);
    }
    
    let rawResponse = geminiData.candidates[0]?.content?.parts[0]?.text?.trim();
    
    if (!rawResponse) {
      throw new Error('Tidak ada hasil terjemahan dari Gemini');
    }

    let translatedText = rawResponse;
    let transliteration = '';

    // --- PARSING JSON RESPON ---
    if (needsTransliteration) {
        try {
            // Bersihkan markdown jika Gemini tidak sengaja menambahkannya (misal ```json ... ```)
            const cleanJson = rawResponse.replace(/```json|```/g, '').trim();
            const parsedData = JSON.parse(cleanJson);
            
            translatedText = parsedData.translatedText;
            transliteration = parsedData.transliteration;
        } catch (e) {
            console.error("Gagal parsing JSON transliterasi:", e);
            // Fallback: jika gagal parse, anggap seluruh respon adalah terjemahan
            translatedText = rawResponse;
        }
    }

    res.json({
      translatedText,
      transliteration, // Mengirim cara baca ke frontend
      fromLanguage: fromLanguageName,
      toLanguage: toLanguageName,
      originalText: text
    });

  } catch (error) {
    console.error('Translation error:', error);
    res.status(500).json({ 
      error: 'Terjadi kesalahan saat menerjemahkan teks',
      details: error.message 
    });
  }
});

app.post('/api/detect-language', async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text harus diisi' });
    }

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
        contents: [
          {
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],
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

    res.json({
      detectedLanguage: detectedLang,
      languageName: supportedLanguages[detectedLang]
    });

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
  res.status(404).json({ error: 'Endpoint tidak ditemukan' });
});

app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});