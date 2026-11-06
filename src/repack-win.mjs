// Windows (portable zip): core/ извлекается из NSIS-инсталлятора Zena семёркой
// (проверено локально на macOS — CI для сборки артефакта не нужен).
import path from 'node:path';
import { buildDistribution } from './build-distribution.mjs';
import { patchOmni, patchAppIdentity } from './patch-brand.mjs';

/**
 * Патчит каталог установки (core из инсталлятора или корень на linux):
 * distribution + autoconfig + бренд-omni + идентичность приложения.
 */
export async function patchInstallDir(installDir, opts = {}) {
  const { platform = 'win', brandAssets } = opts;
  await buildDistribution(installDir, opts);
  const omniRes = await patchOmni(path.join(installDir, 'browser', 'omni.ja'), { brandAssets, version: opts.version });
  const idRes = await patchAppIdentity(installDir, { platform });
  return { ...omniRes, ...idRes };
}
