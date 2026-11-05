import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assetUrl, pickAsset, MissingAssetError } from '../src/fetch-upstream.mjs';

test('assetUrl строит точный URL скачивания для mac-дмг по тегу', () => {
  assert.equal(
    assetUrl('mac', '1.24b'),
    'https://github.com/zen-browser/desktop/releases/download/1.24b/zen.macos-universal.dmg',
  );
});

test('pickAsset бросает MissingAssetError со списком имеющихся ассетов, когда ожидаемого нет', () => {
  const fixture = [
    { name: 'zen.linux-x86_64.tar.xz' },
    { name: 'zen.macos-universal.dmg' },
    { name: 'zen.source.tar.zst' },
  ];
  assert.throws(
    () => pickAsset('win', fixture),
    (err) => {
      assert.ok(err instanceof MissingAssetError);
      assert.deepEqual(err.available, ['zen.linux-x86_64.tar.xz', 'zen.macos-universal.dmg', 'zen.source.tar.zst']);
      return true;
    },
  );
});

test('pickAsset возвращает ассет, когда ожидаемый есть', () => {
  const fixture = [
    { name: 'zen.installer.exe', browser_download_url: 'https://example/zen.installer.exe' },
  ];
  assert.equal(pickAsset('win', fixture).name, 'zen.installer.exe');
});
