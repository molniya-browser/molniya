// Сертификаты Минцифры: скачивание только с официального gu-st.ru с проверкой SHA256-пина.
// Пин не совпал (ротация/подмена) — CertPinError, пайплайн падает (Review Focus №3).
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CONFIG } from './config.mjs';

export class CertPinError extends Error {
  constructor(file, expected, actual) {
    super(`Сертификат «${file}» не совпал с пином: ожидали sha256=${expected}, получили ${actual}. ` +
      'Возможна ротация корня Минцифры — проверить gu-st.ru и осознанно обновить пин в src/config.mjs.');
    this.name = 'CertPinError';
    this.file = file;
    this.expected = expected;
    this.actual = actual;
  }
}

export function verifyCertHash(buffer, expected) {
  const actual = createHash('sha256').update(buffer).digest('hex');
  return actual === String(expected).toLowerCase();
}

function curlDownload(url) {
  const res = spawnSync('curl', ['-sSLf', '--max-time', '120', url], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (res.status !== 0) {
    throw new Error(`Не удалось скачать ${url}: curl → ${res.status} ${res.stderr?.slice(0, 200)}`);
  }
  return Buffer.from(res.stdout, 'utf8'); // PEM — ASCII-текст
}

export async function fetchCerts(destDir, { download = curlDownload, certs = CONFIG.certs } = {}) {
  mkdirSync(destDir, { recursive: true });
  const written = [];
  for (const cert of certs) {
    const buf = await download(cert.url);
    const actual = createHash('sha256').update(buf).digest('hex');
    if (actual !== String(cert.sha256).toLowerCase()) {
      throw new CertPinError(cert.file, cert.sha256, actual);
    }
    const dest = path.join(destDir, cert.file);
    await writeFile(dest, buf);
    written.push({ file: cert.file, path: dest });
  }
  return written;
}
