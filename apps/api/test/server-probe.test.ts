import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeServer } from '../../mobile/src/server-probe.ts';

test('connection check waits through a cold-start page, then verifies PocketForge', async () => {
  let count = 0;
  const request = (async (_url, init) => {
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.redirect, 'error');
    return ++count === 1
      ? new Response('Starting', { status: 503 })
      : Response.json({
          service: 'pocketforge',
          status: 'ok',
          version: '0.1.0',
          registrationAllowed: false,
        });
  }) as typeof fetch;
  const result = await probeServer('https://test.example.com', { request, retryMs: 1 });
  assert.equal(count, 2);
  assert.equal(result.registrationAllowed, false);
});

test('connection check rejects a different service and stops retrying at its deadline', async () => {
  await assert.rejects(
    probeServer('https://test.example.com', {
      request: (async () => Response.json({ service: 'other', status: 'ok' })) as typeof fetch,
    }),
    /URL/,
  );
  await assert.rejects(
    probeServer('https://test.example.com', {
      request: (async () => new Response('Starting', { status: 503 })) as typeof fetch,
      timeoutMs: 20,
      retryMs: 100,
    }),
    /起動を待ちました/,
  );
});
