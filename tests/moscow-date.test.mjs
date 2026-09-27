import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRussianDateTime, parseRussianDateTime, moscowDateTimeIso } from '../shared/moscow-date.mjs';

test('Russian date input uses 24-hour Moscow time and rejects impossible dates', () => {
  assert.equal(formatRussianDateTime('2026-10-11T18:30'), '11.10.2026 18:30');
  assert.equal(parseRussianDateTime('11.10.2026 18:30'), '2026-10-11T18:30');
  assert.equal(moscowDateTimeIso('11.10.2026 18:30'), '2026-10-11T15:30:00.000Z');
  assert.equal(parseRussianDateTime('31.02.2026 18:30'), '');
  assert.equal(parseRussianDateTime('11.10.2026 12:30AM'), '');
  assert.equal(parseRussianDateTime('29.02.2028 23:59'), '2028-02-29T23:59');
});
