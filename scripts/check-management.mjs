import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const value = env.match(/^VITE_SUPABASE_URL=["']?([^\s"']+)/m)?.[1];
const project = new URL(value).hostname.split('.')[0];
try {
  const output = execFileSync('npx', ['supabase', 'projects', 'list', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 });
  const data = JSON.parse(output.slice(output.indexOf('[')));
  console.log(JSON.stringify({ cliAuthenticated: true, targetProjectAccessible: data.some(p => p.id === project) }));
} catch { console.log(JSON.stringify({ cliAuthenticated: false, reason: 'Supabase CLI management authentication is unavailable; public keys cannot apply schema changes.' })); }
