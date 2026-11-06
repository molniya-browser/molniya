// Windows (portable zip): core/ извлекается из NSIS-инсталлятора Zena семёркой
// (проверено локально на macOS — CI для сборки артефакта не нужен).
import path from 'node:path';
import { existsSync, cpSync } from 'node:fs';
import { buildDistribution } from './build-distribution.mjs';
import { patchOmni, patchAppIdentity } from './patch-brand.mjs';
import { patchWindowsExe } from './patch-win-exe.mjs';

// плитки Пуска (VisualElements): какой ассет кладём вместо какой плитки
const VISUAL_ELEMENTS = [
  ['icon70.png', 'VisualElements_70.png'],
  ['icon150.png', 'VisualElements_150.png'],
  ['icon70.png', 'PrivateBrowsing_70.png'],
  ['icon150.png', 'PrivateBrowsing_150.png'],
];

/**
 * Патчит каталог установки (core из инсталлятора или корень на linux):
 * distribution + autoconfig + бренд-omni + идентичность приложения.
 * На win дополнительно: PE-ресурсы exe (иконки, VERSIONINFO) и плитки Пуска.
 */
export async function patchInstallDir(installDir, opts = {}) {
  const { platform = 'win', brandAssets } = opts;
  await buildDistribution(installDir, opts);
  const omniRes = await patchOmni(path.join(installDir, 'browser', 'omni.ja'), { brandAssets, version: opts.version });
  const idRes = await patchAppIdentity(installDir, { platform });

  const winExe = [];
  if (platform === 'win' && brandAssets) {
    for (const name of ['molniya.exe', 'private_browsing.exe']) {
      const exePath = path.join(installDir, name);
      if (existsSync(exePath)) {
        const res = await patchWindowsExe(exePath, { iconDir: brandAssets });
        winExe.push({ name, ...res });
      }
    }
    const veDir = path.join(installDir, 'browser', 'VisualElements');
    if (existsSync(veDir)) {
      for (const [asset, tile] of VISUAL_ELEMENTS) {
        const from = path.join(brandAssets, asset);
        if (existsSync(from)) cpSync(from, path.join(veDir, tile));
      }
    }
  }
  return { ...omniRes, ...idRes, winExe };
}
