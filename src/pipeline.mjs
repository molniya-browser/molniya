// Оркестратор Молнии: fetch → unpack → distribution → патчи → repack.
// Запуск: npm run pipeline -- --os mac --tag latest
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, cpSync, existsSync, readdirSync } from 'node:fs';
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from './config.mjs';
import { fetchUpstream } from './fetch-upstream.mjs';
import { buildDistribution } from './build-distribution.mjs';
import { patchOmni, patchAppIdentity } from './patch-brand.mjs';
import { repackMac, shaLine } from './repack-mac.mjs';

function sh(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { maxBuffer: 64 * 1024 * 1024, ...opts });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} → ${res.status}: ${String(res.stderr ?? res.stdout).slice(0, 400)}`);
  }
  return res.stdout;
}

async function unpackMac(dmgPath, workDir) {
  const mnt = path.join(workDir, 'mnt');
  mkdirSync(mnt, { recursive: true });
  sh('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mnt, dmgPath]);
  try {
    const appName = readdirSync(mnt).find((n) => n.endsWith('.app'));
    if (!appName) throw new Error(`В DMG нет .app: ${readdirSync(mnt).join(', ')}`);
    const appDir = path.join(workDir, 'build', CONFIG.brand.name + '.app');
    rmSync(path.join(workDir, 'build'), { recursive: true, force: true });
    mkdirSync(path.dirname(appDir), { recursive: true });
    cpSync(path.join(mnt, appName), appDir, { recursive: true });
    return appDir;
  } finally {
    sh('hdiutil', ['detach', mnt, '-quiet']);
  }
}

async function embedMacIcons(appDir) {
  const assets = path.resolve('assets', 'molniya.icns');
  const res = path.join(appDir, 'Contents', 'Resources');
  if (!existsSync(assets)) return false;
  sh('cp', [assets, path.join(res, 'firefox.icns')]);
  sh('cp', [assets, path.join(res, 'document.icns')]);
  rmSync(path.join(res, 'Assets.car'), { force: true }); // зеновский AppIcon (findings спайка)
  return true;
}

export async function runPipeline({ os, tag = 'latest', workDir = CONFIG.paths.work }) {
  if (!['mac', 'win', 'linux'].includes(os)) throw new Error(`Неизвестная ОС: ${os}`);
  mkdirSync(workDir, { recursive: true });

  const { assetPath, tagName } = await fetchUpstream({ os, tag, destDir: path.join(workDir, 'upstream') });
  const version = `${tagName}-molniya.1`;
  console.log(`[${os}] upstream ${tagName} → ${assetPath}`);

  if (os !== 'mac') throw new Error(`Ветка ${os} реализуется в Task 9/10`);

  const appDir = await unpackMac(assetPath, workDir);
  const contents = path.join(appDir, 'Contents');
  const resources = path.join(contents, 'Resources');

  const ini = await readFile(path.join(resources, 'application.ini'), 'utf8');
  const geckoVersion = ini.match(/^Version=(.+)$/m)?.[1] ?? 'unknown';

  const dist = await buildDistribution(resources, { zenTag: tagName });
  console.log(`[${os}] distribution: ${dist.files.length} файлов, gecko ${geckoVersion}`);

  const omniRes = await patchOmni(path.join(resources, 'browser', 'omni.ja'));
  const idRes = await patchAppIdentity(contents, { platform: 'mac' });
  const icons = await embedMacIcons(appDir);
  console.log(`[${os}] бренд: ${omniRes.replaced} строк; identity: ${idRes.renamedBinary ? 'бинарник переименован' : '—'}; иконки: ${icons ? 'встроены' : 'нет (Task 12)'}`);

  const outDir = CONFIG.paths.dist;
  mkdirSync(outDir, { recursive: true });
  const { dmgPath, shaLine: line } = repackMac({ appDir, outDir, version });
  await appendFile(path.join(outDir, 'SHA256SUMS'), line + '\n');
  console.log(`[${os}] готово: ${dmgPath}`);
  return { artifactPath: dmgPath, version };
}

// CLI
if (process.argv[1] && process.argv[1].endsWith('pipeline.mjs')) {
  const args = process.argv.slice(2);
  const get = (name, def) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : def;
  };
  runPipeline({ os: get('os', 'mac'), tag: get('tag', 'latest'), workDir: get('work', CONFIG.paths.work) })
    .then((r) => { console.log('ВЕРСИЯ:', r.version); process.exit(0); })
    .catch((e) => { console.error('ПАЙПЛАЙН УПАЛ:', e.message); process.exit(1); });
}
