import test from 'node:test';
import assert from 'node:assert/strict';
import { autoAssign, generateLayout, layoutSeats, SEATING_TEMPLATES, seatTitle, validateLayout } from '../shared/seating.mjs';
import { fixture } from './helpers.mjs';

test('every template seats exactly the requested guests and passes validation', () => {
  for (const { id } of SEATING_TEMPLATES.filter(entry => entry.id !== 'empty')) {
    for (const guests of [1, 2, 7, 12, 45, 150, 1000]) {
      const layout = generateLayout(id, guests);
      assert.equal(validateLayout(layout).error, undefined, `${id} ${guests}`);
      const seats = layoutSeats(layout);
      assert.equal(seats.length, guests, `${id} ${guests}`);
      assert.equal(new Set(seats.map(seat => seat.id)).size, guests);
    }
  }
  assert.deepEqual(generateLayout('empty', 10), { tables: [] });
  const presidium = generateLayout('presidium', 30);
  assert.equal(presidium.tables[0].label, 'Президиум');
  assert.equal(seatTitle(presidium, 't1-2'), 'Президиум, место 2');
  assert.equal(seatTitle(presidium, 't2-1'), 'Стол 1, место 1');
});

test('layout validation rejects malformed tables', () => {
  const table = { id: 't1', shape: 'rect', label: '1', x: 0, y: 0, w: 200, h: 70, rotation: 0, seats: 4, sides: ['top'] };
  assert.ok(validateLayout({ tables: [table] }).layout);
  for (const broken of [{ shape: 'star' }, { label: '' }, { seats: 41 }, { sides: [] }, { sides: ['up'] }, { rotation: 45 }, { w: Infinity }, { id: '../x' }]) {
    assert.ok(validateLayout({ tables: [{ ...table, ...broken }] }).error, JSON.stringify(broken));
  }
  assert.ok(validateLayout({ tables: [table, table] }).error);
  assert.ok(validateLayout(null).error);
});

test('auto seating fills partly occupied tables before empty ones', () => {
  const layout = generateLayout('rounds', 16);
  const picks = autoAssign(layout, ['t2-1'], ['a', 'b', 'c']);
  assert.deepEqual(picks.map(pick => pick.seatId), ['t2-2', 't2-3', 't2-4']);
  assert.equal(autoAssign(layout, [], Array.from({ length: 20 }, (_, i) => i)).length, 16);
});

test('guests choose free seats, organizer edits layout and approval seats everyone else', async t => {
  const f = await fixture(t);
  const owner = await f.login(100);
  const anna = await f.login(200, 'Анна');
  const boris = await f.login(300, 'Борис');
  const event = await f.event(owner.token);
  await f.inviteGuest(owner.token, event, anna.token, 200, '+79990000002', 'Анна');
  await f.inviteGuest(owner.token, event, boris.token, 300, '+79990000003', 'Борис');
  const late = await f.request(`/api/events/${event.id}/guests`, { token: owner.token, method: 'POST', body: { name: 'Вера', phone: '+79990000004' } });
  const seatPath = `/api/events/${event.id}/seat`;
  assert.equal((await f.request(seatPath, { token: anna.token, method: 'PUT', body: { seatId: 't1-1' } })).status, 409);

  const layout = generateLayout('rounds', 4);
  assert.equal((await f.request(`/api/events/${event.id}/seating`, { token: anna.token, method: 'PUT', body: { mode: 'choice', layout } })).status, 403);
  assert.equal((await f.request(`/api/events/${event.id}/seating`, { token: owner.token, method: 'PUT', body: { mode: 'choice', layout: { tables: [{ id: 'x' }] } } })).status, 400);
  const saved = await f.request(`/api/events/${event.id}/seating`, { token: owner.token, method: 'PUT', body: { mode: 'choice', layout } });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.seatCount, 4);

  assert.equal((await f.request(seatPath, { token: anna.token, method: 'PUT', body: { seatId: 't1-9' } })).status, 400);
  assert.equal((await f.request(seatPath, { token: anna.token, method: 'PUT', body: { seatId: 't1-2' } })).data.mySeat, 't1-2');
  assert.equal((await f.request(seatPath, { token: boris.token, method: 'PUT', body: { seatId: 't1-2' } })).status, 409);
  const moved = await f.request(seatPath, { token: anna.token, method: 'PUT', body: { seatId: 't1-3' } });
  assert.deepEqual(moved.data.occupied, ['t1-3']);
  assert.equal(moved.data.people, undefined, 'guests do not see who sits where');

  const shrink = structuredClone(layout);
  shrink.tables[0].seats = 2;
  const blocked = await f.request(`/api/events/${event.id}/seating`, { token: owner.token, method: 'PUT', body: { layout: shrink } });
  assert.equal(blocked.status, 409);
  assert.match(blocked.data.error, /Стол 1, место 3/);

  const annaKey = `invite:${(await f.request(`/api/events/${event.id}`, { token: owner.token })).data.invitedGuests[0].id}`;
  const swap = await f.request(`/api/events/${event.id}/seating/assignments`, { token: owner.token, method: 'PUT', body: { guest: `invite:${late.data.id}`, seatId: 't1-3' } });
  assert.equal(swap.status, 200);
  assert.equal(swap.data.people.find(person => person.key === annaKey).seatId, null);

  const revision = (await f.request(`/api/events/${event.id}`, { token: owner.token })).data.event.revision;
  await f.request(`/api/events/${event.id}/selection`, { token: anna.token, method: 'PUT', body: { items: [{ menuItemId: event.menu[0].id, quantity: 1 }] } });
  const current = (await f.request(`/api/events/${event.id}`, { token: owner.token })).data;
  assert.equal(current.event.revision, revision + 1, 'seat changes do not invalidate the approval revision');
  assert.equal((await f.request(`/api/events/${event.id}/approve`, { token: owner.token, method: 'POST', body: { expectedRevision: current.event.revision } })).status, 200);

  const approved = (await f.request(`/api/events/${event.id}`, { token: owner.token })).data;
  assert.ok(approved.seating.people.every(person => person.seatId), 'approval seats everyone');
  assert.equal(new Set(approved.seating.people.map(person => person.seatId)).size, 3);
  assert.match(approved.guests.find(guest => guest.name === 'Анна').seat, /^Стол 1, место \d$/);
  assert.equal((await f.request(seatPath, { token: anna.token, method: 'PUT', body: { seatId: null } })).status, 409);
  const csv = (await f.request(`/api/events/${event.id}/export.csv`, { token: owner.token })).data;
  assert.match(csv, /"Стол";"Место";"Гость"/);
  assert.match(csv, /"Вера"/);
});

test('fixed mode lets only the organizer seat guests; demo banquet ships with seating', async t => {
  const f = await fixture(t);
  const organizer = await f.demo();
  const guest = await f.demo({ role: 'guest', sandbox: organizer.sandbox });
  const [banquet] = (await f.request('/api/events', { token: organizer.token })).data;
  const detail = (await f.request(`/api/events/${banquet.id}`, { token: guest.token })).data;
  assert.equal(detail.seating.mode, 'choice');
  assert.equal(detail.seating.occupied.length, 3);
  assert.equal((await f.request(`/api/events/${banquet.id}/seat`, { token: guest.token, method: 'PUT', body: { seatId: 't1-1' } })).status, 409);
  assert.equal((await f.request(`/api/events/${banquet.id}/seat`, { token: guest.token, method: 'PUT', body: { seatId: 't1-3' } })).status, 200);
  await f.request(`/api/events/${banquet.id}/seating`, { token: organizer.token, method: 'PUT', body: { mode: 'fixed' } });
  assert.equal((await f.request(`/api/events/${banquet.id}/seat`, { token: guest.token, method: 'PUT', body: { seatId: 't1-4' } })).status, 409);
  const auto = await f.request(`/api/events/${banquet.id}/seating/auto`, { token: organizer.token, method: 'POST' });
  assert.equal(auto.status, 200);
  assert.equal(auto.data.assigned, 2);
  assert.equal(auto.data.unseated, 0);
});
