import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verifyCertHash, fetchCerts, CertPinError } from '../src/certs.mjs';

const fakeCert = Buffer.from('-----BEGIN CERTIFICATE-----\nFAKEPEM\n-----END CERTIFICATE-----\n');
const goodSha = createHash('sha256').update(fakeCert).digest('hex');

test('verifyCertHash: true, когда хеш буфера совпадает с ожидаемым', () => {
  assert.equal(verifyCertHash(fakeCert, goodSha), true);
});

test('verifyCertHash: false при любом несовпадении', () => {
  assert.equal(verifyCertHash(Buffer.from('другой файл'), goodSha), false);
});

test('fetchCerts: при подмененном файле бросает CertPinError с file/expected/actual', async () => {
  const evil = Buffer.from('-----BEGIN CERTIFICATE-----\nЗЛОУМЫШЛЕННИК\n-----END CERTIFICATE-----\n');
  const evilSha = createHash('sha256').update(evil).digest('hex');
  const cfg = [{ file: 'root.crt', url: 'https://example/root.crt', sha256: goodSha }];
  await assert.rejects(
    fetchCerts(mkdtempSync(path.join(tmpdir(), 'certs-')), { download: async () => evil, certs: cfg }),
    (err) => {
      assert.ok(err instanceof CertPinError);
      assert.equal(err.file, 'root.crt');
      assert.equal(err.expected, goodSha);
      assert.equal(err.actual, evilSha);
      return true;
    },
  );
});

test('fetchCerts: при совпадении пинов кладёт файлы на диск и возвращает пути', async () => {
  const cfg = [
    { file: 'root.crt', url: 'https://example/root.crt', sha256: goodSha },
    { file: 'sub.crt', url: 'https://example/sub.crt', sha256: goodSha },
  ];
  const dir = mkdtempSync(path.join(tmpdir(), 'certs-'));
  const result = await fetchCerts(dir, { download: async () => fakeCert, certs: cfg });
  assert.equal(result.length, 2);
  assert.deepEqual(readFileSync(result[0].path, 'utf8'), fakeCert.toString('utf8'));
  assert.equal(path.basename(result[1].path), 'sub.crt');
});
