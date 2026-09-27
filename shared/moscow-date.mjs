export function parseRussianDateTime(value) {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})\s+([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || '').trim());
  if (!match) return '';
  const [, day, month, year, hour, minute] = match;
  const calendar = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (calendar.getUTCFullYear() !== Number(year) || calendar.getUTCMonth() !== Number(month) - 1 || calendar.getUTCDate() !== Number(day)) return '';
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function formatRussianDateTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(value || ''));
  return match ? `${match[3]}.${match[2]}.${match[1]} ${match[4]}:${match[5]}` : '';
}

export function moscowDateTimeIso(value) {
  const local = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(value || '')) ? value : parseRussianDateTime(value);
  if (!local) throw new Error('Введите дату и время в формате ДД.ММ.ГГГГ ЧЧ:ММ.');
  return new Date(`${local}:00+03:00`).toISOString();
}
