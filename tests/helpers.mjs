import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { createApp } from '../server/index.mjs';

export const BOT_TOKEN = '123456:only-a-test-token';
export function sign({ id = 100, name = 'Александра', timestamp = Math.floor(Date.now() / 1000), extra = {} } = {}) {
  const params = new URLSearchParams({ auth_date: String(timestamp), query_id: 'fixture-query', user: JSON.stringify({ id, first_name: name, last_name: 'Тестовая' }), ...extra });
  const data = [...params].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  params.set('hash', createHmac('sha256', secret).update(data).digest('hex'));
  return params.toString();
}
export function signedContact(userId, phone) {
  const authDate = String(Math.floor(Date.now() / 1000));
  const digits = phone.replace(/\D/g, '');
  return { phone, authDate, hash: createHmac('sha256', BOT_TOKEN).update(`authDate=${authDate}\nphone=${digits}\nuserId=${userId}`).digest('hex') };
}

export async function fixture(t, overrides = {}) {
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
  const inviteGuest = async (ownerToken, banquet, guestToken, userId, phone, name = 'Гость') => {
    const roster = await request(`/api/events/${banquet.id}/guests`, { token: ownerToken, method: 'POST', body: { name, phone } });
    assert.equal(roster.status, 201);
    const binding = await request('/api/me/phone', { token: guestToken, method: 'PUT', body: signedContact(userId, phone) });
    assert.equal(binding.status, 200);
    const joined = await request(`/api/invites/${banquet.inviteCode}/join`, { token: guestToken, method: 'POST' });
    assert.equal(joined.status, 200);
    return roster.data;
  };
  return { ...app, base, request, login, demo, event, inviteGuest };
}
