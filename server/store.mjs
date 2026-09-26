import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { digest, HttpError, normalizePhone } from './auth.mjs';
import { MENU_LABELS } from '../shared/menu-labels.mjs';
import { spentByUnit } from '../shared/currency.mjs';
import { SEATING_MODES, autoAssign, generateLayout, layoutSeats, seatTitle, tableSeats, validateLayout } from '../shared/seating.mjs';

const secret = () => randomBytes(32).toString('base64url');
const id = prefix => `${prefix}_${randomUUID()}`;
const iso = value => new Date(value).toISOString();
const MAX_MONEY = 100_000_000_00;

export const SAMPLE_MENU = [
  { name: 'Буррата с томатами', description: 'Сладкие томаты, базилик, оливковое масло и нежная буррата', category: 'Закуски', price: 69000, weight: '230 г', emoji: '🍅', allergens: ['Молоко'], vegetarian: true, nutrition: { kcal: 340, protein: 17, fat: 26, carbs: 10 } },
  { name: 'Салат с ростбифом', description: 'Ростбиф, микс салатов, печёный перец и горчичный соус', category: 'Закуски', price: 79000, weight: '210 г', emoji: '🥗', allergens: ['Горчица'], vegetarian: false, nutrition: { kcal: 295, protein: 24, fat: 18, carbs: 9 } },
  { name: 'Лосось с овощами', description: 'Филе лосося на гриле с сезонными овощами и лимоном', category: 'Горячее', price: 129000, weight: '320 г', emoji: '🐟', allergens: ['Рыба'], vegetarian: false, labels: ['Много белка'], nutrition: { kcal: 510, protein: 42, fat: 32, carbs: 13 } },
  { name: 'Цыплёнок с пюре', description: 'Запечённое филе цыплёнка, картофельное пюре и сливочный соус', category: 'Горячее', price: 89000, weight: '350 г', emoji: '🍗', allergens: ['Молоко'], vegetarian: false, labels: ['Много белка'], nutrition: { kcal: 575, protein: 44, fat: 27, carbs: 35 } },
  { name: 'Ризотто с грибами', description: 'Рис арборио, лесные грибы и пармезан', category: 'Горячее', price: 85000, weight: '280 г', emoji: '🍄', allergens: ['Молоко'], vegetarian: true, nutrition: { kcal: 490, protein: 13, fat: 21, carbs: 59 } },
  { name: 'Павлова с ягодами', description: 'Хрустящая меренга, сливочный крем и сезонные ягоды', category: 'Десерты', price: 49000, weight: '150 г', emoji: '🍓', allergens: ['Яйца', 'Молоко'], vegetarian: true, nutrition: { kcal: 315, protein: 5, fat: 15, carbs: 40 } },
  { name: 'Шоколадный фондан', description: 'Тёплый шоколадный десерт с шариком ванильного мороженого', category: 'Десерты', price: 55000, weight: '180 г', emoji: '🍫', allergens: ['Глютен', 'Яйца', 'Молоко'], vegetarian: true, nutrition: { kcal: 465, protein: 7, fat: 28, carbs: 47 } },
  { name: 'Домашний лимонад', description: 'Лимон, мята и газированная вода', category: 'Напитки', price: 29000, weight: '300 мл', emoji: '🍋', allergens: [], vegetarian: true, nutrition: { kcal: 105, protein: 0, fat: 0, carbs: 26 } },
  { name: 'Ягодный морс', description: 'Клюква, брусника и немного сахара', category: 'Напитки', price: 25000, weight: '300 мл', emoji: '🫐', allergens: [], vegetarian: true, nutrition: { kcal: 90, protein: 0, fat: 0, carbs: 22 } },
  { name: 'Чай с мятой', description: 'Горячий чай с листьями мяты', category: 'Напитки', price: 19000, weight: '350 мл', emoji: '🍵', allergens: [], vegetarian: true, labels: ['Мало калорий'], nutrition: { kcal: 0, protein: 0, fat: 0, carbs: 0 } },
  { name: 'Капучино', description: 'Эспрессо и вспененное молоко', category: 'Напитки', price: 27000, weight: '250 мл', emoji: '☕', allergens: ['Молоко'], vegetarian: true, nutrition: { kcal: 120, protein: 6, fat: 6, carbs: 11 } },
  { name: 'Вода без газа', description: 'Бутилированная питьевая вода', category: 'Напитки', price: 17000, weight: '500 мл', emoji: '💧', allergens: [], vegetarian: true, nutrition: { kcal: 0, protein: 0, fat: 0, carbs: 0 } },
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
function grams(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000 || Math.round(value * 10) !== value * 10) throw new HttpError(400, `${label}: укажите число от 0 до 1000 с точностью 0,1 г.`);
  return value;
}
function date(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new HttpError(400, `${label}: ожидается дата ISO 8601.`);
  return iso(value);
}
function menuItem(value, itemId) {
  const nutrition = value.nutrition || {};
  const item = {
    id: itemId, name: string(value.name, 'Название', 120), description: string(value.description, 'Описание', 500, true),
    category: string(value.category, 'Категория', 80), price: integer(value.price, 'Цена в копейках', 1, 100000000),
    weight: string(value.weight, 'Вес / объём', 40, true), emoji: string(value.emoji || '🍽️', 'Значок', 12),
    ingredients: string(value.ingredients ?? '', 'Состав', 1000, true), forGuests: value.forGuests ?? true,
    photoUrl: value.photoUrl || '', available: value.available, vegetarian: value.vegetarian, allergens: value.allergens,
    labels: value.labels ?? [],
    nutrition: {
      kcal: integer(nutrition.kcal, 'Калории', 0, 10000), protein: grams(nutrition.protein, 'Белки'),
      fat: grams(nutrition.fat, 'Жиры'), carbs: grams(nutrition.carbs, 'Углеводы'),
    },
  };
  if (typeof item.forGuests !== 'boolean') throw new HttpError(400, 'Доступность гостям должна быть true/false.');
  if (typeof item.available !== 'boolean' || typeof item.vegetarian !== 'boolean') throw new HttpError(400, 'Доступность и вегетарианское блюдо должны быть true/false.');
  if (typeof item.photoUrl !== 'string' || (item.photoUrl && !/^\/api\/media\/[a-f0-9-]{36}\.(?:jpg|png|webp)$/.test(item.photoUrl))) throw new HttpError(400, 'Загрузите фото через API сервиса.');
  if (!Array.isArray(item.allergens) || item.allergens.length > 20) throw new HttpError(400, 'Аллергены: ожидается список до 20 значений.');
  item.allergens = item.allergens.map(entry => string(entry, 'Аллерген', 80));
  if (!Array.isArray(item.labels) || item.labels.length > MENU_LABELS.length || new Set(item.labels).size !== item.labels.length || item.labels.some(label => !MENU_LABELS.includes(label))) throw new HttpError(400, 'Пометки блюда: выберите значения из доступного списка без повторов.');
  return item;
}

const presentMenuItem = data => ({ labels: [], ingredients: '', forGuests: true, ...JSON.parse(data) });

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
      CREATE TABLE IF NOT EXISTS guest_invites (id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE, name TEXT NOT NULL, phone TEXT NOT NULL, user_id TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL, UNIQUE(event_id,phone), UNIQUE(event_id,user_id));
      CREATE INDEX IF NOT EXISTS guest_invites_event_idx ON guest_invites(event_id);
      CREATE TABLE IF NOT EXISTS bot_contacts (external_id TEXT PRIMARY KEY, active INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS notification_jobs (id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, due_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, sent_at INTEGER, cancelled_at INTEGER, UNIQUE(event_id,user_id,kind));
      CREATE INDEX IF NOT EXISTS notification_due_idx ON notification_jobs(due_at) WHERE sent_at IS NULL AND cancelled_at IS NULL;
      CREATE TABLE IF NOT EXISTS media_assets (file_name TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS organizers (id TEXT PRIMARY KEY, scope TEXT NOT NULL REFERENCES scopes(id) ON DELETE CASCADE, name TEXT NOT NULL, phone TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(scope,phone));
      CREATE TABLE IF NOT EXISTS shared_items (event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE, menu_item_id TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 1000), price INTEGER NOT NULL CHECK(price >= 0), name TEXT NOT NULL, PRIMARY KEY(event_id,menu_item_id));
      CREATE TABLE IF NOT EXISTS seat_assignments (event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE, seat_id TEXT NOT NULL, invite_id TEXT REFERENCES guest_invites(id) ON DELETE CASCADE, user_id TEXT REFERENCES users(id) ON DELETE CASCADE, source TEXT NOT NULL, assigned_at TEXT NOT NULL, PRIMARY KEY(event_id,seat_id), UNIQUE(event_id,invite_id), UNIQUE(event_id,user_id), CHECK((invite_id IS NULL) != (user_id IS NULL)));
      `);
    const eventColumns = this.db.prepare('PRAGMA table_info(events)').all().map(column => column.name);
    if (!eventColumns.includes('revision')) this.db.exec('ALTER TABLE events ADD COLUMN revision INTEGER NOT NULL DEFAULT 0');
    if (!eventColumns.includes('seating_mode')) this.db.exec("ALTER TABLE events ADD COLUMN seating_mode TEXT NOT NULL DEFAULT 'off'");
    if (!eventColumns.includes('guest_budget')) {
      // The old budget was a total for the whole banquet; convert it to a per-guest limit.
      this.db.exec('ALTER TABLE events ADD COLUMN guest_budget INTEGER NOT NULL DEFAULT 0; UPDATE events SET guest_budget=budget/MAX(expected_guests,1) WHERE budget>0;');
    }
    if (!eventColumns.includes('food_budget')) {
      // Food and drinks have independent per-guest limits; the former single limit becomes the food one.
      this.db.exec('ALTER TABLE events ADD COLUMN food_budget INTEGER NOT NULL DEFAULT 0; ALTER TABLE events ADD COLUMN drink_budget INTEGER NOT NULL DEFAULT 0; UPDATE events SET food_budget=guest_budget;');
    }
    if (!eventColumns.includes('seating_layout')) this.db.exec(`ALTER TABLE events ADD COLUMN seating_layout TEXT NOT NULL DEFAULT '{"tables":[]}'`);
    const userColumns = this.db.prepare('PRAGMA table_info(users)').all().map(column => column.name);
    if (!userColumns.includes('phone')) this.db.exec('ALTER TABLE users ADD COLUMN phone TEXT');
    if (!userColumns.includes('phone_verified_at')) this.db.exec('ALTER TABLE users ADD COLUMN phone_verified_at INTEGER');
    if (!userColumns.includes('notifications_enabled')) this.db.exec('ALTER TABLE users ADD COLUMN notifications_enabled INTEGER NOT NULL DEFAULT 0');
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_live_phone_idx ON users(phone) WHERE scope='live' AND phone IS NOT NULL; PRAGMA user_version = 7;");
    this.db.prepare('INSERT OR IGNORE INTO scopes VALUES (?, NULL, ?)').run('live', iso(Date.now()));
    if (!this.db.prepare('SELECT id FROM restaurants WHERE scope = ?').get('live')) this.seedRestaurant('live');
    this.migrateSampleNutrition();
    this.cleanup();
  }
  migrateSampleNutrition() {
    const examples = new Map(SAMPLE_MENU.map(item => [item.name, item.nutrition]));
    for (const table of ['menu_items', 'event_menu']) {
      const rows = table === 'menu_items'
        ? this.db.prepare('SELECT menu_items.rowid AS rowid,menu_items.data FROM menu_items JOIN restaurants ON restaurants.id=menu_items.restaurant_id WHERE restaurants.sample_menu=1').all()
        : this.db.prepare('SELECT event_menu.rowid AS rowid,event_menu.data FROM event_menu JOIN events ON events.id=event_menu.event_id JOIN restaurants ON restaurants.id=events.restaurant_id WHERE restaurants.sample_menu=1').all();
      const update = this.db.prepare(`UPDATE ${table} SET data=? WHERE rowid=?`);
      for (const row of rows) {
        const item = JSON.parse(row.data);
        if (item.nutrition) continue;
        const nutrition = examples.get(item.name);
        if (nutrition) update.run(JSON.stringify({ ...item, nutrition, photoUrl: item.photoUrl || '' }), row.rowid);
      }
    }
    for (const restaurant of this.db.prepare('SELECT id FROM restaurants WHERE sample_menu=1').all()) {
      const names = new Set(this.db.prepare('SELECT data FROM menu_items WHERE restaurant_id=?').all(restaurant.id).map(row => JSON.parse(row.data).name));
      const add = this.db.prepare('INSERT INTO menu_items VALUES (?,?,?)');
      for (const entry of SAMPLE_MENU.filter(item => item.category === 'Напитки' && !names.has(item.name))) {
        const itemId = id('dish');
        add.run(itemId, restaurant.id, JSON.stringify({ ...entry, id: itemId, photoUrl: '', available: true }));
      }
    }
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
  /** Live roles: allowlisted MAX IDs administer, organizers are added by an administrator (or already own a banquet), everyone else is a guest. */
  liveRole(user) {
    if (this.config.restaurantAdminIds.includes(user.external_id)) return 'restaurant';
    if (this.config.openOrganizerSignup) return 'organizer';
    if (user.phone_verified_at && user.phone && this.db.prepare("SELECT 1 FROM organizers WHERE scope='live' AND phone=?").get(user.phone)) return 'organizer';
    return this.db.prepare('SELECT 1 FROM events WHERE owner_id=?').get(user.id) ? 'organizer' : 'guest';
  }
  publicUser(user) { return { id: user.id, name: user.name, role: user.demo ? user.role : this.liveRole(user), demo: Boolean(user.demo), phoneVerified: Boolean(user.phone_verified_at), phone: user.phone || null, notificationsEnabled: Boolean(user.notifications_enabled) }; }
  bindPhone(user, phone) {
    if (user.demo || !user.external_id) throw new HttpError(403, 'Подтверждение номера доступно только в MAX.');
    return this.transaction(() => {
      const existing = this.db.prepare("SELECT id FROM users WHERE scope='live' AND phone=? AND id!=?").get(phone, user.id);
      if (existing) throw new HttpError(409, 'Этот номер уже привязан к другому аккаунту MAX.');
      if (user.phone && user.phone !== phone && this.db.prepare('SELECT 1 FROM guest_invites WHERE user_id=?').get(user.id)) {
        throw new HttpError(409, 'Номер уже связан с приглашением. Обратитесь к организатору.');
      }
      this.db.prepare('UPDATE users SET phone=?,phone_verified_at=? WHERE id=?').run(phone, Date.now(), user.id);
      return this.publicUser(this.db.prepare('SELECT * FROM users WHERE id=?').get(user.id));
    });
  }
  setNotifications(user, enabled) {
    if (typeof enabled !== 'boolean') throw new HttpError(400, 'Укажите true или false.');
    if (user.demo) throw new HttpError(403, 'Уведомления доступны после входа через MAX.');
    this.db.prepare('UPDATE users SET notifications_enabled=? WHERE id=?').run(enabled ? 1 : 0, user.id);
    return this.publicUser(this.db.prepare('SELECT * FROM users WHERE id=?').get(user.id));
  }
  recordBotActivity(externalId, active) {
    if (!/^[1-9][0-9]{0,18}$/.test(String(externalId))) return;
    this.db.prepare('INSERT INTO bot_contacts VALUES (?,?,?) ON CONFLICT(external_id) DO UPDATE SET active=excluded.active,updated_at=excluded.updated_at').run(String(externalId), active ? 1 : 0, Date.now());
  }
  queueNotice(eventId, userId, kind, dueAt = Date.now()) {
    if (this.config.botToken && userId) this.db.prepare('INSERT INTO notification_jobs (id,event_id,user_id,kind,due_at) VALUES (?,?,?,?,?) ON CONFLICT(event_id,user_id,kind) DO UPDATE SET due_at=excluded.due_at,cancelled_at=NULL WHERE notification_jobs.sent_at IS NULL').run(id('notice'), eventId, userId, kind, dueAt);
  }
  dueNotices(limit = 10) {
    return this.db.prepare(`SELECT jobs.*,users.external_id,events.title,events.deadline,events.date,events.status AS event_status,events.invite_code,
      COALESCE(guests.submitted,0) AS guest_submitted,bot_contacts.active
      FROM notification_jobs jobs JOIN users ON users.id=jobs.user_id JOIN events ON events.id=jobs.event_id
      LEFT JOIN bot_contacts ON bot_contacts.external_id=users.external_id
      LEFT JOIN guests ON guests.event_id=jobs.event_id AND guests.user_id=jobs.user_id
      WHERE jobs.sent_at IS NULL AND jobs.cancelled_at IS NULL AND jobs.attempts<4 AND jobs.due_at<=?
      AND users.notifications_enabled=1 AND bot_contacts.active=1 ORDER BY jobs.due_at LIMIT ?`).all(Date.now(), limit);
  }
  claimNotice(jobId) {
    return this.db.prepare('UPDATE notification_jobs SET attempts=attempts+1,due_at=? WHERE id=? AND sent_at IS NULL AND cancelled_at IS NULL').run(Date.now() + 60_000, jobId).changes === 1;
  }
  finishNotice(jobId, success) {
    if (success) this.db.prepare('UPDATE notification_jobs SET sent_at=? WHERE id=?').run(Date.now(), jobId);
    else this.db.prepare('UPDATE notification_jobs SET due_at=? WHERE id=?').run(Date.now() + 60_000, jobId);
  }
  cancelNotice(jobId) { this.db.prepare('UPDATE notification_jobs SET cancelled_at=? WHERE id=?').run(Date.now(), jobId); }
  registerMedia(user, fileName) {
    if (user.role === 'guest') throw new HttpError(403, 'Загружать фото может организатор или ресторан.');
    if (this.db.prepare('SELECT COUNT(*) AS count FROM media_assets WHERE owner_id=?').get(user.id).count >= 500) throw new HttpError(429, 'Достигнут предел фотографий.');
    this.db.prepare('INSERT INTO media_assets VALUES (?,?,?)').run(fileName, user.id, Date.now());
  }
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
    if (!user.demo) user.role = this.liveRole(user);
    return user;
  }
  loginMax(profile) {
    const userId = `max_${profile.id}`;
    const role = this.config.restaurantAdminIds.includes(profile.id) ? 'restaurant' : 'organizer';
    this.db.prepare(`INSERT INTO users (id,scope,external_id,name,role,demo) VALUES (?,'live',?,?,?,0) ON CONFLICT(id) DO UPDATE SET name=excluded.name,role=excluded.role`).run(userId, profile.id, profile.name, role);
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
        this.db.prepare('INSERT INTO users (id,scope,external_id,name,role,demo) VALUES (?,?,NULL,?,?,1)').run(userId, event.scope, name, 'guest');
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
          this.db.prepare('INSERT INTO users (id,scope,external_id,name,role,demo) VALUES (?,?,NULL,?,?,1)').run(`${scope}_${userRole}`, scope, name, userRole);
        }
        const restaurantId = this.seedRestaurant(scope);
        const owner = this.db.prepare('SELECT * FROM users WHERE id=?').get(`${scope}_organizer`);
        const event = this.createEvent(owner, { title: 'День рождения Александры', restaurantId, date: iso(Date.now() + 14 * 86400000), deadline: iso(Date.now() + 10 * 86400000), expectedGuests: 12, foodBudget: 250000, drinkBudget: 60000 });
        const menu = this.eventMenu(event.id);
        for (const [index, [name, notes, indexes]] of [
          // Starters (0, 1) are on the shared table, so guests order mains, desserts and drinks.
          ['Мария Волкова', 'Без орехов, пожалуйста', [4, 5, 8]],
          ['Дмитрий Соколов', '', [3, 7, 10]],
          ['Анна Морозова', 'Вегетарианское меню', [4, 6, 9]],
          ['Алексей Петров', 'Соус отдельно', [2, 6, 11]],
          ['Екатерина Смирнова', '', [3, 5, 8]],
        ].entries()) {
          const uid = `${scope}_synthetic_${index}`;
          this.db.prepare('INSERT INTO users (id,scope,external_id,name,role,demo) VALUES (?,?,NULL,?,?,1)').run(uid, scope, name, 'guest');
          this.db.prepare('INSERT INTO guests VALUES (?,?,1,?,?)').run(event.id, uid, notes, iso(Date.now()));
          for (const itemIndex of indexes) {
            const item = menu[itemIndex];
            this.db.prepare('INSERT INTO selections VALUES (?,?,?,?,?,?)').run(event.id, uid, item.id, 1, item.price, item.name);
          }
        }
        this.db.prepare('INSERT INTO guests VALUES (?,?,0,?,?)').run(event.id, `${scope}_guest`, '', iso(Date.now()));
        const shared = this.db.prepare('INSERT INTO shared_items VALUES (?,?,?,?,?)');
        for (const item of menu.filter(entry => entry.category === 'Закуски').slice(0, 2)) shared.run(event.id, item.id, 3, item.price, item.name);
        this.db.prepare("UPDATE events SET seating_mode='choice',seating_layout=? WHERE id=?").run(JSON.stringify(generateLayout('rounds', 12)), event.id);
        const seat = this.db.prepare("INSERT INTO seat_assignments (event_id,seat_id,user_id,source,assigned_at) VALUES (?,?,?,'guest',?)");
        for (const [index, seatId] of ['t1-1', 't1-2', 't2-1'].entries()) seat.run(event.id, seatId, `${scope}_synthetic_${index}`, iso(Date.now()));
      });
    }
    const user = this.db.prepare('SELECT * FROM users WHERE id=?').get(`${scope}_${role}`);
    if (!user) throw new HttpError(401, 'Демо-сессия недоступна.');
    return { ...this.issueSession(user), sandbox };
  }
  restaurants(user) {
    return this.db.prepare('SELECT * FROM restaurants WHERE scope=? ORDER BY name').all(user.scope).map(row => ({
      id: row.id, name: row.name, description: row.description, address: row.address, sampleMenu: Boolean(row.sample_menu),
      menu: this.db.prepare('SELECT data FROM menu_items WHERE restaurant_id=? ORDER BY rowid').all(row.id).map(item => presentMenuItem(item.data)),
    }));
  }
  eventMenu(eventId) { return this.db.prepare('SELECT data FROM event_menu WHERE event_id=? ORDER BY rowid').all(eventId).map(row => presentMenuItem(row.data)); }
  eventRow(eventId, user) {
    const row = this.db.prepare('SELECT * FROM events WHERE id=? AND scope=?').get(eventId, user.scope);
    if (!row) throw new HttpError(404, 'Банкет не найден.');
    return row;
  }
  isManager(user, event) { return event.scope === user.scope && (event.owner_id === user.id || user.role === 'restaurant'); }
  canRead(user, event) {
    if (this.isManager(user, event)) return true;
    const joined = this.db.prepare('SELECT 1 FROM guests WHERE event_id=? AND user_id=?').get(event.id, user.id);
    if (!joined) return false;
    return event.scope !== 'live' || Boolean(user.phone_verified_at && user.phone && this.db.prepare('SELECT 1 FROM guest_invites WHERE event_id=? AND user_id=? AND phone=?').get(event.id, user.id, user.phone));
  }
  presentEvent(row, user, publicOnly = false) {
    const sharedTotal = this.db.prepare('SELECT COALESCE(SUM(quantity*price),0) AS total FROM shared_items WHERE event_id=?').get(row.id).total;
    const total = this.db.prepare('SELECT COALESCE(SUM(quantity*price),0) AS total FROM selections WHERE event_id=?').get(row.id).total + sharedTotal;
    const counts = this.db.prepare('SELECT COUNT(*) AS joined, COALESCE(SUM(submitted),0) AS responded FROM guests WHERE event_id=?').get(row.id);
    const restaurant = this.db.prepare('SELECT name,sample_menu FROM restaurants WHERE id=?').get(row.restaurant_id);
    const event = { id: row.id, title: row.title, date: row.date, deadline: row.deadline, status: row.status, restaurantId: row.restaurant_id, restaurantName: restaurant.name, demo: row.scope !== 'live', sampleMenu: Boolean(restaurant.sample_menu), menuSnapshot: true, seatingMode: row.seating_mode };
    if (!publicOnly) Object.assign(event, { expectedGuests: row.expected_guests, total, responded: counts.responded, joined: counts.joined, approvedAt: row.approved_at, isOwner: user?.id === row.owner_id, revision: row.revision, foodBudget: row.food_budget, drinkBudget: row.drink_budget });
    if (!publicOnly && this.isManager(user, row)) {
      const owner = this.db.prepare('SELECT name FROM users WHERE id=?').get(row.owner_id);
      Object.assign(event, { budget: (row.food_budget + row.drink_budget) * row.expected_guests, sharedTotal, inviteCode: row.invite_code, ownerName: owner?.name || '' });
    }
    return event;
  }
  events(user) {
    return this.db.prepare('SELECT * FROM events WHERE scope=? ORDER BY created_at DESC').all(user.scope).filter(row => this.canRead(user, row)).map(row => this.presentEvent(row, user));
  }
  createEvent(user, body) {
    if (user.role === 'guest') throw new HttpError(403, 'Создать банкет может организатор или администратор ресторана.');
    const count = this.db.prepare('SELECT COUNT(*) AS count FROM events WHERE owner_id=?').get(user.id).count;
    if (count >= (user.demo ? 30 : 500)) throw new HttpError(429, 'Достигнут предел банкетов для этого организатора.');
    const restaurant = this.db.prepare('SELECT * FROM restaurants WHERE id=? AND scope=?').get(body.restaurantId, user.scope);
    if (!restaurant) throw new HttpError(400, 'Выберите доступный ресторан.');
    const title = string(body.title, 'Название', 120);
    const eventDate = date(body.date, 'Дата банкета');
    const deadline = date(body.deadline, 'Срок выбора');
    if (Date.parse(eventDate) < Date.now() || Date.parse(deadline) < Date.now() || deadline > eventDate) throw new HttpError(400, 'Срок выбора должен быть в будущем и не позже банкета.');
    const expected = integer(body.expectedGuests, 'Число гостей', 1, 1000);
    const foodBudget = integer(body.foodBudget ?? 0, 'Бюджет на еду');
    const drinkBudget = integer(body.drinkBudget ?? 0, 'Бюджет на напитки');
    const menu = this.db.prepare('SELECT id,data FROM menu_items WHERE restaurant_id=? ORDER BY rowid').all(restaurant.id).filter(row => JSON.parse(row.data).available);
    if (!menu.length) throw new HttpError(409, 'В ресторане пока нет доступных блюд.');
    const eventId = id('event');
    this.db.prepare(`INSERT INTO events (id,scope,owner_id,restaurant_id,title,date,deadline,expected_guests,budget,guest_budget,food_budget,drink_budget,status,invite_code,created_at,approved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'collecting',?,?,NULL)`).run(eventId, user.scope, user.id, restaurant.id, title, eventDate, deadline, expected, (foodBudget + drinkBudget) * expected, foodBudget + drinkBudget, foodBudget, drinkBudget, secret().slice(0, 24), iso(Date.now()));
    const add = this.db.prepare('INSERT INTO event_menu VALUES (?,?,?)');
    for (const item of menu) add.run(eventId, item.id, item.data);
    return this.presentEvent(this.eventRow(eventId, user), user);
  }
  editEvent(user, eventId, body) {
    return this.transaction(() => {
      const event = this.eventRow(eventId, user);
      if (!this.isManager(user, event)) throw new HttpError(403, 'Нет доступа к настройкам банкета.');
      if (event.status !== 'collecting') throw new HttpError(409, 'Утверждённый банкет нельзя изменить.');
      if (integer(body.expectedRevision, 'Версия заказа') !== event.revision) throw new HttpError(409, 'Банкет изменился. Обновите страницу.');
      const title = body.title === undefined ? event.title : string(body.title, 'Название', 120);
      const eventDate = body.date === undefined ? event.date : date(body.date, 'Дата банкета');
      const deadline = body.deadline === undefined ? event.deadline : date(body.deadline, 'Срок выбора');
      if (Date.parse(eventDate) <= Date.now() || Date.parse(deadline) <= Date.now() || deadline > eventDate) throw new HttpError(400, 'Срок выбора должен быть в будущем и не позже банкета.');
      const count = this.db.prepare('SELECT COUNT(*) AS count FROM guest_invites WHERE event_id=?').get(event.id).count;
      const expected = body.expectedGuests === undefined ? event.expected_guests : integer(body.expectedGuests, 'Число гостей', Math.max(1, count), 1000);
      const foodBudget = body.foodBudget === undefined ? event.food_budget : integer(body.foodBudget, 'Бюджет на еду');
      const drinkBudget = body.drinkBudget === undefined ? event.drink_budget : integer(body.drinkBudget, 'Бюджет на напитки');
      this.db.prepare('UPDATE events SET title=?,date=?,deadline=?,expected_guests=?,budget=?,guest_budget=?,food_budget=?,drink_budget=?,revision=revision+1 WHERE id=?').run(title, eventDate, deadline, expected, (foodBudget + drinkBudget) * expected, foodBudget + drinkBudget, foodBudget, drinkBudget, event.id);
      if (deadline !== event.deadline) {
        const reminderAt = Math.max(Date.now() + 120_000, Date.parse(deadline) - 24 * 3600_000);
        this.db.prepare("UPDATE notification_jobs SET due_at=?,sent_at=NULL,cancelled_at=NULL,attempts=0 WHERE event_id=? AND kind='reminder'").run(reminderAt, event.id);
      }
      const updated = this.eventRow(event.id, user);
      for (const guest of this.db.prepare('SELECT user_id FROM guests WHERE event_id=?').all(event.id)) this.queueNotice(event.id, guest.user_id, `event_changed:${updated.revision}`);
      return this.presentEvent(updated, user);
    });
  }
  addInvite(user, eventId, body) {
    return this.transaction(() => {
      const event = this.eventRow(eventId, user);
      if (!this.isManager(user, event)) throw new HttpError(403, 'Нет доступа к гостям банкета.');
      if (event.status !== 'collecting') throw new HttpError(409, 'Список гостей закрыт после утверждения.');
      const count = this.db.prepare('SELECT COUNT(*) AS count FROM guest_invites WHERE event_id=?').get(event.id).count;
      if (count >= 1000) throw new HttpError(429, 'Достигнут предел гостей.');
      const name = string(body.name, 'Имя гостя', 100);
      const phone = normalizePhone(body.phone);
      if (this.db.prepare('SELECT 1 FROM guest_invites WHERE event_id=? AND phone=?').get(event.id, phone)) throw new HttpError(409, 'Гость с таким номером уже добавлен.');
      const guestId = id('invite');
      this.db.prepare('INSERT INTO guest_invites (id,event_id,name,phone,created_at) VALUES (?,?,?,?,?)').run(guestId, event.id, name, phone, iso(Date.now()));
      this.db.prepare('UPDATE events SET expected_guests=MAX(expected_guests,?),revision=revision+1 WHERE id=?').run(count + 1, event.id);
      return { id: guestId, name, phone, joined: false, submitted: false };
    });
  }
  editInvite(user, eventId, guestId, body) {
    return this.transaction(() => {
      const event = this.eventRow(eventId, user);
      if (!this.isManager(user, event)) throw new HttpError(403, 'Нет доступа к гостям банкета.');
      if (event.status !== 'collecting') throw new HttpError(409, 'Список гостей закрыт после утверждения.');
      const guest = this.db.prepare('SELECT * FROM guest_invites WHERE id=? AND event_id=?').get(guestId, event.id);
      if (!guest) throw new HttpError(404, 'Гость не найден.');
      const name = body.name === undefined ? guest.name : string(body.name, 'Имя гостя', 100);
      const phone = body.phone === undefined ? guest.phone : normalizePhone(body.phone);
      if (phone !== guest.phone && guest.user_id) throw new HttpError(409, 'Гость уже подтвердил номер. Удалите его запись и добавьте новую до выбора блюд.');
      if (phone !== guest.phone && this.db.prepare('SELECT 1 FROM guest_invites WHERE event_id=? AND phone=?').get(event.id, phone)) throw new HttpError(409, 'Гость с таким номером уже добавлен.');
      this.db.prepare('UPDATE guest_invites SET name=?,phone=? WHERE id=?').run(name, phone, guest.id);
      this.db.prepare('UPDATE events SET revision=revision+1 WHERE id=?').run(event.id);
      return { id: guest.id, name, phone, joined: Boolean(guest.user_id) };
    });
  }
  deleteInvite(user, eventId, guestId) {
    return this.transaction(() => {
      const event = this.eventRow(eventId, user);
      if (!this.isManager(user, event)) throw new HttpError(403, 'Нет доступа к гостям банкета.');
      if (event.status !== 'collecting') throw new HttpError(409, 'Список гостей закрыт после утверждения.');
      const guest = this.db.prepare('SELECT * FROM guest_invites WHERE id=? AND event_id=?').get(guestId, event.id);
      if (!guest) throw new HttpError(404, 'Гость не найден.');
      if (guest.user_id && this.db.prepare('SELECT submitted FROM guests WHERE event_id=? AND user_id=?').get(event.id, guest.user_id)?.submitted) throw new HttpError(409, 'Гость уже выбрал блюда. Сначала согласуйте изменение заказа.');
      if (guest.user_id) this.db.prepare('DELETE FROM guests WHERE event_id=? AND user_id=?').run(event.id, guest.user_id);
      this.db.prepare('DELETE FROM guest_invites WHERE id=?').run(guest.id);
      this.db.prepare('UPDATE events SET revision=revision+1 WHERE id=?').run(event.id);
      return { success: true };
    });
  }
  editEventMenu(user, eventId, itemId, body) {
    return this.transaction(() => {
      const event = this.eventRow(eventId, user);
      if (!this.isManager(user, event)) throw new HttpError(403, 'Нет доступа к меню банкета.');
      if (event.status !== 'collecting') throw new HttpError(409, 'Меню закрыто после утверждения.');
      if (!itemId && this.db.prepare('SELECT COUNT(*) AS count FROM event_menu WHERE event_id=?').get(event.id).count >= 500) throw new HttpError(429, 'Достигнут предел позиций меню.');
      const existing = itemId ? this.db.prepare('SELECT data FROM event_menu WHERE event_id=? AND item_id=?').get(event.id, itemId) : null;
      if (itemId && !existing) throw new HttpError(404, 'Позиция меню не найдена.');
      const previous = existing ? JSON.parse(existing.data) : null;
      const value = { ...(previous || { emoji: '🍽️', available: true, vegetarian: false, allergens: [] }), ...body };
      const item = menuItem(value, itemId || id('dish'));
      if (previous && (item.price !== previous.price || item.name !== previous.name || !item.available || (!item.forGuests && previous.forGuests !== false)) &&
          this.db.prepare('SELECT 1 FROM selections WHERE event_id=? AND menu_item_id=?').get(event.id, itemId)) {
        throw new HttpError(409, 'Это блюдо уже выбрали гости. Цена, название и доступность заблокированы.');
      }
      if (previous && (item.price !== previous.price || item.name !== previous.name || !item.available) &&
          this.db.prepare('SELECT 1 FROM shared_items WHERE event_id=? AND menu_item_id=?').get(event.id, itemId)) {
        throw new HttpError(409, 'Блюдо стоит на общем столе. Сначала уберите его оттуда.');
      }
      this.db.prepare('INSERT INTO event_menu VALUES (?,?,?) ON CONFLICT(event_id,item_id) DO UPDATE SET data=excluded.data').run(event.id, item.id, JSON.stringify(item));
      this.db.prepare('UPDATE events SET revision=revision+1 WHERE id=?').run(event.id);
      return item;
    });
  }
  deleteEventMenu(user, eventId, itemId) {
    return this.transaction(() => {
      const event = this.eventRow(eventId, user);
      if (!this.isManager(user, event)) throw new HttpError(403, 'Нет доступа к меню банкета.');
      if (event.status !== 'collecting') throw new HttpError(409, 'Меню закрыто после утверждения.');
      if (this.db.prepare('SELECT 1 FROM selections WHERE event_id=? AND menu_item_id=?').get(event.id, itemId)) throw new HttpError(409, 'Это блюдо уже выбрали гости.');
      if (this.db.prepare('SELECT 1 FROM shared_items WHERE event_id=? AND menu_item_id=?').get(event.id, itemId)) throw new HttpError(409, 'Блюдо стоит на общем столе. Сначала уберите его оттуда.');
      if (this.db.prepare('DELETE FROM event_menu WHERE event_id=? AND item_id=?').run(event.id, itemId).changes !== 1) throw new HttpError(404, 'Позиция меню не найдена.');
      this.db.prepare('UPDATE events SET revision=revision+1 WHERE id=?').run(event.id);
      return { success: true };
    });
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
    const sharedIds = new Set(this.sharedItems(event.id).map(item => item.menuItemId));
    return { event: this.presentEvent(event, null, true), menu: this.eventMenu(event.id).filter(item => item.forGuests || sharedIds.has(item.id)) };
  }
  assertOpen(event) {
    if (event.status !== 'collecting') throw new HttpError(409, 'Заказ уже утверждён. Выбор блюд закрыт.');
    if (Date.parse(event.deadline) <= Date.now()) throw new HttpError(409, 'Срок выбора блюд завершён.');
  }
  join(user, code) {
    const event = this.findInvite(code);
    if (event.scope !== user.scope) throw new HttpError(403, 'Это приглашение относится к другой сессии. Откройте его в MAX или в отдельном демо.');
    const existing = this.db.prepare('SELECT 1 FROM guests WHERE event_id=? AND user_id=?').get(event.id, user.id);
    if (event.scope === 'live') {
      if (!user.phone || !user.phone_verified_at) throw new HttpError(403, 'Подтвердите номер телефона через MAX, чтобы принять приглашение.');
      const slot = this.db.prepare('SELECT * FROM guest_invites WHERE event_id=? AND phone=?').get(event.id, user.phone);
      if (!slot) throw new HttpError(403, 'Ваш номер отсутствует в списке гостей. Попросите организатора добавить его.');
      if (slot.user_id && slot.user_id !== user.id) throw new HttpError(403, 'Приглашение уже закреплено за другим пользователем MAX.');
      if (this.db.prepare('SELECT 1 FROM guest_invites WHERE event_id=? AND user_id=? AND id!=?').get(event.id, user.id, slot.id)) throw new HttpError(409, 'Аккаунт уже привязан к другому гостю.');
      this.db.prepare('UPDATE guest_invites SET user_id=? WHERE id=?').run(user.id, slot.id);
    }
    if (!existing) {
      this.assertOpen(event);
      const count = this.db.prepare('SELECT COUNT(*) AS count FROM guests WHERE event_id=?').get(event.id).count;
      if (count >= 1000) throw new HttpError(409, 'Достигнут предел гостей.');
      this.db.prepare('INSERT INTO guests VALUES (?,?,0,?,?)').run(event.id, user.id, '', iso(Date.now()));
      this.db.prepare('UPDATE events SET revision=revision+1 WHERE id=?').run(event.id);
      const reminderAt = Math.max(Date.now() + 120_000, Date.parse(event.deadline) - 24 * 3600_000);
      if (event.scope === 'live' && reminderAt < Date.parse(event.deadline)) this.queueNotice(event.id, user.id, 'reminder', reminderAt);
      if (event.scope === 'live') this.queueNotice(event.id, event.owner_id, `guest_joined:${user.id}`);
    }
    return { eventId: event.id };
  }
  claimInvitations(user) {
    if (user.demo || !user.phone || !user.phone_verified_at) throw new HttpError(403, 'Подтвердите номер телефона через MAX, чтобы найти приглашения.');
    const slots = this.db.prepare(`SELECT events.id,events.invite_code FROM guest_invites JOIN events ON events.id=guest_invites.event_id
      WHERE events.scope='live' AND guest_invites.phone=? AND (guest_invites.user_id IS NULL OR guest_invites.user_id=?)
      ORDER BY events.date`).all(user.phone, user.id);
    const eventIds = [];
    for (const slot of slots) {
      const joined = this.db.prepare('SELECT 1 FROM guests WHERE event_id=? AND user_id=?').get(slot.id, user.id);
      if (!joined) {
        const event = this.db.prepare('SELECT * FROM events WHERE id=?').get(slot.id);
        if (event.status !== 'collecting' || Date.parse(event.deadline) <= Date.now()) continue;
      }
      this.join(user, slot.invite_code);
      eventIds.push(slot.id);
    }
    return { eventIds };
  }
  detail(user, eventId) {
    const event = this.eventRow(eventId, user);
    if (!this.canRead(user, event)) throw new HttpError(404, 'Банкет не найден.');
    const manager = this.isManager(user, event);
    const guestRows = manager
      ? this.db.prepare('SELECT guests.*,COALESCE(guest_invites.name,users.name) AS name FROM guests JOIN users ON users.id=guests.user_id LEFT JOIN guest_invites ON guest_invites.event_id=guests.event_id AND guest_invites.user_id=guests.user_id WHERE guests.event_id=? ORDER BY guests.submitted DESC,name').all(event.id)
      : this.db.prepare('SELECT guests.*,COALESCE(guest_invites.name,users.name) AS name FROM guests JOIN users ON users.id=guests.user_id LEFT JOIN guest_invites ON guest_invites.event_id=guests.event_id AND guest_invites.user_id=guests.user_id WHERE guests.event_id=? AND guests.user_id=?').all(event.id, user.id);
    const guests = guestRows.map(row => {
      const selections = this.db.prepare('SELECT menu_item_id AS menuItemId,quantity,price,name FROM selections WHERE event_id=? AND user_id=? ORDER BY rowid').all(event.id, row.user_id);
      return { id: row.user_id, name: row.name, submitted: Boolean(row.submitted), notes: row.notes, items: selections, total: selections.reduce((sum, item) => sum + item.quantity * item.price, 0) };
    });
    const own = guests.find(guest => guest.id === user.id);
    const seating = this.seating(user, event, manager);
    if (manager && event.seating_mode !== 'off') {
      const seatOf = new Map(seating.people.filter(person => person.seatId).map(person => [person.userId, person.seatId]));
      for (const guest of guests) guest.seat = seatOf.has(guest.id) ? seatTitle(seating.layout, seatOf.get(guest.id)) : '';
    }
    const shared = this.sharedItems(event.id);
    const summary = manager ? this.db.prepare(`SELECT menu_item_id AS menuItemId,name,SUM(quantity) AS quantity,SUM(quantity*price) AS total FROM
      (SELECT menu_item_id,name,quantity,price FROM selections WHERE event_id=? UNION ALL SELECT menu_item_id,name,quantity,price FROM shared_items WHERE event_id=?)
      GROUP BY menu_item_id,name ORDER BY name`).all(event.id, event.id) : [];
    const sharedIds = new Set(shared.map(item => item.menuItemId));
    const menu = this.eventMenu(event.id).filter(item => manager || item.forGuests || sharedIds.has(item.id));
    const result = { event: this.presentEvent(event, user), menu, guests, canSelect: Boolean(own) || (event.scope !== 'live' && event.owner_id === user.id), selection: own ? { submitted: own.submitted, notes: own.notes, items: own.items, total: own.total } : { submitted: false, notes: '', items: [], total: 0 }, summary, shared, seating };
    if (manager) {
      const invitedGuests = this.db.prepare(`SELECT guest_invites.id,guest_invites.name,guest_invites.phone,guest_invites.user_id AS userId,
        COALESCE(guests.submitted,0) AS submitted FROM guest_invites LEFT JOIN guests ON guests.event_id=guest_invites.event_id AND guests.user_id=guest_invites.user_id
        WHERE guest_invites.event_id=? ORDER BY guest_invites.created_at,guest_invites.rowid`).all(event.id);
      Object.assign(result, { invitedGuests: invitedGuests.map(entry => ({ ...entry, joined: Boolean(entry.userId), submitted: Boolean(entry.submitted) })), inviteCode: event.invite_code, inviteUrl: `${this.config.publicUrl}/invite/${event.invite_code}`, maxInviteUrl: this.config.botUsername ? `https://max.ru/${this.config.botUsername}?startapp=${event.invite_code}` : null });
    }
    return result;
  }
  saveSelection(user, eventId, body) {
    return this.transaction(() => {
      const event = this.eventRow(eventId, user);
      this.assertOpen(event);
      let guest = this.db.prepare('SELECT * FROM guests WHERE event_id=? AND user_id=?').get(event.id, user.id);
      if (!guest && event.scope !== 'live' && event.owner_id === user.id) {
        this.db.prepare('INSERT INTO guests VALUES (?,?,0,?,?)').run(event.id, user.id, '', iso(Date.now()));
        guest = true;
      }
      if (!guest) throw new HttpError(403, 'Сначала присоединитесь к банкету по приглашению.');
      if (event.scope === 'live' && (!user.phone_verified_at || !user.phone || !this.db.prepare('SELECT 1 FROM guest_invites WHERE event_id=? AND user_id=? AND phone=?').get(event.id, user.id, user.phone))) {
        throw new HttpError(403, 'Выбор доступен только гостю с подтверждённым номером MAX из списка приглашённых.');
      }
      if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) throw new HttpError(400, 'Выберите от 1 до 50 блюд.');
      const notes = string(body.notes, 'Пожелания', 1000, true);
      const menu = new Map(this.eventMenu(event.id).map(item => [item.id, item]));
      const shared = new Set(this.db.prepare('SELECT menu_item_id FROM shared_items WHERE event_id=?').all(event.id).map(row => row.menu_item_id));
      const unique = new Set();
      let total = 0;
      const items = body.items.map(item => {
        if (!item || typeof item.menuItemId !== 'string' || unique.has(item.menuItemId)) throw new HttpError(400, 'Некорректный или повторяющийся выбор блюда.');
        unique.add(item.menuItemId);
        const entry = menu.get(item.menuItemId);
        if (!entry || !entry.available || !entry.forGuests) throw new HttpError(400, 'Блюдо недоступно в меню банкета.');
        if (shared.has(entry.id)) throw new HttpError(400, `«${entry.name}» уже будет на общем столе, его не нужно заказывать.`);
        const quantity = integer(item.quantity, 'Количество', 1, 20);
        total += entry.price * quantity;
        if (!Number.isSafeInteger(total) || total > MAX_MONEY) throw new HttpError(400, 'Превышена максимальная сумма заказа.');
        return { ...entry, quantity };
      });
      const spent = spentByUnit(items);
      if (event.food_budget > 0 && spent.pie > event.food_budget) throw new HttpError(409, 'Блюда превышают ваш бюджет на еду. Уберите что-нибудь из заказа.');
      if (event.drink_budget > 0 && spent.bottle > event.drink_budget) throw new HttpError(409, 'Напитки превышают ваш бюджет на напитки. Уберите что-нибудь из заказа.');
      this.db.prepare('DELETE FROM selections WHERE event_id=? AND user_id=?').run(event.id, user.id);
      const add = this.db.prepare('INSERT INTO selections VALUES (?,?,?,?,?,?)');
      for (const item of items) add.run(event.id, user.id, item.id, item.quantity, item.price, item.name);
      this.db.prepare('UPDATE guests SET submitted=1,notes=?,updated_at=? WHERE event_id=? AND user_id=?').run(notes, iso(Date.now()), event.id, user.id);
      this.db.prepare('UPDATE events SET revision=revision+1 WHERE id=?').run(event.id);
      this.db.prepare("UPDATE notification_jobs SET cancelled_at=? WHERE event_id=? AND user_id=? AND kind='reminder' AND sent_at IS NULL").run(Date.now(), event.id, user.id);
      if (event.scope === 'live') this.queueNotice(event.id, event.owner_id, `selection:${event.revision + 1}`);
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
      if (event.seating_mode !== 'off') this.fillSeats(event);
      this.db.prepare("UPDATE events SET status='approved',approved_at=?,revision=revision+1 WHERE id=? AND status='collecting'").run(iso(Date.now()), event.id);
      this.db.prepare("UPDATE notification_jobs SET cancelled_at=? WHERE event_id=? AND sent_at IS NULL AND kind='reminder'").run(Date.now(), event.id);
      if (event.scope === 'live') {
        for (const guest of this.db.prepare('SELECT user_id FROM guests WHERE event_id=?').all(event.id)) this.queueNotice(event.id, guest.user_id, 'approved');
        for (const adminId of this.config.restaurantAdminIds) {
          const admin = this.db.prepare("SELECT id FROM users WHERE scope='live' AND external_id=?").get(adminId);
          if (admin) this.queueNotice(event.id, admin.id, 'restaurant_approved');
        }
      }
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
    const item = menuItem(value, itemId || id('dish'));
    this.db.prepare('INSERT INTO menu_items VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(item.id, restaurantId, JSON.stringify(item));
    this.db.prepare('UPDATE restaurants SET sample_menu=0 WHERE id=?').run(restaurantId);
    return item;
  }
  deleteMenu(user, restaurantId, itemId) {
    if (user.role !== 'restaurant') throw new HttpError(403, 'Редактирование доступно только ресторану.');
    const restaurant = this.db.prepare('SELECT id FROM restaurants WHERE id=? AND scope=?').get(restaurantId, user.scope);
    if (!restaurant) throw new HttpError(404, 'Ресторан не найден.');
    if (this.db.prepare('DELETE FROM menu_items WHERE id=? AND restaurant_id=?').run(itemId, restaurantId).changes !== 1) throw new HttpError(404, 'Блюдо не найдено.');
    this.db.prepare('UPDATE restaurants SET sample_menu=0 WHERE id=?').run(restaurantId);
    return { success: true };
  }
  organizers(user) {
    if (user.role !== 'restaurant') throw new HttpError(403, 'Список организаторов доступен администратору.');
    return this.db.prepare(`SELECT organizers.id,organizers.name,organizers.phone,organizers.created_at AS createdAt,
      EXISTS(SELECT 1 FROM users WHERE users.scope=organizers.scope AND users.phone=organizers.phone AND users.phone_verified_at IS NOT NULL) AS registered
      FROM organizers WHERE scope=? ORDER BY organizers.name`).all(user.scope).map(row => ({ ...row, registered: Boolean(row.registered) }));
  }
  addOrganizer(user, body) {
    if (user.role !== 'restaurant') throw new HttpError(403, 'Добавлять организаторов может администратор.');
    const name = string(body.name, 'Имя организатора', 100);
    const phone = normalizePhone(body.phone);
    if (this.db.prepare('SELECT COUNT(*) AS count FROM organizers WHERE scope=?').get(user.scope).count >= 500) throw new HttpError(429, 'Достигнут предел организаторов.');
    if (this.db.prepare('SELECT 1 FROM organizers WHERE scope=? AND phone=?').get(user.scope, phone)) throw new HttpError(409, 'Организатор с таким номером уже добавлен.');
    const organizerId = id('organizer');
    this.db.prepare('INSERT INTO organizers VALUES (?,?,?,?,?)').run(organizerId, user.scope, name, phone, iso(Date.now()));
    return this.organizers(user).find(entry => entry.id === organizerId);
  }
  deleteOrganizer(user, organizerId) {
    if (user.role !== 'restaurant') throw new HttpError(403, 'Удалять организаторов может администратор.');
    if (this.db.prepare('DELETE FROM organizers WHERE id=? AND scope=?').run(organizerId, user.scope).changes !== 1) throw new HttpError(404, 'Организатор не найден.');
    return { success: true };
  }
  sharedItems(eventId) {
    return this.db.prepare('SELECT menu_item_id AS menuItemId,name,quantity,price,quantity*price AS total FROM shared_items WHERE event_id=? ORDER BY rowid').all(eventId);
  }
  saveShared(user, eventId, body) {
    return this.transaction(() => {
      const event = this.eventRow(eventId, user);
      if (!this.isManager(user, event)) throw new HttpError(403, 'Нет доступа к меню банкета.');
      if (event.status !== 'collecting') throw new HttpError(409, 'Меню закрыто после утверждения.');
      if (!Array.isArray(body.items) || body.items.length > 200) throw new HttpError(400, 'Общий стол: ожидается список до 200 позиций.');
      const menu = new Map(this.eventMenu(event.id).map(item => [item.id, item]));
      const unique = new Set();
      const items = body.items.map(entry => {
        if (!entry || typeof entry.menuItemId !== 'string' || unique.has(entry.menuItemId)) throw new HttpError(400, 'Некорректная или повторяющаяся позиция общего стола.');
        unique.add(entry.menuItemId);
        const item = menu.get(entry.menuItemId);
        if (!item || !item.available) throw new HttpError(400, 'Позиция недоступна в меню банкета.');
        return { ...item, quantity: integer(entry.quantity, 'Количество на общий стол', 1, 1000) };
      });
      const chosen = items.find(item => this.db.prepare('SELECT 1 FROM selections WHERE event_id=? AND menu_item_id=?').get(event.id, item.id));
      if (chosen) throw new HttpError(409, `«${chosen.name}» уже заказали гости. Его нельзя перенести на общий стол.`);
      this.db.prepare('DELETE FROM shared_items WHERE event_id=?').run(event.id);
      const add = this.db.prepare('INSERT INTO shared_items VALUES (?,?,?,?,?)');
      for (const item of items) add.run(event.id, item.id, item.quantity, item.price, item.name);
      this.db.prepare('UPDATE events SET revision=revision+1 WHERE id=?').run(event.id);
      return { items: this.sharedItems(event.id) };
    });
  }
  importMenu(user, eventId, body) {
    return this.transaction(() => {
      const event = this.eventRow(eventId, user);
      if (!this.isManager(user, event)) throw new HttpError(403, 'Нет доступа к меню банкета.');
      if (event.status !== 'collecting') throw new HttpError(409, 'Меню закрыто после утверждения.');
      if (!Array.isArray(body.itemIds) || !body.itemIds.length || body.itemIds.length > 500 || body.itemIds.some(itemId => typeof itemId !== 'string')) throw new HttpError(400, 'Выберите позиции каталога.');
      const add = this.db.prepare('INSERT OR IGNORE INTO event_menu VALUES (?,?,?)');
      let added = 0;
      for (const itemId of new Set(body.itemIds)) {
        const row = this.db.prepare('SELECT data FROM menu_items WHERE id=? AND restaurant_id=?').get(itemId, event.restaurant_id);
        if (!row) throw new HttpError(404, 'Позиция не найдена в каталоге ресторана.');
        if (!JSON.parse(row.data).available) throw new HttpError(409, 'Позиция сейчас недоступна в каталоге.');
        added += add.run(event.id, itemId, row.data).changes;
      }
      if (this.db.prepare('SELECT COUNT(*) AS count FROM event_menu WHERE event_id=?').get(event.id).count > 500) throw new HttpError(429, 'Достигнут предел позиций меню.');
      if (added) this.db.prepare('UPDATE events SET revision=revision+1 WHERE id=?').run(event.id);
      return { added };
    });
  }
  /** Administrator's kitchen board: every upcoming banquet with what the kitchen needs to cook. */
  kitchen(user) {
    if (user.role !== 'restaurant') throw new HttpError(403, 'Раздел «Кухня» доступен администратору.');
    return this.db.prepare('SELECT id FROM events WHERE scope=? AND date>=? ORDER BY date').all(user.scope, iso(Date.now() - 86400000)).map(row => {
      const detail = this.detail(user, row.id);
      return {
        event: detail.event, summary: detail.summary, shared: detail.shared,
        guests: detail.guests.filter(guest => guest.submitted).map(guest => ({ name: guest.name, notes: guest.notes, seat: guest.seat || '', items: guest.items.map(item => ({ name: item.name, quantity: item.quantity })) })),
      };
    });
  }
  layoutOf(event) { return JSON.parse(event.seating_layout || '{"tables":[]}'); }
  /** Everyone who needs a seat: invited guests (by invite) and joined guests without an invite (demo links). */
  seatPeople(eventId) {
    return this.db.prepare(`SELECT 'invite:'||guest_invites.id AS key,guest_invites.name,guest_invites.user_id AS userId,seat_assignments.seat_id AS seatId,seat_assignments.source
        FROM guest_invites LEFT JOIN seat_assignments ON seat_assignments.event_id=guest_invites.event_id AND seat_assignments.invite_id=guest_invites.id
        WHERE guest_invites.event_id=?
      UNION ALL
      SELECT 'user:'||guests.user_id,users.name,guests.user_id,seat_assignments.seat_id,seat_assignments.source
        FROM guests JOIN users ON users.id=guests.user_id
        LEFT JOIN seat_assignments ON seat_assignments.event_id=guests.event_id AND seat_assignments.user_id=guests.user_id
        WHERE guests.event_id=? AND NOT EXISTS (SELECT 1 FROM guest_invites WHERE guest_invites.event_id=guests.event_id AND guest_invites.user_id=guests.user_id)`).all(eventId, eventId);
  }
  personKey(user, event) {
    const invite = this.db.prepare('SELECT id FROM guest_invites WHERE event_id=? AND user_id=?').get(event.id, user.id);
    if (invite) return `invite:${invite.id}`;
    return this.db.prepare('SELECT 1 FROM guests WHERE event_id=? AND user_id=?').get(event.id, user.id) ? `user:${user.id}` : null;
  }
  unseat(eventId, key) {
    const [kind, value] = key.split(/:(.*)/s);
    this.db.prepare(`DELETE FROM seat_assignments WHERE event_id=? AND ${kind === 'invite' ? 'invite_id' : 'user_id'}=?`).run(eventId, value);
  }
  seat(eventId, key, seatId, source) {
    const [kind, value] = key.split(/:(.*)/s);
    this.db.prepare('INSERT INTO seat_assignments (event_id,seat_id,invite_id,user_id,source,assigned_at) VALUES (?,?,?,?,?,?)')
      .run(eventId, seatId, kind === 'invite' ? value : null, kind === 'user' ? value : null, source, iso(Date.now()));
  }
  seating(user, event, manager) {
    const layout = this.layoutOf(event);
    const people = this.seatPeople(event.id);
    const key = this.personKey(user, event);
    const result = { mode: event.seating_mode, layout, seatCount: layoutSeats(layout).length, mySeat: people.find(person => person.key === key)?.seatId || null, occupied: people.filter(person => person.seatId).map(person => person.seatId), names: Object.fromEntries(people.filter(person => person.seatId).map(person => [person.seatId, person.name])) };
    if (manager) result.people = people;
    return result;
  }
  saveSeating(user, eventId, body) {
    return this.transaction(() => {
      const event = this.eventRow(eventId, user);
      if (!this.isManager(user, event)) throw new HttpError(403, 'Нет доступа к рассадке банкета.');
      if (event.status !== 'collecting') throw new HttpError(409, 'Рассадка закрыта после утверждения.');
      const mode = body.mode === undefined ? event.seating_mode : body.mode;
      if (!SEATING_MODES.includes(mode)) throw new HttpError(400, 'Режим рассадки: off, choice или fixed.');
      let layout = this.layoutOf(event);
      if (body.layout !== undefined) {
        const checked = validateLayout(body.layout);
        if (checked.error) throw new HttpError(400, checked.error);
        layout = checked.layout;
      }
      const seatIds = new Set(layoutSeats(layout).map(seat => seat.id));
      const lost = this.db.prepare('SELECT seat_id FROM seat_assignments WHERE event_id=?').all(event.id).filter(row => !seatIds.has(row.seat_id));
      if (lost.length) {
        const old = this.layoutOf(event);
        throw new HttpError(409, `Нельзя убрать занятые места: ${lost.slice(0, 3).map(row => seatTitle(old, row.seat_id)).join('; ')}${lost.length > 3 ? ` и ещё ${lost.length - 3}` : ''}. Сначала пересадите гостей.`);
      }
      this.db.prepare('UPDATE events SET seating_mode=?,seating_layout=? WHERE id=?').run(mode, JSON.stringify(layout), event.id);
      return this.seating(user, this.eventRow(event.id, user), true);
    });
  }
  chooseSeat(user, eventId, body) {
    return this.transaction(() => {
      const event = this.eventRow(eventId, user);
      if (event.seating_mode !== 'choice') throw new HttpError(409, 'В этом банкете места распределяет организатор.');
      this.assertOpen(event);
      if (!this.db.prepare('SELECT 1 FROM guests WHERE event_id=? AND user_id=?').get(event.id, user.id)) {
        if (event.scope === 'live' || event.owner_id !== user.id) throw new HttpError(403, 'Сначала присоединитесь к банкету по приглашению.');
        this.db.prepare('INSERT INTO guests VALUES (?,?,0,?,?)').run(event.id, user.id, '', iso(Date.now()));
      }
      if (event.scope === 'live' && (!user.phone_verified_at || !user.phone || !this.db.prepare('SELECT 1 FROM guest_invites WHERE event_id=? AND user_id=? AND phone=?').get(event.id, user.id, user.phone))) {
        throw new HttpError(403, 'Выбор места доступен только гостю с подтверждённым номером MAX из списка приглашённых.');
      }
      const key = this.personKey(user, event);
      const seatId = body.seatId ?? null;
      if (seatId !== null) {
        if (typeof seatId !== 'string' || !layoutSeats(this.layoutOf(event)).some(seat => seat.id === seatId)) throw new HttpError(400, 'Такого места нет в схеме зала.');
        const holder = this.db.prepare('SELECT invite_id,user_id FROM seat_assignments WHERE event_id=? AND seat_id=?').get(event.id, seatId);
        if (holder && (holder.invite_id ? `invite:${holder.invite_id}` : `user:${holder.user_id}`) !== key) throw new HttpError(409, 'Это место уже заняли. Выберите другое.');
      }
      this.unseat(event.id, key);
      if (seatId !== null) this.seat(event.id, key, seatId, 'guest');
      return this.seating(user, event, false);
    });
  }
  assignSeat(user, eventId, body) {
    return this.transaction(() => {
      const event = this.eventRow(eventId, user);
      if (!this.isManager(user, event)) throw new HttpError(403, 'Нет доступа к рассадке банкета.');
      if (event.status !== 'collecting') throw new HttpError(409, 'Рассадка закрыта после утверждения.');
      const people = this.seatPeople(event.id);
      const person = people.find(entry => entry.key === body.guest);
      if (!person) throw new HttpError(404, 'Гость не найден.');
      const seatId = body.seatId ?? null;
      if (seatId === null) { this.unseat(event.id, person.key); return this.seating(user, event, true); }
      if (typeof seatId !== 'string' || !layoutSeats(this.layoutOf(event)).some(seat => seat.id === seatId)) throw new HttpError(400, 'Такого места нет в схеме зала.');
      const holder = people.find(entry => entry.seatId === seatId && entry.key !== person.key);
      this.unseat(event.id, person.key);
      if (holder) {
        // Swap: the previous occupant takes the guest's old chair, or stays without a seat.
        this.unseat(event.id, holder.key);
        if (person.seatId) this.seat(event.id, holder.key, person.seatId, 'admin');
      }
      this.seat(event.id, person.key, seatId, 'admin');
      return this.seating(user, event, true);
    });
  }
  fillSeats(event) {
    const people = this.seatPeople(event.id);
    const waiting = people.filter(person => !person.seatId);
    const picks = autoAssign(this.layoutOf(event), people.filter(person => person.seatId).map(person => person.seatId), waiting.map(person => person.key));
    for (const pick of picks) this.seat(event.id, pick.person, pick.seatId, 'auto');
    return { assigned: picks.length, unseated: waiting.length - picks.length };
  }
  autoSeat(user, eventId) {
    return this.transaction(() => {
      const event = this.eventRow(eventId, user);
      if (!this.isManager(user, event)) throw new HttpError(403, 'Нет доступа к рассадке банкета.');
      if (event.status !== 'collecting') throw new HttpError(409, 'Рассадка закрыта после утверждения.');
      if (event.seating_mode === 'off') throw new HttpError(409, 'Сначала включите рассадку.');
      return { ...this.fillSeats(event), seating: this.seating(user, event, true) };
    });
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
    const seated = event.seating_mode !== 'off';
    if (detail.shared.length) {
      rows.push([], ['Общий стол', 'Количество']);
      for (const item of detail.shared) rows.push([item.name, item.quantity]);
    }
    rows.push([], ['Гость', ...(seated ? ['Место'] : []), 'Блюдо', 'Количество', 'Пожелания / аллергии']);
    for (const guest of detail.guests) for (const item of guest.items) rows.push([guest.name, ...(seated ? [guest.seat] : []), item.name, item.quantity, guest.notes]);
    if (seated) {
      rows.push([], ['Стол', 'Место', 'Гость']);
      const people = new Map(detail.seating.people.filter(person => person.seatId).map(person => [person.seatId, person.name]));
      for (const table of detail.seating.layout.tables) for (const seat of tableSeats(table)) if (people.has(seat.id)) rows.push([table.label, seat.number, people.get(seat.id)]);
      for (const person of detail.seating.people.filter(entry => !entry.seatId)) rows.push(['Без места', '', person.name]);
    }
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
      if (!user.demo) user.role = this.liveRole(user);
      const event = this.eventRow(grant.event_id, user);
      if (!this.isManager(user, event) || event.status !== 'approved' || event.revision !== grant.event_revision) throw new HttpError(404, 'Ссылка на выгрузку недействительна. Создайте новую.');
      const csv = this.exportCsv(user, event.id);
      this.db.prepare('DELETE FROM download_tokens WHERE token_hash=?').run(grant.token_hash);
      return csv;
    });
  }
}
