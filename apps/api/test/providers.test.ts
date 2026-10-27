import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIProvider, AnthropicProvider, XAIProvider, GeminiProvider } from '../src/agent.ts';

test('OpenAI Responses contract preserves reasoning and function call outputs', async () => {
  const real = globalThis.fetch;
  let sent: any;
  globalThis.fetch = (async (url: any, init: any) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    sent = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        status: 'completed',
        output: [
          { type: 'reasoning', id: 'r1', summary: [] },
          { type: 'function_call', call_id: 'c1', name: 'list_files', arguments: '{}' },
        ],
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  try {
    const provider = new OpenAIProvider('test-key', 'configured-model'),
      history: any[] = [{ role: 'user', content: 'inspect' }];
    const turn = await provider.next(history, 'system');
    assert.equal(sent.store, false);
    assert.equal(sent.model, 'configured-model');
    assert.equal(sent.tools[0].strict, true);
    assert.equal(turn.calls[0].name, 'list_files');
    provider.append(history, turn, [{ id: 'c1', result: 'App.tsx' }]);
    assert.equal(history[1].type, 'reasoning');
    assert.equal(history[3].type, 'function_call_output');
    assert.equal(history[3].call_id, 'c1');
  } finally {
    globalThis.fetch = real;
  }
});

test('Anthropic contract uses tool_use / tool_result without leaking key in body', async () => {
  const real = globalThis.fetch;
  let sent: any;
  globalThis.fetch = (async (url: any, init: any) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    sent = JSON.parse(init.body);
    assert.ok(!init.body.includes('test-private-key'));
    return new Response(
      JSON.stringify({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'c2', name: 'read_file', input: { path: 'App.tsx' } }],
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  try {
    const provider = new AnthropicProvider('test-private-key', 'configured-model'),
      history: any[] = [{ role: 'user', content: 'inspect' }];
    const turn = await provider.next(history, 'system');
    assert.ok(sent.tools[0].input_schema);
    provider.append(history, turn, [{ id: 'c2', result: 'file contents' }]);
    assert.equal(history[1].role, 'assistant');
    assert.equal(history[2].content[0].type, 'tool_result');
    assert.equal(history[2].content[0].tool_use_id, 'c2');
  } finally {
    globalThis.fetch = real;
  }
});

test('Grok sends tools to xAI and preserves encrypted reasoning through the next request', async (t) => {
  const requests: any[] = [];
  const thought = { type: 'reasoning', id: 'r1', encrypted_content: 'opaque-thought', summary: [] };
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://api.x.ai/v1/responses');
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer xai-test-private-key');
    assert.ok(!String(init.body).includes('xai-test-private-key'));
    const body = JSON.parse(String(init.body));
    requests.push(body);
    return Response.json({
      status: 'completed',
      output:
        requests.length === 1
          ? [
              thought,
              {
                type: 'function_call',
                call_id: 'x1',
                name: 'read_file',
                arguments: '{"path":"App.tsx"}',
              },
            ]
          : [{ type: 'message', content: [{ type: 'output_text', text: '確認しました。' }] }],
    });
  });
  const provider = new XAIProvider('xai-test-private-key', 'chosen-grok-model');
  const history: any[] = [{ role: 'user', content: 'inspect' }];
  const first = await provider.next(history, 'instructions');
  assert.deepEqual(first.calls[0].arguments, { path: 'App.tsx' });
  provider.append(history, first, [{ id: 'x1', result: 'source text' }]);
  assert.equal((await provider.next(history, 'instructions')).text, '確認しました。');
  assert.equal(requests[0].model, 'chosen-grok-model');
  assert.equal(requests[0].store, false);
  assert.deepEqual(requests[0].include, ['reasoning.encrypted_content']);
  assert.deepEqual(requests[1].input[1], thought);
  assert.deepEqual(requests[1].input[3], {
    type: 'function_call_output',
    call_id: 'x1',
    output: 'source text',
  });
});

test('Gemini returns all thought steps and pairs parallel function results by call ID', async (t) => {
  const requests: any[] = [];
  const thought = {
    type: 'thought',
    signature: 'opaque-signature',
    summary: [{ type: 'text', text: 'private summary' }],
  };
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1/interactions');
    assert.equal(new Headers(init.headers).get('x-goog-api-key'), 'google-test-private-key');
    assert.ok(!String(init.body).includes('google-test-private-key'));
    const body = JSON.parse(String(init.body));
    requests.push(body);
    return Response.json(
      requests.length === 1
        ? {
            status: 'requires_action',
            steps: [
              thought,
              { type: 'function_call', id: 'g1', name: 'list_files', arguments: {} },
              {
                type: 'function_call',
                id: 'g2',
                name: 'read_file',
                arguments: { path: 'App.tsx' },
              },
            ],
          }
        : {
            status: 'completed',
            steps: [{ type: 'model_output', content: [{ type: 'text', text: '確認しました。' }] }],
          },
    );
  });
  const provider = new GeminiProvider('google-test-private-key', 'chosen-gemini-model');
  const history: any[] = [{ role: 'user', content: 'inspect' }];
  const first = await provider.next(history, 'instructions');
  assert.equal(first.text, '', 'thought summary must not be presented as an answer');
  assert.equal(first.calls.length, 2);
  provider.append(history, first, [
    { id: 'g2', result: 'source text' },
    { id: 'g1', result: 'App.tsx' },
  ]);
  assert.equal((await provider.next(history, 'instructions')).text, '確認しました。');
  assert.equal(requests[0].model, 'chosen-gemini-model');
  assert.equal(requests[0].store, false);
  assert.equal(requests[0].system_instruction, 'instructions');
  assert.deepEqual(requests[0].input, [
    { type: 'user_input', content: [{ type: 'text', text: 'inspect' }] },
  ]);
  assert.deepEqual(requests[1].input[1], thought);
  assert.deepEqual(requests[1].input[4], {
    type: 'function_result',
    name: 'read_file',
    call_id: 'g2',
    result: [{ type: 'text', text: 'source text' }],
  });
  assert.equal(requests[1].input[5].name, 'list_files');
});

test('new adapters reject service errors, incomplete output and empty success responses', async (t) => {
  const providers = [
    new XAIProvider('test-private-key', 'model'),
    new GeminiProvider('test-private-key', 'model'),
  ];
  let response: Response;
  t.mock.method(globalThis, 'fetch', async () => response);
  for (const provider of providers) {
    for (const status of [401, 429, 503]) {
      response = new Response('test-private-key', { status });
      await assert.rejects(
        provider.next([], 'system'),
        (e: any) =>
          e.statusCode === 502 &&
          e.message.includes(String(status)) &&
          !e.message.includes('test-private-key'),
      );
    }
    for (const status of ['failed', 'incomplete', 'cancelled', 'completed']) {
      response = Response.json({ status, output: [], steps: [] });
      await assert.rejects(provider.next([], 'system'), (e: any) => e.statusCode === 502);
    }
  }
});

test('Anthropic empty, refused and interrupted responses cannot be reported as success', async (t) => {
  let body: any;
  t.mock.method(globalThis, 'fetch', async () => Response.json(body));
  const provider = new AnthropicProvider('test-key', 'model');
  for (const stop_reason of ['max_tokens', 'refusal', 'pause_turn', 'tool_use', 'end_turn']) {
    body = { stop_reason, content: [] };
    await assert.rejects(provider.next([], 'system'), (e: any) => e.statusCode === 502);
  }
});
