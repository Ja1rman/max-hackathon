import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture, futureMoscow } from './helpers.mjs';
import { PETR_MENU } from '../server/petr-menu.mjs';
import { Store } from '../server/store.mjs';

test('every Petr catalog dish and package dish has a photo, including in the four-role demo', async t => {
  const f = await fixture(t);
  const admin = await f.login(900);
  const restaurants = (await f.request('/api/restaurants', { token: admin.token })).data;
  const petr = restaurants.find(item => item.name === 'Петръ');
  assert.equal(petr.menu.length, PETR_MENU.length);
  assert.ok(petr.menu.every(item => /^\/petr-photos\/\d{3}\.(jpg|png)$/.test(item.photoUrl)));
  const files = new Set(petr.menu.map(item => item.photoUrl));
  assert.equal(files.size, PETR_MENU.length, 'each catalog row has its own image file');
  for (const path of files) {
    const file = fileURLToPath(new URL(`../public${path}`, import.meta.url));
    assert.ok(existsSync(file), `missing image: ${path}`);
    const bytes = readFileSync(file).subarray(0, 8);
    assert.ok(path.endsWith('.png') ? bytes.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])), `invalid image: ${path}`);
  }
  const temp = restaurants.find(item => item.name === 'Temp');
  assert.equal(temp.menu.length, 12);
  assert.ok(temp.menu.every(item => /^\/temp-photos\/\d{3}\.jpg$/.test(item.photoUrl)));
  for (const item of temp.menu) {
    const file = fileURLToPath(new URL(`../public${item.photoUrl}`, import.meta.url));
    assert.ok(existsSync(file), `missing image: ${item.photoUrl}`);
  }
  assert.ok(petr.packageDishes.every(item => item.photoUrl));
  assert.ok(petr.packages.every(offer => offer.items.every(item => item.photoUrl)));

  const first = await f.demo({ role: 'admin' });
  const roles = ['admin', 'restaurant', 'organizer', 'guest'];
  for (const role of roles) {
    const session = role === 'admin' ? first : await f.demo({ role, sandbox: first.sandbox });
    assert.equal(session.user.role, role);
    const demoPetr = (await f.request('/api/restaurants', { token: session.token })).data.find(item => item.name.includes('Петръ'));
    assert.equal(demoPetr.menu.length, PETR_MENU.length);
    assert.ok(demoPetr.menu.every(item => item.photoUrl));
    assert.ok(demoPetr.packageDishes.every(item => item.photoUrl));
    if (role === 'guest') {
      const banquets = (await f.request('/api/events', { token: session.token })).data;
      assert.equal(banquets.length, 2);
      assert.ok(banquets.some(event => event.selectionMode === 'package'));
    }
  }
});

test('restaurant favorites are private and banquet deletion requires management rights', async t => {
  const f = await fixture(t);
  const owner = await f.login(900);
  const stranger = await f.login(200);
  const restaurant = (await f.request('/api/restaurants', { token: owner.token })).data[0];
  assert.equal((await f.request(`/api/restaurants/${restaurant.id}/favorite`, { token: owner.token, method: 'PUT' })).status, 200);
  assert.equal((await f.request('/api/restaurants', { token: owner.token })).data.find(item => item.id === restaurant.id).favorite, true);
  assert.equal((await f.request('/api/restaurants', { token: stranger.token })).data.find(item => item.id === restaurant.id).favorite, false);
  assert.equal((await f.request(`/api/restaurants/${restaurant.id}/favorite`, { token: owner.token, method: 'DELETE' })).status, 200);
  assert.equal((await f.request('/api/restaurants', { token: owner.token })).data.find(item => item.id === restaurant.id).favorite, false);

  const moscowDate = days => `${new Date(Date.now() + days * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' })}T18:00:00+03:00`;
  const created = await f.request('/api/events', { token: owner.token, method: 'POST', body: { title: 'Проверка удаления', restaurantId: restaurant.id, date: moscowDate(14), deadline: moscowDate(10), expectedGuests: 4 } });
  assert.equal(created.status, 201);
  const banquet = created.data;
  assert.equal((await f.request(`/api/events/${banquet.id}`, { token: stranger.token, method: 'DELETE' })).status, 403);
  assert.equal((await f.request(`/api/events/${banquet.id}`, { token: owner.token, method: 'DELETE' })).status, 200);
  assert.equal((await f.request(`/api/events/${banquet.id}`, { token: owner.token })).status, 404);
});

test('v11 catalog and banquet snapshots gain photos without replacing orders', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'banquet-photo-migration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = { databasePath: join(directory, 'banquet.sqlite'), demoEnabled: true, restaurantAdminIds: ['900'], publicUrl: 'https://banquet.example', maxDemoSpaces: 10 };
  const store = new Store(config);
  const petr = store.db.prepare("SELECT id FROM restaurants WHERE name='Петръ'").get();
  const temp = store.db.prepare("SELECT id FROM restaurants WHERE name='Temp'").get();
  store.db.prepare("INSERT INTO users (id,scope,external_id,name,role,demo) VALUES ('max_900','live','900','Администратор','admin',0)").run();
  const owner = store.db.prepare("SELECT * FROM users WHERE id='max_900'").get();
  const moscowDate = days => `${new Date(Date.now() + days * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' })}T18:00:00+03:00`;
  const event = store.createEvent(owner, { title: 'Старый банкет', restaurantId: petr.id, date: moscowDate(14), deadline: moscowDate(10), expectedGuests: 4 });
  store.db.prepare("UPDATE menu_items SET data=json_set(data,'$.photoUrl','') WHERE restaurant_id IN (?,?)").run(petr.id, temp.id);
  store.db.prepare("UPDATE event_menu SET data=json_set(data,'$.photoUrl','') WHERE event_id=?").run(event.id);
  store.db.exec('PRAGMA user_version = 11');
  store.close();

  const migrated = new Store(config);
  t.after(() => migrated.close());
  for (const id of [petr.id, temp.id]) {
    const rows = migrated.db.prepare('SELECT data FROM menu_items WHERE restaurant_id=?').all(id);
    assert.ok(rows.every(row => JSON.parse(row.data).photoUrl));
  }
  assert.ok(migrated.db.prepare('SELECT data FROM event_menu WHERE event_id=?').all(event.id).every(row => JSON.parse(row.data).photoUrl));
});

test('corrected catalog photos reach existing banquets without changing their prices or event-specific photos', async t => {
  const f = await fixture(t);
  const admin = await f.login(900);
  const restaurant = (await f.request('/api/restaurants', { token: admin.token })).data.find(item => item.name === 'Петръ');
  const dish = restaurant.menu.find(item => item.name === 'Лосось слабой соли');
  const created = await f.request('/api/events', { token: admin.token, method: 'POST', body: { title: 'Банкет с исправленным фото', restaurantId: restaurant.id, date: futureMoscow(14), deadline: futureMoscow(10), expectedGuests: 4 } });
  assert.equal(created.status, 201);
  const eventId = created.data.id;
  const eventDish = async () => (await f.request(`/api/events/${eventId}`, { token: admin.token })).data.menu.find(item => item.id === dish.id);
  assert.equal((await eventDish()).photoUrl, dish.photoUrl);

  const corrected = '/api/media/00000000-0000-0000-0000-000000000001.jpg';
  assert.equal((await f.request(`/api/restaurants/${restaurant.id}/menu/${dish.id}`, { token: admin.token, method: 'PATCH', body: { photoUrl: corrected, price: dish.price + 100 } })).status, 200);
  assert.equal((await eventDish()).photoUrl, corrected);
  assert.equal((await eventDish()).price, dish.price);

  const custom = '/api/media/00000000-0000-0000-0000-000000000002.jpg';
  assert.equal((await f.request(`/api/events/${eventId}/menu/${dish.id}`, { token: admin.token, method: 'PATCH', body: { photoUrl: custom } })).status, 200);
  assert.equal((await f.request(`/api/restaurants/${restaurant.id}/menu/${dish.id}`, { token: admin.token, method: 'PATCH', body: { photoUrl: '/api/media/00000000-0000-0000-0000-000000000003.jpg' } })).status, 200);
  assert.equal((await eventDish()).photoUrl, custom);
});

test('migration restores restaurant photo corrections in banquets created before synchronization', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'banquet-photo-corrections-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = { databasePath: join(directory, 'banquet.sqlite'), demoEnabled: true, restaurantAdminIds: ['900'], publicUrl: 'https://banquet.example', maxDemoSpaces: 10 };
  const store = new Store(config);
  const restaurant = store.db.prepare("SELECT id FROM restaurants WHERE name='Петръ'").get();
  store.db.prepare("INSERT INTO users (id,scope,external_id,name,role,demo) VALUES ('max_900','live','900','Администратор','admin',0)").run();
  const owner = store.db.prepare("SELECT * FROM users WHERE id='max_900'").get();
  const event = store.createEvent(owner, { title: 'Банкет до исправления', restaurantId: restaurant.id, date: futureMoscow(14), deadline: futureMoscow(10), expectedGuests: 4 });
  const offer = JSON.parse(store.db.prepare('SELECT data FROM restaurant_packages WHERE restaurant_id=? ORDER BY rowid LIMIT 1').get(restaurant.id).data);
  const choice = offer.items.find(item => item.choiceGroup)?.dishId;
  const packageEvent = store.createEvent(owner, { title: 'Пакет до исправления', restaurantId: restaurant.id, date: futureMoscow(15), deadline: futureMoscow(10), expectedGuests: 4, selectionMode: 'package', packageId: offer.id, packageChoice: choice });
  const row = store.db.prepare('SELECT id,data FROM menu_items WHERE restaurant_id=?').all(restaurant.id).find(entry => JSON.parse(entry.data).name === 'Хлебная корзина (чиабатта, фокачча с оливками и маслинами, ржаной зерновой хлеб)');
  const corrected = '/api/media/00000000-0000-0000-0000-000000000004.jpg';
  store.db.prepare('UPDATE menu_items SET data=? WHERE id=?').run(JSON.stringify({ ...JSON.parse(row.data), photoUrl: corrected }), row.id);
  const packageRow = store.db.prepare('SELECT id,data FROM package_dishes WHERE restaurant_id=?').all(restaurant.id).find(entry => JSON.parse(entry.data).name === 'Хлебная корзина');
  const packageCorrected = '/api/media/00000000-0000-0000-0000-000000000005.jpg';
  store.db.prepare('UPDATE package_dishes SET data=? WHERE id=?').run(JSON.stringify({ ...JSON.parse(packageRow.data), photoUrl: packageCorrected }), packageRow.id);
  store.db.exec('PRAGMA user_version = 14');
  store.close();

  const migrated = new Store(config);
  t.after(() => migrated.close());
  const dish = JSON.parse(migrated.db.prepare('SELECT data FROM event_menu WHERE event_id=? AND item_id=?').get(event.id, row.id).data);
  assert.equal(dish.photoUrl, corrected);
  assert.equal(dish.price, JSON.parse(row.data).price);
  const packageSnapshot = JSON.parse(migrated.db.prepare('SELECT package_data FROM events WHERE id=?').get(packageEvent.id).package_data);
  assert.equal(packageSnapshot.items.find(item => item.dishId === packageRow.id).photoUrl, packageCorrected);
});
