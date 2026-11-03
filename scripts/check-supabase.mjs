// Read-only connection check. Does not migrate the database or modify records.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function parseEnv(text) {
  const result = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[match[1]] = value;
  }
  return result;
}

export function validateConfig(config) {
  const url = new URL(config.SUPABASE_URL || 'https://missing.invalid');
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('Set SUPABASE_URL to the project HTTPS URL.');
  if (url.hostname.startsWith('YOUR_') || url.hostname.includes('your_project')) throw Error('Replace the project URL placeholder.');
  const key = config.SUPABASE_PUBLISHABLE_KEY || '';
  if (!key || key.includes('YOUR_') || key.startsWith('sb_secret_')) throw Error('Set a publishable key, not a secret key.');
  if (!key.startsWith('sb_publishable_')) {
    let payload;
    try { payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()); } catch { throw Error('Use a Supabase publishable or legacy anon key.'); }
    if (payload.role !== 'anon') throw Error('Only a publishable or legacy anon key is allowed.');
  }
  return { url: url.origin, key };
}

async function main() {
  let local = {};
  try { local = parseEnv(await readFile(new URL('../.env.local', import.meta.url), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const { url, key } = validateConfig({ ...local, ...process.env });
  const response = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Error(`Supabase rejected the connection (HTTP ${response.status}).`);
  await response.json();
  console.log('PASS: Supabase Auth is reachable with the configured public application key.');
  console.log('This check does not verify migrations, login, RLS or financial workflows.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
