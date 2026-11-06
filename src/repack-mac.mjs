// Перепаковка macOS: подпись ad-hoc + стилизованный DMG (фон-подсказка + ярлык «Программы»)
// + обязательная верификация (Review Focus №5).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync, existsSync, mkdirSync, cpSync, symlinkSync } from 'node:fs';
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
 * Сборка содержимого DMG: приложение + ярлык на /Applications + фон с подсказкой.
 * @param {string} appDir путь к .app
 * @param {string} workDir рабочий каталог (стейджинг создаётся внутри)
 * @param {object} opts { style: boolean } — style=false пропускает Finder-оформление (для тестов)
 */
export function stageDmgContents(appDir, workDir, { style = true } = {}) {
  const staging = path.join(workDir, 'dmg-stage');
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(path.join(staging, '.background'), { recursive: true });

  const appName = path.basename(appDir);
  cpSync(appDir, path.join(staging, appName), { recursive: true });
  try { symlinkSync('/Applications', path.join(staging, 'Программы')); } catch { /* существует */ }

  const bgSvg = path.resolve('assets', 'dmg-bg.svg');
  const bgPng = path.join(staging, '.background', 'bg.png');
  if (existsSync(bgSvg)) {
    const tmp = path.join(workDir, 'bg-tmp');
    mkdirSync(tmp, { recursive: true });
    sh('qlmanage', ['-t', '-s', '1400', '-o', tmp, bgSvg]);
    const rendered = path.join(tmp, 'dmg-bg.svg.png');
    cpSync(rendered, bgPng);
  }

  if (style) {
    const canonical = staging.replace(/^\/tmp/, '/private/tmp'); // Finder не любит symlink-путь
    const script = `
tell application "Finder"
  set stageFolder to POSIX file "${canonical}" as alias
  open stageFolder
  delay 1
  set theWindow to window 1
  set bounds of theWindow to {200, 120, 900, 560}
  set current view of theWindow to icon view
  set icon size of icon view options of theWindow to 110
  tell icon view options of theWindow
    set background picture to (POSIX file "${canonical}/.background/bg.png" as alias)
  end tell
  set position of item "${appName}" of stageFolder to {130, 210}
  set position of item "Программы" of stageFolder to {530, 210}
  close theWindow
end tell`;
    const res = spawnSync('osascript', ['-e', script]);
    // оформление — не блокирует сборку: даже без .DS_Store-стилей dmg валиден
    if (res.status !== 0) console.warn('dmg-стилизация не удалась (не критично):', String(res.stderr).slice(0, 200));
  }
  return staging;
}

/**
 * Подписывает .app ad-hoc, собирает DMG со стилизованным содержимым.
 * Провал верификации = исключение.
 * @returns {{dmgPath: string, shaLine: string}}
 */
export function repackMac({ appDir, outDir, version, workDir = '/tmp' }) {
  sh('xattr', ['-cr', appDir]);
  sh('codesign', ['-f', '-s', '-', '--deep', appDir]);
  sh('codesign', ['--verify', '--deep', appDir]);

  const staging = stageDmgContents(appDir, workDir);
  const dmgPath = path.resolve(path.join(outDir, artifactName('mac', version)));
  rmSync(dmgPath, { force: true });
  sh('hdiutil', ['create', '-volname', 'Молния', '-srcfolder', staging, '-fs', 'HFS+', '-format', 'UDZO', dmgPath]);
  const verify = spawnSync('hdiutil', ['verify', dmgPath], { encoding: 'utf8' });
  if (verify.status !== 0) {
    throw new Error(`DMG не прошёл верификацию: ${verify.stderr?.slice(0, 300)}`);
  }
  return { dmgPath, shaLine: shaLine(dmgPath) };
}
