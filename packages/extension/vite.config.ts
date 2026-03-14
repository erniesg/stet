import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync } from 'fs';

function copyExtensionAssets() {
  return {
    name: 'copy-extension-assets',
    closeBundle() {
      const dist = resolve(__dirname, 'dist');

      copyFileSync(resolve(__dirname, 'manifest.json'), resolve(dist, 'manifest.json'));
      copyFileSync(
        resolve(__dirname, 'src/styles/annotations.css'),
        resolve(dist, 'annotations.css'),
      );
      copyFileSync(
        resolve(__dirname, '..', '..', 'data', 'wordlist-en.txt'),
        resolve(dist, 'wordlist-en.txt'),
      );

      const iconsDir = resolve(dist, 'assets/icons');
      if (!existsSync(iconsDir)) {
        mkdirSync(iconsDir, { recursive: true });
      }
      for (const size of ['16', '48', '128']) {
        const icon = `icon-${size}.png`;
        const src = resolve(__dirname, 'assets/icons', icon);
        if (existsSync(src)) {
          copyFileSync(src, resolve(iconsDir, icon));
        }
      }
    },
  };
}

/**
 * Main build: popup, options (HTML pages), background service worker.
 * Content script is built separately via vite.content.config.ts.
 */
export default defineConfig({
  plugins: [preact(), copyExtensionAssets()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: 'popup.html',
        options: 'options.html',
        background: 'src/background/service-worker.ts',
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
  },
});
