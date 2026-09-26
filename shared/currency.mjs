// Guest-facing currency. Rubles stay the settlement unit; guests only see pie slices (food)
// and bottles (drinks). Rates are in kopecks per unit.

export const DRINKS_CATEGORY = 'Напитки';
export const UNIT_RATES = { pie: 1000, bottle: 10000 }; // 1 кусочек = 10 ₽, 1 бутылочка = 100 ₽

export const unitOf = item => (item?.category === DRINKS_CATEGORY ? 'bottle' : 'pie');

export const toUnits = (kopecks, unit) => kopecks / UNIT_RATES[unit];

const FORMS = {
  pie: ['кусочек пирога', 'кусочка пирога', 'кусочков пирога'],
  bottle: ['бутылочка', 'бутылочки', 'бутылочек'],
};

function plural(value, [one, few, many]) {
  if (!Number.isInteger(value)) return few; // «2,5 бутылочки», «0,5 кусочка пирога»
  const mod10 = value % 10, mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Number shown to guests: up to two decimals, Russian separators. */
export function unitNumber(value) {
  const rounded = Math.round(value * 100) / 100;
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(rounded);
}

/** «60 кусочков пирога», «2,5 бутылочки». */
export function formatUnits(kopecks, unit, { short = false } = {}) {
  const value = Math.round(toUnits(kopecks, unit) * 100) / 100;
  if (short) return `${unitNumber(value)} ${unit === 'bottle' ? '🍾' : '🥧'}`;
  return `${unitNumber(value)} ${plural(value, FORMS[unit])}`;
}

/** Spent amounts split by unit for a list of { price, quantity, category }. */
export function spentByUnit(entries) {
  const spent = { pie: 0, bottle: 0 };
  for (const entry of entries) spent[unitOf(entry)] += entry.price * entry.quantity;
  return spent;
}
