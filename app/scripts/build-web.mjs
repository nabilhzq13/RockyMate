// Runs the repository's build.py (python on Windows, python3 elsewhere), which
// writes app/www/index.html with the app edition, the fonts and the bridge.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const py of process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python']) {
  const r = spawnSync(py, ['build.py'], { cwd: repo, stdio: 'inherit' });
  if (!r.error) process.exit(r.status ?? 0);
}
console.error('Python 3 is needed to run build.py'); process.exit(1);
