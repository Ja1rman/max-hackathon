import { maxApiRequest, miniAppLink } from './max-bot.mjs';

const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function content(job) {
  const name = `«${job.title}»`;
  if (job.kind === 'reminder') {
    if (job.event_status !== 'collecting' || job.guest_submitted || Date.parse(job.deadline) <= Date.now()) return null;
    return `Напоминание о банкете ${name}: выберите блюда до ${new Date(job.deadline).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}.`;
  }
  if (job.kind === 'approved') return job.event_status === 'approved' ? `Заказ для банкета ${name} утверждён. Ваш выбор сохранён.` : null;
  if (job.kind === 'restaurant_approved') return job.event_status === 'approved' ? `Утверждён заказ для банкета ${name}. Откройте сводку кухни в приложении.` : null;
  if (job.kind.startsWith('event_changed:')) return job.event_status === 'collecting' ? `Организатор обновил банкет ${name}. Проверьте дату и меню в приложении.` : null;
  if (job.kind.startsWith('guest_joined:')) return job.event_status === 'collecting' ? `Новый гость присоединился к банкету ${name}.` : null;
  if (job.kind.startsWith('selection:')) return job.event_status === 'collecting' ? `Гость обновил выбор блюд для банкета ${name}. Проверьте общую сумму.` : null;
  return null;
}

/** Delivers only to people who enabled notices and have an active bot dialog. */
export function createNotifier(store, config, { fetchImpl, logger = console } = {}) {
  let running = false;
  let interval;
  const run = async () => {
    if (running || !config.botToken || !config.botUsername) return;
    running = true;
    try {
      for (const job of store.dueNotices()) {
        const text = content(job);
        if (!text) { store.cancelNotice(job.id); continue; }
        if (!store.claimNotice(job.id)) continue;
        try {
          const url = miniAppLink(config.botUsername, job.kind === 'reminder' ? job.invite_code : job.event_id);
          await maxApiRequest({ token: config.botToken, apiUrl: config.maxApiUrl }, `/messages?user_id=${job.external_id}`, {
            method: 'POST', fetchImpl,
            body: { text, notify: true, attachments: [{ type: 'inline_keyboard', payload: { buttons: [[{ type: 'link', text: 'Открыть банкет', url }]] } }] },
          });
          store.finishNotice(job.id, true);
        } catch (error) {
          store.finishNotice(job.id, false);
          logger.error?.('MAX notification delivery failed', { kind: job.kind, code: error.code || 'internal_error' });
        }
        await pause(550); // MAX permits at most two messages per second per dialog.
      }
    } finally { running = false; }
  };
  return {
    run,
    start() { interval = setInterval(() => run().catch(error => logger.error?.('Notification worker failed', { code: error.code || 'internal_error' })), 30_000); interval.unref(); run().catch(error => logger.error?.('Notification worker failed', { code: error.code || 'internal_error' })); },
    stop() { if (interval) clearInterval(interval); },
  };
}
