import { createHash, timingSafeEqual } from 'node:crypto';

const API_TIMEOUT_MS = 8_000;
const API_RESPONSE_LIMIT = 64 * 1024;
const PAYLOAD_PATTERN = /^[A-Za-z0-9_-]{1,512}$/;
const USERNAME_PATTERN = /^[A-Za-z0-9_]{1,64}$/;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{5,256}$/;

export function readMaxConfig(env = process.env) {
  return {
    token: env.MAX_BOT_TOKEN?.trim() || '',
    username: env.MAX_BOT_USERNAME?.trim().replace(/^@/, '') || '',
    webhookSecret: env.MAX_WEBHOOK_SECRET?.trim() || '',
    publicUrl: env.PUBLIC_URL || 'https://mail.lonelycraft.ru/banquet',
    apiUrl: env.MAX_API_URL || 'https://platform-api2.max.ru',
  };
}

export function normalizeHttpsUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute HTTPS URL`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} must be HTTPS without credentials, query or fragment`);
  }
  return url.toString().replace(/\/+$/, '');
}

export function miniAppLink(username, payload) {
  const name = String(username || '').replace(/^@/, '');
  if (!USERNAME_PATTERN.test(name)) throw new Error('MAX_BOT_USERNAME is invalid');
  return `https://max.ru/${name}?startapp${typeof payload === 'string' && PAYLOAD_PATTERN.test(payload) ? `=${payload}` : ''}`;
}

export function verifyMaxWebhookSecret(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || !expected) return false;
  const supplied = Buffer.from(actual);
  const configured = Buffer.from(expected);
  return supplied.length === configured.length && timingSafeEqual(supplied, configured);
}

export class MaxApiError extends Error {
  constructor(code, status = null) {
    super(`MAX API request failed: ${code}${status ? ` (HTTP ${status})` : ''}`);
    this.name = 'MaxApiError';
    this.code = code;
    this.status = status;
  }
}

// Tokens and response bodies deliberately never appear in errors or logs.
export async function maxApiRequest(config, path, { method = 'GET', body, fetchImpl = globalThis.fetch } = {}) {
  if (!config.token) throw new MaxApiError('not_configured');
  const base = normalizeHttpsUrl(config.apiUrl || 'https://platform-api2.max.ru', 'MAX_API_URL');
  if (!path.startsWith('/') || path.startsWith('//')) throw new MaxApiError('invalid_path');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers: { Authorization: config.token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new MaxApiError('http_error', response.status);
    }
    const chunks = [];
    let size = 0;
    if (response.body) {
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > API_RESPONSE_LIMIT) {
          controller.abort();
          throw new MaxApiError('response_too_large');
        }
        chunks.push(Buffer.from(chunk));
      }
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new MaxApiError('invalid_response');
    }
  } catch (error) {
    if (error instanceof MaxApiError) throw error;
    throw new MaxApiError(controller.signal.aborted ? 'timeout' : 'network_error');
  } finally {
    clearTimeout(timer);
  }
}

function userId(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  return typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) ? value : null;
}

function describeUpdate(update) {
  if (!update || typeof update !== 'object' || Array.isArray(update)) return null;
  if (update.update_type === 'bot_started') {
    const recipient = userId(update.user?.user_id);
    if (!recipient || update.user?.is_bot || !Number.isSafeInteger(update.timestamp) || update.timestamp <= 0) return null;
    return {
      recipient,
      payload: update.payload,
      identity: ['bot_started', recipient, update.chat_id ?? '', update.timestamp, update.payload ?? ''],
    };
  }
  if (update.update_type === 'message_created') {
    const message = update.message;
    const recipient = userId(message?.sender?.user_id);
    const mid = message?.body?.mid;
    // Group conversations and bot messages must not generate automatic replies.
    if (!recipient || message.sender.is_bot || message.recipient?.chat_type !== 'dialog') return null;
    if (typeof mid !== 'string' || !mid || mid.length > 512) return null;
    return { recipient, identity: ['message_created', mid] };
  }
  return null;
}

/**
 * The caller must persist claimUpdate(key) with an atomic unique insert.
 * Claim before delivery provides at-most-once welcome replies, including across
 * process restarts. An ambiguous delivery failure is not automatically resent.
 */
export function createMaxBot(config = readMaxConfig(), { claimUpdate, logger = console, fetchImpl } = {}) {
  const username = String(config.username || '').replace(/^@/, '');
  const enabled = Boolean(config.token && USERNAME_PATTERN.test(username) && SECRET_PATTERN.test(config.webhookSecret || ''));
  if (enabled && typeof claimUpdate !== 'function') throw new TypeError('MAX webhook requires persistent claimUpdate(key)');

  return {
    enabled,
    verifyWebhookSecret: (value) => enabled && verifyMaxWebhookSecret(value, config.webhookSecret),
    async handleWebhook({ secretHeader, update }) {
      if (!enabled) return { status: 503, body: { error: 'max_not_configured' } };
      if (!verifyMaxWebhookSecret(secretHeader, config.webhookSecret)) return { status: 401, body: { error: 'unauthorized' } };
      const event = describeUpdate(update);
      if (!event) return { status: 200, body: { ok: true, ignored: true } };
      const key = createHash('sha256').update(JSON.stringify(event.identity)).digest('hex');
      let claimed;
      try {
        claimed = await claimUpdate(key);
      } catch {
        logger.error?.('MAX webhook deduplication store is unavailable');
        return { status: 503, body: { error: 'temporarily_unavailable' } };
      }
      if (!claimed) return { status: 200, body: { ok: true, duplicate: true } };
      try {
        await maxApiRequest(config, `/messages?user_id=${event.recipient}`, {
          method: 'POST',
          fetchImpl,
          body: {
            text: 'Банкет с выбором для каждого гостя.\n\nОрганизатор создаёт мероприятие и отправляет приглашение. Гости выбирают блюда, а ресторан получает точные количества после утверждения заказа.\n\nОткройте приложение, чтобы продолжить.',
            attachments: [{ type: 'inline_keyboard', payload: { buttons: [[{ type: 'link', text: 'Открыть банкет', url: miniAppLink(username, event.payload) }]] } }],
          },
        });
      } catch (error) {
        logger.error?.(`MAX welcome delivery failed (${error instanceof MaxApiError ? error.code : 'internal_error'}); automatic retry suppressed`);
      }
      return { status: 200, body: { ok: true } };
    },
  };
}
