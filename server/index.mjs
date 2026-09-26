import { createServer } from 'node:http';
import { readFile, stat, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve, extname, sep, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { randomUUID } from 'node:crypto';
import { Store } from './store.mjs';
import { HttpError, verifyInitData, verifyMaxContact } from './auth.mjs';
import { createMaxBot } from './max-bot.mjs';
import { createNotifier } from './notifications.mjs';

export function readConfig(env = process.env) {
  const publicUrl = (env.PUBLIC_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const parsedUrl = new URL(publicUrl);
  if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) throw new Error('PUBLIC_URL must be an absolute HTTP(S) URL without credentials, query, or fragment');
  const maxDemoSpaces = Number(env.MAX_DEMO_SPACES || 1000);
  if (!Number.isSafeInteger(maxDemoSpaces) || maxDemoSpaces < 1 || maxDemoSpaces > 100000) throw new Error('MAX_DEMO_SPACES must be an integer from 1 to 100000');
  return {
    port: Number(env.PORT || 3000), host: env.HOST || '0.0.0.0', databasePath: env.DATABASE_PATH || 'data/banquet.sqlite', uploadDir: resolve(env.UPLOAD_DIR || join(dirname(env.DATABASE_PATH || 'data/banquet.sqlite'), 'uploads')), publicUrl,
    botToken: env.MAX_BOT_TOKEN || '', botUsername: (env.MAX_BOT_USERNAME || '').replace(/^@/, ''),
    maxWebhookSecret: env.MAX_WEBHOOK_SECRET || '', maxApiUrl: env.MAX_API_URL || 'https://platform-api2.max.ru',
    restaurantAdminIds: (env.RESTAURANT_ADMIN_IDS || '').split(',').map(value => value.trim()).filter(Boolean),
    openOrganizerSignup: env.OPEN_ORGANIZER_SIGNUP === 'true',
    demoEnabled: (env.DEMO_ENABLED || 'true') === 'true', distPath: resolve(env.DIST_PATH || 'dist'),
    trustProxy: env.TRUST_PROXY === 'true', maxDemoSpaces, authRateLimit: 180,
  };
}

export function clientIp(req, trustProxy = false) {
  // Enable only behind the configured reverse proxy, which overwrites this header.
  // Docker publishes the application on loopback; its socket peer can be a bridge IP.
  const forwarded = req.headers['x-real-ip'];
  if (trustProxy && typeof forwarded === 'string' && isIP(forwarded)) return forwarded;
  return req.socket.remoteAddress || 'unknown';
}

async function readBody(req) {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Нужен Content-Type: application/json.');
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 65536) throw new HttpError(413, 'Запрос слишком большой.');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw new HttpError(400, 'Некорректный JSON.'); }
}

async function readImage(req) {
  const mime = String(req.headers['content-type'] || '').toLowerCase().split(';')[0];
  const types = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  if (!types[mime]) throw new HttpError(415, 'Поддерживаются JPEG, PNG и WebP.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 3 * 1024 * 1024) throw new HttpError(413, 'Фото должно быть не больше 3 МБ.');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (bytes.length < 12 || !(mime === 'image/jpeg' && jpeg || mime === 'image/png' && png || mime === 'image/webp' && webp)) throw new HttpError(400, 'Содержимое файла не соответствует формату фото.');
  return { bytes, extension: types[mime] };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

export function createApp(options = {}) {
  const config = { ...readConfig(), ...options };
  const store = new Store(config);
  const bot = createMaxBot({ token: config.botToken, username: config.botUsername, webhookSecret: config.maxWebhookSecret, publicUrl: config.publicUrl, apiUrl: config.maxApiUrl }, { claimUpdate: key => store.claimMaxUpdate(key), fetchImpl: options.maxFetchImpl });
  const notifier = createNotifier(store, config, { fetchImpl: options.maxFetchImpl });
  const authWindows = new Map();
  const housekeeping = setInterval(() => { store.cleanup(); for (const [key, value] of authWindows) if (value.expires < Date.now()) authWindows.delete(key); }, 3600000);
  housekeeping.unref();
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://st.max.ru https://dev.max.ru; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-ancestors 'self' https://*.max.ru https://max.ru; base-uri 'self'; form-action 'self'");
    const json = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = decodeURIComponent(url.pathname);
      if (path === '/healthz' && req.method === 'GET') {
        store.db.prepare('SELECT 1').get();
        return json({ status: 'ok' });
      }
      if (!path.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Метод не поддерживается.');
        const staticPath = resolve(config.distPath, `.${path}`);
        if (staticPath !== config.distPath && !staticPath.startsWith(config.distPath + sep)) throw new HttpError(404, 'Страница не найдена.');
        let filePath = staticPath;
        let info;
        try { info = await stat(filePath); } catch {}
        if (!info?.isFile()) {
          if (extname(path)) throw new HttpError(404, 'Файл не найден.');
          filePath = resolve(config.distPath, 'index.html');
        }
        let file;
        try { file = await readFile(filePath); } catch { throw new HttpError(404, 'Интерфейс ещё не собран. Запустите npm run build.'); }
        res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream', 'Cache-Control': filePath.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache' });
        return res.end(req.method === 'HEAD' ? undefined : file);
      }
      if (path === '/api/config' && req.method === 'GET') return json({ demoEnabled: config.demoEnabled, maxConfigured: Boolean(config.botToken), botUsername: config.botUsername });
      if (path === '/api/max/webhook' && req.method === 'POST') {
        if (!bot.enabled) throw new HttpError(503, 'MAX-бот ещё не настроен.');
        if (!bot.verifyWebhookSecret(req.headers['x-max-bot-api-secret'])) throw new HttpError(401, 'Некорректный секрет вебхука.');
        const update = await readBody(req);
        if (update.update_type === 'bot_started' || update.update_type === 'bot_stopped') store.recordBotActivity(update.user?.user_id, update.update_type === 'bot_started');
        if (update.update_type === 'message_created' && update.message?.recipient?.chat_type === 'dialog') store.recordBotActivity(update.message?.sender?.user_id, true);
        const result = await bot.handleWebhook({ secretHeader: req.headers['x-max-bot-api-secret'], update });
        return json(result.body, result.status);
      }
      if (path.startsWith('/api/auth/') && req.method === 'POST') {
        const ip = clientIp(req, config.trustProxy);
        let window = authWindows.get(ip);
        if (!window || window.expires < Date.now()) {
          if (!window && authWindows.size >= 10000) {
            for (const [key, entry] of authWindows) if (entry.expires < Date.now()) authWindows.delete(key);
            if (authWindows.size >= 10000) throw new HttpError(429, 'Сервис занят. Попробуйте позже.');
          }
          window = { count: 0, expires: Date.now() + 600000 }; authWindows.set(ip, window);
        }
        if (++window.count > config.authRateLimit) {
          res.setHeader('Retry-After', String(Math.max(1, Math.ceil((window.expires - Date.now()) / 1000))));
          throw new HttpError(429, 'Слишком много попыток входа. Попробуйте позже.');
        }
        const body = await readBody(req);
        if (path === '/api/auth/max') return json(store.loginMax(verifyInitData(body.initData, config.botToken)));
        if (path === '/api/auth/demo') return json(store.loginDemo(body));
        throw new HttpError(404, 'Метод API не найден.');
      }
      let match;
      if ((match = path.match(/^\/api\/invites\/([^/]+)$/)) && req.method === 'GET') return json(store.invite(match[1]));
      if ((match = path.match(/^\/api\/media\/([a-f0-9-]{36}\.(?:jpg|png|webp))$/)) && req.method === 'GET') {
        const file = await readFile(join(config.uploadDir, match[1])).catch(() => { throw new HttpError(404, 'Фото не найдено.'); });
        res.writeHead(200, { 'Content-Type': { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[extname(match[1]).slice(1)], 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
        return res.end(file);
      }
      if ((match = path.match(/^\/api\/downloads\/([^/]+)$/)) && req.method === 'GET') {
        const csv = store.consumeExportLink(match[1]);
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="banquet-kitchen.csv"', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow, noarchive' });
        return res.end(csv);
      }
      const authorization = req.headers.authorization || '';
      const user = store.authenticate(authorization.startsWith('Bearer ') ? authorization.slice(7) : '');
      if (path === '/api/me' && req.method === 'GET') return json(store.publicUser(user));
      if (path === '/api/me/phone' && req.method === 'PUT') return json(store.bindPhone(user, verifyMaxContact(await readBody(req), user.external_id, config.botToken)));
      if (path === '/api/me/claim-invitations' && req.method === 'POST') return json(store.transaction(() => store.claimInvitations(user)));
      if (path === '/api/me/notifications' && req.method === 'PUT') return json(store.setNotifications(user, (await readBody(req)).enabled));
      if (path === '/api/media' && req.method === 'POST') {
        if (user.role === 'guest') throw new HttpError(403, 'Загружать фото может организатор или ресторан.');
        const { bytes, extension } = await readImage(req);
        const fileName = `${randomUUID()}.${extension}`;
        await mkdir(config.uploadDir, { recursive: true, mode: 0o700 });
        await writeFile(join(config.uploadDir, fileName), bytes, { flag: 'wx', mode: 0o600 });
        try { store.registerMedia(user, fileName); }
        catch (error) { await rm(join(config.uploadDir, fileName), { force: true }); throw error; }
        return json({ photoUrl: `/api/media/${fileName}` }, 201);
      }
      if (path === '/api/restaurants' && req.method === 'GET') return json(store.restaurants(user));
      if (path === '/api/events' && req.method === 'GET') return json(store.events(user));
      if (path === '/api/events' && req.method === 'POST') { const body = await readBody(req); return json(store.transaction(() => store.createEvent(user, body)), 201); }
      if ((match = path.match(/^\/api\/events\/([^/]+)$/)) && req.method === 'GET') return json(store.detail(user, match[1]));
      if ((match = path.match(/^\/api\/events\/([^/]+)$/)) && req.method === 'PATCH') return json(store.editEvent(user, match[1], await readBody(req)));
      if ((match = path.match(/^\/api\/events\/([^/]+)\/guests$/)) && req.method === 'POST') return json(store.addInvite(user, match[1], await readBody(req)), 201);
      if ((match = path.match(/^\/api\/events\/([^/]+)\/guests\/([^/]+)$/)) && req.method === 'PATCH') return json(store.editInvite(user, match[1], match[2], await readBody(req)));
      if ((match = path.match(/^\/api\/events\/([^/]+)\/guests\/([^/]+)$/)) && req.method === 'DELETE') return json(store.deleteInvite(user, match[1], match[2]));
      if ((match = path.match(/^\/api\/events\/([^/]+)\/menu(?:\/([^/]+))?$/)) && ((req.method === 'PATCH' && match[2]) || (req.method === 'POST' && !match[2]))) return json(store.editEventMenu(user, match[1], match[2], await readBody(req)), req.method === 'POST' ? 201 : 200);
      if ((match = path.match(/^\/api\/events\/([^/]+)\/menu\/([^/]+)$/)) && req.method === 'DELETE') return json(store.deleteEventMenu(user, match[1], match[2]));
      if (path === '/api/kitchen' && req.method === 'GET') return json(store.kitchen(user));
      if (path === '/api/organizers' && req.method === 'GET') return json(store.organizers(user));
      if (path === '/api/organizers' && req.method === 'POST') return json(store.addOrganizer(user, await readBody(req)), 201);
      if ((match = path.match(/^\/api\/organizers\/([^/]+)$/)) && req.method === 'DELETE') return json(store.deleteOrganizer(user, match[1]));
      if ((match = path.match(/^\/api\/events\/([^/]+)\/shared$/)) && req.method === 'PUT') return json(store.saveShared(user, match[1], await readBody(req)));
      if ((match = path.match(/^\/api\/events\/([^/]+)\/menu\/import$/)) && req.method === 'POST') return json(store.importMenu(user, match[1], await readBody(req)));
      if ((match = path.match(/^\/api\/events\/([^/]+)\/seating$/)) && req.method === 'PUT') return json(store.saveSeating(user, match[1], await readBody(req)));
      if ((match = path.match(/^\/api\/events\/([^/]+)\/seating\/assignments$/)) && req.method === 'PUT') return json(store.assignSeat(user, match[1], await readBody(req)));
      if ((match = path.match(/^\/api\/events\/([^/]+)\/seating\/auto$/)) && req.method === 'POST') return json(store.autoSeat(user, match[1]));
      if ((match = path.match(/^\/api\/events\/([^/]+)\/seat$/)) && req.method === 'PUT') return json(store.chooseSeat(user, match[1], await readBody(req)));
      if ((match = path.match(/^\/api\/events\/([^/]+)\/export-link$/)) && req.method === 'POST') return json(store.createExportLink(user, match[1]));
      if ((match = path.match(/^\/api\/invites\/([^/]+)\/join$/)) && req.method === 'POST') return json(store.transaction(() => store.join(user, match[1])));
      if ((match = path.match(/^\/api\/events\/([^/]+)\/selection$/)) && req.method === 'PUT') return json(store.saveSelection(user, match[1], await readBody(req)));
      if ((match = path.match(/^\/api\/events\/([^/]+)\/approve$/)) && req.method === 'POST') {
        const body = Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding'] ? await readBody(req) : {};
        return json(store.approve(user, match[1], body));
      }
      if ((match = path.match(/^\/api\/restaurants\/([^/]+)\/menu(?:\/([^/]+))?$/)) && ((req.method === 'PATCH' && match[2]) || (req.method === 'POST' && !match[2]))) return json(store.editMenu(user, match[1], match[2], await readBody(req)), req.method === 'POST' ? 201 : 200);
      if ((match = path.match(/^\/api\/restaurants\/([^/]+)\/menu\/([^/]+)$/)) && req.method === 'DELETE') return json(store.deleteMenu(user, match[1], match[2]));
      if ((match = path.match(/^\/api\/events\/([^/]+)\/export\.csv$/)) && req.method === 'GET') {
        const csv = store.exportCsv(user, match[1]);
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="banquet-kitchen.csv"', 'Cache-Control': 'no-store' });
        return res.end(csv);
      }
      throw new HttpError(404, 'Метод API не найден.');
    } catch (error) {
      if (error instanceof URIError) return json({ error: 'Некорректный URL.' }, 400);
      if (!error.status) console.error('Request failed:', error.message);
      if (!res.headersSent) json({ error: error.status ? error.message : 'Не удалось выполнить запрос. Попробуйте ещё раз.' }, error.status || 500);
      else res.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.on('close', () => { clearInterval(housekeeping); notifier.stop(); store.close(); });
  if (!options.disableNotifications) server.on('listening', () => notifier.start());
  return { server, store, config };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp();
  app.server.listen(app.config.port, app.config.host, () => console.log(`За столом: http://${app.config.host}:${app.config.port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.server.close(() => process.exit(0)));
}
