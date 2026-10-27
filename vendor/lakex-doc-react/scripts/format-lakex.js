import fs from 'fs';
import path from 'path';
import { format } from 'prettier';

const url = new URL(import.meta.url);
const filePath = url.pathname;
const __dirname = path.dirname(filePath.replace(/^\/([a-z]:)/i, '$1'));
const inputPath = path.join(__dirname, '../src/components/lakex/lakex.js');
const outputPath = path.join(__dirname, '../src/components/lakex/lakex.js');

const content = fs.readFileSync(inputPath, 'utf-8');

console.log(`Original file size: ${(content.length / 1024 / 1024).toFixed(2)} MB`);

format(content, {
  parser: 'babel',
  printWidth: 120,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: true,
  trailingComma: 'none',
  bracketSpacing: true,
  bracketSameLine: false,
  arrowParens: 'always',
}).then((formatted) => {
  console.log(`Formatted file size: ${(formatted.length / 1024 / 1024).toFixed(2)} MB`);
  fs.writeFileSync(outputPath, formatted, 'utf-8');
  console.log('Successfully formatted lakex.js!');
}).catch((err) => {
  console.error('Formatting failed:', err);
  process.exit(1);
});