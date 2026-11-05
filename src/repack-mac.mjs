// Перепаковка macOS: подпись ad-hoc + DMG + обязательная верификация (Review Focus №5).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

export function artifactName(os, version) {
  const ext = os === 'mac' ? 'dmg' : os === 'win' ? 'zip' : 'tar.xz';
  return `molniya-${version}-${os}.${ext}`;
}

export function sha256sum(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

export function shaLine(file) {
  return `${sha256sum(file)}  ${path.basename(file)}`;
}

function sh(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { maxBuffer: 64 * 1024 * 1024, ...opts });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} → ${res.status}: ${String(res.stderr ?? res.stdout).slice(0, 400)}`);
  }
  return res.stdout;
}

/**
 * Подписывает .app ad-hoc и собирает DMG. Провал верификации = исключение.
 * @returns {{dmgPath: string, shaLine: string}}
 */
export function repackMac({ appDir, outDir, version }) {
  // xattr перед подписью — иначе «resource fork / detritus not allowed» (findings спайка)
  sh('xattr', ['-cr', appDir]);
  sh('codesign', ['-f', '-s', '-', '--deep', appDir]);
  sh('codesign', ['--verify', '--deep', appDir]);

  const dmgPath = path.join(outDir, artifactName('mac', version));
  rmSync(dmgPath, { force: true }); // hdiutil не перезаписывает существующий файл
  sh('hdiutil', ['create', '-volname', 'Молния', '-srcfolder', appDir, '-fs', 'HFS+', '-format', 'UDZO', dmgPath]);
  const verify = spawnSync('hdiutil', ['verify', dmgPath], { encoding: 'utf8' });
  if (verify.status !== 0) {
    throw new Error(`DMG не прошёл верификацию: ${verify.stderr?.slice(0, 300)}`);
  }
  return { dmgPath, shaLine: shaLine(dmgPath) };
}
