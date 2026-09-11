// Pass a management token to npx for one process only. Never print or persist it.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const config = readFileSync('.env.local', 'utf8');
const ref = new URL(config.match(/^VITE_SUPABASE_URL=["']?([^\s"']+)/m)?.[1]).hostname.split('.')[0];
if (readFileSync('supabase/.temp/project-ref', 'utf8').trim() !== ref) throw new Error('Linked project mismatch');
let token = process.env.SUPABASE_ACCESS_TOKEN;
if (process.argv.includes('--stdin-token')) {
  const { createInterface } = await import('node:readline');
  const input = createInterface({ input: process.stdin, terminal: false });
  token = await new Promise(resolve => input.once('line', resolve));
  input.close(); process.stdin.pause();
}
if (!token) { console.error('Supabase management credential is unavailable to this process. No token was printed or saved.'); process.exit(1); }
const args = process.argv.slice(2).filter(arg => arg !== '--stdin-token');
if (args[0] === 'enable-device-auth') {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ external_anonymous_users_enabled: true }), signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Auth configuration HTTP ${response.status}`);
  console.log('Enabled anonymous device sign-ins; other Auth settings preserved.');
} else if (args[0] === 'check') {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Project access HTTP ${response.status}`);
  console.log('Existing Supabase credential can access the linked project.');
} else if (args[0] === 'test-local') {
  const result = spawnSync(process.execPath, ['scripts/test-cloud.mjs'], { env: { ...process.env, SUPABASE_ACCESS_TOKEN: token }, stdio: 'inherit' });
  process.exit(result.status ?? 1);
} else if (args[0] === 'set-redirect') {
  const redirect = new URL(args[1]);
  if (redirect.protocol !== 'https:') throw new Error('HTTPS redirect required');
  const endpoint = `https://api.supabase.com/v1/projects/${ref}/config/auth`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const current = await fetch(endpoint, { headers, signal: AbortSignal.timeout(20000) });
  if (!current.ok) throw new Error(`Auth read HTTP ${current.status}`);
  const config = await current.json();
  const urls = new Set((config.uri_allow_list || '').split(',').filter(Boolean));
  urls.add(redirect.href);
  const response = await fetch(endpoint, { method: 'PATCH', headers, body: JSON.stringify({ uri_allow_list: [...urls].join(',') }), signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Auth redirect HTTP ${response.status}`);
  console.log('Added HTTPS app sign-in redirect; existing Auth settings preserved.');
} else {
  const result = spawnSync('npx', ['supabase', ...args], { env: { ...process.env, SUPABASE_ACCESS_TOKEN: token }, stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
