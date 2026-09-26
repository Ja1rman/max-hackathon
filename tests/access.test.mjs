import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../server/store.mjs';
import { fixture, signedContact } from './helpers.mjs';

const future = days => new Date(Date.now() + days * 86400000).toISOString();
const banquet = restaurantId => ({ title: 'Корпоратив', restaurantId, date: future(14), deadline: future(10), expectedGuests: 5 });

test('access is granted per restaurant: admin, organizer or nothing', async t => {
  const f = await fixture(t, { openOrganizerSignup: false });
  const root = await f.login(900, 'Суперадмин');
  const olga = await f.login(300, 'Ольга');
  const petr = await f.login(400, 'Пётр');
  assert.equal(olga.user.role, 'guest');
  assert.deepEqual(olga.user.access, []);
  assert.equal(root.user.superAdmin, true);
  const [first] = (await f.request('/api/restaurants', { token: root.token })).data;
  assert.equal((await f.request('/api/restaurants', { token: olga.token, method: 'POST', body: { name: 'Чужой' } })).status, 403);
  const second = await f.request('/api/restaurants', { token: root.token, method: 'POST', body: { name: 'Второй зал', address: 'Казань' } });
  assert.equal(second.status, 201);
  assert.equal(second.data.access, 'admin');
  assert.deepEqual((await f.request('/api/restaurants', { token: olga.token })).data, []);
  assert.equal((await f.request('/api/events', { token: olga.token, method: 'POST', body: banquet(first.id) })).status, 403);

  const users = await f.request('/api/users', { token: root.token });
  assert.deepEqual(users.data.map(user => user.name).sort(), ['Ольга Тестовая', 'Пётр Тестовая', 'Суперадмин Тестовая']);
  assert.equal(users.data.find(user => user.isYou).superAdmin, true);
  assert.equal((await f.request('/api/users?q=Ольга', { token: root.token })).data.length, 1);
  assert.equal((await f.request('/api/users', { token: olga.token })).status, 403);

  assert.equal((await f.request(`/api/restaurants/${first.id}/members/${olga.user.id}`, { token: root.token, method: 'PUT', body: { role: 'organizer' } })).status, 200);
  assert.equal((await f.request(`/api/restaurants/${second.data.id}/members/${petr.user.id}`, { token: root.token, method: 'PUT', body: { role: 'admin' } })).status, 200);
  const me = (await f.request('/api/me', { token: olga.token })).data;
  assert.equal(me.role, 'organizer');
  assert.deepEqual(me.access.map(entry => [entry.restaurantName, entry.role]), [[first.name, 'organizer']]);
  assert.equal((await f.request('/api/events', { token: olga.token, method: 'POST', body: banquet(second.data.id) })).status, 403, 'organizer only where granted');
  const event = await f.request('/api/events', { token: olga.token, method: 'POST', body: banquet(first.id) });
  assert.equal(event.status, 201);

  // Пётр administers only the second restaurant: no access to the first one's banquets, menu or members.
  assert.equal((await f.request('/api/me', { token: petr.token })).data.role, 'restaurant');
  assert.equal((await f.request(`/api/events/${event.data.id}`, { token: petr.token })).status, 404);
  assert.equal((await f.request(`/api/restaurants/${first.id}/menu`, { token: petr.token, method: 'POST', body: { name: 'Суп', category: 'Супы', price: 1000, available: true, vegetarian: true, allergens: [], nutrition: { kcal: 1, protein: 0, fat: 0, carbs: 0 } } })).status, 403);
  assert.equal((await f.request(`/api/restaurants/${first.id}/members/${olga.user.id}`, { token: petr.token, method: 'PUT', body: { role: 'none' } })).status, 403);
  assert.deepEqual(Object.keys((await f.request('/api/users', { token: petr.token })).data[0].roles), [second.data.id]);
  assert.equal((await f.request(`/api/restaurants/${second.data.id}`, { token: petr.token, method: 'PATCH', body: { name: 'Второй зал у реки' } })).data.name, 'Второй зал у реки');
  assert.equal((await f.request(`/api/restaurants/${second.data.id}/members/${petr.user.id}`, { token: petr.token, method: 'PUT', body: { role: 'none' } })).status, 409, 'no self-demotion');
  assert.equal((await f.request(`/api/restaurants/${first.id}/members/${root.user.id}`, { token: root.token, method: 'PUT', body: { role: 'none' } })).status, 409, 'superadmin access is implicit');

  const kitchen = await f.request('/api/kitchen', { token: root.token });
  assert.equal(kitchen.data.length, 1);
  assert.deepEqual((await f.request('/api/kitchen', { token: petr.token })).data, [], 'kitchen shows only administered restaurants');
  assert.equal((await f.request(`/api/restaurants/${first.id}/members/${olga.user.id}`, { token: root.token, method: 'PUT', body: { role: 'none' } })).status, 200);
  assert.equal((await f.request('/api/me', { token: olga.token })).data.role, 'guest');
  assert.equal((await f.request(`/api/events/${event.data.id}`, { token: olga.token })).status, 200, 'the owner still sees their banquet');
});

test('global administrator delegates restaurant roles by MAX ID; a signed invite link admits an unknown guest', async t => {
  const f = await fixture(t, { openOrganizerSignup: false });
  const root = await f.login(900);
  const first = (await f.request('/api/restaurants', { token: root.token })).data[0];
  const second = (await f.request('/api/restaurants', { token: root.token, method: 'POST', body: { name: 'Другой ресторан' } })).data;
  assert.equal(root.user.role, 'admin');
  assert.equal(root.user.access.length, 1);
  assert.equal((await f.request(`/api/restaurants/${first.id}/members/200`, { token: root.token, method: 'PUT', body: { role: 'admin' } })).status, 200);
  assert.equal((await f.request(`/api/restaurants/${first.id}/members`, { token: root.token })).data[0].maxId, '200');
  const scoped = await f.login(200);
  assert.equal(scoped.user.role, 'restaurant');
  assert.deepEqual(scoped.user.access.map(entry => entry.restaurantId), [first.id]);
  assert.equal((await f.request(`/api/restaurants/${first.id}/members/300`, { token: scoped.token, method: 'PUT', body: { role: 'admin' } })).status, 403);
  assert.equal((await f.request(`/api/restaurants/${first.id}/members/200`, { token: scoped.token, method: 'PUT', body: { role: 'organizer' } })).status, 409);
  assert.equal((await f.request(`/api/restaurants/${second.id}/members/300`, { token: scoped.token, method: 'PUT', body: { role: 'organizer' } })).status, 403);
  assert.equal((await f.request(`/api/restaurants/${first.id}/members/300`, { token: scoped.token, method: 'PUT', body: { role: 'organizer' } })).status, 200);
  const organizer = await f.login(300);
  const event = await f.event(organizer.token);
  const guest = await f.login(400);
  assert.equal((await f.request(`/api/invites/${event.inviteCode}/join`, { token: guest.token, method: 'POST' })).status, 403);
  assert.equal((await f.request('/api/me/phone', { token: guest.token, method: 'PUT', body: signedContact(400, '+79990000400') })).status, 200);
  assert.equal((await f.request(`/api/invites/${event.inviteCode}/join`, { token: guest.token, method: 'POST' })).status, 200);
  const own = await f.request(`/api/events/${event.id}`, { token: guest.token });
  assert.equal(own.data.canSelect, true);
  assert.equal(own.data.invitedGuests, undefined);
  assert.equal((await f.request(`/api/events/${event.id}`, { token: scoped.token })).status, 200);
  assert.equal((await f.request(`/api/restaurants/${first.id}/members/300`, { token: scoped.token, method: 'DELETE' })).status, 200);
  assert.equal((await f.request(`/api/events/${event.id}/approve`, { token: organizer.token, method: 'POST', body: {} })).status, 403);
  const formerOwner = await f.request(`/api/events/${event.id}`, { token: organizer.token });
  assert.equal(formerOwner.status, 200);
  assert.equal(formerOwner.data.canSelect, false);
  assert.equal((await f.request(`/api/events/${event.id}/selection`, { token: organizer.token, method: 'PUT', body: { items: [] } })).status, 403);
});

test('kitchen board exports CSV and a valid XLSX workbook, also through a one-use link', async t => {
  const f = await fixture(t);
  const admin = await f.login(900, 'Шеф');
  const owner = await f.login(100);
  const guest = await f.login(200, '=Гость');
  const event = await f.event(owner.token);
  await f.inviteGuest(owner.token, event, guest.token, 200, '+79990000002', '=Гость');
  await f.request(`/api/events/${event.id}/selection`, { token: guest.token, method: 'PUT', body: { items: [{ menuItemId: event.menu[2].id, quantity: 2 }], notes: 'Без лука' } });
  await f.request(`/api/events/${event.id}/shared`, { token: owner.token, method: 'PUT', body: { items: [{ menuItemId: event.menu[0].id, quantity: 3 }] } });
  assert.equal((await f.request('/api/kitchen/export?format=csv', { token: owner.token })).status, 403);
  assert.equal((await f.request('/api/kitchen/export?format=pdf', { token: admin.token })).status, 400);
  const csv = await f.request('/api/kitchen/export?format=csv', { token: admin.token });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-disposition'), /kitchen-\d{4}-\d{2}-\d{2}\.csv/);
  assert.ok(csv.data.includes(`"${event.menu[0].name}";"3";"3"`));
  assert.ok(csv.data.includes(`"'=Гость"`) && csv.data.includes('"Без лука"'));

  const link = await f.request('/api/kitchen/export-link', { token: admin.token, method: 'POST', body: { format: 'xlsx' } });
  const url = new URL(link.data.url);
  const file = await fetch(f.base + url.pathname);
  assert.equal(file.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const bytes = Buffer.from(await file.arrayBuffer());
  assert.equal((await fetch(f.base + url.pathname)).status, 404, 'link works once');
  const directory = await mkdtemp(join(tmpdir(), 'xlsx-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'k.xlsx'), bytes);
  const listing = execFileSync('unzip', ['-l', join(directory, 'k.xlsx')], { encoding: 'utf8' });
  assert.match(listing, /xl\/worksheets\/sheet2\.xml/);
  const sheet = execFileSync('unzip', ['-p', join(directory, 'k.xlsx'), 'xl/worksheets/sheet2.xml'], { encoding: 'utf8' });
  assert.match(sheet, /=Гость/, 'xlsx keeps text cells as text, formulas are not created');
  assert.match(sheet, /Без лука/);
});

test('v8 migration turns the old organizer list and banquet owners into restaurant access', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'access-migration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = { databasePath: join(directory, 'db.sqlite'), demoEnabled: true, restaurantAdminIds: [], publicUrl: 'https://banquet.example', maxDemoSpaces: 10 };
  const store = new Store(config);
  const restaurant = store.db.prepare("SELECT id FROM restaurants WHERE scope='live'").get().id;
  store.db.exec(`INSERT INTO users (id,scope,external_id,name,role,demo,phone,phone_verified_at) VALUES ('max_1','live','1','Ольга','organizer',0,'79990000001',1), ('max_2','live','2','Иван','organizer',0,NULL,NULL);
    CREATE TABLE organizers (id TEXT PRIMARY KEY, scope TEXT, name TEXT, phone TEXT, created_at TEXT);
    INSERT INTO organizers VALUES ('o1','live','Ольга','79990000001','2026-01-01');
    INSERT INTO events (id,scope,owner_id,restaurant_id,title,date,deadline,expected_guests,budget,invite_code,created_at) VALUES ('e1','live','max_2','${restaurant}','Старый','2027-01-01T00:00:00.000Z','2026-12-01T00:00:00.000Z',5,0,'aaaaaaaaaaaaaaaaaaaaaaaa','2026-01-01');
    PRAGMA user_version = 7;`);
  store.close();
  const migrated = new Store(config);
  t.after(() => migrated.close());
  assert.deepEqual(migrated.db.prepare('SELECT user_id,role FROM restaurant_members ORDER BY user_id').all().map(row => ({ ...row })), [{ user_id: 'max_1', role: 'organizer' }, { user_id: 'max_2', role: 'organizer' }]);
  assert.equal(migrated.db.prepare("SELECT 1 FROM sqlite_master WHERE name='organizers'").get(), undefined);
  assert.equal(new DatabaseSync(config.databasePath).prepare('PRAGMA user_version').get().user_version, 9);
});

test('a live organizer orders and picks a seat at their own banquet without being on the guest list', async t => {
  const f = await fixture(t, { openOrganizerSignup: false });
  const root = await f.login(900, 'Суперадмин');
  const owner = await f.login(300, 'Ольга');
  const stranger = await f.login(400, 'Пётр');
  const [restaurant] = (await f.request('/api/restaurants', { token: root.token })).data;
  await f.request(`/api/restaurants/${restaurant.id}/members/${owner.user.id}`, { token: root.token, method: 'PUT', body: { role: 'organizer' } });
  const event = (await f.request('/api/events', { token: owner.token, method: 'POST', body: banquet(restaurant.id) })).data;
  const detail = (await f.request(`/api/events/${event.id}`, { token: owner.token })).data;
  assert.equal(detail.canSelect, true);
  assert.equal(detail.event.canManage, true);
  const dish = detail.menu[2];
  assert.equal((await f.request(`/api/events/${event.id}/selection`, { token: owner.token, method: 'PUT', body: { items: [{ menuItemId: dish.id, quantity: 1 }] } })).status, 200);
  assert.equal((await f.request(`/api/events/${event.id}/selection`, { token: stranger.token, method: 'PUT', body: { items: [{ menuItemId: dish.id, quantity: 1 }] } })).status, 403);
  await f.request(`/api/events/${event.id}/seating`, { token: owner.token, method: 'PUT', body: { mode: 'choice', layout: { tables: [{ id: 't1', shape: 'round', label: '1', x: 0, y: 0, w: 120, h: 120, rotation: 0, seats: 4 }] } } });
  assert.equal((await f.request(`/api/events/${event.id}/seat`, { token: owner.token, method: 'PUT', body: { seatId: 't1-1' } })).data.mySeat, 't1-1');
  const after = (await f.request(`/api/events/${event.id}`, { token: owner.token })).data;
  assert.equal(after.event.responded, 1);
  assert.equal(after.guests[0].name, 'Ольга Тестовая');
  const revision = after.event.revision;
  assert.equal((await f.request(`/api/events/${event.id}/approve`, { token: owner.token, method: 'POST', body: { expectedRevision: revision } })).data.status, 'approved');
});
