import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { digest, HttpError, normalizePhone } from './auth.mjs';
import { MENU_LABELS } from '../shared/menu-labels.mjs';
import { PETR_MENU, PETR_PACKAGES } from './petr-menu.mjs';
import { spentByUnit } from '../shared/currency.mjs';
import { workbook } from './xlsx.mjs';
import { SEATING_MODES, SEATING_TEMPLATES, autoAssign, generateLayout, layoutSeats, seatTitle, tableSeats, validateLayout } from '../shared/seating.mjs';
import { DEFAULT_NOTIFICATION_PREFERENCES, notificationCategory } from '../shared/notification-categories.mjs';

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
].map((item, index) => ({ ...item, photoUrl: `/temp-photos/${String(index + 1).padStart(3, '0')}.jpg` }));

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
  if (typeof item.photoUrl !== 'string' || (item.photoUrl && !/^\/api\/media\/[a-f0-9-]{36}\.(?:jpg|png|webp)$/.test(item.photoUrl) && !/^\/(?:petr|temp)-photos\/\d{3}\.jpg$/.test(item.photoUrl))) throw new HttpError(400, 'Загрузите фото через API сервиса.');
  if (!Array.isArray(item.allergens) || item.allergens.length > 20) throw new HttpError(400, 'Аллергены: ожидается список до 20 значений.');
  item.allergens = item.allergens.map(entry => string(entry, 'Аллерген', 80));
  if (!Array.isArray(item.labels) || item.labels.length > MENU_LABELS.length || new Set(item.labels).size !== item.labels.length || item.labels.some(label => !MENU_LABELS.includes(label))) throw new HttpError(400, 'Пометки блюда: выберите значения из доступного списка без повторов.');
  return item;
}

const presentMenuItem = data => ({ labels: [], ingredients: '', forGuests: true, ...JSON.parse(data) });
function packageOffer(value, offerId) {
  if (!Array.isArray(value.items) || !value.items.length || value.items.length > 100) throw new HttpError(400, 'Пакет должен содержать от 1 до 100 позиций.');
  return {
    id: offerId, name: string(value.name, 'Название пакета', 120),
    description: string(value.description ?? '', 'Описание пакета', 500, true),
    price: integer(value.price, 'Цена пакета в копейках', 1, 100000000),
    items: value.items.map(entry => ({ dishId: string(entry.dishId, 'Блюдо пакета', 100), grams: integer(entry.grams, 'Граммы на гостя', 1, 10000), choiceGroup: string(entry.choiceGroup || '', 'Группа выбора', 80, true) })),
  };
}
function packageDish(value, dishId) {
  const nutrition = value.nutrition || {};
  const dish = {
    id: dishId, name: string(value.name, 'Название блюда', 120), category: string(value.category, 'Категория', 80),
    description: string(value.description ?? '', 'Описание', 500, true), weight: string(value.weight ?? '', 'Вес', 40, true),
    photoUrl: value.photoUrl || '', allergens: value.allergens ?? [], vegetarian: value.vegetarian ?? false,
    labels: value.labels ?? [], available: value.available ?? true, packageOnly: true,
    nutrition: { kcal: integer(nutrition.kcal, 'Калории', 0, 10000), protein: grams(nutrition.protein, 'Белки'), fat: grams(nutrition.fat, 'Жиры'), carbs: grams(nutrition.carbs, 'Углеводы') },
  };
  if (typeof dish.photoUrl !== 'string' || (dish.photoUrl && !/^\/api\/media\/[a-f0-9-]{36}\.(?:jpg|png|webp)$/.test(dish.photoUrl) && !/^\/(?:petr|temp)-photos\/\d{3}\.jpg$/.test(dish.photoUrl))) throw new HttpError(400, 'Загрузите фото через API сервиса.');
  if (!Array.isArray(dish.allergens) || dish.allergens.length > 20) throw new HttpError(400, 'Аллергены: список до 20 значений.');
  dish.allergens = dish.allergens.map(value => string(value, 'Аллерген', 80));
  if (!Array.isArray(dish.labels) || new Set(dish.labels).size !== dish.labels.length || dish.labels.some(label => !MENU_LABELS.includes(label))) throw new HttpError(400, 'Некорректные пометки блюда.');
  if (typeof dish.vegetarian !== 'boolean' || typeof dish.available !== 'boolean') throw new HttpError(400, 'Доступность и вегетарианское блюдо должны быть true/false.');
  return dish;
}

const DEFAULT_WINDOWS = Array.from({ length: 7 }, (_, weekday) => ({ weekday, start: '09:00', end: '23:00' }));
const SEATING_CHOICES = ['choice', 'fixed'];
const DEFAULT_TABLE_PRESETS = [
  ...Array.from({ length: 12 }, (_, index) => ({ shape: 'round', seats: index + 1 })),
  ...Array.from({ length: 12 }, (_, index) => ({ shape: 'rect', seats: index + 1 })),
  { shape: 'rect', seats: 16 }, { shape: 'rect', seats: 20 },
];
const defaultSeatingConfig = (capacity, template = 'rounds', type = 'flexible') => ({ type, fixedLayout: generateLayout(template, Math.min(capacity, 40)), tablePresets: DEFAULT_TABLE_PRESETS });
function validTablePresets(value) {
  if (!Array.isArray(value) || !value.length || value.length > 40) throw new HttpError(400, 'Укажите от 1 до 40 доступных размеров столов.');
  const presets = value.map(preset => {
    if (!preset || !['round', 'rect'].includes(preset.shape) || !Number.isSafeInteger(preset.seats) || preset.seats < 1 || preset.seats > 40) throw new HttpError(400, 'Укажите форму стола и число стульев от 1 до 40.');
    return { shape: preset.shape, seats: preset.seats };
  });
  if (new Set(presets.map(preset => `${preset.shape}:${preset.seats}`)).size !== presets.length) throw new HttpError(400, 'Размеры столов не должны повторяться.');
  return presets;
}
function validSeatingConfig(value, capacity) {
  if (!value || !['fixed', 'flexible'].includes(value.type)) throw new HttpError(400, 'Выберите фиксированную или свободную схему зала.');
  const checked = validateLayout(value.fixedLayout || generateLayout('rounds', Math.min(capacity, 20)));
  if (checked.error) throw new HttpError(400, checked.error);
  const seatCount = layoutSeats(checked.layout).length;
  if (!seatCount || (value.type === 'fixed' && seatCount > capacity)) throw new HttpError(400, 'В готовой схеме должно быть от 1 места до вместимости зала.');
  return { type: value.type, fixedLayout: checked.layout, tablePresets: validTablePresets(value.tablePresets || DEFAULT_TABLE_PRESETS) };
}
function layoutMatchesPresets(layout, presets) {
  const allowed = new Set(presets.map(preset => `${preset.shape}:${preset.seats}`));
  return layout.tables.every(table => allowed.has(`${table.shape}:${table.seats}`));
}
const SAMPLE_REPLACEMENTS = {
  'Буррата с томатами': 'Капрезе с помидорами и базиликом',
  'Салат с ростбифом': 'Салат Цезарь с цыплёнком',
  'Лосось с овощами': 'Филе лосося на гриле с брокколи и цветной капустой, запечённые под Пармезаном',
  'Цыплёнок с пюре': 'Филе индейки в сырной корочке с картофелем сотэ, салатом из рукколы и чесночным соусом',
  'Ризотто с грибами': 'Жульен из белых грибов в кокотнице',
  'Павлова с ягодами': 'Жасминовая панакота с вишнёвым компоте в шоте',
  'Шоколадный фондан': 'Мини-шоколадный торт',
  'Домашний лимонад': 'Вода в кувшине с яблоком, лимоном и мятой',
  'Ягодный морс': 'Морс клюквенный',
  'Чай с мятой': 'Чай заварной в ассортименте',
  'Капучино': 'Чай заварной в ассортименте',
  'Вода без газа': 'Вода питьевая в ассортименте (пластик)',
};

export class Store {
  constructor(config) {
    this.config = config;
    if (config.databasePath !== ':memory:') mkdirSync(dirname(config.databasePath), { recursive: true });
    this.db = new DatabaseSync(config.databasePath);
    const previousVersion = this.db.prepare('PRAGMA user_version').get().user_version;
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
      CREATE TABLE IF NOT EXISTS restaurant_members (restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('admin','organizer')), created_at TEXT NOT NULL, PRIMARY KEY(restaurant_id,user_id));
      CREATE TABLE IF NOT EXISTS event_organizers (event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, granted_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL, PRIMARY KEY(event_id,user_id));
      CREATE TABLE IF NOT EXISTS global_admins (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, granted_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS restaurant_members_user_idx ON restaurant_members(user_id);
      CREATE TABLE IF NOT EXISTS kitchen_download_tokens (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, format TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS restaurant_packages (id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS package_dishes (id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS restaurant_halls (id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE, name TEXT NOT NULL, capacity INTEGER NOT NULL, windows TEXT NOT NULL, allowed_seating TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS restaurant_favorites (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE, PRIMARY KEY(user_id,restaurant_id));
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
    if (!eventColumns.includes('photo_url')) this.db.exec("ALTER TABLE events ADD COLUMN photo_url TEXT NOT NULL DEFAULT ''");
    if (!eventColumns.includes('selection_mode')) this.db.exec("ALTER TABLE events ADD COLUMN selection_mode TEXT NOT NULL DEFAULT 'individual'");
    if (!eventColumns.includes('package_data')) this.db.exec("ALTER TABLE events ADD COLUMN package_data TEXT NOT NULL DEFAULT ''");
    if (!eventColumns.includes('duration_hours')) this.db.exec('ALTER TABLE events ADD COLUMN duration_hours INTEGER NOT NULL DEFAULT 4');
    if (!eventColumns.includes('hall_id')) this.db.exec("ALTER TABLE events ADD COLUMN hall_id TEXT NOT NULL DEFAULT ''");
    if (!eventColumns.includes('seating_config')) this.db.exec("ALTER TABLE events ADD COLUMN seating_config TEXT NOT NULL DEFAULT ''");
    const hallColumns = this.db.prepare('PRAGMA table_info(restaurant_halls)').all().map(column => column.name);
    if (!hallColumns.includes('default_seating_template')) this.db.exec("ALTER TABLE restaurant_halls ADD COLUMN default_seating_template TEXT NOT NULL DEFAULT 'rounds'");
    if (!hallColumns.includes('seating_config')) this.db.exec("ALTER TABLE restaurant_halls ADD COLUMN seating_config TEXT NOT NULL DEFAULT ''");
    const kitchenTokenColumns = this.db.prepare('PRAGMA table_info(kitchen_download_tokens)').all().map(column => column.name);
    if (!kitchenTokenColumns.includes('event_ids')) this.db.exec("ALTER TABLE kitchen_download_tokens ADD COLUMN event_ids TEXT NOT NULL DEFAULT ''");
    const userColumns = this.db.prepare('PRAGMA table_info(users)').all().map(column => column.name);
    if (!userColumns.includes('phone')) this.db.exec('ALTER TABLE users ADD COLUMN phone TEXT');
    if (!userColumns.includes('phone_verified_at')) this.db.exec('ALTER TABLE users ADD COLUMN phone_verified_at INTEGER');
    if (!userColumns.includes('notifications_enabled')) this.db.exec('ALTER TABLE users ADD COLUMN notifications_enabled INTEGER NOT NULL DEFAULT 0');
    if (!userColumns.includes('notification_preferences')) this.db.exec("ALTER TABLE users ADD COLUMN notification_preferences TEXT NOT NULL DEFAULT ''");
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_live_phone_idx ON users(phone) WHERE scope='live' AND phone IS NOT NULL;");
    this.db.prepare('INSERT OR IGNORE INTO scopes VALUES (?, NULL, ?)').run('live', iso(Date.now()));
    if (!this.db.prepare('SELECT id FROM restaurants WHERE scope = ?').get('live')) this.seedRestaurant('live');
    this.migrateSampleNutrition();
    if (previousVersion < 8) this.migrateAccess();
    if (previousVersion < 10) this.transaction(() => this.seedPetr());
    if (previousVersion < 11) this.transaction(() => this.migrateBookingsAndPackages());
    if (previousVersion < 12) this.transaction(() => this.migratePetrPhotos());
    if (previousVersion < 13) this.transaction(() => {
      const update = this.db.prepare('UPDATE restaurant_halls SET seating_config=? WHERE id=?');
      for (const hall of this.db.prepare("SELECT * FROM restaurant_halls WHERE seating_config=''").all()) {
        const type = JSON.parse(hall.allowed_seating).includes('choice') ? 'flexible' : 'fixed';
        update.run(JSON.stringify(defaultSeatingConfig(hall.capacity, hall.default_seating_template, type)), hall.id);
      }
    });
    if (previousVersion < 15) this.transaction(() => this.migrateCatalogPhotoCorrections());
    this.db.prepare("UPDATE events SET seating_config=(SELECT seating_config FROM restaurant_halls WHERE restaurant_halls.id=events.hall_id) WHERE seating_config='' AND hall_id!=''").run();
    this.db.exec('PRAGMA user_version = 15');
    this.cleanup();
  }
  seedPetr() {
    const existing = this.db.prepare("SELECT id,name FROM restaurants WHERE scope='live'").all().find(row => /^п[её]тр[ъь]?$/i.test(row.name.trim()));
    const restaurantId = existing?.id || id('restaurant');
    if (!existing) this.db.prepare('INSERT INTO restaurants VALUES (?,?,?,?,?,0)').run(restaurantId, 'live', 'Петръ', 'Фуршетное меню, банкетный конструктор и пакетные предложения.', 'Санкт-Петербург, ул. Гороховая, д. 1');
    const known = new Set(this.db.prepare('SELECT data FROM menu_items WHERE restaurant_id=?').all(restaurantId).map(row => JSON.parse(row.data).name));
    const add = this.db.prepare('INSERT INTO menu_items VALUES (?,?,?)');
    for (const entry of PETR_MENU) if (!known.has(entry.name)) {
      const itemId = id('dish');
      add.run(itemId, restaurantId, JSON.stringify({ ...entry, id: itemId, forGuests: true, ingredients: '' }));
    }
    const packages = new Set(this.db.prepare('SELECT data FROM restaurant_packages WHERE restaurant_id=?').all(restaurantId).map(row => JSON.parse(row.data).name));
    const addPackage = this.db.prepare('INSERT INTO restaurant_packages VALUES (?,?,?)');
    for (const entry of PETR_PACKAGES) if (!packages.has(entry.name)) {
      const offerId = id('package');
      addPackage.run(offerId, restaurantId, JSON.stringify({ ...entry, id: offerId }));
    }
    this.db.prepare('UPDATE restaurants SET sample_menu=0 WHERE id=?').run(restaurantId);
  }
  ensureHall(restaurantId) {
    const existing = this.db.prepare('SELECT id FROM restaurant_halls WHERE restaurant_id=? LIMIT 1').get(restaurantId);
    if (existing) return existing.id;
    const hallId = id('hall');
    this.db.prepare('INSERT INTO restaurant_halls (id,restaurant_id,name,capacity,windows,allowed_seating,seating_config) VALUES (?,?,?,?,?,?,?)').run(hallId, restaurantId, 'Основной зал', 1000, JSON.stringify(DEFAULT_WINDOWS), JSON.stringify(SEATING_CHOICES), JSON.stringify(defaultSeatingConfig(1000)));
    return hallId;
  }
  migrateBookingsAndPackages() {
    for (const restaurant of this.db.prepare('SELECT id FROM restaurants').all()) this.ensureHall(restaurant.id);
    this.db.prepare(`UPDATE events SET hall_id=(SELECT id FROM restaurant_halls WHERE restaurant_id=events.restaurant_id ORDER BY rowid LIMIT 1) WHERE hall_id=''`).run();
    const petr = this.db.prepare("SELECT id FROM restaurants WHERE scope='live' AND name='Петръ'").get();
    if (petr) {
      let temp = this.db.prepare("SELECT id FROM restaurants WHERE scope='live' AND name='Temp'").get();
      if (!temp) {
        temp = { id: id('restaurant') };
        this.db.prepare('INSERT INTO restaurants VALUES (?,?,?,?,?,0)').run(temp.id, 'live', 'Temp', 'Тестовый каталог, отделённый от меню ресторана «Петръ».', '');
      }
      this.ensureHall(temp.id);
      const real = new Map(this.db.prepare('SELECT data FROM menu_items WHERE restaurant_id=?').all(petr.id).map(row => { const item = JSON.parse(row.data); return [item.name, item]; }));
      for (const row of this.db.prepare('SELECT id,data FROM menu_items WHERE restaurant_id=?').all(petr.id)) {
        const item = JSON.parse(row.data);
        if (Object.hasOwn(SAMPLE_REPLACEMENTS, item.name)) this.db.prepare('UPDATE menu_items SET restaurant_id=? WHERE id=?').run(temp.id, row.id);
      }
      const tempNames = new Set(this.db.prepare('SELECT data FROM menu_items WHERE restaurant_id=?').all(temp.id).map(row => JSON.parse(row.data).name));
      for (const sample of SAMPLE_MENU) if (!tempNames.has(sample.name)) {
        const sampleId = id('dish');
        this.db.prepare('INSERT INTO menu_items VALUES (?,?,?)').run(sampleId, temp.id, JSON.stringify({ ...sample, id: sampleId, ingredients: '', forGuests: true, available: true, vegetarian: Boolean(sample.vegetarian), allergens: sample.allergens || [], labels: sample.labels || [] }));
      }
      for (const row of this.db.prepare('SELECT event_menu.event_id,event_menu.item_id,event_menu.data FROM event_menu JOIN events ON events.id=event_menu.event_id WHERE events.restaurant_id=?').all(petr.id)) {
        const old = JSON.parse(row.data);
        const replacement = real.get(SAMPLE_REPLACEMENTS[old.name]);
        if (!replacement) continue;
        // Keep the banquet's agreed price snapshot while replacing only the test dish identity and details.
        const next = { ...replacement, id: row.item_id, price: old.price };
        this.db.prepare('UPDATE event_menu SET data=? WHERE event_id=? AND item_id=?').run(JSON.stringify(next), row.event_id, row.item_id);
        this.db.prepare('UPDATE selections SET name=? WHERE event_id=? AND menu_item_id=?').run(next.name, row.event_id, row.item_id);
        this.db.prepare('UPDATE shared_items SET name=? WHERE event_id=? AND menu_item_id=?').run(next.name, row.event_id, row.item_id);
        this.db.prepare('UPDATE events SET revision=revision+1 WHERE id=?').run(row.event_id);
      }
    }
    const addDish = this.db.prepare('INSERT INTO package_dishes VALUES (?,?,?)');
    const updatePackage = this.db.prepare('UPDATE restaurant_packages SET data=? WHERE id=?');
    const dishByName = new Map();
    for (const row of this.db.prepare('SELECT * FROM restaurant_packages').all()) {
      const offer = JSON.parse(row.data);
      if (offer.items.every(item => item.dishId)) continue;
      const refs = [];
      for (const item of offer.items) {
        const alternatives = item.category === 'Горячее на выбор' ? item.name.split('/').map(name => name.trim()) : [item.name];
        for (const name of alternatives) {
          const category = item.category === 'Горячее на выбор' ? 'Горячее' : item.category;
          const key = `${row.restaurant_id}|${category}|${name}`;
          let dishId = dishByName.get(key);
          if (!dishId) {
            dishId = id('package_dish');
            const source = PETR_MENU.find(entry => entry.name === name || entry.name.startsWith(`${name} `) || name.startsWith(entry.name));
            const grams = item.grams;
            const factor = source ? grams / (Number.parseInt(source.weight, 10) || 100) : 1;
            const nutrition = source ? Object.fromEntries(Object.entries(source.nutrition).map(([k, v]) => [k, Math.round(v * factor * 10) / 10])) : { kcal: Math.round(grams * 1.8), protein: Math.round(grams * .1 * 10) / 10, fat: Math.round(grams * .08 * 10) / 10, carbs: Math.round(grams * .12 * 10) / 10 };
            addDish.run(dishId, row.restaurant_id, JSON.stringify({ id: dishId, name, category, description: 'Блюдо пакетного предложения.', weight: `${grams} г`, nutrition, photoUrl: '', allergens: source?.allergens || [], vegetarian: source?.vegetarian || false, labels: [], available: true, packageOnly: true }));
            dishByName.set(key, dishId);
          }
          refs.push({ dishId, grams: item.grams, choiceGroup: item.category === 'Горячее на выбор' ? 'Горячее' : '' });
        }
      }
      updatePackage.run(JSON.stringify({ ...offer, items: refs }), row.id);
    }
    for (const event of this.db.prepare("SELECT id,restaurant_id,package_data FROM events WHERE selection_mode='package'").all()) {
      if (!event.package_data) continue;
      const snapshot = JSON.parse(event.package_data);
      if (snapshot.items.every(item => item.dishId)) continue;
      const dishes = this.db.prepare('SELECT data FROM package_dishes WHERE restaurant_id=?').all(event.restaurant_id).map(row => JSON.parse(row.data));
      const items = snapshot.items.map(item => {
        const dish = dishes.find(entry => entry.name === item.name && (entry.category === item.category || item.category === 'Горячее на выбор'));
        return dish ? { ...dish, dishId: dish.id, grams: item.grams, choiceGroup: '' } : item;
      });
      this.db.prepare('UPDATE events SET package_data=? WHERE id=?').run(JSON.stringify({ ...snapshot, items }), event.id);
    }
    const legacy = this.db.prepare("SELECT restaurant_id,user_id FROM restaurant_members WHERE role='organizer'").all();
    const grantOrganizer = this.db.prepare('INSERT OR IGNORE INTO event_organizers VALUES (?,?,NULL,?)');
    for (const member of legacy) for (const event of this.db.prepare('SELECT id FROM events WHERE restaurant_id=?').all(member.restaurant_id)) grantOrganizer.run(event.id, member.user_id, iso(Date.now()));
    this.db.prepare("DELETE FROM restaurant_members WHERE role='organizer'").run();
  }
  migratePetrPhotos() {
    const temp = this.db.prepare("SELECT id FROM restaurants WHERE scope='live' AND name='Temp'").get();
    if (temp) {
      const sampleByName = new Map(SAMPLE_MENU.map(item => [item.name, item.photoUrl]));
      for (const table of ['menu_items', 'event_menu']) {
        const rows = table === 'menu_items'
          ? this.db.prepare('SELECT rowid,data FROM menu_items WHERE restaurant_id=?').all(temp.id)
          : this.db.prepare('SELECT event_menu.rowid,event_menu.data FROM event_menu JOIN events ON events.id=event_menu.event_id WHERE events.restaurant_id=?').all(temp.id);
        for (const row of rows) {
          const item = JSON.parse(row.data), photoUrl = item.photoUrl || sampleByName.get(item.name);
          if (photoUrl && photoUrl !== item.photoUrl) this.db.prepare(`UPDATE ${table} SET data=? WHERE rowid=?`).run(JSON.stringify({ ...item, photoUrl }), row.rowid);
        }
      }
    }
    const petr = this.db.prepare("SELECT id FROM restaurants WHERE scope='live' AND name='Петръ'").get();
    if (!petr) return;
    const byName = new Map(PETR_MENU.map(item => [item.name, item]));
    const packagePhotoMatches = {
      'Сельдь с картофелем и маринованным луком': 71,
      'Куриный рулет с вялеными томатами': 77,
      'Тёплый салат с кальмаром': 121,
      'Салат с тёплыми хрустящими баклажанами': 114,
      'Салат с копчёной куриной грудкой': 116,
      'Нисуаз с консервированным тунцом': 120,
      'Треска в пергаменте': 100,
      'Бифштекс из говядины': 105,
      'Свиная шея': 107,
    };
    const photoFor = name => byName.get(name)?.photoUrl || PETR_MENU[packagePhotoMatches[name] - 1]?.photoUrl || PETR_MENU.find(item => item.name.startsWith(`${name} `) || name.startsWith(item.name))?.photoUrl || '';
    const update = (table, key, rows) => {
      for (const row of rows) {
        const item = JSON.parse(row.data);
        const photoUrl = item.photoUrl || photoFor(item.name);
        const description = /КБЖУ ориентировочное|уточните у ресторана|уточняйте состав и аллергены/i.test(item.description || '') ? '' : item.description;
        if (photoUrl !== item.photoUrl || description !== item.description) this.db.prepare(`UPDATE ${table} SET data=? WHERE ${key}=?`).run(JSON.stringify({ ...item, photoUrl, description }), row.rowid);
      }
    };
    update('menu_items', 'rowid', this.db.prepare('SELECT rowid,data FROM menu_items WHERE restaurant_id=?').all(petr.id));
    update('event_menu', 'rowid', this.db.prepare('SELECT event_menu.rowid,event_menu.data FROM event_menu JOIN events ON events.id=event_menu.event_id WHERE events.restaurant_id=?').all(petr.id));
    update('package_dishes', 'rowid', this.db.prepare('SELECT rowid,data FROM package_dishes WHERE restaurant_id=?').all(petr.id));
    for (const row of this.db.prepare("SELECT id,package_data FROM events WHERE restaurant_id=? AND selection_mode='package'").all(petr.id)) {
      if (!row.package_data) continue;
      const offer = JSON.parse(row.package_data);
      const items = offer.items.map(item => ({ ...item, photoUrl: item.photoUrl || photoFor(item.name), description: /КБЖУ ориентировочное|уточните у ресторана/i.test(item.description || '') ? '' : item.description }));
      this.db.prepare('UPDATE events SET package_data=? WHERE id=?').run(JSON.stringify({ ...offer, items }), row.id);
    }
  }
  propagateMenuPhoto(restaurantId, itemId, previousPhoto, photoUrl) {
    if (previousPhoto === photoUrl) return;
    const rows = this.db.prepare('SELECT event_menu.event_id,event_menu.data FROM event_menu JOIN events ON events.id=event_menu.event_id WHERE events.restaurant_id=? AND event_menu.item_id=?').all(restaurantId, itemId);
    const update = this.db.prepare('UPDATE event_menu SET data=? WHERE event_id=? AND item_id=?');
    for (const row of rows) {
      const item = JSON.parse(row.data);
      if ((item.photoUrl || '') === (previousPhoto || '')) update.run(JSON.stringify({ ...item, photoUrl }), row.event_id, itemId);
    }
  }
  propagatePackagePhoto(restaurantId, dishId, previousPhoto, photoUrl) {
    if (previousPhoto === photoUrl) return;
    const update = this.db.prepare('UPDATE events SET package_data=? WHERE id=?');
    for (const row of this.db.prepare("SELECT id,package_data FROM events WHERE restaurant_id=? AND selection_mode='package' AND package_data!=''").all(restaurantId)) {
      const offer = JSON.parse(row.package_data);
      const items = offer.items.map(item => item.dishId === dishId && (item.photoUrl || '') === (previousPhoto || '') ? { ...item, photoUrl } : item);
      if (items.some((item, index) => item !== offer.items[index])) update.run(JSON.stringify({ ...offer, items }), row.id);
    }
  }
  migrateCatalogPhotoCorrections() {
    const defaults = new Map(PETR_MENU.map(item => [item.name, item.photoUrl]));
    for (const row of this.db.prepare("SELECT menu_items.id,menu_items.restaurant_id,menu_items.data FROM menu_items JOIN restaurants ON restaurants.id=menu_items.restaurant_id WHERE restaurants.name='Петръ'").all()) {
      const item = JSON.parse(row.data);
      const originalPhoto = defaults.get(item.name);
      if (originalPhoto && item.photoUrl && item.photoUrl !== originalPhoto) this.propagateMenuPhoto(row.restaurant_id, row.id, originalPhoto, item.photoUrl);
    }
    for (const row of this.db.prepare("SELECT package_dishes.id,package_dishes.restaurant_id,package_dishes.data FROM package_dishes JOIN restaurants ON restaurants.id=package_dishes.restaurant_id WHERE restaurants.name='Петръ'").all()) {
      const dish = JSON.parse(row.data);
      const originalPhoto = defaults.get(dish.name) || PETR_MENU.find(item => item.name.startsWith(`${dish.name} `) || dish.name.startsWith(item.name))?.photoUrl;
      if (originalPhoto && dish.photoUrl && dish.photoUrl !== originalPhoto) this.propagatePackagePhoto(row.restaurant_id, row.id, originalPhoto, dish.photoUrl);
    }
  }
  /** v8: per-restaurant access replaces the phone-based organizer list. */
  migrateAccess() {
    const now = iso(Date.now());
    const grant = this.db.prepare("INSERT OR IGNORE INTO restaurant_members VALUES (?,?,'organizer',?)");
    // Existing banquet owners keep organizing at the restaurants they already use.
    for (const row of this.db.prepare("SELECT DISTINCT events.restaurant_id,events.owner_id FROM events JOIN users ON users.id=events.owner_id WHERE events.scope='live' AND users.demo=0").all()) grant.run(row.restaurant_id, row.owner_id, now);
    if (this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='organizers'").get()) {
      const restaurants = this.db.prepare("SELECT id FROM restaurants WHERE scope='live'").all();
      for (const user of this.db.prepare("SELECT users.id FROM organizers JOIN users ON users.scope=organizers.scope AND users.phone=organizers.phone WHERE organizers.scope='live' AND users.phone_verified_at IS NOT NULL").all()) {
        for (const restaurant of restaurants) grant.run(restaurant.id, user.id, now);
      }
      this.db.exec('DROP TABLE organizers');
    }
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
        add.run(itemId, restaurant.id, JSON.stringify({ ...entry, id: itemId, available: true }));
      }
    }
  }
  close() { this.db.close(); }
  cleanup() {
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    this.db.prepare('DELETE FROM scopes WHERE id != ? AND created_at < ?').run('live', iso(Date.now() - 7 * 86400000));
    this.db.prepare('DELETE FROM max_webhook_claims WHERE created_at < ?').run(Date.now() - 7 * 86400000);
    this.db.prepare('DELETE FROM download_tokens WHERE expires_at <= ?').run(Date.now());
    this.db.prepare('DELETE FROM kitchen_download_tokens WHERE expires_at <= ?').run(Date.now());
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
    this.ensureHall(restaurantId);
    return restaurantId;
  }
  seedDemoPetr(scope) {
    const source = this.db.prepare("SELECT * FROM restaurants WHERE scope='live' AND name='Петръ'").get();
    if (!source) throw new Error('Demo Petr catalog missing');
    const restaurantId = id('restaurant');
    this.db.prepare('INSERT INTO restaurants VALUES (?,?,?,?,?,0)').run(restaurantId, scope, 'Петръ · демо', 'Демонстрационный банкетный зал ресторана «Петръ». Все данные здесь тестовые.', source.address);
    const addMenu = this.db.prepare('INSERT INTO menu_items VALUES (?,?,?)');
    for (const row of this.db.prepare('SELECT data FROM menu_items WHERE restaurant_id=?').all(source.id)) {
      const item = JSON.parse(row.data), itemId = id('dish');
      addMenu.run(itemId, restaurantId, JSON.stringify({ ...item, id: itemId }));
    }
    const dishIds = new Map(), addDish = this.db.prepare('INSERT INTO package_dishes VALUES (?,?,?)');
    for (const row of this.db.prepare('SELECT data FROM package_dishes WHERE restaurant_id=?').all(source.id)) {
      const dish = JSON.parse(row.data), dishId = id('package_dish');
      dishIds.set(dish.id, dishId);
      addDish.run(dishId, restaurantId, JSON.stringify({ ...dish, id: dishId }));
    }
    const addPackage = this.db.prepare('INSERT INTO restaurant_packages VALUES (?,?,?)');
    for (const row of this.db.prepare('SELECT data FROM restaurant_packages WHERE restaurant_id=?').all(source.id)) {
      const offer = JSON.parse(row.data), offerId = id('package');
      addPackage.run(offerId, restaurantId, JSON.stringify({ ...offer, id: offerId, items: offer.items.map(item => ({ ...item, dishId: dishIds.get(item.dishId) })) }));
    }
    this.ensureHall(restaurantId);
    return restaurantId;
  }
  isSuperAdmin(user) {
    return user.demo ? user.role === 'admin' : this.config.restaurantAdminIds.includes(user.external_id) || Boolean(this.db.prepare('SELECT 1 FROM global_admins WHERE user_id=?').get(user.id));
  }
  /** restaurantId → 'admin'. Organizer rights belong to a banquet, not a restaurant. */
  accessOf(user) {
    const access = new Map();
    const all = this.db.prepare('SELECT id FROM restaurants WHERE scope=?').all(user.scope).map(row => row.id);
    if (this.isSuperAdmin(user)) { for (const restaurantId of all) access.set(restaurantId, 'admin'); return access; }
    for (const row of this.db.prepare("SELECT restaurant_id FROM restaurant_members WHERE user_id=? AND role='admin'").all(user.id)) access.set(row.restaurant_id, 'admin');
    return access;
  }
  /** Attach access and the coarse UI role. Event ownership and grants confer organizer status. */
  hydrate(user) {
    user.access = this.accessOf(user);
    user.superAdmin = this.isSuperAdmin(user);
    const roles = [...user.access.values()];
    const organizer = Boolean(this.db.prepare('SELECT 1 FROM events WHERE owner_id=? UNION SELECT 1 FROM event_organizers WHERE user_id=? LIMIT 1').get(user.id, user.id));
    user.role = user.superAdmin || roles.includes('admin') ? 'restaurant' : organizer || (user.demo && user.role === 'organizer') ? 'organizer' : 'guest';
    return user;
  }
  adminOf(user, restaurantId) { return (user.access || this.accessOf(user)).get(restaurantId) === 'admin'; }
  eventPhoto(value) {
    if (typeof value !== 'string' || (value && !/^\/api\/media\/[a-f0-9-]{36}\.(?:jpg|png|webp)$/.test(value))) throw new HttpError(400, 'Загрузите фото мероприятия через API сервиса.');
    if (value && !this.db.prepare('SELECT 1 FROM media_assets WHERE file_name=?').get(value.slice('/api/media/'.length))) throw new HttpError(400, 'Фото мероприятия не найдено.');
    return value;
  }
  publicUser(user) {
    this.hydrate(user);
    const names = new Map(this.db.prepare('SELECT id,name FROM restaurants WHERE scope=?').all(user.scope).map(row => [row.id, row.name]));
    const access = [...user.access].map(([restaurantId, role]) => ({ restaurantId, restaurantName: names.get(restaurantId) || '', role }));
    const botConnected = Boolean(user.external_id && this.db.prepare('SELECT active FROM bot_contacts WHERE external_id=?').get(user.external_id)?.active);
    return { ...this.publicProfile(user), access, superAdmin: user.superAdmin, botConnected };
  }
  notificationPreferences(user) { return { ...DEFAULT_NOTIFICATION_PREFERENCES, ...(user.notification_preferences ? JSON.parse(user.notification_preferences) : {}) }; }
  publicProfile(user) { return { id: user.id, maxId: user.external_id || null, name: user.name, role: user.superAdmin ? 'admin' : user.role, demo: Boolean(user.demo), phoneVerified: Boolean(user.phone_verified_at), phone: user.phone || null, notificationsEnabled: Boolean(user.notifications_enabled), notificationPreferences: this.notificationPreferences(user) }; }
  bindPhone(user, phone) {
    if (user.demo || !user.external_id) throw new HttpError(403, 'Подтверждение номера доступно только в MAX.');
    return this.transaction(() => {
      const existing = this.db.prepare("SELECT * FROM users WHERE scope='live' AND phone=? AND id!=?").get(phone, user.id);
      if (existing && (existing.external_id || existing.phone_verified_at)) throw new HttpError(409, 'Этот номер уже привязан к другому аккаунту MAX.');
      if (user.phone && user.phone !== phone && this.db.prepare('SELECT 1 FROM guest_invites WHERE user_id=?').get(user.id)) {
        throw new HttpError(409, 'Номер уже связан с приглашением. Обратитесь к организатору.');
      }
      if (existing) {
        for (const row of this.db.prepare('SELECT restaurant_id,role,created_at FROM restaurant_members WHERE user_id=?').all(existing.id)) this.db.prepare('INSERT OR IGNORE INTO restaurant_members VALUES (?,?,?,?)').run(row.restaurant_id, user.id, row.role, row.created_at);
        for (const row of this.db.prepare('SELECT event_id,granted_by,created_at FROM event_organizers WHERE user_id=?').all(existing.id)) this.db.prepare('INSERT OR IGNORE INTO event_organizers VALUES (?,?,?,?)').run(row.event_id, user.id, row.granted_by, row.created_at);
        const global = this.db.prepare('SELECT granted_by,created_at FROM global_admins WHERE user_id=?').get(existing.id);
        if (global) this.db.prepare('INSERT OR IGNORE INTO global_admins VALUES (?,?,?)').run(user.id, global.granted_by, global.created_at);
        this.db.prepare('DELETE FROM users WHERE id=?').run(existing.id);
      }
      this.db.prepare('UPDATE users SET phone=?,phone_verified_at=? WHERE id=?').run(phone, Date.now(), user.id);
      return this.publicUser(this.db.prepare('SELECT * FROM users WHERE id=?').get(user.id));
    });
  }
  resolveIdentity(scope, targetId) {
    try { targetId = decodeURIComponent(targetId); }
    catch { throw new HttpError(400, 'Некорректный идентификатор пользователя.'); }
    if (scope !== 'live' && /^(?:phone:|max:)/.test(targetId)) throw new HttpError(403, 'Демо не назначает реальные MAX-аккаунты.');
    if (/^phone:/.test(targetId)) {
      const phone = normalizePhone(targetId.slice(6));
      let target = this.db.prepare('SELECT * FROM users WHERE scope=? AND phone=?').get(scope, phone);
      if (!target) {
        const pendingId = id('pending');
        this.db.prepare('INSERT INTO users (id,scope,external_id,name,role,demo,phone) VALUES (?, ?, NULL, ?, ?, 0, ?)').run(pendingId, scope, `Телефон +${phone}`, 'guest', phone);
        target = this.db.prepare('SELECT * FROM users WHERE id=?').get(pendingId);
      }
      return target;
    }
    const maxId = targetId.startsWith('max:') ? targetId.slice(4) : targetId;
    if (/^[1-9][0-9]{0,18}$/.test(maxId)) {
      this.db.prepare("INSERT OR IGNORE INTO users (id,scope,external_id,name,role,demo) VALUES (?,'live',?,?,'guest',0)").run(`max_${maxId}`, maxId, `MAX ${maxId}`);
      targetId = `max_${maxId}`;
    }
    const target = this.db.prepare('SELECT * FROM users WHERE id=? AND scope=?').get(targetId, scope);
    if (!target) throw new HttpError(404, 'Пользователь не найден. Укажите телефон или MAX ID.');
    return target;
  }
  setNotifications(user, settings) {
    const value = typeof settings === 'boolean' ? { enabled: settings } : settings;
    if (!value || typeof value !== 'object' || Array.isArray(value) || (value.enabled === undefined && value.categories === undefined)) throw new HttpError(400, 'Укажите общую настройку или категории уведомлений.');
    if (value.enabled !== undefined && typeof value.enabled !== 'boolean') throw new HttpError(400, 'Укажите true или false.');
    if (value.categories !== undefined && (!value.categories || typeof value.categories !== 'object' || Array.isArray(value.categories) || Object.entries(value.categories).some(([key, enabled]) => !(key in DEFAULT_NOTIFICATION_PREFERENCES) || typeof enabled !== 'boolean'))) throw new HttpError(400, 'Укажите известные категории уведомлений и значения true или false.');
    if (user.demo) throw new HttpError(403, 'Уведомления доступны после входа через MAX.');
    const enabled = value.enabled ?? Boolean(user.notifications_enabled);
    const categories = { ...this.notificationPreferences(user), ...(value.categories || {}) };
    this.db.prepare('UPDATE users SET notifications_enabled=?,notification_preferences=? WHERE id=?').run(enabled ? 1 : 0, JSON.stringify(categories), user.id);
    for (const job of this.db.prepare('SELECT id,kind FROM notification_jobs WHERE user_id=? AND sent_at IS NULL AND cancelled_at IS NULL').all(user.id)) {
      const category = notificationCategory(job.kind);
      if (category && !categories[category]) this.cancelNotice(job.id);
    }
    return this.publicUser(this.db.prepare('SELECT * FROM users WHERE id=?').get(user.id));
  }
  recordBotActivity(externalId, active) {
    if (!/^[1-9][0-9]{0,18}$/.test(String(externalId))) return;
    this.db.prepare('INSERT INTO bot_contacts VALUES (?,?,?) ON CONFLICT(external_id) DO UPDATE SET active=excluded.active,updated_at=excluded.updated_at').run(String(externalId), active ? 1 : 0, Date.now());
  }
  queueNotice(eventId, userId, kind, dueAt = Date.now()) {
    if (!this.config.botToken || !userId) return;
    const recipient = this.db.prepare('SELECT notification_preferences FROM users WHERE id=?').get(userId);
    const category = notificationCategory(kind);
    if (recipient && category && !this.notificationPreferences(recipient)[category]) return;
    this.db.prepare('INSERT INTO notification_jobs (id,event_id,user_id,kind,due_at) VALUES (?,?,?,?,?) ON CONFLICT(event_id,user_id,kind) DO UPDATE SET due_at=excluded.due_at,cancelled_at=NULL WHERE notification_jobs.sent_at IS NULL').run(id('notice'), eventId, userId, kind, dueAt);
  }
  dueNotices(limit = 10) {
    return this.db.prepare(`SELECT jobs.*,users.external_id,users.notification_preferences,events.title,events.deadline,events.date,events.status AS event_status,events.invite_code,
      COALESCE(guests.submitted,0) AS guest_submitted,bot_contacts.active
      FROM notification_jobs jobs JOIN users ON users.id=jobs.user_id JOIN events ON events.id=jobs.event_id
      LEFT JOIN bot_contacts ON bot_contacts.external_id=users.external_id
      LEFT JOIN guests ON guests.event_id=jobs.event_id AND guests.user_id=jobs.user_id
      WHERE jobs.sent_at IS NULL AND jobs.cancelled_at IS NULL AND jobs.attempts<4 AND jobs.due_at<=?
      AND users.notifications_enabled=1 AND bot_contacts.active=1 ORDER BY jobs.due_at`).all(Date.now())
      .filter(job => { const category = notificationCategory(job.kind); return !category || this.notificationPreferences(job)[category]; })
      .slice(0, limit);
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
    return this.hydrate(user);
  }
  loginMax(profile) {
    const userId = `max_${profile.id}`;
    const role = this.config.restaurantAdminIds.includes(profile.id) ? 'restaurant' : 'guest';
    this.db.prepare(`INSERT INTO users (id,scope,external_id,name,role,demo) VALUES (?,'live',?,?,?,0) ON CONFLICT(id) DO UPDATE SET name=excluded.name,role=excluded.role`).run(userId, profile.id, profile.name, role);
    return this.issueSession(this.db.prepare('SELECT * FROM users WHERE id=?').get(userId));
  }
  loginDemo(body) {
    if (!this.config.demoEnabled) throw new HttpError(404, 'Демонстрационный режим выключен.');
    const role = body.role || 'organizer';
    if (!['admin', 'organizer', 'guest', 'restaurant'].includes(role)) throw new HttpError(400, 'Неизвестная роль.');
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
        for (const [userRole, name] of [['admin', 'Администратор'], ['restaurant', 'Управляющий «Петръ»'], ['organizer', 'Александра'], ['guest', 'Вы']]) {
          this.db.prepare('INSERT INTO users (id,scope,external_id,name,role,demo) VALUES (?,?,NULL,?,?,1)').run(`${scope}_${userRole}`, scope, name, userRole);
        }
        const restaurantId = this.seedDemoPetr(scope);
        this.db.prepare("INSERT INTO restaurant_members VALUES (?,?, 'admin', ?)").run(restaurantId, `${scope}_restaurant`, iso(Date.now()));
        const owner = this.db.prepare('SELECT * FROM users WHERE id=?').get(`${scope}_organizer`);
        const demoDate = days => new Date(`${new Date(Date.now() + days * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' })}T18:00:00+03:00`).toISOString();
        const packages = this.restaurants(this.hydrate(owner))[0].packages;
        if (packages.length) {
          const offer = packages[0];
          const fixed = this.createEvent(owner, { title: 'Корпоратив в «Петръ» · пакет', restaurantId, date: demoDate(18), deadline: demoDate(13), expectedGuests: 10, durationHours: 4, selectionMode: 'package', packageId: offer.id, packageChoice: offer.items.find(item => item.choiceGroup)?.dishId, seating: { mode: 'choice', template: 'rounds' } });
          this.db.prepare('UPDATE events SET created_at=? WHERE id=?').run(iso(Date.now() - 60_000), fixed.id);
          this.db.prepare('INSERT INTO guests VALUES (?,?,0,?,?)').run(fixed.id, `${scope}_guest`, '', iso(Date.now()));
          for (let index = 0; index < 6; index++) this.db.prepare('INSERT INTO guest_invites (id,event_id,name,phone,created_at) VALUES (?,?,?,?,?)').run(id('invite'), fixed.id, ['Мария Волкова','Дмитрий Соколов','Анна Морозова','Алексей Петров','Екатерина Смирнова','Ольга Зайцева'][index], `7999000100${index}`, iso(Date.now()));
        }
        const event = this.createEvent(owner, { title: 'День рождения Александры в «Петръ»', restaurantId, date: demoDate(14), deadline: demoDate(10), expectedGuests: 12, durationHours: 4, foodBudget: 250000, drinkBudget: 60000, seating: { mode: 'choice', template: 'rounds' } });
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
        for (const item of menu.filter(entry => entry.category === 'Холодные закуски').slice(0, 2)) shared.run(event.id, item.id, 3, item.price, item.name);
        const seat = this.db.prepare("INSERT INTO seat_assignments (event_id,seat_id,user_id,source,assigned_at) VALUES (?,?,?,'guest',?)");
        for (const [index, seatId] of ['t1-1', 't1-2', 't2-1'].entries()) seat.run(event.id, seatId, `${scope}_synthetic_${index}`, iso(Date.now()));
      });
    }
    const user = this.db.prepare('SELECT * FROM users WHERE id=?').get(`${scope}_${role}`);
    if (!user) throw new HttpError(401, 'Демо-сессия недоступна.');
    return { ...this.issueSession(user), sandbox };
  }
  restaurants(user) {
    const access = user.access || this.accessOf(user);
    const favorites = new Set(this.db.prepare('SELECT restaurant_id FROM restaurant_favorites WHERE user_id=?').all(user.id).map(row => row.restaurant_id));
    return this.db.prepare('SELECT * FROM restaurants WHERE scope=? ORDER BY sample_menu DESC,name').all(user.scope).map(row => ({
      id: row.id, name: row.name, description: row.description, address: row.address, sampleMenu: Boolean(row.sample_menu), access: access.get(row.id) || null, favorite: favorites.has(row.id),
      menu: this.db.prepare('SELECT data FROM menu_items WHERE restaurant_id=? ORDER BY rowid').all(row.id).map(item => presentMenuItem(item.data)),
      packageDishes: this.db.prepare('SELECT data FROM package_dishes WHERE restaurant_id=? ORDER BY rowid').all(row.id).map(item => JSON.parse(item.data)),
      packages: this.db.prepare('SELECT data FROM restaurant_packages WHERE restaurant_id=? ORDER BY rowid').all(row.id).map(item => this.presentPackage(JSON.parse(item.data), row.id)),
      halls: this.halls(row.id),
    }));
  }
  setRestaurantFavorite(user, restaurantId, enabled) {
    const restaurant = this.db.prepare('SELECT id FROM restaurants WHERE id=? AND scope=?').get(restaurantId, user.scope);
    if (!restaurant) throw new HttpError(404, 'Ресторан не найден.');
    if (enabled) this.db.prepare('INSERT OR IGNORE INTO restaurant_favorites VALUES (?,?)').run(user.id, restaurantId);
    else this.db.prepare('DELETE FROM restaurant_favorites WHERE user_id=? AND restaurant_id=?').run(user.id, restaurantId);
    return { restaurantId, favorite: enabled };
  }
  halls(restaurantId) {
    return this.db.prepare('SELECT * FROM restaurant_halls WHERE restaurant_id=? ORDER BY rowid').all(restaurantId).map(row => {
      const seatingConfig = row.seating_config ? JSON.parse(row.seating_config) : defaultSeatingConfig(row.capacity, row.default_seating_template, JSON.parse(row.allowed_seating).includes('choice') ? 'flexible' : 'fixed');
      return { id: row.id, name: row.name, capacity: row.capacity, windows: JSON.parse(row.windows), allowedSeating: SEATING_CHOICES, defaultSeatingTemplate: row.default_seating_template, allowFreeSeating: seatingConfig.type === 'flexible', seatingConfig };
    });
  }
  editHall(user, restaurantId, hallId, body) {
    if (!this.adminOf(user, restaurantId)) throw new HttpError(403, 'Настройки зала меняет администратор ресторана.');
    const restaurant = this.db.prepare('SELECT id FROM restaurants WHERE id=? AND scope=?').get(restaurantId, user.scope);
    if (!restaurant) throw new HttpError(404, 'Ресторан не найден.');
    const old = hallId ? this.halls(restaurantId).find(hall => hall.id === hallId) : null;
    if (hallId && !old) throw new HttpError(404, 'Зал не найден.');
    if (!hallId && this.halls(restaurantId).length >= 20) throw new HttpError(429, 'Достигнут предел залов.');
    const name = string(body.name ?? old?.name, 'Название зала', 100);
    const capacity = integer(body.capacity ?? old?.capacity, 'Вместимость', 1, 1000);
    const windows = body.windows ?? old?.windows;
    if (!Array.isArray(windows) || !windows.length || windows.length > 28) throw new HttpError(400, 'Укажите окна бронирования до 28 интервалов в неделю.');
    const validStart = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
    const validEnd = value => validStart(value) || value === '24:00';
    const normalized = windows.map(window => {
      if (!Number.isInteger(window.weekday) || window.weekday < 0 || window.weekday > 6 || !validStart(window.start) || !validEnd(window.end) || window.start >= window.end) throw new HttpError(400, 'Окно бронирования: день недели 0–6, начало от 00:00 до 23:59, конец до 24:00.');
      return { weekday: window.weekday, start: window.start, end: window.end };
    });
    for (const [index, first] of normalized.entries()) if (normalized.some((second, next) => next > index && second.weekday === first.weekday && first.start < second.end && first.end > second.start)) throw new HttpError(400, 'Окна бронирования не должны пересекаться.');
    const requestedModes = body.allowedSeating ?? old?.allowedSeating ?? SEATING_CHOICES;
    if (!Array.isArray(requestedModes) || new Set(requestedModes).size !== requestedModes.length || requestedModes.some(mode => !SEATING_CHOICES.includes(mode))) throw new HttpError(400, 'Допустимые рассадки: choice и fixed.');
    const defaultSeatingTemplate = body.defaultSeatingTemplate ?? old?.defaultSeatingTemplate ?? 'rounds';
    if (!SEATING_TEMPLATES.some(entry => entry.id === defaultSeatingTemplate && entry.id !== 'empty')) throw new HttpError(400, 'Выберите стандартную схему рассадки зала.');
    const requestedConfig = body.seatingConfig ?? (body.allowedSeating !== undefined ? { ...(old?.seatingConfig || defaultSeatingConfig(capacity, defaultSeatingTemplate)), type: requestedModes.includes('choice') ? 'flexible' : 'fixed' } : old?.seatingConfig || defaultSeatingConfig(capacity, defaultSeatingTemplate));
    const seatingConfig = validSeatingConfig(requestedConfig, capacity);
    const allowedSeating = SEATING_CHOICES;
    const value = { id: hallId || id('hall'), name, capacity, windows: normalized, allowedSeating, defaultSeatingTemplate, allowFreeSeating: seatingConfig.type === 'flexible', seatingConfig };
    if (old) {
      for (const event of this.db.prepare('SELECT * FROM events WHERE hall_id=? AND date>?').all(old.id, iso(Date.now()))) {
        if (event.expected_guests > capacity) throw new HttpError(409, 'Новая вместимость меньше числа гостей уже забронированного банкета.');
        if (!this.hallWindow(value, event.date, event.duration_hours)) throw new HttpError(409, 'Новые часы работы противоречат уже забронированному времени. Сохраните прежнее окно или сначала измените время банкета.');
      }
    }
    this.db.prepare('INSERT INTO restaurant_halls (id,restaurant_id,name,capacity,windows,allowed_seating,default_seating_template,seating_config) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,capacity=excluded.capacity,windows=excluded.windows,allowed_seating=excluded.allowed_seating,default_seating_template=excluded.default_seating_template,seating_config=excluded.seating_config').run(value.id, restaurantId, name, capacity, JSON.stringify(normalized), JSON.stringify(allowedSeating), defaultSeatingTemplate, JSON.stringify(seatingConfig));
    return value;
  }
  deleteHall(user, restaurantId, hallId) {
    if (!this.adminOf(user, restaurantId)) throw new HttpError(403, 'Зал удаляет администратор ресторана.');
    if (this.halls(restaurantId).length <= 1) throw new HttpError(409, 'У ресторана должен оставаться хотя бы один зал.');
    if (this.db.prepare('SELECT 1 FROM events WHERE hall_id=?').get(hallId)) throw new HttpError(409, 'Зал уже используется в банкетах.');
    if (this.db.prepare('DELETE FROM restaurant_halls WHERE id=? AND restaurant_id=?').run(hallId, restaurantId).changes !== 1) throw new HttpError(404, 'Зал не найден.');
    return { success: true };
  }
  hallWindow(hall, dateValue, durationHours) {
    if (hall.windows.length === 7 && new Set(hall.windows.map(window => window.weekday)).size === 7 && hall.windows.every(window => window.start === '00:00' && window.end === '24:00')) return true;
    const start = new Date(dateValue);
    const end = new Date(start.getTime() + durationHours * 3600000);
    const parts = value => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Moscow', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value).map(part => [part.type, part.value]));
    const a = parts(start), b = parts(end);
    const weekday = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(a.weekday);
    const day = value => Date.UTC(Number(value.year), Number(value.month) - 1, Number(value.day));
    const startMinute = Number(a.hour) * 60 + Number(a.minute);
    const endMinute = (day(b) - day(a)) / 86400000 * 1440 + Number(b.hour) * 60 + Number(b.minute);
    const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
    return hall.windows.some(window => window.weekday === weekday && minutes(window.start) <= startMinute && endMinute <= minutes(window.end));
  }
  reserveHall(restaurantId, hallId, dateValue, durationHours, expectedGuests, excludeEventId = '') {
    const hall = this.halls(restaurantId).find(entry => entry.id === hallId);
    if (!hall) throw new HttpError(400, 'Выберите зал этого ресторана.');
    if (expectedGuests > hall.capacity) throw new HttpError(409, `Зал «${hall.name}» вмещает не более ${hall.capacity} гостей.`);
    if (!this.hallWindow(hall, dateValue, durationHours)) throw new HttpError(409, 'Время банкета с учётом длительности выходит за окно бронирования зала.');
    const start = Date.parse(dateValue), end = start + durationHours * 3600000;
    for (const event of this.db.prepare("SELECT date,duration_hours FROM events WHERE hall_id=? AND status IN ('collecting','approved') AND id!=?").all(hallId, excludeEventId)) {
      if (start < Date.parse(event.date) + event.duration_hours * 3600000 && end > Date.parse(event.date)) {
        const format = value => new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
        throw new HttpError(409, `Зал «${hall.name}» уже забронирован с ${format(event.date)} до ${format(Date.parse(event.date) + event.duration_hours * 3600000)}. Выберите свободное время.`);
      }
    }
    return hall;
  }
  availability(user, restaurantId, day, hallId) {
    const restaurant = this.db.prepare('SELECT id FROM restaurants WHERE id=? AND scope=?').get(restaurantId, user.scope);
    if (!restaurant) throw new HttpError(404, 'Ресторан не найден.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '') || Number.isNaN(Date.parse(`${day}T12:00:00+03:00`))) throw new HttpError(400, 'Укажите дату YYYY-MM-DD.');
    const halls = this.halls(restaurantId).filter(hall => !hallId || hall.id === hallId);
    if (!halls.length) throw new HttpError(404, 'Зал не найден.');
    const weekday = new Date(`${day}T12:00:00+03:00`).getUTCDay();
    const dayStart = Date.parse(`${day}T00:00:00+03:00`), dayEnd = dayStart + 86400000;
    return halls.map(hall => ({ ...hall, windows: hall.windows.filter(window => window.weekday === weekday), booked: this.db.prepare("SELECT * FROM events WHERE hall_id=? AND status IN ('collecting','approved')").all(hall.id).filter(event => Date.parse(event.date) < dayEnd && Date.parse(event.date) + event.duration_hours * 3600000 > dayStart).map(event => ({ ...(this.isManager(user, event) ? { eventId: event.id } : {}), start: event.date, end: iso(Date.parse(event.date) + event.duration_hours * 3600000) })) }));
  }
  availabilityMonth(user, restaurantId, month, hallId, duration, excludeEventId = '') {
    const restaurant = this.db.prepare('SELECT id FROM restaurants WHERE id=? AND scope=?').get(restaurantId, user.scope);
    if (!restaurant) throw new HttpError(404, 'Ресторан не найден.');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) throw new HttpError(400, 'Укажите месяц YYYY-MM.');
    const durationHours = integer(Number(duration), 'Длительность в часах', 1, 12);
    const hall = this.halls(restaurantId).find(entry => entry.id === hallId);
    if (!hall) throw new HttpError(404, 'Зал не найден.');
    if (excludeEventId) {
      const excluded = this.eventRow(excludeEventId, user);
      if (!this.isManager(user, excluded) || excluded.restaurant_id !== restaurantId) throw new HttpError(403, 'Нет доступа к этой брони.');
    }
    const bookings = this.db.prepare("SELECT date,duration_hours FROM events WHERE hall_id=? AND status IN ('collecting','approved') AND id!=?").all(hallId, excludeEventId).map(event => ({ start: Date.parse(event.date), end: Date.parse(event.date) + event.duration_hours * 3600000 }));
    const [year, monthNumber] = month.split('-').map(Number);
    const count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const now = Date.now();
    const days = Array.from({ length: count }, (_, index) => {
      const day = `${month}-${String(index + 1).padStart(2, '0')}`;
      const slots = [];
      for (let minute = 0; minute < 1440; minute += 30) {
        const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
        const start = Date.parse(`${day}T${time}:00+03:00`);
        if (start <= now || !this.hallWindow(hall, iso(start), durationHours)) continue;
        const end = start + durationHours * 3600000;
        if (!bookings.some(booking => start < booking.end && end > booking.start)) slots.push(time);
      }
      return { date: day, slots };
    });
    return { month, hallId, durationHours, days };
  }
  editPackage(user, restaurantId, offerId, body) {
    if (!this.adminOf(user, restaurantId)) throw new HttpError(403, 'Пакеты редактирует администратор ресторана.');
    if (!this.db.prepare('SELECT 1 FROM restaurants WHERE id=? AND scope=?').get(restaurantId, user.scope)) throw new HttpError(404, 'Ресторан не найден.');
    if (!offerId && this.db.prepare('SELECT COUNT(*) AS count FROM restaurant_packages WHERE restaurant_id=?').get(restaurantId).count >= 50) throw new HttpError(429, 'Достигнут предел пакетных предложений.');
    const existing = offerId ? this.db.prepare('SELECT data FROM restaurant_packages WHERE id=? AND restaurant_id=?').get(offerId, restaurantId) : null;
    if (offerId && !existing) throw new HttpError(404, 'Пакет не найден.');
    const offer = packageOffer({ ...(existing ? JSON.parse(existing.data) : {}), ...body }, offerId || id('package'));
    const choices = new Set(offer.items.map(item => item.choiceGroup).filter(Boolean));
    if (choices.size > 1) throw new HttpError(400, 'В пакете допускается одна группа выбора горячего.');
    for (const item of offer.items) {
      const dish = this.db.prepare('SELECT data FROM package_dishes WHERE id=? AND restaurant_id=?').get(item.dishId, restaurantId);
      if (!dish || !JSON.parse(dish.data).available) throw new HttpError(400, 'Выберите доступные блюда этого ресторана, помеченные «только для пакета».');
    }
    this.db.prepare('INSERT INTO restaurant_packages VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(offer.id, restaurantId, JSON.stringify(offer));
    return this.presentPackage(offer, restaurantId);
  }
  presentPackage(offer, restaurantId) {
    return { ...offer, items: offer.items.map(item => {
      if (!item.dishId) return item;
      const row = this.db.prepare('SELECT data FROM package_dishes WHERE id=? AND restaurant_id=?').get(item.dishId, restaurantId);
      return { ...item, ...(row ? JSON.parse(row.data) : { name: 'Удалённое блюдо', category: 'Прочее' }), dishId: item.dishId, grams: item.grams, choiceGroup: item.choiceGroup || '' };
    }) };
  }
  editPackageDish(user, restaurantId, dishId, body) {
    return this.transaction(() => {
      if (!this.adminOf(user, restaurantId)) throw new HttpError(403, 'Блюда пакетов редактирует администратор ресторана.');
      if (!this.db.prepare('SELECT 1 FROM restaurants WHERE id=? AND scope=?').get(restaurantId, user.scope)) throw new HttpError(404, 'Ресторан не найден.');
      if (!dishId && this.db.prepare('SELECT COUNT(*) AS count FROM package_dishes WHERE restaurant_id=?').get(restaurantId).count >= 500) throw new HttpError(429, 'Достигнут предел блюд пакетов.');
      const old = dishId ? this.db.prepare('SELECT data FROM package_dishes WHERE id=? AND restaurant_id=?').get(dishId, restaurantId) : null;
      if (dishId && !old) throw new HttpError(404, 'Блюдо пакета не найдено.');
      const previous = old ? JSON.parse(old.data) : null;
      const dish = packageDish({ ...(previous || {}), ...body }, dishId || id('package_dish'));
      this.db.prepare('INSERT INTO package_dishes VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(dish.id, restaurantId, JSON.stringify(dish));
      if (previous) this.propagatePackagePhoto(restaurantId, dish.id, previous.photoUrl, dish.photoUrl);
      return dish;
    });
  }
  deletePackageDish(user, restaurantId, dishId) {
    if (!this.adminOf(user, restaurantId)) throw new HttpError(403, 'Блюда пакетов редактирует администратор ресторана.');
    for (const row of this.db.prepare('SELECT data FROM restaurant_packages WHERE restaurant_id=?').all(restaurantId)) if (JSON.parse(row.data).items.some(item => item.dishId === dishId)) throw new HttpError(409, 'Блюдо входит в пакет. Сначала уберите его из пакета.');
    if (this.db.prepare('DELETE FROM package_dishes WHERE id=? AND restaurant_id=?').run(dishId, restaurantId).changes !== 1) throw new HttpError(404, 'Блюдо пакета не найдено.');
    return { success: true };
  }
  deletePackage(user, restaurantId, offerId) {
    if (!this.adminOf(user, restaurantId)) throw new HttpError(403, 'Пакеты редактирует администратор ресторана.');
    if (this.db.prepare('DELETE FROM restaurant_packages WHERE id=? AND restaurant_id=?').run(offerId, restaurantId).changes !== 1) throw new HttpError(404, 'Пакет не найден.');
    return { success: true };
  }
  eventMenu(eventId) { return this.db.prepare('SELECT data FROM event_menu WHERE event_id=? ORDER BY rowid').all(eventId).map(row => presentMenuItem(row.data)); }
  selectedPackage(restaurantId, packageId, choice) {
    const row = this.db.prepare('SELECT data FROM restaurant_packages WHERE id=? AND restaurant_id=?').get(packageId, restaurantId);
    if (!row) throw new HttpError(400, 'Выберите пакетное предложение этого ресторана.');
    const offer = this.presentPackage(JSON.parse(row.data), restaurantId);
    const variants = offer.items.filter(item => item.choiceGroup);
    if (!variants.length) return offer;
    const selected = variants.find(item => item.dishId === choice || item.name === choice);
    if (!selected) throw new HttpError(400, 'Выберите горячее блюдо для фиксированного пакета.');
    return { ...offer, items: offer.items.filter(item => !item.choiceGroup || item.dishId === selected.dishId).map(item => ({ ...item, choiceGroup: '' })) };
  }
  eventRow(eventId, user) {
    const row = this.db.prepare('SELECT * FROM events WHERE id=? AND scope=?').get(eventId, user.scope);
    if (!row) throw new HttpError(404, 'Банкет не найден.');
    return row;
  }
  isOrganizer(user, event) { return event.owner_id === user.id || Boolean(this.db.prepare('SELECT 1 FROM event_organizers WHERE event_id=? AND user_id=?').get(event.id, user.id)); }
  isManager(user, event) { return event.scope === user.scope && (this.adminOf(user, event.restaurant_id) || this.isOrganizer(user, event)); }
  canRead(user, event) {
    if (this.isManager(user, event)) return true;
    if (event.owner_id === user.id) return true;
    const joined = this.db.prepare('SELECT 1 FROM guests WHERE event_id=? AND user_id=?').get(event.id, user.id);
    if (!joined) return false;
    return event.scope !== 'live' || Boolean(user.phone_verified_at && user.phone && this.db.prepare('SELECT 1 FROM guest_invites WHERE event_id=? AND user_id=? AND phone=?').get(event.id, user.id, user.phone));
  }
  presentEvent(row, user, publicOnly = false) {
    const sharedTotal = this.db.prepare('SELECT COALESCE(SUM(quantity*price),0) AS total FROM shared_items WHERE event_id=?').get(row.id).total;
    const selectedPackage = row.selection_mode === 'package' ? JSON.parse(row.package_data) : null;
    const total = this.db.prepare('SELECT COALESCE(SUM(quantity*price),0) AS total FROM selections WHERE event_id=?').get(row.id).total + sharedTotal + (selectedPackage?.price || 0) * row.expected_guests;
    const counts = this.db.prepare('SELECT COUNT(*) AS joined, COALESCE(SUM(submitted),0) AS responded FROM guests WHERE event_id=?').get(row.id);
    const restaurant = this.db.prepare('SELECT name,sample_menu FROM restaurants WHERE id=?').get(row.restaurant_id);
    const hall = this.halls(row.restaurant_id).find(entry => entry.id === row.hall_id);
    const event = { id: row.id, title: row.title, photoUrl: row.photo_url || '', date: row.date, deadline: row.deadline, durationHours: row.duration_hours, hallId: row.hall_id, hallName: hall?.name || '', status: row.status, restaurantId: row.restaurant_id, restaurantName: restaurant.name, demo: row.scope !== 'live', sampleMenu: Boolean(restaurant.sample_menu), menuSnapshot: true, seatingMode: row.seating_mode, selectionMode: row.selection_mode, package: selectedPackage };
    if (!publicOnly) Object.assign(event, { expectedGuests: row.expected_guests, total, responded: counts.responded, joined: counts.joined, approvedAt: row.approved_at, isOwner: user?.id === row.owner_id, revision: row.revision, foodBudget: row.food_budget, drinkBudget: row.drink_budget });
    if (!publicOnly) {
      event.canManage = Boolean(user && this.isManager(user, row));
      event.canDelete = Boolean(user && (row.status === 'approved' ? this.adminOf(user, row.restaurant_id) : event.canManage));
    }
    if (!publicOnly && event.canManage) {
      const owner = this.db.prepare('SELECT name FROM users WHERE id=?').get(row.owner_id);
      Object.assign(event, { budget: (row.food_budget + row.drink_budget) * row.expected_guests, sharedTotal, inviteCode: row.invite_code, ownerName: owner?.name || '' });
    }
    return event;
  }
  events(user) {
    return this.db.prepare('SELECT * FROM events WHERE scope=? ORDER BY created_at DESC').all(user.scope).filter(row => this.canRead(user, row)).map(row => this.presentEvent(row, user));
  }
  createEvent(user, body) {
    const count = this.db.prepare('SELECT COUNT(*) AS count FROM events WHERE owner_id=?').get(user.id).count;
    if (count >= (user.demo ? 30 : 500)) throw new HttpError(429, 'Достигнут предел банкетов для этого организатора.');
    const restaurant = this.db.prepare('SELECT * FROM restaurants WHERE id=? AND scope=?').get(body.restaurantId, user.scope);
    if (!restaurant) throw new HttpError(400, 'Выберите доступный ресторан.');
    if (!user.demo && !user.external_id) throw new HttpError(403, 'Создать банкет можно после входа через MAX.');
    const title = string(body.title, 'Название', 120);
    const eventDate = date(body.date, 'Дата банкета');
    const deadline = date(body.deadline, 'Срок выбора');
    if (Date.parse(eventDate) < Date.now() || Date.parse(deadline) < Date.now() || deadline > eventDate) throw new HttpError(400, 'Срок выбора должен быть в будущем и не позже банкета.');
    const expected = integer(body.expectedGuests, 'Число гостей', 1, 1000);
    const foodBudget = integer(body.foodBudget ?? 0, 'Бюджет на еду');
    const drinkBudget = integer(body.drinkBudget ?? 0, 'Бюджет на напитки');
    const durationHours = integer(body.durationHours ?? 4, 'Длительность в часах', 1, 12);
    const hallId = body.hallId || this.ensureHall(restaurant.id);
    const photoUrl = this.eventPhoto(body.photoUrl || '');
    const selectionMode = body.selectionMode || 'individual';
    if (!['individual', 'package'].includes(selectionMode)) throw new HttpError(400, 'Режим заказа: individual или package.');
    const selectedPackage = selectionMode === 'package' ? this.selectedPackage(restaurant.id, body.packageId, body.packageChoice) : null;
    const hall = this.reserveHall(restaurant.id, hallId, eventDate, durationHours, expected);
    const fixedHall = hall.seatingConfig.type === 'fixed';
    const seatingMode = body.seating?.mode ?? (fixedHall ? 'choice' : 'fixed');
    if (fixedHall && (body.seating?.template || body.seating?.layout)) throw new HttpError(403, 'Ресторан закрепил расположение столов и стульев этого зала.');
    if (!SEATING_MODES.includes(seatingMode) || (seatingMode !== 'off' && !hall.allowedSeating.includes(seatingMode))) throw new HttpError(400, 'Этот вариант рассадки недоступен для выбранного зала.');
    const template = body.seating?.template || hall.defaultSeatingTemplate;
    if (!fixedHall && seatingMode !== 'off' && !SEATING_TEMPLATES.some(entry => entry.id === template)) throw new HttpError(400, 'Неизвестная схема зала.');
    let seatingLayout = fixedHall ? hall.seatingConfig.fixedLayout : seatingMode === 'off' ? { tables: [] } : generateLayout(template, expected);
    if (!fixedHall && !layoutMatchesPresets(seatingLayout, hall.seatingConfig.tablePresets)) {
      if (body.seating?.template) throw new HttpError(409, 'Шаблон содержит столы, которых нет в наборе ресторана. Выберите другие размеры.');
      seatingLayout = { tables: [] };
    }
    const checkedLayout = validateLayout(seatingLayout);
    if (checkedLayout.error) throw new HttpError(400, checkedLayout.error);
    if (fixedHall && layoutSeats(checkedLayout.layout).length < expected) throw new HttpError(409, `В готовой схеме зала только ${layoutSeats(checkedLayout.layout).length} мест. Выберите другой зал или уменьшите число гостей.`);
    const menu = this.db.prepare('SELECT id,data FROM menu_items WHERE restaurant_id=? ORDER BY rowid').all(restaurant.id).filter(row => JSON.parse(row.data).available);
    if (!menu.length && !selectedPackage) throw new HttpError(409, 'В ресторане пока нет доступных блюд.');
    const eventId = id('event');
    this.db.prepare(`INSERT INTO events (id,scope,owner_id,restaurant_id,title,date,deadline,expected_guests,budget,guest_budget,food_budget,drink_budget,status,invite_code,created_at,approved_at,photo_url,selection_mode,package_data,duration_hours,hall_id,seating_config) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'collecting',?,?,NULL,?,?,?,?,?,?)`).run(eventId, user.scope, user.id, restaurant.id, title, eventDate, deadline, expected, (foodBudget + drinkBudget) * expected, foodBudget + drinkBudget, foodBudget, drinkBudget, secret().slice(0, 24), iso(Date.now()), photoUrl, selectionMode, selectedPackage ? JSON.stringify(selectedPackage) : '', durationHours, hallId, JSON.stringify(hall.seatingConfig));
    if (seatingMode !== 'off' || fixedHall) this.db.prepare('UPDATE events SET seating_mode=?,seating_layout=? WHERE id=?').run(seatingMode, JSON.stringify(checkedLayout.layout), eventId);
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
      const durationHours = body.durationHours === undefined ? event.duration_hours : integer(body.durationHours, 'Длительность в часах', 1, 12);
      const hallId = body.hallId === undefined ? event.hall_id : body.hallId;
      const hall = this.reserveHall(event.restaurant_id, hallId, eventDate, durationHours, expected, event.id);
      let nextSeating = null;
      if (hallId !== event.hall_id) {
        if (this.db.prepare('SELECT 1 FROM seat_assignments WHERE event_id=? LIMIT 1').get(event.id)) throw new HttpError(409, 'Перед сменой зала снимите назначенные гостям места.');
        if (hall.seatingConfig.type === 'fixed') {
          const layout = hall.seatingConfig.fixedLayout;
          if (layoutSeats(layout).length < expected) throw new HttpError(409, 'В готовой схеме выбранного зала недостаточно мест для гостей.');
          nextSeating = { mode: event.seating_mode, layout };
        } else {
          const generated = generateLayout(hall.defaultSeatingTemplate, expected);
          nextSeating = { mode: event.seating_mode === 'off' ? 'off' : event.seating_mode, layout: layoutMatchesPresets(generated, hall.seatingConfig.tablePresets) ? generated : { tables: [] } };
        }
      } else if (JSON.parse(event.seating_config || '{}').type === 'fixed' && expected > layoutSeats(this.layoutOf(event)).length) throw new HttpError(409, 'В готовой схеме зала недостаточно мест для гостей.');
      const photoUrl = body.photoUrl === undefined ? event.photo_url : this.eventPhoto(body.photoUrl);
      const selectionMode = body.selectionMode === undefined ? event.selection_mode : body.selectionMode;
      if (!['individual', 'package'].includes(selectionMode)) throw new HttpError(400, 'Режим заказа: individual или package.');
      const changingMode = selectionMode !== event.selection_mode || body.packageId !== undefined;
      if (changingMode && this.db.prepare('SELECT 1 FROM selections WHERE event_id=?').get(event.id)) throw new HttpError(409, 'Нельзя менять режим заказа после выбора блюд гостями.');
      const selectedPackage = selectionMode === 'package' ? (body.packageId ? this.selectedPackage(event.restaurant_id, body.packageId, body.packageChoice) : JSON.parse(event.package_data || 'null')) : null;
      if (selectionMode === 'package' && !selectedPackage) throw new HttpError(400, 'Выберите пакетное предложение.');
      this.db.prepare('UPDATE events SET title=?,date=?,deadline=?,expected_guests=?,budget=?,guest_budget=?,food_budget=?,drink_budget=?,photo_url=?,selection_mode=?,package_data=?,duration_hours=?,hall_id=?,revision=revision+1 WHERE id=?').run(title, eventDate, deadline, expected, (foodBudget + drinkBudget) * expected, foodBudget + drinkBudget, foodBudget, drinkBudget, photoUrl, selectionMode, selectedPackage ? JSON.stringify(selectedPackage) : '', durationHours, hallId, event.id);
      if (nextSeating) this.db.prepare('UPDATE events SET seating_mode=?,seating_layout=?,seating_config=? WHERE id=?').run(nextSeating.mode, JSON.stringify(nextSeating.layout), JSON.stringify(hall.seatingConfig), event.id);
      if (deadline !== event.deadline) {
        const reminderAt = Math.max(Date.now() + 120_000, Date.parse(deadline) - 24 * 3600_000);
        this.db.prepare("UPDATE notification_jobs SET due_at=?,sent_at=NULL,cancelled_at=NULL,attempts=0 WHERE event_id=? AND kind='reminder'").run(reminderAt, event.id);
      }
      const updated = this.eventRow(event.id, user);
      for (const guest of this.db.prepare('SELECT user_id FROM guests WHERE event_id=?').all(event.id)) this.queueNotice(event.id, guest.user_id, `event_changed:${updated.revision}`);
      return this.presentEvent(updated, user);
    });
  }
  deleteEvent(user, eventId) {
    return this.transaction(() => {
      const event = this.eventRow(eventId, user);
      if (!this.isManager(user, event)) throw new HttpError(403, 'Удалить банкет может его организатор или администратор ресторана.');
      if (event.status === 'approved' && !this.adminOf(user, event.restaurant_id)) throw new HttpError(403, 'После утверждения банкет удаляет только администратор ресторана.');
      this.db.prepare('DELETE FROM events WHERE id=?').run(event.id);
      return { success: true, eventId };
    });
  }
  addInvite(user, eventId, body) {
    return this.transaction(() => {
      const event = this.eventRow(eventId, user);
      if (!this.isManager(user, event)) throw new HttpError(403, 'Нет доступа к гостям банкета.');
      if (event.status !== 'collecting') throw new HttpError(409, 'Список гостей закрыт после утверждения.');
      const count = this.db.prepare('SELECT COUNT(*) AS count FROM guest_invites WHERE event_id=?').get(event.id).count;
      if (count >= 1000) throw new HttpError(429, 'Достигнут предел гостей.');
      if (event.seating_config && JSON.parse(event.seating_config).type === 'fixed' && count >= layoutSeats(this.layoutOf(event)).length) throw new HttpError(409, 'В готовой схеме зала больше нет мест для гостей.');
      if (count + 1 > event.expected_guests) this.reserveHall(event.restaurant_id, event.hall_id, event.date, event.duration_hours, count + 1, event.id);
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
      if (!this.adminOf(user, event.restaurant_id) && (!itemId || Object.keys(body).length !== 1 || typeof body.forGuests !== 'boolean')) {
        throw new HttpError(403, 'Создавать и редактировать блюда может только администратор ресторана.');
      }
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
      let slot = this.db.prepare('SELECT * FROM guest_invites WHERE event_id=? AND phone=?').get(event.id, user.phone);
      if (!slot) {
        this.assertOpen(event);
        const count = this.db.prepare('SELECT COUNT(*) AS count FROM guest_invites WHERE event_id=?').get(event.id).count;
        if (count >= 1000) throw new HttpError(409, 'Достигнут предел гостей.');
        if (event.seating_config && JSON.parse(event.seating_config).type === 'fixed' && count >= layoutSeats(this.layoutOf(event)).length) throw new HttpError(409, 'В готовой схеме зала больше нет мест для гостей.');
        const inviteId = id('invite');
        this.db.prepare('INSERT INTO guest_invites (id,event_id,name,phone,user_id,created_at) VALUES (?,?,?,?,?,?)').run(inviteId, event.id, user.name, user.phone, user.id, iso(Date.now()));
        if (count >= event.expected_guests) this.db.prepare('UPDATE events SET expected_guests=expected_guests+1,revision=revision+1 WHERE id=?').run(event.id);
        slot = this.db.prepare('SELECT * FROM guest_invites WHERE id=?').get(inviteId);
      }
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
      ? this.db.prepare('SELECT guests.*,COALESCE(guest_invites.name,users.name) AS name,guest_invites.phone AS invited_phone,users.external_id AS max_id FROM guests JOIN users ON users.id=guests.user_id LEFT JOIN guest_invites ON guest_invites.event_id=guests.event_id AND guest_invites.user_id=guests.user_id WHERE guests.event_id=? ORDER BY guests.submitted DESC,name').all(event.id)
      : this.db.prepare('SELECT guests.*,COALESCE(guest_invites.name,users.name) AS name FROM guests JOIN users ON users.id=guests.user_id LEFT JOIN guest_invites ON guest_invites.event_id=guests.event_id AND guest_invites.user_id=guests.user_id WHERE guests.event_id=? AND guests.user_id=?').all(event.id, user.id);
    const guests = guestRows.map(row => {
      const selections = this.db.prepare('SELECT menu_item_id AS menuItemId,quantity,price,name FROM selections WHERE event_id=? AND user_id=? ORDER BY rowid').all(event.id, row.user_id);
      return { id: row.user_id, name: row.name, submitted: Boolean(row.submitted), notes: row.notes, items: selections, total: selections.reduce((sum, item) => sum + item.quantity * item.price, 0), ...(manager ? { phone: row.invited_phone || null, maxId: row.max_id || null } : {}) };
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
    if (manager && event.selection_mode === 'package') {
      const offer = JSON.parse(event.package_data);
      summary.unshift({ menuItemId: offer.id, name: offer.name, quantity: event.expected_guests, total: offer.price * event.expected_guests });
    }
    const sharedIds = new Set(shared.map(item => item.menuItemId));
    const menu = this.eventMenu(event.id).filter(item => manager || item.forGuests || sharedIds.has(item.id));
    const selfAuthorized = event.scope !== 'live' || this.isOrganizer(user, event) || Boolean(user.phone_verified_at && user.phone && this.db.prepare('SELECT 1 FROM guest_invites WHERE event_id=? AND user_id=? AND phone=?').get(event.id, user.id, user.phone));
    const result = { event: this.presentEvent(event, user), menu, guests, canSelect: event.selection_mode === 'individual' && (Boolean(own) || this.isOrganizer(user, event)) && selfAuthorized, selection: own ? { submitted: own.submitted, notes: own.notes, items: own.items, total: own.total } : { submitted: false, notes: '', items: [], total: 0 }, summary, shared, seating };
    if (manager) {
      const invitedGuests = this.db.prepare(`SELECT guest_invites.id,guest_invites.name,guest_invites.phone,guest_invites.user_id AS userId,users.external_id AS maxId,
        COALESCE(guests.submitted,0) AS submitted FROM guest_invites LEFT JOIN guests ON guests.event_id=guest_invites.event_id AND guests.user_id=guest_invites.user_id
        LEFT JOIN users ON users.id=guest_invites.user_id
        WHERE guest_invites.event_id=? ORDER BY guest_invites.created_at,guest_invites.rowid`).all(event.id);
      Object.assign(result, { invitedGuests: invitedGuests.map(entry => ({ ...entry, joined: Boolean(entry.userId), submitted: Boolean(entry.submitted) })), inviteCode: event.invite_code, inviteUrl: `${this.config.publicUrl}/invite/${event.invite_code}`, maxInviteUrl: this.config.botUsername ? `https://max.ru/${this.config.botUsername}?startapp=${event.invite_code}` : null });
    }
    return result;
  }
  saveSelection(user, eventId, body) {
    return this.transaction(() => {
      const event = this.eventRow(eventId, user);
      this.assertOpen(event);
      if (event.selection_mode === 'package') throw new HttpError(409, 'Для этого банкета выбран фиксированный пакет. Гости не выбирают блюда.');
      let guest = this.db.prepare('SELECT * FROM guests WHERE event_id=? AND user_id=?').get(event.id, user.id);
      // The organizer can order for themselves without being on their own guest list.
      if (!guest && this.isOrganizer(user, event)) {
        this.db.prepare('INSERT INTO guests VALUES (?,?,0,?,?)').run(event.id, user.id, '', iso(Date.now()));
        guest = true;
      }
      if (!guest) throw new HttpError(403, 'Сначала присоединитесь к банкету по приглашению.');
      if (event.scope === 'live' && !this.isOrganizer(user, event) && (!user.phone_verified_at || !user.phone || !this.db.prepare('SELECT 1 FROM guest_invites WHERE event_id=? AND user_id=? AND phone=?').get(event.id, user.id, user.phone))) {
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
      if (event.scope === 'live' && event.owner_id !== user.id) this.queueNotice(event.id, event.owner_id, `selection:${event.revision + 1}`);
      return { success: true, total };
    });
  }
  approve(user, eventId, body = {}) {
    return this.transaction(() => {
      const event = this.eventRow(eventId, user);
      if (!this.isManager(user, event)) throw new HttpError(403, 'Утвердить заказ может организатор банкета или администратор ресторана.');
      if (event.status === 'approved') return this.presentEvent(event, user);
      if (body.expectedRevision === undefined) throw new HttpError(400, 'Перед утверждением откройте актуальную версию заказа.');
      if (integer(body.expectedRevision, 'Версия заказа') !== event.revision) {
        throw new HttpError(409, 'Гости обновили свой выбор. Проверьте свежую сумму и утвердите заказ ещё раз.');
      }
      const count = this.db.prepare('SELECT COUNT(*) AS count FROM guests WHERE event_id=? AND submitted=1').get(event.id).count;
      if (!count && event.selection_mode !== 'package') throw new HttpError(409, 'Пока нет ни одного выбора. Дождитесь ответа гостей.');
      if (event.seating_mode !== 'off') this.fillSeats(event);
      this.db.prepare("UPDATE events SET status='approved',approved_at=?,revision=revision+1 WHERE id=? AND status='collecting'").run(iso(Date.now()), event.id);
      this.db.prepare("UPDATE notification_jobs SET cancelled_at=? WHERE event_id=? AND sent_at IS NULL AND kind='reminder'").run(Date.now(), event.id);
      if (event.scope === 'live') {
        for (const guest of this.db.prepare('SELECT user_id FROM guests WHERE event_id=?').all(event.id)) this.queueNotice(event.id, guest.user_id, 'approved');
        const admins = new Set(this.db.prepare("SELECT user_id FROM restaurant_members WHERE restaurant_id=? AND role='admin'").all(event.restaurant_id).map(row => row.user_id));
        for (const row of this.db.prepare('SELECT user_id FROM global_admins').all()) admins.add(row.user_id);
        for (const adminId of this.config.restaurantAdminIds) {
          const admin = this.db.prepare("SELECT id FROM users WHERE scope='live' AND external_id=?").get(adminId);
          if (admin) admins.add(admin.id);
        }
        for (const adminId of admins) this.queueNotice(event.id, adminId, 'restaurant_approved');
      }
      return this.presentEvent(this.eventRow(event.id, user), user);
    });
  }
  editMenu(user, restaurantId, itemId, body) {
    return this.transaction(() => {
      if (!this.adminOf(user, restaurantId)) throw new HttpError(403, 'Меню редактирует администратор ресторана.');
      const restaurant = this.db.prepare('SELECT * FROM restaurants WHERE id=? AND scope=?').get(restaurantId, user.scope);
      if (!restaurant) throw new HttpError(404, 'Ресторан не найден.');
      if (!itemId && this.db.prepare('SELECT COUNT(*) AS count FROM menu_items WHERE restaurant_id=?').get(restaurantId).count >= 500) throw new HttpError(429, 'Достигнут предел блюд в меню.');
      const existing = itemId ? this.db.prepare('SELECT data FROM menu_items WHERE id=? AND restaurant_id=?').get(itemId, restaurantId) : null;
      if (itemId && !existing) throw new HttpError(404, 'Блюдо не найдено.');
      const previous = existing ? JSON.parse(existing.data) : null;
      const value = { ...(previous || { emoji: '🍽️', available: true, vegetarian: false, allergens: [] }), ...body };
      const item = menuItem(value, itemId || id('dish'));
      this.db.prepare('INSERT INTO menu_items VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(item.id, restaurantId, JSON.stringify(item));
      if (previous) this.propagateMenuPhoto(restaurantId, item.id, previous.photoUrl, item.photoUrl);
      this.db.prepare('UPDATE restaurants SET sample_menu=0 WHERE id=?').run(restaurantId);
      return item;
    });
  }
  deleteMenu(user, restaurantId, itemId) {
    if (!this.adminOf(user, restaurantId)) throw new HttpError(403, 'Меню редактирует администратор ресторана.');
    const restaurant = this.db.prepare('SELECT id FROM restaurants WHERE id=? AND scope=?').get(restaurantId, user.scope);
    if (!restaurant) throw new HttpError(404, 'Ресторан не найден.');
    if (this.db.prepare('DELETE FROM menu_items WHERE id=? AND restaurant_id=?').run(itemId, restaurantId).changes !== 1) throw new HttpError(404, 'Блюдо не найдено.');
    this.db.prepare('UPDATE restaurants SET sample_menu=0 WHERE id=?').run(restaurantId);
    return { success: true };
  }
  /** People who have opened the app, with their roles in the restaurants the requester administers. */
  users(user, query = '') {
    const administered = [...(user.access || this.accessOf(user))].filter(([, role]) => role === 'admin').map(([restaurantId]) => restaurantId);
    const managed = this.db.prepare('SELECT * FROM events WHERE scope=?').all(user.scope).filter(event => this.isManager(user, event));
    if (!administered.length && !managed.length) throw new HttpError(403, 'Доступы видны организаторам и администраторам.');
    const q = string(query, 'Поиск', 80, true).toLowerCase();
    const members = administered.length ? this.db.prepare(`SELECT user_id,restaurant_id,role FROM restaurant_members WHERE role='admin' AND restaurant_id IN (${administered.map(() => '?').join(',')})`).all(...administered) : [];
    const visible = new Set(members.map(row => row.user_id));
    for (const event of managed) {
      visible.add(event.owner_id);
      for (const row of this.db.prepare('SELECT user_id FROM event_organizers WHERE event_id=?').all(event.id)) visible.add(row.user_id);
      for (const row of this.db.prepare('SELECT user_id FROM guests WHERE event_id=?').all(event.id)) visible.add(row.user_id);
    }
    if (this.isSuperAdmin(user)) {
      for (const row of this.db.prepare('SELECT user_id FROM global_admins').all()) visible.add(row.user_id);
      for (const configured of this.config.restaurantAdminIds) { const row = this.db.prepare("SELECT id FROM users WHERE scope='live' AND external_id=?").get(configured); if (row) visible.add(row.id); }
    }
    visible.add(user.id);
    return this.db.prepare('SELECT * FROM users WHERE scope=? AND demo=? ORDER BY name').all(user.scope, user.demo ? 1 : 0)
      .filter(row => visible.has(row.id) && (!q || row.name.toLowerCase().includes(q) || row.phone?.includes(q.replace(/\D/g, '') || '\u0000') || row.external_id === q))
      .slice(0, 200)
      .map(row => {
        const superAdmin = this.isSuperAdmin(row);
        // Demo organizers keep their demo role; everyone else is managed through restaurant_members.
        const fixed = (superAdmin && !this.isSuperAdmin(user)) || (Boolean(row.demo) && row.role === 'organizer');
        const effective = superAdmin || fixed ? this.accessOf(row) : null;
        return {
          id: row.id, name: row.name, maxId: row.external_id || null, phone: row.phone || null, superAdmin, fixedGlobal: this.config.restaurantAdminIds.includes(row.external_id), fixed, isYou: row.id === user.id,
          roles: Object.fromEntries(administered.map(restaurantId => [restaurantId, effective ? effective.get(restaurantId) || 'none' : members.find(member => member.user_id === row.id && member.restaurant_id === restaurantId)?.role || 'none'])),
          eventRoles: Object.fromEntries(managed.map(event => [event.id, row.id === event.owner_id || Boolean(this.db.prepare('SELECT 1 FROM event_organizers WHERE event_id=? AND user_id=?').get(event.id, row.id))])),
          eventOwned: Object.fromEntries(managed.map(event => [event.id, row.id === event.owner_id])),
        };
      });
  }
  setGlobalAdmin(user, targetId, body) {
    return this.transaction(() => {
      if (!this.isSuperAdmin(user) || user.demo) throw new HttpError(403, 'Назначить администратора сервиса может только действующий администратор.');
      if (typeof body.enabled !== 'boolean') throw new HttpError(400, 'Укажите enabled: true или false.');
      const target = this.resolveIdentity('live', targetId);
      if (!body.enabled && target.id === user.id) throw new HttpError(409, 'Снимите роль через другого администратора.');
      if (!body.enabled && this.config.restaurantAdminIds.includes(target.external_id)) throw new HttpError(409, 'Роль этого пользователя задана на сервере.');
      if (body.enabled) this.db.prepare('INSERT OR IGNORE INTO global_admins VALUES (?,?,?)').run(target.id, user.id, iso(Date.now()));
      else this.db.prepare('DELETE FROM global_admins WHERE user_id=?').run(target.id);
      return { userId: target.id, maxId: target.external_id, superAdmin: this.isSuperAdmin(target) };
    });
  }
  setMember(user, restaurantId, targetId, body) {
    return this.transaction(() => {
      if (!this.db.prepare('SELECT 1 FROM restaurants WHERE id=? AND scope=?').get(restaurantId, user.scope)) throw new HttpError(404, 'Ресторан не найден.');
      if (!this.adminOf(user, restaurantId)) throw new HttpError(403, 'Выдавать доступ может администратор этого ресторана.');
      const target = this.resolveIdentity(user.scope, targetId);
      if (this.isSuperAdmin(target)) throw new HttpError(409, 'У суперадминистратора уже есть доступ ко всем ресторанам.');
      if (target.id === user.id) throw new HttpError(409, 'Свою роль может изменить другой администратор.');
      if (!['admin', 'none'].includes(body.role)) throw new HttpError(400, 'Роль ресторана: admin или none. Организатор назначается на банкет.');
      if (body.role === 'admin' && !this.isSuperAdmin(user)) throw new HttpError(403, 'Назначить администратора ресторана может только администратор сервиса.');
      const previous = this.db.prepare('SELECT role FROM restaurant_members WHERE restaurant_id=? AND user_id=?').get(restaurantId, target.id)?.role;
      if (previous === 'admin' && body.role !== 'admin' && !this.isSuperAdmin(user)) throw new HttpError(403, 'Изменить администратора ресторана может только администратор сервиса.');
      if (body.role === 'none') this.db.prepare('DELETE FROM restaurant_members WHERE restaurant_id=? AND user_id=?').run(restaurantId, target.id);
      else this.db.prepare('INSERT INTO restaurant_members VALUES (?,?,?,?) ON CONFLICT(restaurant_id,user_id) DO UPDATE SET role=excluded.role').run(restaurantId, target.id, body.role, iso(Date.now()));
      return { userId: target.id, restaurantId, role: body.role };
    });
  }
  restaurantMembers(user, restaurantId) {
    if (!this.db.prepare('SELECT 1 FROM restaurants WHERE id=? AND scope=?').get(restaurantId, user.scope)) throw new HttpError(404, 'Ресторан не найден.');
    if (!this.adminOf(user, restaurantId)) throw new HttpError(403, 'Нет доступа к ролям ресторана.');
    return this.db.prepare("SELECT users.id AS userId,users.external_id AS maxId,users.name,restaurant_members.role FROM restaurant_members JOIN users ON users.id=restaurant_members.user_id WHERE restaurant_members.restaurant_id=? AND restaurant_members.role='admin' ORDER BY users.name").all(restaurantId);
  }
  setEventOrganizer(user, eventId, targetId, body) {
    return this.transaction(() => {
      const event = this.eventRow(eventId, user);
      if (!this.isManager(user, event)) throw new HttpError(403, 'Назначить организатора может организатор банкета или администратор ресторана.');
      if (typeof body.enabled !== 'boolean') throw new HttpError(400, 'Укажите enabled: true или false.');
      const target = this.resolveIdentity(user.scope, targetId);
      if (target.id === event.owner_id && !body.enabled) throw new HttpError(409, 'Создатель банкета сохраняет роль организатора.');
      if (body.enabled) {
        if (this.db.prepare('SELECT COUNT(*) AS count FROM event_organizers WHERE event_id=?').get(event.id).count >= 30) throw new HttpError(429, 'Достигнут предел организаторов банкета.');
        this.db.prepare('INSERT OR IGNORE INTO event_organizers VALUES (?,?,?,?)').run(event.id, target.id, user.id, iso(Date.now()));
      } else this.db.prepare('DELETE FROM event_organizers WHERE event_id=? AND user_id=?').run(event.id, target.id);
      return { eventId, userId: target.id, organizer: body.enabled };
    });
  }
  eventOrganizers(user, eventId) {
    const event = this.eventRow(eventId, user);
    if (!this.isManager(user, event)) throw new HttpError(403, 'Организаторы видны только команде банкета.');
    return this.db.prepare(`SELECT users.id AS userId,users.name,users.phone,users.external_id AS maxId,users.id=? AS owner FROM users
      WHERE users.id=? OR users.id IN (SELECT user_id FROM event_organizers WHERE event_id=?) ORDER BY owner DESC,users.name`).all(event.owner_id, event.owner_id, eventId).map(row => ({ ...row, owner: Boolean(row.owner) }));
  }
  createRestaurant(user, body) {
    if (!user.superAdmin && !this.isSuperAdmin(user)) throw new HttpError(403, 'Добавлять рестораны может суперадминистратор.');
    if (this.db.prepare('SELECT COUNT(*) AS count FROM restaurants WHERE scope=?').get(user.scope).count >= 100) throw new HttpError(429, 'Достигнут предел ресторанов.');
    const restaurantId = id('restaurant');
    this.db.prepare('INSERT INTO restaurants VALUES (?,?,?,?,?,0)').run(restaurantId, user.scope, string(body.name, 'Название ресторана', 120), string(body.description, 'Описание', 500, true), string(body.address, 'Адрес', 200, true));
    this.ensureHall(restaurantId);
    return this.restaurants(this.hydrate(user)).find(entry => entry.id === restaurantId);
  }
  editRestaurant(user, restaurantId, body) {
    const row = this.db.prepare('SELECT * FROM restaurants WHERE id=? AND scope=?').get(restaurantId, user.scope);
    if (!row) throw new HttpError(404, 'Ресторан не найден.');
    if (!this.adminOf(user, restaurantId)) throw new HttpError(403, 'Изменять ресторан может его администратор.');
    const name = body.name === undefined ? row.name : string(body.name, 'Название ресторана', 120);
    const description = body.description === undefined ? row.description : string(body.description, 'Описание', 500, true);
    const address = body.address === undefined ? row.address : string(body.address, 'Адрес', 200, true);
    this.db.prepare('UPDATE restaurants SET name=?,description=?,address=? WHERE id=?').run(name, description, address, restaurantId);
    return this.restaurants(user).find(entry => entry.id === restaurantId);
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
  saveCatalogMenu(user, eventId, body) {
    return this.transaction(() => {
      const event = this.eventRow(eventId, user);
      if (!this.isManager(user, event)) throw new HttpError(403, 'Нет доступа к меню банкета.');
      if (event.status !== 'collecting') throw new HttpError(409, 'Меню закрыто после утверждения.');
      if (!Array.isArray(body.itemIds) || body.itemIds.length > 500 || body.itemIds.some(itemId => typeof itemId !== 'string')) throw new HttpError(400, 'Передайте список блюд каталога.');
      const catalog = new Map(this.db.prepare('SELECT id,data FROM menu_items WHERE restaurant_id=?').all(event.restaurant_id).map(row => [row.id, JSON.parse(row.data)]));
      const current = new Set(this.db.prepare('SELECT item_id FROM event_menu WHERE event_id=?').all(event.id).map(row => row.item_id));
      const selected = new Set(body.itemIds);
      for (const itemId of selected) {
        const item = catalog.get(itemId);
        if (!item) throw new HttpError(404, 'Блюдо не найдено в каталоге этого ресторана.');
        if (!item.available && !current.has(itemId)) throw new HttpError(409, `«${item.name}» сейчас недоступно в каталоге.`);
      }
      const remove = [...current].filter(itemId => catalog.has(itemId) && !selected.has(itemId));
      const add = [...selected].filter(itemId => !current.has(itemId));
      if (current.size - remove.length + add.length > 500) throw new HttpError(429, 'Достигнут предел позиций меню.');
      for (const itemId of remove) {
        const name = catalog.get(itemId).name;
        if (this.db.prepare('SELECT 1 FROM selections WHERE event_id=? AND menu_item_id=?').get(event.id, itemId)) throw new HttpError(409, `«${name}» уже выбрали гости. Его нельзя убрать из меню.`);
        if (this.db.prepare('SELECT 1 FROM shared_items WHERE event_id=? AND menu_item_id=?').get(event.id, itemId)) throw new HttpError(409, `«${name}» стоит на общем столе. Сначала уберите его оттуда.`);
      }
      const deleteItem = this.db.prepare('DELETE FROM event_menu WHERE event_id=? AND item_id=?');
      for (const itemId of remove) deleteItem.run(event.id, itemId);
      const insertItem = this.db.prepare('INSERT INTO event_menu VALUES (?,?,?)');
      for (const itemId of add) insertItem.run(event.id, itemId, JSON.stringify(catalog.get(itemId)));
      if (remove.length || add.length) this.db.prepare('UPDATE events SET revision=revision+1 WHERE id=?').run(event.id);
      return { added: add.length, removed: remove.length, count: current.size - remove.length + add.length };
    });
  }
  /** Administrator's kitchen board: every upcoming banquet with what the kitchen needs to cook. */
  kitchen(user) {
    const access = user.access || this.accessOf(user);
    if (![...access.values()].includes('admin')) throw new HttpError(403, 'Раздел «Кухня» доступен администратору.');
    return this.db.prepare('SELECT id,restaurant_id FROM events WHERE scope=? AND date>=? ORDER BY date').all(user.scope, iso(Date.now() - 86400000)).filter(row => access.get(row.restaurant_id) === 'admin').map(row => {
      const detail = this.detail(user, row.id);
      return {
        event: detail.event, summary: detail.summary, shared: detail.shared, seatingOn: detail.seating.mode !== 'off', seating: detail.seating,
        guests: detail.guests.filter(guest => guest.submitted).map(guest => ({ name: guest.name, notes: guest.notes, seat: guest.seat || '', items: guest.items.map(item => ({ name: item.name, quantity: item.quantity })) })),
      };
    });
  }
  /** Kitchen board as a spreadsheet: portions per banquet and every guest's order. */
  kitchenExport(user, format, eventIds) {
    if (!['csv', 'xlsx'].includes(format)) throw new HttpError(400, 'Формат выгрузки: csv или xlsx.');
    const allowed = this.kitchen(user);
    let board = allowed;
    if (eventIds !== undefined && eventIds !== null) {
      if (!Array.isArray(eventIds) || !eventIds.length || eventIds.length > 100 || eventIds.some(value => typeof value !== 'string' || !/^event_[a-f0-9-]{36}$/.test(value)) || new Set(eventIds).size !== eventIds.length) throw new HttpError(400, 'Выберите от 1 до 100 разных мероприятий.');
      const ids = new Set(eventIds);
      board = allowed.filter(entry => ids.has(entry.event.id));
      if (board.length !== ids.size) throw new HttpError(403, 'Одно из мероприятий недоступно для выгрузки.');
    }
    const status = event => (event.status === 'approved' ? 'Утверждён' : 'Собираем выбор');
    const when = value => new Date(value).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const dishes = [['Банкет', 'Дата', 'Ресторан', 'Организатор', 'Статус', 'Блюдо', 'Порции', 'Из них на общий стол']];
    const guests = [['Банкет', 'Дата', 'Гость', 'Место', 'Блюдо', 'Количество', 'Пожелания / аллергии']];
    const seating = [['Банкет', 'Дата', 'Стол', 'Место', 'Гость']];
    const packages = [['Банкет', 'Пакет', 'Раздел', 'Позиция', 'Грамм на гостя', 'Грамм на банкет']];
    for (const { event, summary, shared, guests: people, seating: plan } of board) {
      const sharedBy = new Map(shared.map(item => [item.menuItemId, item.quantity]));
      for (const item of summary) dishes.push([event.title, when(event.date), event.restaurantName, event.ownerName, status(event), item.name, item.quantity, sharedBy.get(item.menuItemId) || 0]);
      for (const person of people) for (const item of person.items) guests.push([event.title, when(event.date), person.name, person.seat, item.name, item.quantity, person.notes]);
      if (plan.mode !== 'off') {
        const bySeat = new Map(plan.people.filter(person => person.seatId).map(person => [person.seatId, person.name]));
        for (const table of plan.layout.tables) for (const seat of tableSeats(table)) if (bySeat.has(seat.id)) seating.push([event.title, when(event.date), table.label, seat.number, bySeat.get(seat.id)]);
        for (const person of plan.people.filter(person => !person.seatId)) seating.push([event.title, when(event.date), 'Без места', '', person.name]);
      }
      if (event.package) for (const item of event.package.items) packages.push([event.title, event.package.name, item.category, item.name, item.grams, item.grams * event.expectedGuests]);
    }
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'xlsx') return { body: workbook([{ name: 'Порции', rows: dishes }, { name: 'Гости', rows: guests }, { name: 'Рассадка', rows: seating }, { name: 'Пакеты', rows: packages }]), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName: `kitchen-${stamp}.xlsx` };
    const cell = value => `"${String(value ?? '').replace(/^[\s]*[=+@-]/, match => `'${match}`).replaceAll('"', '""')}"`;
    return { body: '\uFEFF' + [...dishes, [], ...guests, [], ...seating, [], ...packages].map(row => row.map(cell).join(';')).join('\r\n'), contentType: 'text/csv; charset=utf-8', fileName: `kitchen-${stamp}.csv` };
  }
  createKitchenExportLink(user, format, eventIds) {
    if (!['csv', 'xlsx'].includes(format)) throw new HttpError(400, 'Формат выгрузки: csv или xlsx.');
    this.kitchenExport(user, format, eventIds);
    const token = secret();
    this.db.prepare('DELETE FROM kitchen_download_tokens WHERE user_id=? OR expires_at<=?').run(user.id, Date.now());
    this.db.prepare('INSERT INTO kitchen_download_tokens (token_hash,user_id,format,expires_at,event_ids) VALUES (?,?,?,?,?)').run(digest(token), user.id, format, Date.now() + 60000, eventIds ? JSON.stringify(eventIds) : '');
    return { url: `${this.config.publicUrl}/api/v1/downloads/kitchen/${token}` };
  }
  consumeKitchenExportLink(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError(404, 'Ссылка на выгрузку недействительна. Создайте новую.');
    return this.transaction(() => {
      const grant = this.db.prepare('SELECT * FROM kitchen_download_tokens WHERE token_hash=? AND expires_at>?').get(digest(token), Date.now());
      const user = grant && this.db.prepare('SELECT * FROM users WHERE id=?').get(grant.user_id);
      if (!user || (user.demo && !this.config.demoEnabled)) throw new HttpError(404, 'Ссылка на выгрузку недействительна. Создайте новую.');
      this.db.prepare('DELETE FROM kitchen_download_tokens WHERE token_hash=?').run(grant.token_hash);
      return this.kitchenExport(this.hydrate(user), grant.format, grant.event_ids ? JSON.parse(grant.event_ids) : undefined);
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
    const hall = this.halls(event.restaurant_id).find(entry => entry.id === event.hall_id);
    const result = { mode: event.seating_mode, layout, seatCount: layoutSeats(layout).length, mySeat: people.find(person => person.key === key)?.seatId || null, occupied: people.filter(person => person.seatId).map(person => person.seatId), names: Object.fromEntries(people.filter(person => person.seatId).map(person => [person.seatId, person.name])) };
    const config = event.seating_config ? JSON.parse(event.seating_config) : hall?.seatingConfig;
    if (manager) { result.canCustomize = config?.type === 'flexible'; result.allowedModes = SEATING_CHOICES; result.tablePresets = config?.tablePresets || []; result.layoutPolicy = config?.type || 'fixed'; result.hallCapacity = hall?.capacity || 0; }
    if (manager) result.people = people;
    return result;
  }
  saveSeating(user, eventId, body) {
    return this.transaction(() => {
      const event = this.eventRow(eventId, user);
      if (!this.isManager(user, event)) throw new HttpError(403, 'Нет доступа к рассадке банкета.');
      if (event.status !== 'collecting') throw new HttpError(409, 'Рассадка закрыта после утверждения.');
      const hall = this.halls(event.restaurant_id).find(entry => entry.id === event.hall_id);
      const config = event.seating_config ? JSON.parse(event.seating_config) : hall?.seatingConfig;
      const mode = body.mode === undefined ? event.seating_mode : body.mode;
      if (!SEATING_MODES.includes(mode)) throw new HttpError(400, 'Режим рассадки: off, choice или fixed.');
      if (config?.type === 'fixed' && body.layout !== undefined) throw new HttpError(403, 'Ресторан закрепил расположение столов и стульев этого зала.');
      let layout = this.layoutOf(event);
      if (body.layout !== undefined) {
        const checked = validateLayout(body.layout);
        if (checked.error) throw new HttpError(400, checked.error);
        layout = checked.layout;
      }
      if (config?.type === 'flexible' && !layoutMatchesPresets(layout, config.tablePresets)) throw new HttpError(400, 'В схеме есть столы вне разрешённого рестораном набора размеров.');
      if (config?.type === 'flexible' && layoutSeats(layout).length > hall.capacity) throw new HttpError(400, 'Число стульев превышает вместимость зала.');
      const seatIds = new Set(layoutSeats(layout).map(seat => seat.id));
      const lost = this.db.prepare('SELECT seat_id FROM seat_assignments WHERE event_id=?').all(event.id).filter(row => !seatIds.has(row.seat_id));
      if (lost.length && mode !== 'off') {
        const old = this.layoutOf(event);
        throw new HttpError(409, `Нельзя убрать занятые места: ${lost.slice(0, 3).map(row => seatTitle(old, row.seat_id)).join('; ')}${lost.length > 3 ? ` и ещё ${lost.length - 3}` : ''}. Сначала пересадите гостей.`);
      }
      this.db.prepare('UPDATE events SET seating_mode=?,seating_layout=? WHERE id=?').run(mode, JSON.stringify(layout), event.id);
      if (mode === 'off') this.db.prepare('DELETE FROM seat_assignments WHERE event_id=?').run(event.id);
      return this.seating(user, this.eventRow(event.id, user), true);
    });
  }
  chooseSeat(user, eventId, body) {
    return this.transaction(() => {
      const event = this.eventRow(eventId, user);
      if (event.seating_mode !== 'choice') throw new HttpError(409, event.seating_mode === 'off' ? 'В этом банкете рассадка выключена.' : 'В этом банкете места распределяет организатор.');
      if (event.status !== 'collecting' || Date.parse(event.date) <= Date.now()) throw new HttpError(409, 'Выбор места для этого банкета закрыт.');
      if (!this.db.prepare('SELECT 1 FROM guests WHERE event_id=? AND user_id=?').get(event.id, user.id)) {
        if (!this.isOrganizer(user, event)) throw new HttpError(403, 'Сначала присоединитесь к банкету по приглашению.');
        this.db.prepare('INSERT INTO guests VALUES (?,?,0,?,?)').run(event.id, user.id, '', iso(Date.now()));
      }
      if (event.scope === 'live' && !this.isOrganizer(user, event) && (!user.phone_verified_at || !user.phone || !this.db.prepare('SELECT 1 FROM guest_invites WHERE event_id=? AND user_id=? AND phone=?').get(event.id, user.id, user.phone))) {
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
      if (event.seating_mode === 'off') throw new HttpError(409, 'Сначала включите рассадку.');
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
    if (detail.event.package) {
      rows.push([], ['Состав пакета', 'Грамм на гостя', 'Грамм на банкет']);
      for (const item of detail.event.package.items) rows.push([`${item.category}: ${item.name}`, item.grams, item.grams * event.expected_guests]);
    }
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
      return { url: `${this.config.publicUrl}/api/v1/downloads/${token}` };
    });
  }
  consumeExportLink(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError(404, 'Ссылка на выгрузку недействительна. Создайте новую.');
    return this.transaction(() => {
      const grant = this.db.prepare('SELECT * FROM download_tokens WHERE token_hash=? AND expires_at>?').get(digest(token), Date.now());
      if (!grant) throw new HttpError(404, 'Ссылка на выгрузку недействительна. Создайте новую.');
      const user = this.db.prepare('SELECT * FROM users WHERE id=?').get(grant.user_id);
      if (!user || (user.demo && !this.config.demoEnabled)) throw new HttpError(404, 'Ссылка на выгрузку недействительна. Создайте новую.');
      this.hydrate(user);
      const event = this.eventRow(grant.event_id, user);
      if (!this.isManager(user, event) || event.status !== 'approved' || event.revision !== grant.event_revision) throw new HttpError(404, 'Ссылка на выгрузку недействительна. Создайте новую.');
      const csv = this.exportCsv(user, event.id);
      this.db.prepare('DELETE FROM download_tokens WHERE token_hash=?').run(grant.token_hash);
      return csv;
    });
  }
}
