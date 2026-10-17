// Copies the typefaces the page uses (latin, woff2) from @fontsource into the
// repository's web/fonts/, with their licences. build.py serves them with the
// website and bundles them into the app, so no page loads fonts from Google.
// Only needed when the fonts change: web/fonts/ is committed.
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)), app = join(here, '..');
const out = join(app, '..', 'web', 'fonts'); mkdirSync(out, { recursive: true });
const FACES = [['barlow', [400, 500, 600, 700]], ['barlow-condensed', [500, 600, 700]], ['permanent-marker', [400]]];
let n = 0;
for (const [pkg, weights] of FACES) {
  const dir = join(app, 'node_modules', '@fontsource', pkg);
  if (!existsSync(dir)) throw new Error('missing ' + dir + ' (run npm install in app/)');
  for (const w of weights) { copyFileSync(join(dir, 'files', `${pkg}-latin-${w}-normal.woff2`), join(out, `${pkg}-latin-${w}-normal.woff2`)); n++; }
  copyFileSync(join(dir, 'LICENSE'), join(out, `LICENSE-${pkg}.txt`));
}
console.log(`fonts: copied ${n} files and their licences to web/fonts/`);
