import test from 'node:test';
import assert from 'node:assert/strict';
import { formatUnits, spentByUnit, unitOf } from '../shared/currency.mjs';
import { fixture, signedContact } from './helpers.mjs';

test('guest currency converts rubles to pie slices and bottles', () => {
  assert.equal(formatUnits(60000, 'pie'), '60 кусочков пирога');
  assert.equal(formatUnits(1000, 'pie'), '1 кусочек пирога');
  assert.equal(formatUnits(2200, 'pie'), '2,2 кусочка пирога');
  assert.equal(formatUnits(25000, 'bottle'), '2,5 бутылочки');
  assert.equal(formatUnits(30000, 'bottle'), '3 бутылочки');
  assert.equal(formatUnits(110000, 'bottle'), '11 бутылочек');
  assert.equal(unitOf({ category: 'Напитки' }), 'bottle');
  assert.equal(unitOf({ category: 'Горячее' }), 'pie');
  assert.deepEqual(spentByUnit([{ category: 'Напитки', price: 25000, quantity: 2 }, { category: 'Закуски', price: 69000, quantity: 1 }]), { pie: 69000, bottle: 50000 });
});

test('food and drink budgets are independent hard limits; shared table and hidden items cannot be ordered', async t => {
  const f = await fixture(t);
  const owner = await f.login(100);
  const guest = await f.login(200, 'Гость');
  const event = await f.event(owner.token);
  await f.inviteGuest(owner.token, event, guest.token, 200, '+79990000002');
  const food = event.menu.filter(item => item.category !== 'Напитки');
  const drink = event.menu.find(item => item.category === 'Напитки');
  const [first, second, third] = food;
  const path = `/api/events/${event.id}`;
  let detail = (await f.request(path, { token: guest.token })).data;
  assert.equal(detail.event.foodBudget, 300000);
  assert.equal(detail.event.drinkBudget, 0);
  assert.equal(detail.event.budget, undefined);

  const revision = (await f.request(path, { token: owner.token })).data.event.revision;
  assert.equal((await f.request(path, { token: owner.token, method: 'PATCH', body: { foodBudget: first.price, drinkBudget: drink.price, expectedRevision: revision } })).status, 200);
  assert.equal((await f.request(path, { token: owner.token })).data.event.budget, (first.price + drink.price) * 12);
  assert.equal((await f.request(`${path}/selection`, { token: guest.token, method: 'PUT', body: { items: [{ menuItemId: first.id, quantity: 2 }] } })).status, 409);
  const tooMuchDrink = await f.request(`${path}/selection`, { token: guest.token, method: 'PUT', body: { items: [{ menuItemId: first.id, quantity: 1 }, { menuItemId: drink.id, quantity: 2 }] } });
  assert.equal(tooMuchDrink.status, 409);
  assert.match(tooMuchDrink.data.error, /напитки/);
  assert.equal((await f.request(`${path}/selection`, { token: guest.token, method: 'PUT', body: { items: [{ menuItemId: first.id, quantity: 1 }, { menuItemId: drink.id, quantity: 1 }] } })).status, 200, 'unused food budget does not pay for drinks and vice versa');

  assert.equal((await f.request(`${path}/shared`, { token: guest.token, method: 'PUT', body: { items: [] } })).status, 403);
  assert.equal((await f.request(`${path}/shared`, { token: owner.token, method: 'PUT', body: { items: [{ menuItemId: first.id, quantity: 2 }] } })).status, 409, 'already ordered by a guest');
  const shared = await f.request(`${path}/shared`, { token: owner.token, method: 'PUT', body: { items: [{ menuItemId: second.id, quantity: 3 }] } });
  assert.equal(shared.status, 200);
  assert.equal(shared.data.items[0].total, second.price * 3);
  assert.equal((await f.request(`${path}/selection`, { token: guest.token, method: 'PUT', body: { items: [{ menuItemId: second.id, quantity: 1 }] } })).status, 400);
  assert.equal((await f.request(`${path}/menu/${second.id}`, { token: owner.token, method: 'DELETE' })).status, 409);

  assert.equal((await f.request(`${path}/menu/${third.id}`, { token: owner.token, method: 'PATCH', body: { forGuests: false } })).status, 200);
  detail = (await f.request(path, { token: guest.token })).data;
  assert.ok(!detail.menu.some(item => item.id === third.id), 'hidden item is not sent to guests');
  assert.ok(detail.menu.some(item => item.id === second.id), 'shared item stays visible');
  assert.equal(detail.shared[0].quantity, 3);
  assert.equal((await f.request(`${path}/selection`, { token: guest.token, method: 'PUT', body: { items: [{ menuItemId: third.id, quantity: 1 }] } })).status, 400);
  assert.equal((await f.request(`${path}/menu/${first.id}`, { token: owner.token, method: 'PATCH', body: { forGuests: false } })).status, 409, 'ordered item cannot be hidden');

  const managerDetail = (await f.request(path, { token: owner.token })).data;
  assert.equal(managerDetail.event.total, first.price + drink.price + second.price * 3);
  assert.equal(managerDetail.event.ownerName, 'Александра Тестовая');
  assert.equal(managerDetail.summary.find(item => item.menuItemId === second.id).quantity, 3);

  assert.equal((await f.request(`${path}/menu/${third.id}`, { token: owner.token, method: 'DELETE' })).status, 200);
  const imported = await f.request(`${path}/menu/import`, { token: owner.token, method: 'POST', body: { itemIds: [third.id, first.id] } });
  assert.deepEqual(imported.data, { added: 1 });
  assert.equal((await f.request(`${path}/menu/import`, { token: owner.token, method: 'POST', body: { itemIds: ['dish_missing'] } })).status, 404);
});

test('menu items keep ingredients; administrator gets the kitchen board', async t => {
  const f = await fixture(t);
  const admin = await f.login(900, 'Шеф');
  const owner = await f.login(100);
  const [restaurant] = (await f.request('/api/restaurants', { token: admin.token })).data;
  const created = await f.request(`/api/restaurants/${restaurant.id}/menu`, { token: admin.token, method: 'POST', body: { name: 'Суп', category: 'Супы', price: 40000, available: true, vegetarian: true, allergens: [], ingredients: 'Томаты, базилик, сливки', nutrition: { kcal: 200, protein: 4, fat: 10, carbs: 20 } } });
  assert.equal(created.status, 201);
  assert.equal(created.data.ingredients, 'Томаты, базилик, сливки');
  assert.equal(restaurant.menu[0].ingredients, '');
  const event = await f.event(owner.token);
  await f.request(`/api/events/${event.id}/shared`, { token: owner.token, method: 'PUT', body: { items: [{ menuItemId: event.menu[0].id, quantity: 4 }] } });
  assert.equal((await f.request('/api/kitchen', { token: owner.token })).status, 403);
  const board = await f.request('/api/kitchen', { token: admin.token });
  assert.equal(board.status, 200);
  assert.equal(board.data.length, 1);
  assert.equal(board.data[0].event.ownerName, 'Александра Тестовая');
  assert.equal(board.data[0].shared[0].quantity, 4);
  assert.equal(board.data[0].summary[0].quantity, 4);
});

test('administrator adds organizers by phone; other MAX users are guests', async t => {
  const f = await fixture(t, { openOrganizerSignup: false });
  const admin = await f.login(900, 'Шеф');
  const person = await f.login(300, 'Ольга');
  assert.equal(person.user.role, 'guest');
  const [restaurant] = (await f.request('/api/restaurants', { token: admin.token })).data;
  const body = { title: 'Корпоратив', restaurantId: restaurant.id, date: new Date(Date.now() + 86400000 * 14).toISOString(), deadline: new Date(Date.now() + 86400000 * 10).toISOString(), expectedGuests: 5 };
  assert.equal((await f.request('/api/events', { token: person.token, method: 'POST', body })).status, 403);
  assert.equal((await f.request('/api/organizers', { token: person.token, method: 'POST', body: { name: 'Ольга', phone: '+79990000003' } })).status, 403);
  const added = await f.request('/api/organizers', { token: admin.token, method: 'POST', body: { name: 'Ольга', phone: '+7 999 000-00-03' } });
  assert.equal(added.status, 201);
  assert.equal(added.data.registered, false);
  assert.equal((await f.request('/api/organizers', { token: admin.token, method: 'POST', body: { name: 'Дубль', phone: '89990000003' } })).status, 409);
  const bound = await f.request('/api/me/phone', { token: person.token, method: 'PUT', body: signedContact(300, '+79990000003') });
  assert.equal(bound.data.role, 'organizer');
  assert.equal((await f.request('/api/me', { token: person.token })).data.role, 'organizer');
  assert.equal((await f.request('/api/events', { token: person.token, method: 'POST', body })).status, 201);
  assert.equal((await f.request('/api/organizers', { token: admin.token })).data[0].registered, true);
  assert.equal((await f.request(`/api/organizers/${added.data.id}`, { token: admin.token, method: 'DELETE' })).status, 200);
  assert.equal((await f.request('/api/me', { token: person.token })).data.role, 'organizer', 'an organizer who already owns a banquet keeps managing it');
  const other = await f.login(400, 'Пётр');
  assert.equal(other.user.role, 'guest');
});
