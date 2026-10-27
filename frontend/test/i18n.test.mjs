// Every text the screens translate must exist in the Chinese dictionary, and placeholders must match.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../src/', import.meta.url));
const zh = JSON.parse(readFileSync(join(src, 'i18n', 'zh.json'), 'utf8'));
const files = (dir) => readdirSync(dir).flatMap(name => { const path = join(dir, name); return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : []; });
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join(',');
// Calls that are not UI text (e.g. tx used on data keys) and example placeholders.
const ignore = new Set(['e.g. SHP-2026-014']);

test('every t(\'...\') text in the screens has a Chinese translation', () => {
  const missing = [];
  for (const file of files(src)) {
    if (/i18n[\/]/.test(file) || /lib[\/]i18n\.tsx$/.test(file)) continue;
    const code = readFileSync(file, 'utf8');
    for (const match of code.matchAll(/\bt\(\s*(['"])((?:\.|(?!\1).)*)\1/g)) {
      const text = match[2].replace(/\'/g, "'").replace(/\\"/g, '"');
      if (!ignore.has(text) && !(text in zh)) missing.push(`${file.slice(src.length)}: ${text}`);
    }
  }
  assert.deepEqual(missing, [], 'Add these to src/i18n/zh.json');
});

test('navigation labels and descriptions are translated', () => {
  const nav = readFileSync(join(src, 'config', 'navigation.ts'), 'utf8');
  const missing = [...nav.matchAll(/label:'([^']+)',icon:\w+,description:'([^']+)'/g)].flatMap(m => [m[1], m[2]]).filter(text => !(text in zh));
  assert.deepEqual(missing, []);
});

test('translations keep their {placeholders} and are not empty', () => {
  const broken = Object.entries(zh).filter(([english, chinese]) => !chinese.trim() || placeholders(english) !== placeholders(chinese)).map(([english]) => english);
  assert.deepEqual(broken, []);
});
