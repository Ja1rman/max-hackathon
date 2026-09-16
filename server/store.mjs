import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { digest, HttpError } from './auth.mjs';

const secret = () => randomBytes(32).toString('base64url');
const id = prefix => `${prefix}_${randomUUID()}`;
const iso = value => new Date(value).toISOString();
const MAX_MONEY = 100_000_000_00;

export const SAMPLE_MENU = [
  { name: 'Буррата с томатами', description: 'Сладкие томаты, базилик, оливковое масло и нежная буррата', category: 'Закуски', price: 69000, weight: '230 г', emoji: '🍅', allergens: ['Молоко'], vegetarian: true },
  { name: 'Салат с ростбифом', description: 'Ростбиф, микс салатов, печёный перец и горчичный соус', category: 'Закуски', price: 79000, weight: '210 г', emoji: '🥗', allergens: ['Горчица'], vegetarian: false },
  { name: 'Лосось с овощами', description: 'Филе лосося на гриле с сезонными овощами и лимоном', category: 'Горячее', price: 129000, weight: '320 г', emoji: '🐟', allergens: ['Рыба'], vegetarian: false },
  { name: 'Цыплёнок с пюре', description: 'Запечённое филе цыплёнка, картофельное пюре и сливочный соус', category: 'Горячее', price: 89000, weight: '350 г', emoji: '🍗', allergens: ['Молоко'], vegetarian: false },
  { name: 'Ризотто с грибами', description: 'Рис арборио, лесные грибы и пармезан', category: 'Горячее', price: 85000, weight: '280 г', emoji: '🍄', allergens: ['Молоко'], vegetarian: true },
  { name: 'Павлова с ягодами', description: 'Хрустящая меренга, сливочный крем и свежие ягоды', category: 'Десерты', price: 49000, weight: '150 г', emoji: '🍓', allergens: ['Яйца', 'Молоко'], vegetarian: true },
  { name: 'Шоколадный фондан', description: 'Тёплый шоколадный десерт с шариком ванильного мороженого', category: 'Десерты', price: 55000, weight: '180 г', emoji: '🍫', allergens: ['Глютен', 'Яйца', 'Молоко'], vegetarian: true },
  { name: 'Домашний лимонад', description: 'Лимон, мята и газированная вода', category: 'Напитки', price: 29000, weight: '300 мл', emoji: '🍋', allergens: [], vegetarian: true },
];

function string(value, label, max = 160, optional = false) {
  if (optional && (value === undefined || value === null)) return '';
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    throw new HttpError(400, `${label}: проверьте значение.`);
  }
  return value.trim();
}
function integer(value, label, min = 0, max = MAX_MONEY) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new HttpError(400, `${label}: ожидается целое число от ${min} до ${max}.`);
  return value;
}
function date(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new HttpError(400, `${label}: ожидается дата ISO 8601.`);
  return iso(value);
}

export class Store {
  constructor(config) {
    this.config = config;
    if (config.databasePath !== ':memory:') mkdirSync(dirname(config.databasePath), { recursive: true });
    this.db = new DatabaseSync(config.databasePath);
    this.db.exec(`PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS scopes (id TEXT PRIMARY KEY, secret_hash TEXT UNIQUE, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, scope TEXT NOT NULL REFERENCES scopes(id) ON DELETE CASCADE, external_id TEXT, name TEXT NOT NULL, role TEXT NOT NULL, demo INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS restaurants (id TEXT PRIMARY KEY, scope TEXT NOT NULL REFERENCES scopes(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT NOT NULL, address TEXT NOT NULL, sample_menu INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS menu_items (id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, scope TEXT NOT NULL REFERENCES scopes(id) ON DELETE CASCADE, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE, title TEXT NOT NULL, date TEXT NOT NULL, deadline TEXT NOT NULL, expected_guests INTEGER NOT NULL, budget INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'collecting', invite_code TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL, approved_at TEXT, revision INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS event_menu (event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE, item_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(event_id,item_id));
      CREATE TABLE IF NOT EXISTS guests (event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, submitted INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, PRIMARY KEY(event_id,user_id));
      CREATE TABLE IF NOT EXISTS selections (event_id TEXT NOT NULL, user_id TEXT NOT NULL, menu_item_id TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 20), price INTEGER NOT NULL CHECK(price >= 0), name TEXT NOT NULL, PRIMARY KEY(event_id,user_id,menu_item_id), FOREIGN KEY(event_id,user_id) REFERENCES guests(event_id,user_id) ON DELETE CASCADE);
      CREATE INDEX IF NOT EXISTS events_scope_idx ON events(scope);
      CREATE INDEX IF NOT EXISTS guests_user_idx ON guests(user_id);
      CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
      CREATE TABLE IF NOT EXISTS max_webhook_claims (key TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS download_tokens (token_hash TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, event_revision INTEGER NOT NULL, expires_at INTEGER NOT NULL, UNIQUE(event_id,user_id));
      `);
    if (!this.db.prepare('PRAGMA table_info(events)').all().some(column => column.name === 'revision')) {
      this.db.exec('ALTER TABLE events ADD COLUMN revision INTEGER NOT NULL DEFAULT 0');
    }
    this.db.exec('PRAGMA user_version = 3');
    this.db.prepare('INSERT OR IGNORE INTO scopes VALUES (?, NULL, ?)').run('live', iso(Date.now()));
    if (!this.db.prepare('SELECT id FROM restaurants WHERE scope = ?').get('live')) this.seedRestaurant('live');
    this.cleanup();
  }
  close() { this.db.close(); }
  cleanup() {
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    this.db.prepare('DELETE FROM scopes WHERE id != ? AND created_at < ?').run('live', iso(Date.now() - 7 * 86400000));
    this.db.prepare('DELETE FROM max_webhook_claims WHERE created_at < ?').run(Date.now() - 7 * 86400000);
    this.db.prepare('DELETE FROM download_tokens WHERE expires_at <= ?').run(Date.now());
  }
  claimMaxUpdate(key) {
    if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid MAX update claim key');
    return this.db.prepare('INSERT OR IGNORE INTO max_webhook_claims VALUES (?,?)').run(key, Date.now()).changes === 1;
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  seedRestaurant(scope) {
    const restaurantId = id('restaurant');
    this.db.prepare('INSERT INTO restaurants VALUES (?,?,?,?,?,1)').run(restaurantId, scope, 'Тёплый вечер', 'Современная кухня для ваших особенных встреч. Демонстрационный ресторан и пример меню.', 'Москва · адрес уточняется');
    const add = this.db.prepare('INSERT INTO menu_items VALUES (?,?,?)');
    for (const entry of SAMPLE_MENU) {
      const itemId = id('dish');
      add.run(itemId, restaurantId, JSON.stringify({ ...entry, id: itemId, available: true }));
    }
    return restaurantId;
  }
  publicUser(user) { return { id: user.id, name: user.name, role: user.role, demo: Boolean(user.demo) }; }
  issueSession(user) {
    const token = secret();
    this.db.prepare('DELETE FROM sessions WHERE user_id=? AND expires_at<=?').run(user.id, Date.now());
    this.db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id=? ORDER BY expires_at DESC LIMIT 9)').run(user.id, user.id);
    this.db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(digest(token), user.id, Date.now() + (user.demo ? 86400000 : 7 * 86400000));
    return { token, user: this.publicUser(user) };
  }
  authenticate(token) {
    if (!token || token.length > 256) throw new HttpError(401, 'Войдите через MAX или откройте демо.');
    const user = this.db.prepare('SELECT users.* FROM users JOIN sessions ON sessions.user_id = users.id WHERE sessions.token_hash = ? AND sessions.expires_at > ?').get(digest(token), Date.now());
    if (!user) throw new HttpError(401, 'Сессия истекла. Войдите снова.');
    if (user.demo && !this.config.demoEnabled) throw new HttpError(401, 'Демонстрационный режим выключен. Войдите через MAX.');
    // Configuration changes revoke restaurant permissions on the next request.
    if (!user.demo) user.role = this.config.restaurantAdminIds.includes(user.external_id) ? 'restaurant' : 'organizer';
    return user;
  }
  loginMax(profile) {
    const userId = `max_${profile.id}`;
    const role = this.config.restaurantAdminIds.includes(profile.id) ? 'restaurant' : 'organizer';
    this.db.prepare(`INSERT INTO users VALUES (?,'live',?,?,?,0) ON CONFLICT(id) DO UPDATE SET name=excluded.name,role=excluded.role`).run(userId, profile.id, profile.name, role);
    return this.issueSession(this.db.prepare('SELECT * FROM users WHERE id=?').get(userId));
  }
  loginDemo(body) {
    if (!this.config.demoEnabled) throw new HttpError(404, 'Демонстрационный режим выключен.');
    const role = body.role || 'organizer';
    if (!['organizer', 'guest', 'restaurant'].includes(role)) throw new HttpError(400, 'Неизвестная роль.');
    if (body.inviteCode && !body.sandbox) {
      return this.transaction(() => {
        const event = this.findInvite(body.inviteCode);
        if (event.scope === 'live') throw new HttpError(403, 'Для этого банкета нужен вход через MAX.');
        this.assertOpen(event);
        const userId = id('demo_guest');
        const name = string(body.name || 'Новый гость', 'Имя', 80);
        this.db.prepare('INSERT INTO users VALUES (?,?,NULL,?,?,1)').run(userId, event.scope, name, 'guest');
        const user = this.db.prepare('SELECT * FROM users WHERE id=?').get(userId);
        this.join(user, event.invite_code);
        return { ...this.issueSession(user), sandbox: null, eventId: event.id };
      });
    }
    let scope;
    let sandbox = body.sandbox;
    if (sandbox !== undefined) {
      if (typeof sandbox !== 'string' || sandbox.length > 128) throw new HttpError(400, 'Некорректная демо-сессия.');
      scope = this.db.prepare('SELECT id FROM scopes WHERE secret_hash=?').get(digest(sandbox))?.id;
      if (!scope) throw new HttpError(401, 'Демо-сессия истекла. Начните новую.');
    } else {
      sandbox = secret();
      scope = id('demo');
      this.transaction(() => {
        const count = this.db.prepare("SELECT COUNT(*) AS count FROM scopes WHERE id!='live'").get().count;
        if (count >= this.config.maxDemoSpaces) throw new HttpError(429, 'Все демо-пространства заняты. Продолжите в существующем демо или зайдите позже.');
        this.db.prepare('INSERT INTO scopes VALUES (?,?,?)').run(scope, digest(sandbox), iso(Date.now()));
        for (const [userRole, name] of [['organizer', 'Александра'], ['guest', 'Вы'], ['restaurant', 'Команда ресторана']]) {
          this.db.prepare('INSERT INTO users VALUES (?,?,NULL,?,?,1)').run(`${scope}_${userRole}`, scope, name, userRole);
        }
        const restaurantId = this.seedRestaurant(scope);
        const owner = this.db.prepare('SELECT * FROM users WHERE id=?').get(`${scope}_organizer`);
        const event = this.createEvent(owner, { title: 'День рождения Александры', restaurantId, date: iso(Date.now() + 14 * 86400000), deadline: iso(Date.now() + 10 * 86400000), expectedGuests: 12, budget: 3600000 });
        const menu = this.eventMenu(event.id);
        for (const [index, [name, notes, indexes]] of [
          ['Мария Волкова', 'Без орехов, пожалуйста', [0, 4, 5]],
          ['Дмитрий Соколов', '', [1, 3, 7]],
          ['Анна Морозова', 'Вегетарианское меню', [0, 4, 7]],
          ['Алексей Петров', 'Соус отдельно', [1, 2, 6]],
          ['Екатерина Смирнова', '', [0, 3, 5]],
        ].entries()) {
          const uid = `${scope}_synthetic_${index}`;
          this.db.prepare('INSERT INTO users VALUES (?,?,NULL,?,?,1)').run(uid, scope, name, 'guest');
          this.db.prepare('INSERT INTO guests VALUES (?,?,1,?,?)').run(event.id, uid, notes, iso(Date.now()));
          for (const itemIndex of indexes) {
            const item = menu[itemIndex];
            this.db.prepare('INSERT INTO selections VALUES (?,?,?,?,?,?)').run(event.id, uid, item.id, 1, item.price, item.name);
          }
        }
        this.db.prepare('INSERT INTO guests VALUES (?,?,0,?,?)').run(event.id, `${scope}_guest`, '', iso(Date.now()));
      });
    }
    const user = this.db.prepare('SELECT * FROM users WHERE id=?').get(`${scope}_${role}`);
    if (!user) throw new HttpError(401, 'Демо-сессия недоступна.');
    return { ...this.issueSession(user), sandbox };
  }
  restaurants(user) {
    return this.db.prepare('SELECT * FROM restaurants WHERE scope=? ORDER BY name').all(user.scope).map(row => ({
      id: row.id, name: row.name, description: row.description, address: row.address, sampleMenu: Boolean(row.sample_menu),
      menu: this.db.prepare('SELECT data FROM menu_items WHERE restaurant_id=? ORDER BY rowid').all(row.id).map(item => JSON.parse(item.data)),
    }));
  }
  eventMenu(eventId) { return this.db.prepare('SELECT data FROM event_menu WHERE event_id=? ORDER BY rowid').all(eventId).map(row => JSON.parse(row.data)); }
  eventRow(eventId, user) {
    const row = this.db.prepare('SELECT * FROM events WHERE id=? AND scope=?').get(eventId, user.scope);
    if (!row) throw new HttpError(404, 'Банкет не найден.');
    return row;
  }
  isManager(user, event) { return event.scope === user.scope && (event.owner_id === user.id || user.role === 'restaurant'); }
  canRead(user, event) {
    if (this.isManager(user, event)) return true;
    return Boolean(this.db.prepare('SELECT 1 FROM guests WHERE event_id=? AND user_id=?').get(event.id, user.id));
  }
  presentEvent(row, user, publicOnly = false) {
    const total = this.db.prepare('SELECT COALESCE(SUM(quantity*price),0) AS total FROM selections WHERE event_id=?').get(row.id).total;
    const counts = this.db.prepare('SELECT COUNT(*) AS joined, COALESCE(SUM(submitted),0) AS responded FROM guests WHERE event_id=?').get(row.id);
    const restaurant = this.db.prepare('SELECT name,sample_menu FROM restaurants WHERE id=?').get(row.restaurant_id);
    const event = { id: row.id, title: row.title, date: row.date, deadline: row.deadline, status: row.status, restaurantId: row.restaurant_id, restaurantName: restaurant.name, demo: row.scope !== 'live', sampleMenu: Boolean(restaurant.sample_menu), menuSnapshot: true };
    if (!publicOnly) Object.assign(event, { expectedGuests: row.expected_guests, total, responded: counts.responded, joined: counts.joined, approvedAt: row.approved_at, isOwner: user?.id === row.owner_id, revision: row.revision });
    if (!publicOnly && this.isManager(user, row)) Object.assign(event, { budget: row.budget, inviteCode: row.invite_code });
    return event;
  }
  events(user) {
    return this.db.prepare('SELECT * FROM events WHERE scope=? ORDER BY created_at DESC').all(user.scope).filter(row => this.canRead(user, row)).map(row => this.presentEvent(row, user));
  }
  createEvent(user, body) {
    if (user.role === 'guest' || user.role === 'restaurant') throw new HttpError(403, 'Создать банкет может организатор.');
    const count = this.db.prepare('SELECT COUNT(*) AS count FROM events WHERE owner_id=?').get(user.id).count;
    if (count >= (user.demo ? 30 : 500)) throw new HttpError(429, 'Достигнут предел банкетов для этого организатора.');
    const restaurant = this.db.prepare('SELECT * FROM restaurants WHERE id=? AND scope=?').get(body.restaurantId, user.scope);
    if (!restaurant) throw new HttpError(400, 'Выберите доступный ресторан.');
    const title = string(body.title, 'Название', 120);
    const eventDate = date(body.date, 'Дата банкета');
    const deadline = date(body.deadline, 'Срок выбора');
    if (Date.parse(eventDate) < Date.now() || Date.parse(deadline) < Date.now() || deadline > eventDate) throw new HttpError(400, 'Срок выбора должен быть в будущем и не позже банкета.');
    const expected = integer(body.expectedGuests, 'Число гостей', 1, 1000);
    const budget = integer(body.budget ?? 0, 'Бюджет');
    const menu = this.db.prepare('SELECT id,data FROM menu_items WHERE restaurant_id=? ORDER BY rowid').all(restaurant.id).filter(row => JSON.parse(row.data).available);
    if (!menu.length) throw new HttpError(409, 'В ресторане пока нет доступных блюд.');
    const eventId = id('event');
    this.db.prepare(`INSERT INTO events (id,scope,owner_id,restaurant_id,title,date,deadline,expected_guests,budget,status,invite_code,created_at,approved_at) VALUES (?,?,?,?,?,?,?,?,?,'collecting',?,?,NULL)`).run(eventId, user.scope, user.id, restaurant.id, title, eventDate, deadline, expected, budget, secret().slice(0, 24), iso(Date.now()));
    const add = this.db.prepare('INSERT INTO event_menu VALUES (?,?,?)');
    for (const item of menu) add.run(eventId, item.id, item.data);
    return this.presentEvent(this.eventRow(eventId, user), user);
  }
  findInvite(code) {
    if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{24}$/.test(code)) throw new HttpError(404, 'Приглашение не найдено.');
    const event = this.db.prepare('SELECT * FROM events WHERE invite_code=?').get(code);
    if (!event) throw new HttpError(404, 'Приглашение не найдено.');
    if (event.scope !== 'live' && !this.config.demoEnabled) throw new HttpError(404, 'Приглашение не найдено.');
    return event;
  }
  invite(code) {
    const event = this.findInvite(code);
    return { event: this.presentEvent(event, null, true), menu: this.eventMenu(event.id) };
  }
  assertOpen(event) {
    if (event.status !== 'collecting') throw new HttpError(409, 'Заказ уже утверждён. Выбор блюд закрыт.');
    if (Date.parse(event.deadline) <= Date.now()) throw new HttpError(409, 'Срок выбора блюд завершён.');
  }
  join(user, code) {
    const event = this.findInvite(code);
    if (event.scope !== user.scope) throw new HttpError(403, 'Это приглашение относится к другой сессии. Откройте его в MAX или в отдельном демо.');
    const existing = this.db.prepare('SELECT 1 FROM guests WHERE event_id=? AND user_id=?').get(event.id, user.id);
    if (!existing) {
      this.assertOpen(event);
      const count = this.db.prepare('SELECT COUNT(*) AS count FROM guests WHERE event_id=?').get(event.id).count;
      if (count >= 1000) throw new HttpError(409, 'Достигнут предел гостей.');
      this.db.prepare('INSERT INTO guests VALUES (?,?,0,?,?)').run(event.id, user.id, '', iso(Date.now()));
      this.db.prepare('UPDATE events SET revision=revision+1 WHERE id=?').run(event.id);
    }
    return { eventId: event.id };
  }
  detail(user, eventId) {
    const event = this.eventRow(eventId, user);
    if (!this.canRead(user, event)) throw new HttpError(404, 'Банкет не найден.');
    const manager = this.isManager(user, event);
    const guestRows = manager
      ? this.db.prepare('SELECT guests.*,users.name FROM guests JOIN users ON users.id=guests.user_id WHERE event_id=? ORDER BY submitted DESC, users.name').all(event.id)
      : this.db.prepare('SELECT guests.*,users.name FROM guests JOIN users ON users.id=guests.user_id WHERE event_id=? AND user_id=?').all(event.id, user.id);
    const guests = guestRows.map(row => {
      const selections = this.db.prepare('SELECT menu_item_id AS menuItemId,quantity,price,name FROM selections WHERE event_id=? AND user_id=? ORDER BY rowid').all(event.id, row.user_id);
      return { id: row.user_id, name: row.name, submitted: Boolean(row.submitted), notes: row.notes, items: selections, total: selections.reduce((sum, item) => sum + item.quantity * item.price, 0) };
    });
    const own = guests.find(guest => guest.id === user.id);
    const summary = manager ? this.db.prepare('SELECT menu_item_id AS menuItemId,name,SUM(quantity) AS quantity,SUM(quantity*price) AS total FROM selections WHERE event_id=? GROUP BY menu_item_id,name ORDER BY name').all(event.id) : [];
    const result = { event: this.presentEvent(event, user), menu: this.eventMenu(event.id), guests, selection: own ? { submitted: own.submitted, notes: own.notes, items: own.items, total: own.total } : { submitted: false, notes: '', items: [], total: 0 }, summary };
    if (manager) Object.assign(result, { inviteCode: event.invite_code, inviteUrl: `${this.config.publicUrl}/invite/${event.invite_code}`, maxInviteUrl: this.config.botUsername ? `https://max.ru/${this.config.botUsername}?startapp=${event.invite_code}` : null });
    return result;
  }
  saveSelection(user, eventId, body) {
    return this.transaction(() => {
      const event = this.eventRow(eventId, user);
      this.assertOpen(event);
      let guest = this.db.prepare('SELECT * FROM guests WHERE event_id=? AND user_id=?').get(event.id, user.id);
      if (!guest && event.owner_id === user.id) {
        this.db.prepare('INSERT INTO guests VALUES (?,?,0,?,?)').run(event.id, user.id, '', iso(Date.now()));
        guest = true;
      }
      if (!guest) throw new HttpError(403, 'Сначала присоединитесь к банкету по приглашению.');
      if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) throw new HttpError(400, 'Выберите от 1 до 50 блюд.');
      const notes = string(body.notes, 'Пожелания', 1000, true);
      const menu = new Map(this.eventMenu(event.id).map(item => [item.id, item]));
      const unique = new Set();
      let total = 0;
      const items = body.items.map(item => {
        if (!item || typeof item.menuItemId !== 'string' || unique.has(item.menuItemId)) throw new HttpError(400, 'Некорректный или повторяющийся выбор блюда.');
        unique.add(item.menuItemId);
        const entry = menu.get(item.menuItemId);
        if (!entry || !entry.available) throw new HttpError(400, 'Блюдо недоступно в меню банкета.');
        const quantity = integer(item.quantity, 'Количество', 1, 20);
        total += entry.price * quantity;
        if (!Number.isSafeInteger(total) || total > MAX_MONEY) throw new HttpError(400, 'Превышена максимальная сумма заказа.');
        return { ...entry, quantity };
      });
      this.db.prepare('DELETE FROM selections WHERE event_id=? AND user_id=?').run(event.id, user.id);
      const add = this.db.prepare('INSERT INTO selections VALUES (?,?,?,?,?,?)');
      for (const item of items) add.run(event.id, user.id, item.id, item.quantity, item.price, item.name);
      this.db.prepare('UPDATE guests SET submitted=1,notes=?,updated_at=? WHERE event_id=? AND user_id=?').run(notes, iso(Date.now()), event.id, user.id);
      this.db.prepare('UPDATE events SET revision=revision+1 WHERE id=?').run(event.id);
      return { success: true, total };
    });
  }
  approve(user, eventId, body = {}) {
    return this.transaction(() => {
      const event = this.eventRow(eventId, user);
      if (event.owner_id !== user.id) throw new HttpError(403, 'Утвердить заказ может только организатор.');
      if (event.status === 'approved') return this.presentEvent(event, user);
      if (body.expectedRevision === undefined) throw new HttpError(400, 'Перед утверждением откройте актуальную версию заказа.');
      if (integer(body.expectedRevision, 'Версия заказа') !== event.revision) {
        throw new HttpError(409, 'Гости обновили свой выбор. Проверьте свежую сумму и утвердите заказ ещё раз.');
      }
      const count = this.db.prepare('SELECT COUNT(*) AS count FROM guests WHERE event_id=? AND submitted=1').get(event.id).count;
      if (!count) throw new HttpError(409, 'Пока нет ни одного выбора. Дождитесь ответа гостей.');
      this.db.prepare("UPDATE events SET status='approved',approved_at=?,revision=revision+1 WHERE id=? AND status='collecting'").run(iso(Date.now()), event.id);
      return this.presentEvent(this.eventRow(event.id, user), user);
    });
  }
  editMenu(user, restaurantId, itemId, body) {
    if (user.role !== 'restaurant') throw new HttpError(403, 'Редактирование доступно только ресторану.');
    const restaurant = this.db.prepare('SELECT * FROM restaurants WHERE id=? AND scope=?').get(restaurantId, user.scope);
    if (!restaurant) throw new HttpError(404, 'Ресторан не найден.');
    if (!itemId && this.db.prepare('SELECT COUNT(*) AS count FROM menu_items WHERE restaurant_id=?').get(restaurantId).count >= 500) throw new HttpError(429, 'Достигнут предел блюд в меню.');
    const existing = itemId ? this.db.prepare('SELECT data FROM menu_items WHERE id=? AND restaurant_id=?').get(itemId, restaurantId) : null;
    if (itemId && !existing) throw new HttpError(404, 'Блюдо не найдено.');
    const value = { ...(existing ? JSON.parse(existing.data) : { emoji: '🍽️', available: true, vegetarian: false, allergens: [] }), ...body };
    const item = {
      id: itemId || id('dish'), name: string(value.name, 'Название', 120), description: string(value.description, 'Описание', 500, true), category: string(value.category, 'Категория', 80),
      price: integer(value.price, 'Цена в копейках', 1, 100000000), weight: string(value.weight, 'Вес', 40, true), emoji: string(value.emoji || '🍽️', 'Значок', 12),
      available: value.available, vegetarian: value.vegetarian, allergens: value.allergens,
    };
    if (typeof item.available !== 'boolean' || typeof item.vegetarian !== 'boolean') throw new HttpError(400, 'Доступность и вегетарианское блюдо должны быть true/false.');
    if (!Array.isArray(item.allergens) || item.allergens.length > 20) throw new HttpError(400, 'Аллергены: ожидается список до 20 значений.');
    item.allergens = item.allergens.map(entry => string(entry, 'Аллерген', 80));
    this.db.prepare('INSERT INTO menu_items VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(item.id, restaurantId, JSON.stringify(item));
    this.db.prepare('UPDATE restaurants SET sample_menu=0 WHERE id=?').run(restaurantId);
    return item;
  }
  exportCsv(user, eventId) {
    const event = this.eventRow(eventId, user);
    if (!this.isManager(user, event)) throw new HttpError(403, 'Экспорт доступен организатору и ресторану.');
    if (event.status !== 'approved') throw new HttpError(409, 'Сначала утвердите заказ.');
    const detail = this.detail(user, eventId);
    // Formula injection remains possible after quoting, so neutralize leading spreadsheet operators.
    const cell = value => `"${String(value ?? '').replace(/^[\s]*[=+@-]/, match => `'${match}`).replaceAll('"', '""')}"`;
    const rows = [['Банкет', event.title], ['Дата', event.date], [], ['Блюдо', 'Количество', 'Сумма, руб.']];
    for (const item of detail.summary) rows.push([item.name, item.quantity, (item.total / 100).toFixed(2)]);
    rows.push([], ['Гость', 'Блюдо', 'Количество', 'Пожелания / аллергии']);
    for (const guest of detail.guests) for (const item of guest.items) rows.push([guest.name, item.name, item.quantity, guest.notes]);
    return '\uFEFF' + rows.map(row => row.map(cell).join(';')).join('\r\n');
  }
  createExportLink(user, eventId) {
    return this.transaction(() => {
      const event = this.eventRow(eventId, user);
      if (!this.isManager(user, event)) throw new HttpError(403, 'Экспорт доступен организатору и ресторану.');
      if (event.status !== 'approved') throw new HttpError(409, 'Сначала утвердите заказ.');
      const token = secret();
      this.db.prepare('DELETE FROM download_tokens WHERE expires_at <= ? OR (event_id=? AND user_id=?)').run(Date.now(), event.id, user.id);
      this.db.prepare('INSERT INTO download_tokens VALUES (?,?,?,?,?)').run(digest(token), event.id, user.id, event.revision, Date.now() + 60000);
      return { url: `${this.config.publicUrl}/api/downloads/${token}` };
    });
  }
  consumeExportLink(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError(404, 'Ссылка на выгрузку недействительна. Создайте новую.');
    return this.transaction(() => {
      const grant = this.db.prepare('SELECT * FROM download_tokens WHERE token_hash=? AND expires_at>?').get(digest(token), Date.now());
      if (!grant) throw new HttpError(404, 'Ссылка на выгрузку недействительна. Создайте новую.');
      const user = this.db.prepare('SELECT * FROM users WHERE id=?').get(grant.user_id);
      if (!user || (user.demo && !this.config.demoEnabled)) throw new HttpError(404, 'Ссылка на выгрузку недействительна. Создайте новую.');
      if (!user.demo) user.role = this.config.restaurantAdminIds.includes(user.external_id) ? 'restaurant' : 'organizer';
      const event = this.eventRow(grant.event_id, user);
      if (!this.isManager(user, event) || event.status !== 'approved' || event.revision !== grant.event_revision) throw new HttpError(404, 'Ссылка на выгрузку недействительна. Создайте новую.');
      const csv = this.exportCsv(user, event.id);
      this.db.prepare('DELETE FROM download_tokens WHERE token_hash=?').run(grant.token_hash);
      return csv;
    });
  }
}
