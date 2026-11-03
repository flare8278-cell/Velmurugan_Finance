import { mkdir, copyFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const output = new URL('dist/', root);
await mkdir(output, { recursive: true });
const assets = ['index.html', 'workspace.css'];
// Refuse to publish unexpected content left by a different build.
const unexpected = (await readdir(output)).filter(name => !assets.includes(name));
if (unexpected.length) throw new Error(`Unexpected files in dist: ${unexpected.join(', ')}. Use a clean output directory.`);
for (const name of assets) await copyFile(new URL(name, root), new URL(name, output));
console.log(`Built demo: ${fileURLToPath(output)} (${assets.length} public files).`);
