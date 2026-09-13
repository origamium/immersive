import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { request } from 'node:http';
const binary = 'native/.build/debug/acoustic-lab';
const token = randomBytes(32).toString('base64');
const server = spawn(binary, ['avr', 'mock-serve'], { env: { ...process.env, IMMERSIVE_AVR_TEST_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe'] });
let stderr = '';
server.stderr.on('data', data => { stderr += data; });
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Simulator startup timed out')), 15000);
    server.stdout.on('data', data => { if (String(data).includes('SIMULATOR: no hardware')) { clearTimeout(timeout); resolve(); } });
    server.once('exit', () => { clearTimeout(timeout); reject(new Error(`Simulator failed to start: ${stderr.slice(0, 300)}`)); });
  });
  // The simulator-only token is random, ephemeral, and never printed or persisted.
  const base = 'http://127.0.0.1:8765';
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const get = async path => { const response = await fetch(base + path, { headers }); assert.equal(response.status, 200); return response.json(); };
  assert.equal((await fetch(base + '/api/status')).status, 401);
  assert.equal((await fetch(base + '/api/status', { headers: { ...headers, Origin: 'https://example.test' } })).status, 403);
  // Node fetch normalizes Host; use the HTTP client to test the actual wire header.
  const hostileHostStatus = await new Promise((resolve, reject) => {
    const req = request(base + '/api/status', { headers: { ...headers, Host: 'example.test' } }, response => {
      response.resume(); resolve(response.statusCode);
    });
    req.on('error', reject); req.end();
  });
  assert.equal(hostileHostStatus, 403);
  assert.equal((await fetch(base + '/api/operation', { method: 'POST', headers, body: 'x'.repeat(65537) })).status, 413);
  const state = await get('/api/status');
  assert.equal(state.state.simulated, true); assert.equal(state.volume.zone1.volume, -40);
  assert.equal((await get('/api/catalog')).commands.length, 50);
  assert.ok((await get('/api/channel-levels')).channels.some(channel => channel.name === 'C' && channel.value === 24));
  const createdAt = Date.now();
  const operation = { id: randomUUID(), expectedRevision: state.revision, kind: 'volume', zone: 1, value: 40.5, createdAt: new Date(createdAt).toISOString(), expiresAt: new Date(createdAt + 10000).toISOString() };
  const send = body => fetch(base + '/api/operation', { method: 'POST', headers, body: JSON.stringify(body) });
  const response = await send(operation); const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.status, 'succeeded'); assert.equal(result.state.zones.zone1.volume, 40.5);
  const duplicate = await send(operation); assert.equal((await duplicate.json()).id.toLowerCase(), operation.id.toLowerCase());
  assert.equal((await send({ ...operation, id: randomUUID(), value: 41 })).status, 409);
  console.log('PASS: authenticated loopback, Host/Origin rejection, body limit, legacy getters, simulated marker, revision checks, idempotent writes');
} finally {
  if (server.exitCode === null) server.kill('SIGTERM');
}
