import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(line => /^[A-Z_]+=/.test(line)).map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]; }));
const url = new URL(env.VITE_SUPABASE_URL); if (url.protocol !== 'https:') throw new Error('Expected cloud HTTPS endpoint');
const headers = { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY };
for (const [name, path] of [['Auth configuration', '/auth/v1/settings'], ['Acoustic schema', '/rest/v1/workspaces?select=id&limit=0']]) {
  const response = await fetch(new URL(path, url), { headers, signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  console.log(JSON.stringify({ check: name, httpStatus: response.status, ...(name === 'Auth configuration' ? { anonymousSignIns: data.external?.anonymous_users ?? data.anonymous_users_enabled ?? 'inspect dashboard', email: data.external?.email } : { schemaAvailable: response.ok || data.code === '42501', unauthenticatedAccessDenied: data.code === '42501', code: data.code }) }));
}
