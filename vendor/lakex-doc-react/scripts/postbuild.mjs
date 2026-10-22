// Copy the framework type declaration (lakex.d.ts) next to the bundled
// lakex.js so that the emitted dist/index.d.ts can resolve `Doc`'s types.
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const src = 'src/components/lakex/lakex.d.ts';
const destDir = 'dist/components/lakex';
const dest = `${destDir}/lakex.d.ts`;

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log(`copied ${src} -> ${dest}`);

// Remove CSS imports from .d.ts files to avoid type errors in consuming projects.
function removeCssImports(dir) {
  readdirSync(dir).forEach(file => {
    const fullPath = join(dir, file);
    const stat = statSync(fullPath);
    
    if (stat.isDirectory()) {
      removeCssImports(fullPath);
    } else if (file.endsWith('.d.ts')) {
      const content = readFileSync(fullPath, 'utf8');
      const newContent = content.replace(/^import ["']\.?\/.*\.css["'];?\r?\n/mg, '');
      if (content !== newContent) {
        writeFileSync(fullPath, newContent);
        console.log(`removed CSS imports from ${fullPath}`);
      }
    }
  });
}

removeCssImports('dist');
