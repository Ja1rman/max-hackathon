import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { verifyInitData } from '../server/auth.mjs';
import { createApp, clientIp } from '../server/index.mjs';

const BOT_TOKEN = '123456:only-a-test-token';
function sign({ id = 100, name = 'Александра', timestamp = Math.floor(Date.now() / 1000), extra = {} } = {}) {
  const params = new URLSearchParams({ auth_date: String(timestamp), query_id: 'fixture-query', user: JSON.stringify({ id, first_name: name, last_name: 'Тестовая' }), ...extra });
  const data = [...params].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  params.set('hash', createHmac('sha256', secret).update(data).digest('hex'));
  return params.toString();
}

async function fixture(t, overrides = {}) {
  const app = createApp({ databasePath: ':memory:', botToken: BOT_TOKEN, botUsername: '', maxWebhookSecret: '', demoEnabled: true, restaurantAdminIds: ['900'], publicUrl: 'https://banquet.example', ...overrides });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(() => new Promise((resolve, reject) => app.server.close(error => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = async (path, { token, method = 'GET', body, headers = {} } = {}) => {
    const response = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const content = await response.text();
    return { status: response.status, data: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(content) : content, headers: response.headers };
  };
  const login = async (id = 100, name) => {
    const response = await request('/api/auth/max', { method: 'POST', body: { initData: sign({ id, name }) } });
    assert.equal(response.status, 200);
    return response.data;
  };
  const demo = async body => {
    const response = await request('/api/auth/demo', { method: 'POST', body: { role: 'organizer', ...body } });
    assert.equal(response.status, 200);
    return response.data;
  };
  const event = async token => {
    const restaurants = await request('/api/restaurants', { token });
    const restaurant = restaurants.data[0];
    const response = await request('/api/events', { token, method: 'POST', body: { title: 'Банкет', restaurantId: restaurant.id, date: new Date(Date.now() + 86400000 * 14).toISOString(), deadline: new Date(Date.now() + 86400000 * 10).toISOString(), expectedGuests: 12, budget: 3000000 } });
    assert.equal(response.status, 201);
    return { ...response.data, menu: restaurant.menu };
  };
  return { ...app, request, login, demo, event };
}

test('MAX signature authenticates decoded fields and rejects forgery, duplicate keys and stale/future launches', () => {
  const valid = sign({ name: 'Анна + Мария & друзья' });
  assert.equal(verifyInitData(valid, BOT_TOKEN).name, 'Анна + Мария & друзья Тестовая');
  const forged = new URLSearchParams(valid);
  forged.set('user', JSON.stringify({ id: 900, first_name: 'Attacker' }));
  assert.throws(() => verifyInitData(forged.toString(), BOT_TOKEN), { status: 401 });
  assert.throws(() => verifyInitData(valid + '&auth_date=1', BOT_TOKEN), { status: 401 });
  assert.throws(() => verifyInitData(valid + '&hash=' + '0'.repeat(64), BOT_TOKEN), { status: 401 });
  assert.throws(() => verifyInitData(sign({ timestamp: Math.floor(Date.now() / 1000) - 3601 }), BOT_TOKEN), { status: 401 });
  assert.throws(() => verifyInitData(sign({ timestamp: Math.floor(Date.now() / 1000) + 90 }), BOT_TOKEN), { status: 401 });
  assert.throws(() => verifyInitData(valid, ''), { status: 503 });
});

test('API exposes no secrets, rejects unsigned sessions and derives restaurant role only from verified MAX ID', async t => {
  const f = await fixture(t);
  const config = await f.request('/api/config');
  assert.deepEqual(config.data, { demoEnabled: true, maxConfigured: true, botUsername: '' });
  assert.equal((await f.request('/healthz')).status, 200);
  assert.equal((await f.request('/api/events')).status, 401);
  assert.equal((await f.request('/api/me', { token: 'max_900' })).status, 401);
  const ordinary = await f.login(101);
  assert.equal(ordinary.user.role, 'organizer');
  assert.equal(ordinary.user.demo, false);
  const admin = await f.login(900);
  assert.equal(admin.user.role, 'restaurant');
  assert.equal((await f.request('/api/me', { token: admin.token })).data.id, 'max_900');
});

test('demo sessions isolate catalogs and events; sharing an invitation only grants guest access', async t => {
  const f = await fixture(t);
  const first = await f.demo();
  const second = await f.demo();
  const firstEvent = (await f.request('/api/events', { token: first.token })).data[0];
  const secondEvents = (await f.request('/api/events', { token: second.token })).data;
  assert.notEqual(secondEvents[0].id, firstEvent.id);
  assert.equal((await f.request(`/api/events/${firstEvent.id}`, { token: second.token })).status, 404);
  const restored = await f.demo({ role: 'restaurant', sandbox: first.sandbox });
  assert.equal((await f.request('/api/events', { token: restored.token })).data[0].id, firstEvent.id);
  const visitor = await f.demo({ role: 'restaurant', inviteCode: firstEvent.inviteCode, name: 'Новый гость' });
  assert.equal(visitor.user.role, 'guest');
  assert.equal(visitor.sandbox, null);
  const detail = await f.request(`/api/events/${firstEvent.id}`, { token: visitor.token });
  assert.equal(detail.data.guests.length, 1);
  assert.equal(detail.data.guests[0].id, visitor.user.id);
  assert.equal(detail.data.inviteCode, undefined);
  assert.equal(detail.data.event.budget, undefined);
  assert.equal((await f.request(`/api/events/${firstEvent.id}/approve`, { token: visitor.token, method: 'POST' })).status, 403);
  assert.equal((await f.request('/api/auth/demo', { method: 'POST', body: { role: 'restaurant', sandbox: firstEvent.inviteCode } })).status, 401);
});

test('organizer ownership and invite membership protect unrelated events and dietary notes', async t => {
  const f = await fixture(t);
  const owner = await f.login(100);
  const outsider = await f.login(200);
  const event = await f.event(owner.token);
  assert.equal((await f.request(`/api/events/${event.id}`, { token: outsider.token })).status, 404);
  assert.deepEqual((await f.request('/api/events', { token: outsider.token })).data, []);
  const invite = await f.request(`/api/invites/${event.inviteCode}`);
  assert.equal(invite.data.event.title, 'Банкет');
  assert.equal(invite.data.event.budget, undefined);
  assert.equal(invite.data.event.total, undefined);
  assert.equal(invite.data.guests, undefined);
  await f.request(`/api/events/${event.id}/selection`, { token: owner.token, method: 'PUT', body: { items: [{ menuItemId: event.menu[0].id, quantity: 1 }], notes: 'Личная информация' } });
  assert.equal((await f.request(`/api/invites/${event.inviteCode}/join`, { token: outsider.token, method: 'POST' })).status, 200);
  const outsiderDetail = await f.request(`/api/events/${event.id}`, { token: outsider.token });
  assert.equal(outsiderDetail.data.guests.length, 1);
  assert.equal(JSON.stringify(outsiderDetail.data).includes('Личная информация'), false);
  assert.equal((await f.request(`/api/events/${event.id}/approve`, { token: outsider.token, method: 'POST' })).status, 403);
});

test('selection overwrites atomically, computes kopecks server-side and keeps the event price snapshot', async t => {
  const f = await fixture(t);
  const owner = await f.login(100);
  const guest = await f.login(200);
  const admin = await f.login(900);
  const event = await f.event(owner.token);
  await f.request(`/api/invites/${event.inviteCode}/join`, { token: guest.token, method: 'POST' });
  const dish = event.menu[0];
  const save = body => f.request(`/api/events/${event.id}/selection`, { token: guest.token, method: 'PUT', body });
  const first = await save({ items: [{ menuItemId: dish.id, quantity: 2, price: 1 }], notes: 'Без лука' });
  assert.equal(first.status, 200);
  assert.equal(first.data.total, dish.price * 2);
  assert.equal((await f.request(`/api/restaurants/${event.restaurantId}/menu/${dish.id}`, { token: admin.token, method: 'PATCH', body: { price: 12345, available: false } })).status, 200);
  const second = await save({ items: [{ menuItemId: dish.id, quantity: 3 }], notes: 'Соус отдельно' });
  assert.equal(second.data.total, dish.price * 3);
  assert.equal((await save({ items: [{ menuItemId: dish.id, quantity: 0 }] })).status, 400);
  assert.equal((await save({ items: [{ menuItemId: dish.id, quantity: 1 }, { menuItemId: dish.id, quantity: 1 }] })).status, 400);
  assert.equal((await save({ items: [{ menuItemId: 'unrelated_dish', quantity: 1 }] })).status, 400);
  const detail = (await f.request(`/api/events/${event.id}`, { token: owner.token })).data;
  assert.equal(detail.event.total, dish.price * 3);
  assert.equal(detail.event.responded, 1);
  assert.equal(detail.guests[0].items.length, 1);
  assert.equal(detail.guests[0].notes, 'Соус отдельно');
  assert.deepEqual(detail.summary.map(({ quantity, total }) => ({ quantity, total })), [{ quantity: 3, total: dish.price * 3 }]);
});

test('approval locks quantities and membership, remains idempotent and exposes kitchen CSV', async t => {
  const f = await fixture(t);
  const owner = await f.login(100);
  const guest = await f.login(200, '=SUM(A1:A2)');
  const late = await f.login(300);
  const event = await f.event(owner.token);
  assert.equal((await f.request(`/api/events/${event.id}/approve`, { token: owner.token, method: 'POST', body: { expectedRevision: event.revision } })).status, 409);
  const oldRevision = event.revision;
  await f.request(`/api/invites/${event.inviteCode}/join`, { token: guest.token, method: 'POST' });
  await f.request(`/api/events/${event.id}/selection`, { token: guest.token, method: 'PUT', body: { items: [{ menuItemId: event.menu[0].id, quantity: 2 }], notes: '+dangerous-formula' } });
  assert.equal((await f.request(`/api/events/${event.id}/approve`, { token: owner.token, method: 'POST' })).status, 400);
  assert.equal((await f.request(`/api/events/${event.id}/approve`, { token: owner.token, method: 'POST', body: { expectedRevision: oldRevision } })).status, 409);
  const revision = (await f.request(`/api/events/${event.id}`, { token: owner.token })).data.event.revision;
  const approved = await f.request(`/api/events/${event.id}/approve`, { token: owner.token, method: 'POST', body: { expectedRevision: revision } });
  assert.equal(approved.data.status, 'approved');
  assert.equal((await f.request(`/api/events/${event.id}/approve`, { token: owner.token, method: 'POST' })).data.approvedAt, approved.data.approvedAt);
  assert.equal((await f.request(`/api/events/${event.id}/selection`, { token: guest.token, method: 'PUT', body: { items: [{ menuItemId: event.menu[0].id, quantity: 3 }] } })).status, 409);
  assert.equal((await f.request(`/api/invites/${event.inviteCode}/join`, { token: late.token, method: 'POST' })).status, 409);
  assert.equal((await f.request(`/api/invites/${event.inviteCode}/join`, { token: guest.token, method: 'POST' })).status, 200);
  const csv = await f.request(`/api/events/${event.id}/export.csv`, { token: owner.token });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /^text\/csv/);
  assert.ok(csv.data.includes("'=SUM(A1:A2)"));
  assert.ok(csv.data.includes("'+dangerous-formula"));
  assert.equal((await f.request(`/api/events/${event.id}/export.csv`, { token: guest.token })).status, 403);
});

test('deadline blocks selection but organizer can approve already submitted quantities', async t => {
  const f = await fixture(t);
  const owner = await f.login(100);
  const event = await f.event(owner.token);
  await f.request(`/api/events/${event.id}/selection`, { token: owner.token, method: 'PUT', body: { items: [{ menuItemId: event.menu[0].id, quantity: 1 }] } });
  f.store.db.prepare('UPDATE events SET deadline=? WHERE id=?').run(new Date(Date.now() - 1000).toISOString(), event.id);
  assert.equal((await f.request(`/api/events/${event.id}/selection`, { token: owner.token, method: 'PUT', body: { items: [{ menuItemId: event.menu[0].id, quantity: 2 }] } })).status, 409);
  const revision = (await f.request(`/api/events/${event.id}`, { token: owner.token })).data.event.revision;
  assert.equal((await f.request(`/api/events/${event.id}/approve`, { token: owner.token, method: 'POST', body: { expectedRevision: revision } })).status, 200);
});

test('real events reject demo identities; demo can be entirely disabled', async t => {
  const f = await fixture(t);
  const owner = await f.login(100);
  const event = await f.event(owner.token);
  const demo = await f.demo();
  assert.equal((await f.request(`/api/invites/${event.inviteCode}/join`, { token: demo.token, method: 'POST' })).status, 403);
  assert.equal((await f.request('/api/auth/demo', { method: 'POST', body: { inviteCode: event.inviteCode } })).status, 403);
  const disabled = await fixture(t, { demoEnabled: false, botToken: '' });
  assert.equal((await disabled.request('/api/auth/demo', { method: 'POST', body: {} })).status, 404);
  assert.equal((await disabled.request('/api/auth/max', { method: 'POST', body: { initData: sign() } })).status, 503);
  const demoEvent = (await f.request('/api/events', { token: demo.token })).data[0];
  f.config.demoEnabled = false;
  assert.equal((await f.request('/api/me', { token: demo.token })).status, 401);
  assert.equal((await f.request(`/api/invites/${demoEvent.inviteCode}`)).status, 404);
});

test('SQLite persists sessions and orders after server restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'za-stolom-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = { databasePath: join(directory, 'db.sqlite'), botToken: BOT_TOKEN, botUsername: '', maxWebhookSecret: '', restaurantAdminIds: [], demoEnabled: true };
  const first = createApp(config);
  const session = first.store.loginMax({ id: '100', name: 'Persistent Owner' });
  const user = first.store.authenticate(session.token);
  const restaurant = first.store.restaurants(user)[0];
  const event = first.store.createEvent(user, { title: 'Persistent Banquet', restaurantId: restaurant.id, date: new Date(Date.now() + 86400000 * 14).toISOString(), deadline: new Date(Date.now() + 86400000 * 10).toISOString(), expectedGuests: 10, budget: 100000 });
  first.store.saveSelection(user, event.id, { items: [{ menuItemId: restaurant.menu[0].id, quantity: 2 }] });
  first.store.close();
  const second = createApp(config);
  const restored = second.store.authenticate(session.token);
  assert.equal(second.store.detail(restored, event.id).event.total, restaurant.menu[0].price * 2);
  second.store.close();
});

test('webhook checks its own secret and persists dedupe before its only MAX response', async t => {
  let sent = 0;
  const f = await fixture(t, { botUsername: 'banquet_test_bot', maxWebhookSecret: 'webhook_test_secret', maxFetchImpl: async () => { sent += 1; return new Response(JSON.stringify({ message: { body: { mid: 'reply' } } }), { status: 200 }); } });
  const update = { update_type: 'bot_started', timestamp: Date.now(), user: { user_id: 100, is_bot: false }, chat_id: 10 };
  const request = secretHeader => f.request('/api/max/webhook', { method: 'POST', headers: { 'x-max-bot-api-secret': secretHeader }, body: update });
  assert.equal((await request('wrong_secret')).status, 401);
  assert.equal(sent, 0);
  assert.equal((await request('webhook_test_secret')).status, 200);
  assert.equal((await request('webhook_test_secret')).data.duplicate, true);
  assert.equal(sent, 1);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS count FROM max_webhook_claims').get().count, 1);
});

test('proxy client IP is opt-in, validated and gives independent authentication rate limits', async t => {
  const fakeRequest = value => ({ headers: { 'x-real-ip': value }, socket: { remoteAddress: '172.18.0.1' } });
  assert.equal(clientIp(fakeRequest('203.0.113.1')), '172.18.0.1');
  assert.equal(clientIp(fakeRequest('203.0.113.1'), true), '203.0.113.1');
  assert.equal(clientIp(fakeRequest('2001:db8::1'), true), '2001:db8::1');
  assert.equal(clientIp(fakeRequest('203.0.113.1, 1.2.3.4'), true), '172.18.0.1');
  assert.equal(clientIp(fakeRequest('not-an-ip'), true), '172.18.0.1');
  const f = await fixture(t, { trustProxy: true, authRateLimit: 2 });
  const attempt = ip => f.request('/api/auth/max', { method: 'POST', headers: { 'x-real-ip': ip }, body: { initData: 'invalid' } });
  assert.equal((await attempt('203.0.113.1')).status, 401);
  assert.equal((await attempt('203.0.113.1')).status, 401);
  const limited = await attempt('203.0.113.1');
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal((await attempt('203.0.113.2')).status, 401);
});

test('demo quotas preserve existing spaces and session replay cannot create unlimited tokens', async t => {
  const f = await fixture(t, { maxDemoSpaces: 1 });
  const first = await f.demo();
  assert.equal((await f.request('/api/auth/demo', { method: 'POST', body: {} })).status, 429);
  const restored = await f.demo({ sandbox: first.sandbox, role: 'guest' });
  assert.equal(restored.user.role, 'guest');
  for (let index = 0; index < 12; index++) await f.login(100);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id=?').get('max_100').count, 10);
});

test('native download links protect CSV with a one-use, expiring, hashed and revocable capability', async t => {
  const f = await fixture(t);
  const owner = await f.login(100);
  const guest = await f.login(200);
  const admin = await f.login(900);
  const event = await f.event(owner.token);
  const issue = token => f.request(`/api/events/${event.id}/export-link`, { token, method: 'POST' });
  assert.equal((await issue()).status, 401);
  assert.equal((await issue(owner.token)).status, 409);
  await f.request(`/api/invites/${event.inviteCode}/join`, { token: guest.token, method: 'POST' });
  await f.request(`/api/events/${event.id}/selection`, { token: guest.token, method: 'PUT', body: { items: [{ menuItemId: event.menu[0].id, quantity: 2 }], notes: 'Private dietary note' } });
  const revision = (await f.request(`/api/events/${event.id}`, { token: owner.token })).data.event.revision;
  await f.request(`/api/events/${event.id}/approve`, { token: owner.token, method: 'POST', body: { expectedRevision: revision } });
  assert.equal((await issue(guest.token)).status, 403);
  const link = await issue(owner.token);
  assert.equal(link.status, 200);
  const path = new URL(link.data.url).pathname;
  const secret = path.split('/').at(-1);
  const persisted = f.store.db.prepare('SELECT * FROM download_tokens').get();
  assert.match(persisted.token_hash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(persisted).includes(secret), false);
  assert.equal((await f.request('/api/downloads/' + 'A'.repeat(43))).status, 404);
  const csv = await f.request(path);
  assert.equal(csv.status, 200);
  assert.ok(csv.data.includes('Private dietary note'));
  assert.match(csv.headers.get('cache-control'), /no-store/);
  assert.equal((await f.request(path)).status, 404);
  const expired = await issue(owner.token);
  f.store.db.prepare('UPDATE download_tokens SET expires_at=?').run(Date.now() - 1);
  assert.equal((await f.request(new URL(expired.data.url).pathname)).status, 404);
  const replaced = await issue(owner.token);
  const current = await issue(owner.token);
  assert.equal((await f.request(new URL(replaced.data.url).pathname)).status, 404);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS count FROM download_tokens').get().count, 1);
  assert.equal((await f.request(new URL(current.data.url).pathname)).status, 200);
  const adminLink = await issue(admin.token);
  assert.equal(adminLink.status, 200);
  f.config.restaurantAdminIds = [];
  assert.equal((await f.request(new URL(adminLink.data.url).pathname)).status, 404);
  const staleEventLink = await issue(owner.token);
  f.store.db.prepare('UPDATE events SET revision=revision+1 WHERE id=?').run(event.id);
  assert.equal((await f.request(new URL(staleEventLink.data.url).pathname)).status, 404);
});
