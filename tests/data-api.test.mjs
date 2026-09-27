import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSpec, runChecks, render, select } from '../scripts/api-check.mjs';
import { fixture } from './helpers.mjs';

test('DATA-API.yaml declares the required fields for every mandatory check', () => {
  const { spec, data } = loadSpec();
  assert.equal(spec.config_version, '1.0');
  assert.ok(spec.solution.name && spec.solution.team_id);
  assert.match(spec.base_url, /^https:\/\/.+\/api\/v1$/);
  assert.ok(spec.checks.length >= 20);
  assert.ok(data.event.title);
  const ids = new Set();
  for (const check of spec.checks) {
    assert.ok(!ids.has(check.id), `duplicate ${check.id}`);
    ids.add(check.id);
    assert.ok(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(check.method), check.id);
    assert.match(check.path, /^\//, check.id);
    assert.ok(['anonymous', 'organizer', 'guest', 'restaurant', 'admin'].includes(check.role), check.id);
    assert.ok(Array.isArray(check.expected_status) && check.expected_status.length, check.id);
    assert.ok(check.expected_response?.content_type, check.id);
  }
});

test('checker helpers select JSON paths and keep variable types', () => {
  const payload = { menu: [{ id: 'a', category: 'Закуски' }, { id: 'b', category: 'Напитки' }], event: { revision: 3 } };
  assert.equal(select(payload, "$.menu[?(@.category=='Напитки')].id"), 'b');
  assert.equal(select(payload, '$.menu[0].id'), 'a');
  assert.deepEqual(render({ n: '{{rev}}', s: 'rev {{rev}}' }, { rev: 3 }), { n: 3, s: 'rev 3' });
});

test('every mandatory check from DATA-API.yaml passes against the server via /api/v1', async t => {
  const f = await fixture(t);
  const { results, failed } = await runChecks({ base: `${f.base}/api/v1`, log: () => {} });
  assert.deepEqual(failed.map(result => `${result.id}: ${result.problems.join('; ')}`), []);
  assert.ok(results.length >= 20);
});

test('versioned API root, health alias and Swagger redirect', async t => {
  const f = await fixture(t);
  const root = await f.request('/api/v1');
  assert.equal(root.status, 200);
  assert.equal(root.data.version, 'v1');
  assert.equal((await f.request('/api/v1/healthz')).data.status, 'ok');
  assert.equal((await f.request('/api/config')).status, 200, 'unversioned /api stays for stored media URLs and the MAX webhook');
  const swagger = await fetch(`${f.base}/swagger`, { redirect: 'manual' });
  assert.equal(swagger.status, 308);
  assert.equal(swagger.headers.get('location'), 'swagger/', 'relative redirect keeps the /banquet prefix behind nginx');
});
