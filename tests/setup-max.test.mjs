import test from 'node:test';
import assert from 'node:assert/strict';
import { setupMax } from '../scripts/setup-max.mjs';

const config = {
  token: 'setup-test-token-never-sent-to-real-api',
  username: '@banquet_test_bot',
  webhookSecret: 'setup_test_webhook_secret',
  publicUrl: 'https://banquet.example/banquet/',
  apiUrl: 'https://max-api.example',
};
const bot = { is_bot: true, username: '@banquet_test_bot', commands: [{ name: 'help', description: 'Помощь' }, { name: 'id', description: 'Старое описание' }] };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

function fixture(respond) {
  const requests = [];
  const output = [];
  return {
    requests, output,
    options: {
      output: line => output.push(line),
      fetchImpl: async (url, options) => {
        const request = { url, method: options.method, headers: options.headers, body: options.body ? JSON.parse(options.body) : undefined };
        requests.push(request);
        if (respond) return respond(request);
        if (url === 'https://max-api.example/me') return json(bot);
        if (url === 'https://max-api.example/subscriptions') return json({ success: true });
        if (url === 'https://max-api.example/me/commands') return json({ success: true });
        throw new Error('Unexpected mocked endpoint');
      },
    },
  };
}

test('MAX setup resolves the bot name, registers the webhook then /id and preserves other commands', async () => {
  const f = fixture();
  const result = await setupMax(config, f.options);
  assert.deepEqual(result, {
    username: 'banquet_test_bot',
    webhookUrl: 'https://banquet.example/banquet/api/max/webhook',
    publicUrl: 'https://banquet.example/banquet',
    appLink: 'https://max.ru/banquet_test_bot?startapp',
  });
  assert.deepEqual(f.requests.map(({ url, method }) => ({ url, method })), [
    { url: 'https://max-api.example/me', method: 'GET' },
    { url: 'https://max-api.example/subscriptions', method: 'POST' },
    { url: 'https://max-api.example/me/commands', method: 'PATCH' },
  ]);
  assert.deepEqual(f.requests[1].body, { url: result.webhookUrl, update_types: ['bot_started', 'bot_stopped', 'message_created'], secret: config.webhookSecret });
  assert.deepEqual(f.requests[2].body, { commands: [{ name: 'help', description: 'Помощь' }, { name: 'id', description: 'Показать мой MAX ID' }] });
  assert.ok(f.requests.every(request => request.headers.Authorization === config.token));
  assert.deepEqual(f.output, [
    'MAX_BOT_USERNAME=banquet_test_bot',
    'Webhook configured: https://banquet.example/banquet/api/max/webhook',
    'Set the Mini App URL in MAX for Business to: https://banquet.example/banquet',
    'Open Mini App: https://max.ru/banquet_test_bot?startapp',
  ]);
  assert.equal(JSON.stringify([result, f.output]).includes(config.token), false);
  assert.equal(JSON.stringify([result, f.output]).includes(config.webhookSecret), false);
});

test('MAX setup can discover an omitted bot username without inventing a destination', async () => {
  const f = fixture(request => request.url.endsWith('/me') ? json({ is_bot: true, username: 'discovered_bot' }) : json({ success: true }));
  const result = await setupMax({ ...config, username: '' }, f.options);
  assert.equal(result.username, 'discovered_bot');
  assert.equal(result.appLink, 'https://max.ru/discovered_bot?startapp');
  assert.deepEqual(f.requests[2].body, { commands: [{ name: 'id', description: 'Показать мой MAX ID' }] });
});

test('a token and configured username mismatch stops before any MAX mutation or success output', async () => {
  const f = fixture();
  await assert.rejects(setupMax({ ...config, username: 'another_bot' }, f.options), /MAX_BOT_USERNAME does not match/);
  assert.deepEqual(f.requests.map(request => request.method), ['GET']);
  assert.deepEqual(f.output, []);
});

test('unconfirmed or failed webhook registration never attempts command registration', async () => {
  for (const status of [200, 503]) {
    const f = fixture(request => request.url.endsWith('/me') ? json(bot) : json({ success: false, message: `${config.token} ${config.webhookSecret}` }, status));
    await assert.rejects(setupMax(config, f.options), error => {
      assert.equal(error.message.includes(config.token), false);
      assert.equal(error.message.includes(config.webhookSecret), false);
      return status === 200 ? error.message === 'MAX did not confirm webhook registration' : error.message.includes('http_error');
    });
    assert.deepEqual(f.requests.map(request => request.method), ['GET', 'POST']);
    assert.deepEqual(f.output, []);
  }
});

test('command registration failure does not print a misleading successful setup', async () => {
  const f = fixture(request => request.url.endsWith('/me') ? json(bot) : request.url.endsWith('/subscriptions') ? json({ success: true }) : json({ success: false }));
  await assert.rejects(setupMax(config, f.options), /MAX did not confirm command registration/);
  assert.deepEqual(f.requests.map(request => request.method), ['GET', 'POST', 'PATCH']);
  assert.deepEqual(f.output, []);
});

test('network errors at every setup stage redact token, secret and provider message content', async () => {
  for (const failedPath of ['/me', '/subscriptions', '/me/commands']) {
    const f = fixture(request => {
      if (new URL(request.url).pathname === failedPath) throw new Error(`Sensitive provider message ${config.token} ${config.webhookSecret}`);
      return request.url.endsWith('/me') ? json(bot) : json({ success: true });
    });
    await assert.rejects(setupMax(config, f.options), { message: 'MAX API request failed: network_error' });
    assert.deepEqual(f.output, []);
  }
});

test('invalid setup credentials or HTTPS configuration fail before any request', async () => {
  for (const overrides of [{ token: '' }, { webhookSecret: '!' }, { publicUrl: 'http://banquet.example' }, { publicUrl: 'https://banquet.example:8443' }, { apiUrl: 'http://max-api.example' }]) {
    const f = fixture();
    await assert.rejects(setupMax({ ...config, ...overrides }, f.options));
    assert.deepEqual(f.requests, []);
    assert.deepEqual(f.output, []);
  }
});
