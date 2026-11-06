import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectPlatform } from '../landing/app.js';

const html = readFileSync(new URL('../landing/index.html', import.meta.url), 'utf8');

test('лендинг содержит пять медиамест и настоящий логотип Молнии', () => {
  assert.equal((html.match(/data-media-slot=/g) || []).length, 5);
  for (const name of ['hero', 'workspaces', 'compact', 'glance', 'split']) {
    assert.match(html, new RegExp(`data-media-slot="${name}"`));
  }
  assert.match(html, /src="molniya-512\.png"/);
  assert.doesNotMatch(html, /class="logo"[^>]*><img src="icon\.svg"/);
});

test('лендинг содержит релизы, контакты и авторство', () => {
  for (const href of [
    'https://github.com/molniya-browser/molniya/releases',
    'https://github.com/molniya-browser',
    'https://github.com/molniya-browser/molniya',
    'https://t.me/molniya_browser',
    'https://t.me/good_gis',
    'https://vk.com/good_gis',
    'mailto:gis.glushkov@yandex.ru',
    'https://github.com/good-gis',
    'thank-you-zen.html'
  ]) {
    assert.match(html, new RegExp(`href="${href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  }
  assert.match(html, /Сделано с любовью/);
  assert.match(html, /good_gis/);
});

test('кнопки трёх ОС ведут на релизы и доступны по стабильным id', () => {
  for (const id of ['btn-win', 'btn-mac', 'btn-linux']) {
    assert.match(html, new RegExp(`id="${id}" href="https://github\\.com/molniya-browser/molniya/releases"`));
  }
  assert.match(html, /id="dl"/);
  assert.match(html, /id="dl-hint"/);
});

test('detectPlatform: отличает desktop ОС и не принимает iPhone за macOS', () => {
  assert.equal(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'win');
  assert.equal(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), 'mac');
  assert.equal(detectPlatform('Mozilla/5.0 (X11; Linux x86_64)'), 'linux');
  assert.equal(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), 'unknown');
  assert.equal(detectPlatform('Unknown'), 'unknown');
});

test('медиаслоты используют локальные MP4 с тихим зацикленным воспроизведением', () => {
  const videos = {
    hero: 'demo-main.mp4',
    workspaces: 'spaces.mp4',
    compact: 'full-screen.mp4',
    glance: 'link-preview.mp4',
    split: 'split-screen.mp4'
  };
  assert.equal((html.match(/<video /g) || []).length, 5);
  for (const [slot, file] of Object.entries(videos)) {
    assert.match(html, new RegExp(`data-media-slot="${slot}"[^>]*>\\s*<video src="video/${file}" autoplay muted loop playsinline`));
  }
  assert.doesNotMatch(html, /src="video\/[^"]+\.mov"/);
});
