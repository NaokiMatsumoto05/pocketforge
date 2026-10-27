import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeServerUrl } from '@pocketforge/core';
import { buildApp } from '../src/app.ts';
import { serverConfig } from '../src/config.ts';
test('phone endpoints require an HTTPS origin and reject loopback, credentials and paths', () => {
  assert.equal(normalizeServerUrl('  https://api.example.com/  '), 'https://api.example.com');
  for (const url of [
    'http://api.example.com',
    'https://localhost',
    'https://localhost.',
    'https://app.localhost',
    'https://127.0.0.1',
    'https://127.2.3.4',
    'https://2130706433',
    'https://0x7f000001',
    'https://[::1]',
    'https://[::]',
    'https://[::ffff:127.0.0.1]',
    'https://0.0.0.0',
    'https://user:password@api.example.com',
    'https://api.example.com/api',
    'https://api.example.com/?secret=a',
    'https://api.example.com/#token',
    '',
  ])
    assert.throws(() => normalizeServerUrl(url), url);
});
test('production config requires a durable vault key and exact HTTPS origins', () => {
  const env = {
    NODE_ENV: 'production',
    VAULT_KEY: 'a'.repeat(64),
    PUBLIC_ORIGIN: 'https://api.example.com',
  };
  const config = serverConfig(env);
  assert.equal(config.allowRegistration, false);
  assert.deepEqual(config.origins, ['https://api.example.com']);
  assert.throws(() => serverConfig({ ...env, VAULT_KEY: '' }));
  assert.throws(() => serverConfig({ ...env, PUBLIC_ORIGIN: 'http://api.example.com' }));
  assert.throws(() => serverConfig({ ...env, ALLOWED_ORIGINS: '*' }));
  assert.throws(() =>
    serverConfig({ ...env, ALLOWED_ORIGINS: env.PUBLIC_ORIGIN + ',http://other.example.com' }),
  );
  assert.throws(() => serverConfig({ ...env, TRUST_PROXY: 'true' }));
});
test('mobile bearer sessions work behind a trusted HTTPS proxy and never fall back to cookies', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pocketforge-phone-'));
  const { app, store } = await buildApp({
    dataDir: dir,
    production: true,
    allowRegistration: false,
    origins: ['https://api.example.com'],
    trustProxy: 'loopback',
  });
  try {
    await store.createUser('PhoneOwner', 'phone-test-password');
    const headers = { 'x-forwarded-proto': 'https', 'x-client': 'mobile' };
    const health = await app.inject('/api/health');
    assert.equal(health.json().service, 'pocketforge');
    assert.equal(health.json().registrationAllowed, false);
    assert.equal((await app.inject('/api/projects')).statusCode, 403);
    assert.equal(
      (await app.inject({ url: '/api/projects', remoteAddress: '203.0.113.2', headers }))
        .statusCode,
      403,
    );
    const credentials = { name: 'PhoneOwner', password: 'phone-test-password' };
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers,
      payload: credentials,
    });
    assert.equal(login.statusCode, 200, login.body);
    assert.equal(login.headers['set-cookie'], undefined);
    const token = login.json().token;
    const auth = { ...headers, authorization: 'Bearer ' + token };
    const project = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: auth,
      payload: { name: 'Phone flow' },
    });
    assert.equal(project.statusCode, 200, project.body);
    assert.equal(
      (await app.inject({ url: '/api/projects', headers, cookies: { pf_session: token } }))
        .statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          url: '/api/projects',
          headers: { ...auth, origin: 'https://evil.example' },
        })
      ).statusCode,
      403,
    );
    const web = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-forwarded-proto': 'https' },
      payload: credentials,
    });
    assert.equal(web.json().token, undefined);
    assert.match(String(web.headers['set-cookie']), /HttpOnly/);
    assert.match(String(web.headers['set-cookie']), /Secure/);
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: auth });
    assert.equal((await app.inject({ url: '/api/projects', headers: auth })).statusCode, 401);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('forwarded HTTPS headers are not trusted unless explicitly configured', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pocketforge-proxy-'));
  const { app } = await buildApp({ dataDir: dir, production: true });
  try {
    assert.equal(
      (await app.inject({ url: '/api/projects', headers: { 'x-forwarded-proto': 'https' } }))
        .statusCode,
      403,
    );
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
