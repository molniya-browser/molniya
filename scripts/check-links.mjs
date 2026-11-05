// Проверка ссылок лендинга: битая кнопка скачивания не должна молчать (Review Focus).
// Использование: node scripts/check-links.mjs [файлы...]
import { readFile } from 'node:fs/promises';

export function extractLinks(html) {
  const out = [];
  const re = /(?:href|src)="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const url = m[1];
    if (/^(https?:)?\/\//.test(url)) out.push(url.replace(/^\/\//, 'https://'));
  }
  return [...new Set(out)];
}

export async function runChecks(files, fetchImpl = fetch) {
  const failures = [];
  for (const f of files) {
    const links = extractLinks(await readFile(f, 'utf8'));
    for (const url of links) {
      try {
        const res = await fetchImpl(url, { method: 'HEAD', redirect: 'follow' });
        if (!res.ok) failures.push(`${f}: ${url} → HTTP ${res.status}`);
      } catch (e) {
        failures.push(`${f}: ${url} → ${e.message}`);
      }
    }
  }
  return failures;
}

if (process.argv[1] && process.argv[1].endsWith('check-links.mjs')) {
  const files = process.argv.slice(2).length ? process.argv.slice(2) : ['landing/index.html', 'landing/thank-you-zen.html'];
  runChecks(files).then((failures) => {
    if (failures.length) {
      console.error('БИТЫЕ ССЫЛКИ:\n' + failures.join('\n'));
      process.exit(1);
    }
    console.log('Все ссылки живы: ' + files.join(', '));
  });
}
