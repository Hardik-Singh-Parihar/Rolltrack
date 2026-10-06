// Rebuilds docs/ (the static web demo) from extension/. Run after you update the extension:
//   node scripts/build-demo.mjs
// docs/ = the extension's dashboard files + demo-seed.js. Nothing else from the extension
// (background.js, content.js, manifest.json) is published to the web.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ext = path.join(root, 'extension');
const docs = path.join(root, 'docs');

fs.mkdirSync(docs, { recursive: true });
for (const p of ['assets', 'icons', 'index.html', 'demo-seed.js']) fs.rmSync(path.join(docs, p), { recursive: true, force: true });
fs.cpSync(path.join(ext, 'assets'), path.join(docs, 'assets'), { recursive: true });
if (fs.existsSync(path.join(ext, 'icons'))) fs.cpSync(path.join(ext, 'icons'), path.join(docs, 'icons'), { recursive: true });

let html = fs.readFileSync(path.join(ext, 'index.html'), 'utf8');
const tag = '<script src="./demo-seed.js"></script>';
const marker = '<script type="module"';
if (!html.includes(marker)) throw new Error('index.html has no module script to put the demo seed before');
html = html.replace(marker, tag + '\n    ' + marker);
html = html.replace('<title>RollTrack', '<title>RollTrack (demo)');
fs.writeFileSync(path.join(docs, 'index.html'), html);
fs.copyFileSync(path.join(root, 'scripts', 'demo-seed.js'), path.join(docs, 'demo-seed.js'));
fs.writeFileSync(path.join(docs, '.nojekyll'), ''); // GitHub Pages: serve files as they are
console.log('docs/ rebuilt from extension/ (' + fs.readdirSync(path.join(docs, 'assets')).length + ' asset files)');
