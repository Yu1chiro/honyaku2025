// build.js (Versi BARU dengan esbuild - "Seperti Vite")
const { minify: minifyHtml } = require('html-minifier-terser');
const esbuild = require('esbuild'); // <-- GANTI: Pakai esbuild
const glob = require('glob');
const fs = require('fs/promises');
const path = require('path');

const sourceDir = 'dev';
const outDir = 'public';

async function build() {
  try {
    console.log('🚀 Memulai proses build dengan esbuild...');

    // 1. Hapus folder 'public'
    await fs.rm(outDir, { recursive: true, force: true });
    await fs.mkdir(outDir, { recursive: true });

    // 2. TEMUKAN, BUNDLE, dan MINIFY semua file JavaScript
    //    Kita cari semua file .js di 'dev', kecuali di root 'dev' itu sendiri
    const jsFiles = glob.sync(`${sourceDir}/**/*.js`, { 
        ignore: `${sourceDir}/*.js` // Abaikan file seperti dev.js
    });
    
    if (jsFiles.length > 0) {
      console.log(`🔒 Menemukan ${jsFiles.length} file JavaScript untuk di-bundle...`);
      
      // Ini adalah keajaibannya!
      // esbuild akan mengambil SEMUA file JS dan mem-bundle-nya
      await esbuild.build({
        entryPoints: jsFiles,      // <-- Input: semua file .js
        outdir: outDir,           // <-- Output: folder 'public'
        bundle: true,             // <-- KUNCI: Gabungkan semua import!
        minify: true,             // <-- KUNCI: Minify (gantikan Terser)
        sourcemap: true,          // <-- Opsional: bagus untuk debugging
        format: 'iife',           // <-- Buat agar aman dijalankan di browser
        target: 'es6',            // <-- Target browser modern
        logLevel: 'info',         // <-- Tampilkan log
      });
      
      console.log('✅ File JavaScript berhasil di-bundle dan di-minify.');
    }

    // 3. Cari, minify, dan salin semua file HTML
    const htmlFiles = glob.sync(`${sourceDir}/**/*.html`);

    if (htmlFiles.length > 0) {
      console.log(`📄 Menemukan ${htmlFiles.length} file HTML untuk di-minify...`);

      for (const filePath of htmlFiles) {
        const fileContent = await fs.readFile(filePath, 'utf8');
        
        const minifiedHtml = await minifyHtml(fileContent, {
          removeComments: true,
          collapseWhitespace: true,
          minifyCSS: true,
          // Minify <script> inline. Kita pakai esbuild untuk ini juga!
          minifyJS: (text) => {
            try {
              const result = esbuild.transformSync(text, {
                minify: true,
                target: 'es6',
              });
              return result.code;
            } catch (e) {
              console.warn("Gagal minify JS inline:", e);
              return text; // Kembalikan teks asli jika gagal
            }
          }, 
        });

        const finalHtml = minifiedHtml;
        const relativePath = path.relative(sourceDir, filePath);
        const destinationPath = path.join(outDir, relativePath);
        
        await fs.mkdir(path.dirname(destinationPath), { recursive: true });
        await fs.writeFile(destinationPath, finalHtml);
      }
      console.log('✅ File HTML berhasil di-minify dan disalin.');
    }

    console.log(`\n✨ Proses build selesai! Cek folder "${outDir}".`);

  } catch (e) {
    console.error('❌ Terjadi kesalahan saat proses build:', e.message);
    process.exit(1);
  }
}

build();