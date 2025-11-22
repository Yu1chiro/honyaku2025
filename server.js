const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Bahasa yang didukung
const supportedLanguages = {
  'id': 'Bahasa Indonesia',
  'en': 'English',
  'ja': '日本語 (Japanese)'
};

// Route untuk halaman utama
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// Route untuk mendapatkan daftar bahasa
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

    // Siapkan prompt untuk Gemini
    const fromLanguageName = supportedLanguages[fromLang];
    const toLanguageName = supportedLanguages[toLang];
    
    const prompt = `Terjemahkan teks berikut dari ${fromLanguageName} ke ${toLanguageName}. 
Berikan HANYA hasil terjemahan tanpa penjelasan tambahan:

"${text}"`;

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
    
    // Ekstrak teks hasil terjemahan
    const translatedText = geminiData.candidates[0]?.content?.parts[0]?.text?.trim();
    
    if (!translatedText) {
      throw new Error('Tidak ada hasil terjemahan dari Gemini');
    }

    res.json({
      translatedText,
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

// Route untuk detect bahasa (opsional)
app.post('/api/detect-language', async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text harus diisi' });
    }

    // Validasi API key
    if (!process.env.GEMINI_APIKEY) {
      return res.status(500).json({ error: 'GEMINI_APIKEY tidak dikonfigurasi' });
    }

    const prompt = `Deteksi bahasa dari teks berikut dan berikan HANYA kode bahasa (id untuk Indonesia, en untuk Inggris, ja untuk Jepang):

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
    
    // Normalisasi hasil deteksi
    if (detectedLang.includes('id') || detectedLang.includes('indonesia')) {
      detectedLang = 'id';
    } else if (detectedLang.includes('en') || detectedLang.includes('english')) {
      detectedLang = 'en';
    } else if (detectedLang.includes('ja') || detectedLang.includes('japanese')) {
      detectedLang = 'ja';
    } else {
      detectedLang = 'en'; // default ke English
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

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Terjadi kesalahan server' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint tidak ditemukan' });
});

app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});