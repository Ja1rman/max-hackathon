import test from 'node:test';
import assert from 'node:assert/strict';
import { createMaxBot } from '../server/max-bot.mjs';

const config = {
  token: 'test-bot-token-never-sent-to-real-api',
  username: 'banquet_test_bot',
  webhookSecret: 'test_webhook_secret',
  apiUrl: 'https://max-api.example',
};

function fixture({ fetchImpl, claimUpdate } = {}) {
  const requests = [];
  const claims = new Set();
  const logs = [];
  const bot = createMaxBot(config, {
    claimUpdate: claimUpdate || (async key => {
      if (claims.has(key)) return false;
      claims.add(key);
      return true;
    }),
    logger: { error: message => logs.push(message) },
    fetchImpl: async (url, options) => {
      requests.push({ url, method: options.method, body: JSON.parse(options.body) });
      if (fetchImpl) return fetchImpl(url, options);
      return new Response(JSON.stringify({ message: { body: { mid: 'reply-id' } } }), { status: 200 });
    },
  });
  return { bot, requests, claims, logs, handle: update => bot.handleWebhook({ secretHeader: config.webhookSecret, update }) };
}

function message(text = '/id', mid = 'incoming-id', senderId = 725300710) {
  return { update_type: 'message_created', message: {
    sender: { user_id: senderId, is_bot: false },
    recipient: { chat_type: 'dialog', user_id: 998877 },
    body: { mid, text },
  } };
}

test('/id replies to its verified sender with only that sender ID and restaurant access instructions', async () => {
  const f = fixture();
  const update = message(' \n/id\t');
  // These unrelated IDs and arbitrary payload fields must never choose the recipient or result.
  update.user = { user_id: 111222 };
  update.message.body.user_id = 333444;
  update.message.forward = { sender: { user_id: 555666 } };
  assert.deepEqual(await f.handle(update), { status: 200, body: { ok: true } });
  assert.deepEqual(f.requests, [{
    url: 'https://max-api.example/messages?user_id=725300710',
    method: 'POST',
    body: { text: 'Ваш ID в MAX:\n725300710\n\nПередайте этот ID владельцу сервиса «За столом», чтобы получить доступ к кабинету ресторана.' },
  }]);
  assert.deepEqual(f.logs, []);
  assert.equal(f.claims.size, 1);
});

test('only the exact normalized message body command selects /id; other input retains the welcome', async () => {
  const f = fixture();
  for (const [index, text] of ['/id 111222', '/identity', '/ID', '/id@other_bot', '/start', '', null, { text: '/id' }].entries()) {
    const update = message(text, `non-command-${index}`);
    update.payload = '/id';
    update.message.body.attachments = [{ text: '/id' }];
    assert.equal((await f.handle(update)).status, 200);
    const { body } = f.requests.at(-1);
    assert.ok(body.text.startsWith('Банкет с выбором для каждого гостя.'));
    assert.ok(body.text.includes('Команда /id покажет ваш ID'));
    assert.equal(body.text.includes('725300710'), false);
    assert.equal(body.text.includes('111222'), false);
    assert.equal(body.attachments[0].payload.buttons[0][0].url, 'https://max.ru/banquet_test_bot?startapp');
  }
  assert.equal(f.requests.length, 8);
});

test('/id ignores groups, bot senders and invalid sender IDs without claiming or responding', async () => {
  const f = fixture();
  const group = message();
  group.message.recipient.chat_type = 'chat';
  const channel = message();
  channel.message.recipient.chat_type = 'channel';
  const bot = message();
  bot.message.sender.is_bot = true;
  const missingSender = message();
  delete missingSender.message.sender;
  const missingMid = message();
  delete missingMid.message.body.mid;
  for (const update of [group, channel, bot, missingSender, missingMid, message('/id', 'bad-zero', 0), message('/id', 'bad-negative', -1), message('/id', 'bad-fraction', 1.5), message('/id', 'bad-string', '123&user_id=456')]) {
    assert.deepEqual(await f.handle(update), { status: 200, body: { ok: true, ignored: true } });
  }
  assert.equal(f.requests.length, 0);
  assert.equal(f.claims.size, 0);
});

test('the webhook secret is checked before any /id processing and successful replies are deduplicated', async () => {
  const f = fixture();
  const update = message();
  assert.deepEqual(await f.bot.handleWebhook({ secretHeader: 'wrong_secret', update }), { status: 401, body: { error: 'unauthorized' } });
  assert.equal(f.requests.length, 0);
  assert.equal(f.claims.size, 0);
  assert.equal((await f.handle(update)).status, 200);
  assert.deepEqual(await f.handle(update), { status: 200, body: { ok: true, duplicate: true } });
  assert.equal(f.requests.length, 1);
});

test('/id failure logs exclude messages, IDs, API bodies and secrets and never retry an ambiguous delivery', async () => {
  const f = fixture({ fetchImpl: async () => { throw new Error(`${config.token} ${config.webhookSecret} /id 725300710 sensitive response`); } });
  const update = message();
  assert.equal((await f.handle(update)).status, 200);
  assert.deepEqual(f.logs, ['MAX bot reply delivery failed (network_error); automatic retry suppressed']);
  assert.deepEqual(await f.handle(update), { status: 200, body: { ok: true, duplicate: true } });
  assert.equal(f.requests.length, 1);
});

test('bot_started preserves its invitation link and mentions /id without exposing a user ID', async () => {
  const f = fixture();
  assert.equal((await f.handle({ update_type: 'bot_started', timestamp: 1800000000000, user: { user_id: 725300710, is_bot: false }, chat_id: 4321, payload: 'invite_example' })).status, 200);
  const request = f.requests[0];
  assert.equal(request.url, 'https://max-api.example/messages?user_id=725300710');
  assert.ok(request.body.text.includes('Команда /id'));
  assert.equal(request.body.text.includes('725300710'), false);
  assert.equal(request.body.attachments[0].payload.buttons[0][0].url, 'https://max.ru/banquet_test_bot?startapp=invite_example');
});
