import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const digest = value => createHash('sha256').update(value).digest('hex');

export function normalizePhone(value) {
  if (typeof value !== 'string' || !/^\+?[0-9 ()-]{10,24}$/.test(value)) throw new HttpError(400, 'Укажите корректный номер телефона.');
  let digits = value.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (!/^[1-9][0-9]{9,14}$/.test(digits)) throw new HttpError(400, 'Укажите номер в международном формате.');
  return digits;
}

/** https://dev.max.ru/docs/webapps/bridge#windowwebapprequestcontact */
export function verifyMaxContact(contact, userId, botToken, { now = Date.now(), maxAgeMs = 10 * 60_000 } = {}) {
  if (!botToken) throw new HttpError(503, 'Подтверждение телефона MAX не настроено.');
  if (!contact || typeof contact !== 'object' || Array.isArray(contact) ||
      typeof contact.phone !== 'string' || typeof contact.authDate !== 'string' ||
      !/^[a-fA-F0-9]{64}$/.test(contact.hash || '') || !/^[1-9][0-9]{0,18}$/.test(String(userId))) {
    throw new HttpError(401, 'MAX не подтвердил номер телефона.');
  }
  const phone = normalizePhone(contact.phone);
  const rawTime = contact.authDate;
  const numericTime = /^\d{10,13}$/.test(rawTime) ? Number(rawTime) : NaN;
  const time = Number.isSafeInteger(numericTime)
    ? (numericTime < 1e12 ? numericTime * 1000 : numericTime)
    : Date.parse(rawTime);
  if (!Number.isFinite(time) || time > now + 30_000 || time < now - maxAgeMs) {
    throw new HttpError(401, 'Подтверждение номера устарело. Запросите номер ещё раз.');
  }
  const data = `authDate=${rawTime}\nphone=${phone}\nuserId=${userId}`;
  const expected = createHmac('sha256', botToken).update(data).digest();
  if (!timingSafeEqual(expected, Buffer.from(contact.hash, 'hex'))) throw new HttpError(401, 'MAX не подтвердил номер телефона.');
  return phone;
}

/** MAX specification: https://dev.max.ru/docs/webapps/validation */
export function verifyInitData(initData, botToken, { now = Date.now(), maxAge = 3600 } = {}) {
  if (!botToken) throw new HttpError(503, 'Вход через MAX ещё не настроен.');
  if (typeof initData !== 'string' || !initData || initData.length > 16384) {
    throw new HttpError(401, 'Некорректные данные входа MAX.');
  }
  const params = new URLSearchParams(initData);
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) throw new HttpError(401, 'Повторяющиеся параметры MAX.');
  const hash = params.get('hash');
  if (!hash || !/^[a-fA-F0-9]{64}$/.test(hash)) throw new HttpError(401, 'Некорректная подпись MAX.');
  params.delete('hash');
  const data = [...params].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(data).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) throw new HttpError(401, 'Подпись MAX не прошла проверку.');
  const timestamp = Number(params.get('auth_date'));
  const nowSeconds = Math.floor(now / 1000);
  if (!params.get('auth_date') || !Number.isSafeInteger(timestamp) || timestamp > nowSeconds + 30 || timestamp < nowSeconds - maxAge) {
    throw new HttpError(401, 'Сессия запуска MAX устарела. Откройте мини-приложение заново.');
  }
  let user;
  try { user = JSON.parse(params.get('user')); } catch { throw new HttpError(401, 'Некорректный пользователь MAX.'); }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.first_name !== 'string' || !user.first_name.trim()) {
    throw new HttpError(401, 'Некорректный пользователь MAX.');
  }
  return {
    id: String(user.id),
    name: [user.first_name, typeof user.last_name === 'string' ? user.last_name : ''].filter(Boolean).join(' ').slice(0, 160),
  };
}
