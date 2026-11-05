// Скачивание официальных артефактов релизов Zen Browser (upstream).
// Никаких частичных успехов: ожидаемого ассета нет — исключение (Review Focus №4).
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { CONFIG } from './config.mjs';

export class MissingAssetError extends Error {
  constructor(pattern, available) {
    super(`Upstream-релиз не содержит ожидаемый ассет «${pattern}». Имеются: ${available.join(', ')}`);
    this.name = 'MissingAssetError';
    this.pattern = pattern;
    this.available = available;
  }
}

export function assetUrl(os, tag) {
  const name = CONFIG.upstream.assets[os];
  if (!name) throw new Error(`Неизвестная ОС «${os}» (ожидаю одну из: ${Object.keys(CONFIG.upstream.assets).join(', ')})`);
  return `https://github.com/${CONFIG.upstream.owner}/${CONFIG.upstream.repo}/releases/download/${tag}/${name}`;
}

export function pickAsset(os, assets) {
  const expected = CONFIG.upstream.assets[os];
  const found = assets.find((a) => a.name === expected);
  if (!found) throw new MissingAssetError(expected, assets.map((a) => a.name));
  return found;
}

function api(pathname) {
  return `https://api.github.com/repos/${CONFIG.upstream.owner}/${CONFIG.upstream.repo}${pathname}`;
}

function curl(args) {
  const res = spawnSync('curl', ['-sSLf', '--max-time', '600', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) {
    throw new Error(`curl ${args.join(' ')} → код ${res.status}: ${res.stderr?.slice(0, 300)}`);
  }
  return res.stdout;
}

export async function fetchRelease(tag) {
  const pathname = tag === 'latest' ? '/releases/latest' : `/releases/tags/${encodeURIComponent(tag)}`;
  return JSON.parse(curl([api(pathname)]));
}

export async function fetchUpstream({ os, tag = 'latest', destDir }) {
  const release = await fetchRelease(tag);
  const asset = pickAsset(os, release.assets ?? []);
  mkdirSync(destDir, { recursive: true });
  const assetPath = path.join(destDir, asset.name);
  curl(['-o', assetPath, asset.browser_download_url]);
  return { assetPath, tagName: release.tag_name };
}
