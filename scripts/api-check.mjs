#!/usr/bin/env node
// Runs the mandatory API checks described in DATA-API.yaml against a base URL.
//   node scripts/api-check.mjs                      → base_url from DATA-API.yaml (production)
//   node scripts/api-check.mjs http://localhost:3000/api/v1
//   node scripts/api-check.mjs --only health,me     → selected checks (their dependencies must be listed too)
// Every run logs in to a fresh isolated demo space, so production data is never touched.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function loadSpec(file = resolve(root, 'DATA-API.yaml')) {
  const spec = parse(readFileSync(file, 'utf8'));
  const data = spec.test_data ? JSON.parse(readFileSync(resolve(dirname(file), spec.test_data), 'utf8')) : {};
  return { spec, data };
}

/** Minimal JSONPath: $.a.b[0].c, $[1], $.items[?(@.category=='Напитки')].id (first match). */
export function select(value, path) {
  if (path === '$') return value;
  const tokens = path.replace(/^\$/, '').match(/\.[^.[\]]+|\[\d+\]|\[\?\(@\.[^=]+==(?:'[^']*'|"[^"]*")\)\]/g) || [];
  let current = value;
  for (const token of tokens) {
    if (current === undefined || current === null) return undefined;
    if (token.startsWith('.')) current = current[token.slice(1)];
    else if (token.startsWith('[?')) {
      const [, field, literal] = token.match(/@\.([^=]+)==['"](.*)['"]/);
      current = Array.isArray(current) ? current.find(item => String(item?.[field]) === literal) : undefined;
    } else current = current[Number(token.slice(1, -1))];
  }
  return current;
}

/** "{{name}}" keeps the variable's type; "text {{name}}" interpolates. Names may be dotted (data.event). */
export function render(value, vars) {
  if (typeof value === 'string') {
    const whole = value.match(/^\{\{\s*([\w.]+)\s*\}\}$/);
    const lookup = name => name.split('.').reduce((acc, key) => acc?.[key], vars);
    if (whole) {
      const found = lookup(whole[1]);
      if (found === undefined) throw new Error(`unknown variable ${whole[1]}`);
      return found;
    }
    return value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, name) => {
      const found = lookup(name);
      if (found === undefined) throw new Error(`unknown variable ${name}`);
      return String(found);
    });
  }
  if (Array.isArray(value)) return value.map(item => render(item, vars));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, render(item, vars)]));
  return value;
}

async function runCheck(check, base, vars) {
  const params = check.params || {};
  let path = check.path;
  for (const [name, value] of Object.entries(render(params.path || {}, vars))) path = path.replace(`{${name}}`, encodeURIComponent(value));
  const url = new URL(base.replace(/\/$/, '') + path);
  for (const [name, value] of Object.entries(render(params.query || {}, vars))) url.searchParams.set(name, value);
  const headers = render(params.headers || {}, vars);
  const body = params.body === undefined || params.body === null ? undefined : JSON.stringify(render(params.body, vars));
  if (body !== undefined) headers['Content-Type'] ??= 'application/json';
  const response = await fetch(url, { method: check.method, headers, body, redirect: 'manual' });
  const problems = [];
  const expected = check.expected_status || [200];
  if (!expected.includes(response.status)) problems.push(`status ${response.status}, expected ${expected.join('/')}`);
  const format = check.expected_response || {};
  const type = response.headers.get('content-type') || '';
  if (format.content_type && !type.startsWith(format.content_type)) problems.push(`content-type "${type}", expected ${format.content_type}`);
  let payload;
  const raw = Buffer.from(await response.arrayBuffer());
  if (type.includes('json')) {
    try { payload = JSON.parse(raw.toString('utf8')); } catch { problems.push('response is not valid JSON'); }
  } else payload = raw.toString('utf8');
  if (format.type === 'array' && !Array.isArray(payload)) problems.push('expected a JSON array');
  if (format.type === 'object' && (payload === null || typeof payload !== 'object' || Array.isArray(payload))) problems.push('expected a JSON object');
  const target = format.type === 'array' ? payload?.[0] : payload;
  if (format.type === 'array' && format.min_items && (!Array.isArray(payload) || payload.length < format.min_items)) problems.push(`expected at least ${format.min_items} item(s)`);
  for (const field of format.required_fields || []) if (select(target, `$.${field}`) === undefined) problems.push(`missing field ${field}`);
  for (const [field, value] of Object.entries(render(format.values || {}, vars))) {
    const actual = select(target, `$.${field}`);
    if (JSON.stringify(actual) !== JSON.stringify(value)) problems.push(`${field} = ${JSON.stringify(actual)}, expected ${JSON.stringify(value)}`);
  }
  if (format.body_contains) for (const text of [].concat(render(format.body_contains, vars))) if (!String(payload).includes(text)) problems.push(`body does not contain "${text}"`);
  if (format.min_bytes && raw.length < format.min_bytes) problems.push(`body is ${raw.length} bytes, expected at least ${format.min_bytes}`);
  if (!problems.length) for (const [name, jsonPath] of Object.entries(check.save || {})) {
    const value = select(payload, jsonPath);
    if (value === undefined) problems.push(`cannot save ${name} from ${jsonPath}`);
    else vars[name] = value;
  }
  return { status: response.status, problems, payload };
}

export async function runChecks({ base, only, file, log = console.log } = {}) {
  const { spec, data } = loadSpec(file);
  base ||= spec.base_url;
  const vars = { data, ...(spec.variables || {}) };
  const results = [];
  for (const check of spec.checks) {
    if (only && !only.includes(check.id)) continue;
    let result;
    try { result = await runCheck(check, base, vars); } catch (error) { result = { problems: [error.message] }; }
    results.push({ id: check.id, ...result });
    log(`${result.problems.length ? 'FAIL' : 'ok  '} ${check.id.padEnd(28)} ${check.method.padEnd(6)} ${check.path}${result.problems.length ? `\n       ${result.problems.join('\n       ')}` : ''}`);
  }
  return { base, results, failed: results.filter(result => result.problems.length) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const onlyIndex = args.indexOf('--only');
  const only = onlyIndex >= 0 ? args.splice(onlyIndex, 2)[1].split(',') : undefined;
  const { base, results, failed } = await runChecks({ base: args[0], only });
  console.log(`\n${results.length - failed.length}/${results.length} checks passed against ${base}`);
  process.exitCode = failed.length ? 1 : 0;
}
