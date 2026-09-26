// Seating geometry shared by the API (validation, seat ids) and the UI (drawing, templates).
// Chairs are not stored: they are derived from each table, so ids like "t3-5" match everywhere.

export const SEATING_MODES = ['off', 'choice', 'fixed'];
export const TABLE_SHAPES = ['round', 'rect'];
export const RECT_SIDES = ['top', 'right', 'bottom', 'left'];
export const LIMITS = { tables: 150, seatsPerTable: 40, seats: 1000 };
export const SEAT_GAP = 26; // distance from table edge to chair centre
export const SEAT_RADIUS = 14;
const SEAT_PITCH = 56; // chair spacing along a rectangular side
const RECT_DEPTH = 70;

export const SEATING_TEMPLATES = [
  { id: 'rounds', name: 'Круглые столы', hint: 'Банкет за круглыми столами по 8 мест' },
  { id: 'u', name: 'П-образная', hint: 'Три стола буквой П, гости по внешней и внутренней стороне' },
  { id: 'presidium', name: 'С президиумом', hint: 'Стол президиума и ряды столов напротив' },
  { id: 't', name: 'Т-образная', hint: 'Главный стол и длинный стол перпендикулярно' },
  { id: 'long', name: 'Длинный стол', hint: 'Один или несколько длинных столов' },
  { id: 'empty', name: 'Пустой зал', hint: 'Столы добавляются вручную' },
];

const round1 = value => Math.round(value * 10) / 10;

/** Resize a table so its chairs fit comfortably. */
export function fitTable(table) {
  if (table.shape === 'round') {
    const diameter = Math.max(90, Math.round((table.seats * 50) / Math.PI - SEAT_GAP * 2 + 10));
    return { ...table, w: Math.min(600, diameter), h: Math.min(600, diameter) };
  }
  const sides = table.sides?.length ? table.sides : ['top', 'bottom'];
  const horizontal = sides.filter(side => side === 'top' || side === 'bottom').length;
  const vertical = sides.length - horizontal;
  // Keep short sides short: they seat at most one chair each unless only they are used.
  const onLong = horizontal ? Math.ceil(Math.max(0, table.seats - Math.min(vertical, table.seats)) / horizontal) : 0;
  const onShort = vertical ? Math.ceil((horizontal ? Math.min(vertical, table.seats) : table.seats) / vertical) : 0;
  const w = Math.max(120, onLong * SEAT_PITCH + 20);
  const h = Math.max(RECT_DEPTH, onShort > 1 ? onShort * SEAT_PITCH + 20 : RECT_DEPTH);
  return { ...table, sides, w: Math.min(1400, w), h: Math.min(1000, h) };
}

function rotate(point, center, degrees) {
  if (!degrees) return point;
  const rad = (degrees * Math.PI) / 180;
  const dx = point.x - center.x, dy = point.y - center.y;
  return { x: center.x + dx * Math.cos(rad) - dy * Math.sin(rad), y: center.y + dx * Math.sin(rad) + dy * Math.cos(rad) };
}

/** Split `count` chairs over the chosen sides; short sides take one chair each first. */
function distribute(table) {
  const sides = RECT_SIDES.filter(side => table.sides.includes(side));
  const result = Object.fromEntries(sides.map(side => [side, 0]));
  const long = sides.filter(side => (side === 'top' || side === 'bottom') === table.w >= table.h);
  const short = sides.filter(side => !long.includes(side));
  let left = table.seats;
  if (long.length) for (const side of short) if (left > 0) { result[side] = 1; left--; }
  const pool = long.length ? long : short;
  pool.forEach((side, index) => { result[side] += Math.floor(left / pool.length) + (index < left % pool.length ? 1 : 0); });
  return result;
}

/** Chairs of a table in clockwise order starting top-left. */
export function tableSeats(table) {
  const cx = table.x + table.w / 2, cy = table.y + table.h / 2;
  const seats = [];
  if (table.shape === 'round') {
    const radius = table.w / 2 + SEAT_GAP;
    for (let n = 0; n < table.seats; n++) {
      const angle = -Math.PI / 2 + (2 * Math.PI * n) / table.seats;
      seats.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
    }
  } else {
    const counts = distribute(table);
    const along = (count, index, length) => ((index + 0.5) * length) / count;
    for (let i = 0; i < (counts.top || 0); i++) seats.push({ x: table.x + along(counts.top, i, table.w), y: table.y - SEAT_GAP });
    for (let i = 0; i < (counts.right || 0); i++) seats.push({ x: table.x + table.w + SEAT_GAP, y: table.y + along(counts.right, i, table.h) });
    for (let i = (counts.bottom || 0) - 1; i >= 0; i--) seats.push({ x: table.x + along(counts.bottom, i, table.w), y: table.y + table.h + SEAT_GAP });
    for (let i = (counts.left || 0) - 1; i >= 0; i--) seats.push({ x: table.x - SEAT_GAP, y: table.y + along(counts.left, i, table.h) });
  }
  return seats.map((point, index) => {
    const turned = rotate(point, { x: cx, y: cy }, table.rotation || 0);
    return { id: `${table.id}-${index + 1}`, tableId: table.id, number: index + 1, x: round1(turned.x), y: round1(turned.y) };
  });
}

export function layoutSeats(layout) {
  return (layout?.tables || []).flatMap(tableSeats);
}

export function tableTitle(table) {
  return /^\d+$/.test(table.label) ? `Стол ${table.label}` : table.label;
}

export function seatTitle(layout, seatId) {
  const table = layout?.tables?.find(entry => seatId?.startsWith(`${entry.id}-`));
  if (!table) return '';
  return `${tableTitle(table)}, место ${seatId.slice(table.id.length + 1)}`;
}

/** Bounding box of tables and chairs, for the SVG viewBox. */
export function layoutBounds(layout, padding = 40) {
  const tables = layout?.tables || [];
  if (!tables.length) return { x: 0, y: 0, w: 800, h: 500 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const include = (x, y, r = 0) => { minX = Math.min(minX, x - r); minY = Math.min(minY, y - r); maxX = Math.max(maxX, x + r); maxY = Math.max(maxY, y + r); };
  for (const table of tables) {
    const center = { x: table.x + table.w / 2, y: table.y + table.h / 2 };
    for (const [x, y] of [[table.x, table.y], [table.x + table.w, table.y], [table.x, table.y + table.h], [table.x + table.w, table.y + table.h]]) {
      const corner = rotate({ x, y }, center, table.rotation || 0);
      include(corner.x, corner.y);
    }
    for (const seat of tableSeats(table)) include(seat.x, seat.y, SEAT_RADIUS);
  }
  return { x: minX - padding, y: minY - padding, w: maxX - minX + padding * 2, h: maxY - minY + padding * 2 };
}

let counter = 0;
export function newTableId(tables = []) {
  const used = new Set(tables.map(table => table.id));
  let candidate;
  do candidate = `t${Date.now().toString(36).slice(-4)}${(counter++).toString(36)}`; while (used.has(candidate));
  return candidate;
}

export function nextLabel(tables = []) {
  const numbers = tables.map(table => Number(table.label)).filter(Number.isInteger);
  return String(numbers.length ? Math.max(...numbers) + 1 : 1);
}

const rect = (id, label, x, y, seats, sides) => fitTable({ id, shape: 'rect', label, x, y, w: 0, h: 0, rotation: 0, seats, sides });
const round = (id, label, x, y, seats) => fitTable({ id, shape: 'round', label, x, y, w: 0, h: 0, rotation: 0, seats });

/** Stack narrow tables vertically (legs of П and Т layouts), at most 20 chairs each. */
function column(tables, x, y, seats) {
  const count = Math.ceil(seats / 20);
  for (let i = 0; i < count; i++) {
    const part = Math.floor(seats / count) + (i < seats % count ? 1 : 0);
    const h = Math.max(140, Math.ceil(part / 2) * SEAT_PITCH + 20);
    const n = tables.length + 1;
    tables.push({ id: `t${n}`, shape: 'rect', label: String(n), x, y, w: RECT_DEPTH, h, rotation: 0, seats: part, sides: part > 1 ? ['left', 'right'] : ['left'] });
    y += h + 10;
  }
}

/** Build a starting layout for `guests` people. Ids are deterministic (t1, t2, ...). */
export function generateLayout(template, guests) {
  const total = Math.max(1, Math.min(LIMITS.seats, Math.round(Number(guests) || 1)));
  const tables = [];
  const add = table => { tables.push(table); return table; };
  if (template === 'rounds') {
    const perTable = total <= 6 ? total : total <= 40 ? 8 : 10;
    const count = Math.ceil(total / perTable);
    const columns = Math.ceil(Math.sqrt(count * 1.5));
    for (let i = 0; i < count; i++) add(round(`t${i + 1}`, String(i + 1), 0, 0, Math.floor(total / count) + (i < total % count ? 1 : 0)));
    const cell = Math.max(...tables.map(table => table.w)) + 2 * (SEAT_GAP + SEAT_RADIUS) + 40;
    tables.forEach((table, i) => {
      table.x = 60 + (i % columns) * cell + (cell - table.w) / 2;
      table.y = 60 + Math.floor(i / columns) * cell + (cell - table.h) / 2;
    });
  } else if (template === 'u') {
    const head = Math.max(1, Math.min(16, Math.round(total * 0.2)));
    const legs = total - head;
    const top = add(rect('t1', '1', 60, 60, head, ['top']));
    top.w = Math.max(top.w, 360);
    const leftLeg = Math.ceil(legs / 2);
    column(tables, 60, 60 + top.h + 10, leftLeg);
    column(tables, 60 + top.w - RECT_DEPTH, 60 + top.h + 10, legs - leftLeg);
  } else if (template === 't') {
    const head = Math.max(1, Math.min(16, total, Math.round(total * 0.25)));
    const top = add(rect('t1', '1', 60, 60, head, ['top']));
    top.w = Math.max(top.w, 300);
    column(tables, top.x + top.w / 2 - RECT_DEPTH / 2, top.y + top.h + 10, total - head);
  } else if (template === 'presidium') {
    const head = Math.min(total, Math.max(3, Math.min(9, Math.round(total / 8))));
    const rest = total - head;
    const perRow = 12;
    const rows = Math.ceil(rest / perRow);
    const tablesRest = [];
    for (let i = 0; i < rows; i++) tablesRest.push(Math.floor(rest / rows) + (i < rest % rows ? 1 : 0));
    const widths = tablesRest.map(seats => fitTable({ id: 'tmp', shape: 'rect', label: '', x: 0, y: 0, w: 0, h: 0, rotation: 0, seats, sides: ['top', 'bottom'] }).w);
    const presidium = add(rect('t1', 'Президиум', 60, 60, head, ['top']));
    const width = Math.max(presidium.w, ...widths, 300);
    presidium.x = 60 + (width - presidium.w) / 2;
    tablesRest.forEach((seats, i) => {
      const table = add(rect(`t${i + 2}`, String(i + 1), 60, 60 + presidium.h + 140 + i * 190, seats, ['top', 'bottom']));
      table.x = 60 + (width - table.w) / 2;
    });
  } else if (template === 't') {
    const head = Math.max(1, Math.min(total, Math.round(total * 0.25)));
    const rest = total - head;
    const top = add(rect('t1', '1', 60, 60, head, ['top']));
    if (rest) {
      const stem = fitTable({ id: 't2', shape: 'rect', label: '2', x: 0, y: 0, w: 0, h: 0, rotation: 0, seats: rest, sides: rest > 1 ? ['left', 'right'] : ['left'] });
      const w = RECT_DEPTH, h = Math.max(140, Math.ceil(rest / 2) * SEAT_PITCH + 20);
      top.w = Math.max(top.w, 300);
      add({ ...stem, w, h, x: top.x + top.w / 2 - w / 2, y: top.y + top.h + 10 });
    }
  } else if (template === 'long') {
    const perTable = 24;
    const count = Math.ceil(total / perTable);
    for (let i = 0; i < count; i++) {
      const seats = Math.floor(total / count) + (i < total % count ? 1 : 0);
      add(rect(`t${i + 1}`, String(i + 1), 60, 60 + i * 200, seats, ['top', 'right', 'bottom', 'left']));
    }
  }
  return { tables };
}

function finite(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/**
 * Validate and normalise an untrusted layout. Returns { layout } or { error } with a Russian message.
 */
export function validateLayout(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.tables)) return { error: 'Схема зала: ожидается список столов.' };
  if (value.tables.length > LIMITS.tables) return { error: `Схема зала: не больше ${LIMITS.tables} столов.` };
  const ids = new Set();
  const tables = [];
  let seats = 0;
  for (const raw of value.tables) {
    if (!raw || typeof raw !== 'object') return { error: 'Схема зала: некорректный стол.' };
    if (typeof raw.id !== 'string' || !/^[A-Za-z0-9_]{1,32}$/.test(raw.id) || ids.has(raw.id)) return { error: 'Схема зала: у каждого стола должен быть уникальный идентификатор.' };
    ids.add(raw.id);
    if (!TABLE_SHAPES.includes(raw.shape)) return { error: 'Форма стола: круглый или прямоугольный.' };
    if (typeof raw.label !== 'string' || !raw.label.trim() || raw.label.length > 24 || /[\u0000-\u001f]/.test(raw.label)) return { error: 'Название стола: от 1 до 24 символов.' };
    if (!finite(raw.x, -5000, 50000) || !finite(raw.y, -5000, 50000)) return { error: 'Стол вышел за пределы зала.' };
    if (!finite(raw.w, 40, 1400) || !finite(raw.h, 40, 1000)) return { error: 'Размер стола: от 40 до 1400.' };
    if (![0, 90, 180, 270].includes(raw.rotation ?? 0)) return { error: 'Поворот стола: 0, 90, 180 или 270 градусов.' };
    if (!Number.isSafeInteger(raw.seats) || raw.seats < 0 || raw.seats > LIMITS.seatsPerTable) return { error: `Мест за столом: от 0 до ${LIMITS.seatsPerTable}.` };
    const table = { id: raw.id, shape: raw.shape, label: raw.label.trim(), x: round1(raw.x), y: round1(raw.y), w: round1(raw.w), h: round1(raw.h), rotation: raw.rotation ?? 0, seats: raw.seats };
    if (raw.shape === 'round') table.h = table.w;
    else {
      if (!Array.isArray(raw.sides) || !raw.sides.every(side => RECT_SIDES.includes(side)) || new Set(raw.sides).size !== raw.sides.length || (raw.seats > 0 && !raw.sides.length)) return { error: 'Выберите стороны стола, где стоят стулья.' };
      table.sides = RECT_SIDES.filter(side => raw.sides.includes(side));
    }
    seats += table.seats;
    tables.push(table);
  }
  if (seats > LIMITS.seats) return { error: `Всего мест не больше ${LIMITS.seats}.` };
  return { layout: { tables } };
}

/**
 * Pick seats for unseated people. Tables that already have somebody are filled first,
 * then empty tables in layout order, so nobody sits alone at an otherwise empty table.
 * Returns [{ person, seatId }].
 */
export function autoAssign(layout, occupiedSeatIds, people) {
  const occupied = new Set(occupiedSeatIds);
  const tables = (layout?.tables || []).map((table, order) => {
    const seats = tableSeats(table);
    return { order, busy: seats.filter(seat => occupied.has(seat.id)).length, free: seats.filter(seat => !occupied.has(seat.id)) };
  });
  tables.sort((a, b) => (b.busy > 0) - (a.busy > 0) || a.order - b.order);
  const free = tables.flatMap(table => table.free);
  return people.slice(0, free.length).map((person, index) => ({ person, seatId: free[index].id }));
}
