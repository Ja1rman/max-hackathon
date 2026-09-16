import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const digest = value => createHash('sha256').update(value).digest('hex');

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
