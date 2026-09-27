export const NOTIFICATION_CATEGORIES = [
  { key: 'guestJoined', label: 'Новый гость', description: 'Когда гость присоединяется к моему банкету.' },
  { key: 'guestSelection', label: 'Выбор блюд гостем', description: 'Когда гость отправляет или обновляет свой заказ.' },
  { key: 'eventChanges', label: 'Изменения банкета', description: 'Когда меняются дата, условия или меню моего банкета.' },
  { key: 'reminders', label: 'Напоминания', description: 'О сроке выбора блюд, если я ещё не ответил.' },
  { key: 'orderApproved', label: 'Утверждение заказа', description: 'Когда заказ моего банкета утверждён.' },
  { key: 'kitchenOrders', label: 'Заказ для кухни', description: 'Когда утверждён заказ банкета моего ресторана.' },
];

export const DEFAULT_NOTIFICATION_PREFERENCES = Object.fromEntries(NOTIFICATION_CATEGORIES.map(({ key }) => [key, true]));

export function notificationCategory(kind) {
  if (kind.startsWith('guest_joined:')) return 'guestJoined';
  if (kind.startsWith('selection:')) return 'guestSelection';
  if (kind.startsWith('event_changed:')) return 'eventChanges';
  if (kind === 'reminder') return 'reminders';
  if (kind === 'approved') return 'orderApproved';
  if (kind === 'restaurant_approved') return 'kitchenOrders';
  return null;
}
