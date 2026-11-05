// Linux: tar.xz пересборка. Стартовый скрипт переименован в molniya, .desktop ссылается на него.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

function sh(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { maxBuffer: 64 * 1024 * 1024, ...opts });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(' ')} → ${res.status}: ${String(res.stderr).slice(0, 300)}`);
  return res.stdout;
}

export function repackLinux({ srcDir, outDir, version }) {
  // бинарник zen → molniya (главный исполняемый файл linux-сборки)
  try { sh('mv', [path.join(srcDir, 'zen'), path.join(srcDir, 'molniya')]); } catch { /* уже переименован */ }
  // корневой каталог архива: zen → molniya
  let parent = path.dirname(srcDir);
  let name = path.basename(srcDir);
  if (name === 'zen') {
    const renamed = path.join(parent, 'molniya');
    sh('mv', [srcDir, renamed]);
    srcDir = renamed; name = 'molniya';
  }
  const out = path.resolve(path.join(outDir, `molniya-${version}-linux.tar.xz`));
  sh('tar', ['-cJf', out, '-C', parent, name]);
  return out;
}
