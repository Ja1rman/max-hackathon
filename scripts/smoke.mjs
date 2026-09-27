// Runs only in an isolated demo scope. Never creates live users or orders.
import assert from 'node:assert/strict';
const base = (process.env.SMOKE_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
async function request(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.ok(response.ok, `${method} ${path}: HTTP ${response.status}`);
  return response.json();
}
assert.equal((await request('/config')).demoEnabled, true, 'Smoke requires DEMO_ENABLED=true');
const owner = await request('/auth/demo', { method: 'POST', body: { role: 'organizer' } });
const restaurant = (await request('/restaurants', { token: owner.token }))[0];
const moscowNoon = days => new Date(`${new Date(Date.now() + days * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' })}T12:00:00+03:00`).toISOString();
const event = await request('/events', { method: 'POST', token: owner.token, body: { title: 'Проверка релиза', restaurantId: restaurant.id, date: moscowNoon(7), deadline: moscowNoon(5), expectedGuests: 1, foodBudget: 500000 } });
const guest = await request('/auth/demo', { method: 'POST', body: { role: 'guest', inviteCode: event.inviteCode, name: 'Тестовый гость' } });
await request(`/invites/${event.inviteCode}/join`, { method: 'POST', token: guest.token, body: {} });
const selected = restaurant.menu[0];
await request(`/events/${event.id}/selection`, { method: 'PUT', token: guest.token, body: { items: [{ menuItemId: selected.id, quantity: 2 }], notes: 'Тест: соус отдельно' } });
let detail = await request(`/events/${event.id}`, { token: owner.token });
assert.equal(detail.event.total, selected.price * 2);
assert.equal(detail.event.responded, 1);
await request(`/events/${event.id}/approve`, { method: 'POST', token: owner.token, body: { expectedRevision: detail.event.revision } });
const kitchen = await request('/auth/demo', { method: 'POST', body: { role: 'restaurant', sandbox: owner.sandbox } });
detail = await request(`/events/${event.id}`, { token: kitchen.token });
assert.equal(detail.event.status, 'approved');
assert.equal(detail.summary[0].quantity, 2);
assert.equal(detail.guests[0].notes, 'Тест: соус отдельно');
const denied = await fetch(`${base}/api/events/${event.id}/selection`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${guest.token}` }, body: JSON.stringify({ items: [{ menuItemId: selected.id, quantity: 3 }], notes: '' }) });
assert.equal(denied.status, 409);
const { url } = await request(`/events/${event.id}/export-link`, { method: 'POST', token: kitchen.token, body: {} });
const csv = await fetch(url);
assert.equal(csv.status, 200);
assert.ok((await csv.text()).includes(selected.name));
assert.equal((await fetch(url)).status, 404);
console.log('PASS: demo invitation → guest selection → server total → approval → kitchen → one-use CSV; approved selection locked.');
