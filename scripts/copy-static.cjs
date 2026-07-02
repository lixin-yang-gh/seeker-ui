// copy-static.cjs
const fs = require('fs-extra');
const path = require('path');

async function copyStaticFiles() {
  try {
    // ────────────────────────────────────────────────
    // Renderer static assets
    // ────────────────────────────────────────────────
    const rendererSrcDir  = path.join(__dirname, '../src/renderer');
    const rendererDistDir = path.join(__dirname, '../dist/renderer');

    await fs.ensureDir(rendererDistDir);

    // Copy index.html
    const indexHtmlSrc = path.join(rendererSrcDir, 'index.html');
    const indexHtmlDest = path.join(rendererDistDir, 'index.html');

    if (await fs.pathExists(indexHtmlSrc)) {
      await fs.copyFile(indexHtmlSrc, indexHtmlDest);
      console.log('Copied: index.html → dist/renderer');
    } else {
      console.warn(`Warning: index.html not found at ${indexHtmlSrc}`);
    }

    // Copy entire styles folder (if it exists)
    const stylesSrc = path.join(rendererSrcDir, 'styles');
    const stylesDist = path.join(rendererDistDir, 'styles');

    if (await fs.pathExists(stylesSrc)) {
      await fs.copy(stylesSrc, stylesDist);
      console.log('Copied: styles/ → dist/renderer/styles');
    }

    // You can easily add more folders/files here, e.g.:
    // await copyIfExists('public', 'public');

    // ────────────────────────────────────────────────
    // Preload script (most important for your current issue)
    // ────────────────────────────────────────────────
    const mainDistDir = path.join(__dirname, '../dist/main');
    await fs.ensureDir(mainDistDir);

    // You can list possible preload filenames here (in order of preference)
    const possiblePreloadFiles = [
      'preload.mjs',           // preferred (modern ESM)
      'preload.js',            // fallback
      'preload.ts',            // rarely — only if you're not compiling it
    ];

    let preloadCopied = false;

    for (const filename of possiblePreloadFiles) {
      const src = path.join(__dirname, '../src/main', filename);           // adjust if preload is elsewhere

      if (await fs.pathExists(src)) {
        const dest = path.join(mainDistDir, filename);
        await fs.copyFile(src, dest);
        console.log(`Copied preload: ${filename} → dist/main/${filename}`);
        preloadCopied = true;
        break; // stop after first successful copy
      }
    }

    if (!preloadCopied) {
      console.warn(
        '⚠️  No preload file found! Looked for: ' +
        possiblePreloadFiles.map(f => `src/${f}`).join(', ')
      );
      console.warn('Make sure preload.mjs (or .js) exists and is copied to dist/main');
    }

    console.log('\nStatic files & preload copy completed.');
  } catch (err) {
    console.error('Error during static/preload copy:', err);
    process.exitCode = 1;
  }
}

copyStaticFiles();