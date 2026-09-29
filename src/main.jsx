import React, { useEffect, useState, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  ArrowUp,
  ArrowLeft,
  Check,
  CheckCheck,
  ChefHat,
  ChevronDown,
  ChevronRight,
  Clock3,
  Copy,
  Download,
  Leaf,
  Link2,
  LoaderCircle,
  LogOut,
  Menu as MenuIcon,
  Minus,
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  Utensils,
  CalendarDays,
  Wallet,
  X,
  CircleHelp,
  CheckCircle2,
  Bell,
  FileSpreadsheet,
  MessageCircle,
  Pencil,
  Search,
  Store,
  Star,
  UserRound,
} from "lucide-react";
import "./styles.css";
import EventPhotoField from './EventPhotoField.jsx';
import { MENU_LABELS } from '../shared/menu-labels.mjs';
import { generateLayout, layoutSeats } from '../shared/seating.mjs';
import { formatRussianDateTime, parseRussianDateTime, moscowDateTimeIso } from '../shared/moscow-date.mjs';
import { formatUnits, spentByUnit, unitOf } from '../shared/currency.mjs';
const units = (kopecks, unit) => formatUnits(kopecks, unit, { short: true });
import { SEATING_MODE_NAMES, SeatPicker, SeatingAdmin, SeatingOverview, SeatingMap, HallLayoutDesigner } from './seating.jsx';
import { ConfirmHost, ask } from './confirm.jsx';
import { DEFAULT_NOTIFICATION_PREFERENCES, NOTIFICATION_CATEGORIES } from '../shared/notification-categories.mjs';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const money = (value = 0) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(value / 100);
const portionWord = count => ({ one: 'порция', few: 'порции', many: 'порций', other: 'порции' })[new Intl.PluralRules('ru-RU').select(count)];
const dateText = (value, time = false) =>
  value
    ? new Date(value).toLocaleString("ru-RU", {
        timeZone: 'Europe/Moscow',
        day: "numeric",
        month: "long",
        ...(time ? { hour: "2-digit", minute: "2-digit" } : {}),
      })
    : "Не указано";
const roleNames = {
  organizer: "Организатор",
  guest: "Гость",
  restaurant: "Администратор ресторана",
  admin: "Администратор",
};
let authToken = sessionStorage.getItem("banquet-token") || "";
async function api(path, options = {}) {
  let response;
  for (let attempt = 0; attempt < ((options.method || 'GET') === 'GET' ? 3 : 1); attempt++) {
    try {
      response = await fetch(`${BASE}/api/v1${path}`, {
        ...options,
        headers: { "Content-Type": "application/json", ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), ...options.headers },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      break;
    } catch {
      if (attempt === 2 || (options.method || 'GET') !== 'GET') throw new Error('Нет связи с сервисом. Проверьте интернет и повторите действие.');
      await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)));
    }
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.error || `Не удалось выполнить запрос (${response.status}).`);
  return data;
}
function russianError(value) {
  const message = typeof value === 'string' ? value : value?.message || '';
  return /[А-Яа-яЁё]/.test(message) ? message : 'Не удалось выполнить действие. Попробуйте ещё раз.';
}
const alwaysOpen = windows => windows?.length === 7 && new Set(windows.map(window => window.weekday)).size === 7 && windows.every(window => window.start === '00:00' && window.end === '24:00');
function durationOptions(hall, localValue) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localValue || '');
  if (!hall || !parts) return [];
  if (alwaysOpen(hall.windows)) return Array.from({ length: 12 }, (_, index) => index + 1);
  const weekday = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))).getUTCDay();
  const start = Number(parts[4]) * 60 + Number(parts[5]);
  const end = Math.max(0, ...hall.windows.filter(window => window.weekday === weekday && Number(window.start.slice(0, 2)) * 60 + Number(window.start.slice(3)) <= start && start < Number(window.end.slice(0, 2)) * 60 + Number(window.end.slice(3))).map(window => Number(window.end.slice(0, 2)) * 60 + Number(window.end.slice(3))));
  return Array.from({ length: Math.min(12, Math.floor((end - start) / 60)) }, (_, index) => index + 1);
}
function bookingDurationOptions(hall, localValue, selected) {
  const available = durationOptions(hall, localValue);
  const widestWindow = Math.max(0, ...(hall?.windows || []).map(window => (Number(window.end.slice(0, 2)) * 60 + Number(window.end.slice(3)) - Number(window.start.slice(0, 2)) * 60 - Number(window.start.slice(3))) / 60));
  const options = available.length ? available : Array.from({ length: Math.min(12, Math.floor(widestWindow)) }, (_, index) => index + 1);
  return selected && !options.includes(selected) ? [...options, selected].sort((a, b) => a - b) : options;
}
async function uploadImage(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error('Выберите JPEG, PNG или WebP до 10 МБ.');
  const response = await fetch(`${BASE}/api/v1/media`, { method: 'POST', headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': file.type }, body: file }).catch(() => { throw new Error('Нет связи с сервисом. Попробуйте загрузить фото ещё раз.'); });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Не удалось загрузить фото.');
  return result;
}
/** Phone input value → "+7 (999) 123-45-67" for Russian numbers, "+<digits>" otherwise. */
function formatPhone(value) {
  let digits = String(value || "").replace(/\D/g, "").slice(0, 15);
  if (!digits) return "";
  if (digits[0] === "8") digits = "7" + digits.slice(1);
  if (digits[0] === "9") digits = "7" + digits;
  if (digits[0] !== "7") return "+" + digits;
  const d = digits.slice(1, 11);
  let out = "+7";
  if (d.length) out += " (" + d.slice(0, 3);
  if (d.length >= 3) out += ")";
  if (d.length > 3) out += " " + d.slice(3, 6);
  if (d.length > 6) out += "-" + d.slice(6, 8);
  if (d.length > 8) out += "-" + d.slice(8, 10);
  return out;
}
const PHONE_PATTERN = "\\+7 \\(\\d{3}\\) \\d{3}-\\d{2}-\\d{2}|\\+[1-69]\\d{9,14}";
function PhoneInput({ value, onChange, ...props }) {
  return (
    <input
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      placeholder="+7 (999) 123-45-67"
      maxLength={18}
      pattern={PHONE_PATTERN}
      title="Номер в формате +7 (999) 123-45-67 или международный с кодом страны"
      value={value}
      onChange={(e) => onChange(formatPhone(e.target.value))}
      {...props}
    />
  );
}
async function saveDownload(response, fallbackName) {
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Не удалось скачать файл");
  const name = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] || fallbackName;
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function downloadResponse(path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await fetch(`${BASE}/api/v1${path}`, { headers: { Authorization: `Bearer ${authToken}` } }); }
    catch {
      if (attempt === 2) throw new Error('Нет связи с сервисом. Повторите выгрузку, когда интернет восстановится.');
      await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)));
    }
  }
}
function openExternal(link) {
  if (window.WebApp?.openMaxLink) window.WebApp.openMaxLink(link);
  else if (window.WebApp?.openLink) window.WebApp.openLink(link);
  else window.open(link, "_blank", "noopener");
}
const positions = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? "позиция" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "позиции" : "позиций"}`;
const localDateTime = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('sv-SE', { timeZone: 'Europe/Moscow', hour12: false }).replace(' ', 'T').slice(0, 16);
};
const moscowIso = moscowDateTimeIso;
const deadlineBefore = eventDate => {
  const eventTime = Date.parse(moscowIso(eventDate));
  return localDateTime(new Date(Math.min(eventTime - 60_000, Math.max(Date.now() + 60_000, eventTime - 3600_000))).toISOString());
};
function RussianDateTimeInput({ name, label, value, defaultValue, onChange, ...props }) {
  const [display, setDisplay] = useState(formatRussianDateTime(value ?? defaultValue));
  const [pickerOpen, setPickerOpen] = useState(false);
  const inputRef = useRef(null);
  const selected = value || parseRussianDateTime(display);
  const datePart = selected?.slice(0, 10) || '';
  const timePart = selected?.slice(11, 16) || '18:00';
  useEffect(() => { if (value) setDisplay(formatRussianDateTime(value)); }, [value]);
  const choose = (day, time) => {
    if (!day) return;
    const next = `${day}T${time || '18:00'}`;
    setDisplay(formatRussianDateTime(next));
    inputRef.current?.setCustomValidity('');
    onChange?.(next);
  };
  return <div className="russian-datetime"><label htmlFor={`${name}-manual`}>{label}</label>
    <div className="russian-datetime-row"><input
      {...props}
      ref={inputRef}
      id={`${name}-manual`}
      type="text"
      name={name}
      inputMode="text"
      autoComplete="off"
      maxLength={16}
      placeholder="ДД.ММ.ГГГГ ЧЧ:ММ"
      value={display}
      onChange={event => {
        const next = event.target.value;
        const parsed = parseRussianDateTime(next);
        event.target.setCustomValidity(next && !parsed ? 'Введите реальную дату и время в формате ДД.ММ.ГГГГ ЧЧ:ММ.' : '');
        setDisplay(next);
        onChange?.(parsed);
      }}
    /><button type="button" className="russian-datetime-toggle" aria-label="Выбрать дату и время в календаре" aria-expanded={pickerOpen} disabled={props.disabled} onClick={() => setPickerOpen(open => !open)}><CalendarDays size={19} /></button></div>
    {pickerOpen && !props.disabled && <div className="russian-datetime-picker"><label>Дата<input type="date" value={datePart} onChange={event => choose(event.target.value, timePart)} /></label><label>Время, МСК<input type="time" value={timePart} onChange={event => choose(datePart || new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' }), event.target.value)} /></label></div>}
  </div>;
}
function BookingMiniCalendar({ restaurantId, hallId, durationHours, value, onChange, excludeEventId = '' }) {
  const day = /^\d{4}-\d{2}-\d{2}/.test(value || '') ? value.slice(0, 10) : '';
  const [month, setMonth] = useState(day.slice(0, 7) || new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' }).slice(0, 7));
  const [focusedDay, setFocusedDay] = useState(day);
  const [calendar, setCalendar] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { if (day) { setFocusedDay(day); setMonth(day.slice(0, 7)); } }, [day]);
  useEffect(() => {
    if (!restaurantId || !hallId || !durationHours) { setCalendar(null); return; }
    let active = true;
    setCalendar(null);
    setError('');
    const query = new URLSearchParams({ month, hallId, durationHours: String(durationHours) });
    if (excludeEventId) query.set('excludeEventId', excludeEventId);
    api(`/restaurants/${restaurantId}/availability/month?${query}`).then(result => { if (active) setCalendar(result); }).catch(() => { if (active) setError('Не удалось загрузить свободное время. Попробуйте ещё раз.'); });
    return () => { active = false; };
  }, [restaurantId, hallId, durationHours, month, excludeEventId]);
  const [year, monthNumber] = month.split('-').map(Number);
  const offset = (new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7;
  const currentMonth = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' }).slice(0, 7);
  const moveMonth = step => { const date = new Date(Date.UTC(year, monthNumber - 1 + step, 1)); setMonth(date.toISOString().slice(0, 7)); setFocusedDay(''); };
  const slots = calendar?.days.find(entry => entry.date === focusedDay)?.slots || [];
  const selectedSlot = value && calendar?.month === value.slice(0, 7) && calendar.days.some(entry => entry.date === value.slice(0, 10) && entry.slots.includes(value.slice(11, 16)));
  useEffect(() => { if (calendar && value && calendar.month === value.slice(0, 7) && !selectedSlot) onChange(''); }, [calendar, value, selectedSlot]);
  const slotCount = count => `${count} ${count % 10 === 1 && count % 100 !== 11 ? 'свободный слот' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? 'свободных слота' : 'свободных слотов'}`;
  return <div className="booking-mini-calendar" aria-label="Свободное время зала">
    <div className="booking-calendar-head"><div><strong>Свободное время</strong><small>Выберите день и начало банкета на {durationHours} ч.</small></div><div className="booking-calendar-month"><button type="button" aria-label="Предыдущий месяц" disabled={month <= currentMonth} onClick={() => moveMonth(-1)}>‹</button><span>{new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, monthNumber - 1, 1)))}</span><button type="button" aria-label="Следующий месяц" onClick={() => moveMonth(1)}>›</button></div></div>
    <div className="booking-calendar-days">{['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(label => <span key={label}>{label}</span>)}{Array.from({ length: offset }, (_, index) => <span key={`empty-${index}`} />)}{calendar?.days.map(entry => <button key={entry.date} type="button" className={focusedDay === entry.date ? 'selected' : ''} disabled={!entry.slots.length} aria-label={`${new Date(`${entry.date}T12:00:00+03:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}: ${entry.slots.length ? slotCount(entry.slots.length) : 'нет свободного времени'}`} onClick={() => setFocusedDay(entry.date)}><strong>{Number(entry.date.slice(-2))}</strong>{entry.slots.length > 0 && <i />}</button>)}</div>
    {!calendar && !error && <p className="muted">{restaurantId && hallId && durationHours ? 'Загружаем свободные слоты…' : 'Выберите зал и длительность, чтобы увидеть свободные слоты.'}</p>}
    {error && <p className="booking-calendar-error">{error}</p>}
    {calendar && <div className="booking-calendar-times"><strong>{focusedDay && focusedDay.slice(0, 7) === month ? `Начало · ${new Date(`${focusedDay}T12:00:00+03:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} · МСК` : 'Выберите доступный день · МСК'}</strong>{focusedDay && focusedDay.slice(0, 7) === month && (slots.length ? <div className="booking-time-grid">{slots.map(time => <button key={time} type="button" className={value === `${focusedDay}T${time}` ? 'selected' : ''} onClick={() => onChange(`${focusedDay}T${time}`)}>{time}</button>)}</div> : <small>На этот день свободного времени для выбранной длительности нет.</small>)}</div>}
    <div className={value ? 'booking-calendar-selected' : 'booking-calendar-selected empty'}>{value ? `Выбрано: ${formatRussianDateTime(value)} МСК` : 'Дата банкета не выбрана. Нажмите на день и свободное время (МСК).'}</div>
  </div>;
}
function Brand({ small = false }) {
  return (
    <div className={`brand ${small ? "small" : ""}`}>
      <span className="brand-mark">
        <Utensils size={23} />
      </span>
      <span>
        за столом<span className="brand-dot">.</span>
        <small>КАЖДОМУ ПО ВКУСУ</small>
      </span>
    </div>
  );
}
function Button({ children, variant = "", className = "", ...props }) {
  return (
    <button className={`btn ${variant} ${className}`} {...props}>
      {children}
    </button>
  );
}
function Tag({ approved, children }) {
  return (
    <span className={`tag ${approved ? "approved" : ""}`}>
      <span />
      {children || (approved ? "Заказ утверждён" : "Собираем предпочтения")}
    </span>
  );
}
function Empty({ title, children }) {
  return (
    <div className="empty">
      <Utensils size={34} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Modal({ title, children, onClose }) {
  const ref = useRef(null);
  const [showTop, setShowTop] = useState(false);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.focus();
    const handler = (e) => {
      if (document.querySelector('.confirm-backdrop, .photo-crop-backdrop')) return;
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const elements = [
          ...ref.current.querySelectorAll(
            'button,input,select,textarea,[tabindex="0"]',
          ),
        ].filter((el) => !el.disabled);
        const first = elements[0],
          last = elements.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="modal"
        tabIndex={-1}
        ref={ref}
        onScroll={event => setShowTop(event.currentTarget.scrollTop > 350)}
      >
        <div className="section-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Закрыть" onClick={onClose}>
            <X />
          </button>
        </div>
        {children}
        {showTop && <button type="button" className="back-to-top modal-back-to-top" onClick={() => ref.current?.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })}><ArrowUp size={17} /> Наверх</button>}
      </section>
    </div>
  );
}
function PageBackToTop() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const update = () => setVisible(window.scrollY > 600);
    window.addEventListener('scroll', update, { passive: true });
    update();
    return () => window.removeEventListener('scroll', update);
  }, []);
  return visible && <button type="button" className="back-to-top page-back-to-top" onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })}><ArrowUp size={17} /> Наверх</button>;
}
function App() {
  const [config, setConfig] = useState(null),
    [session, setSession] = useState(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState("");
  const [events, setEvents] = useState([]),
    [restaurants, setRestaurants] = useState([]),
    [screen, setScreen] = useState("events"),
    [selected, setSelected] = useState(null),
    [detail, setDetail] = useState(null),
    [tab, setTab] = useState("guests"),
    [board, setBoard] = useState(null),
    [kitchenSelection, setKitchenSelection] = useState([]),
    [catalogRestaurant, setCatalogRestaurant] = useState(null),
    [restaurantQuery, setRestaurantQuery] = useState(''),
    [favoriteOnly, setFavoriteOnly] = useState(false),
    [profileOpen, setProfileOpen] = useState(false),
    [restaurantForm, setRestaurantForm] = useState(null);
  const [createOpen, setCreateOpen] = useState(false),
    [approveOpen, setApproveOpen] = useState(false),
    [editItem, setEditItem] = useState(null),
    [editPackage, setEditPackage] = useState(null),
    [editPackageDish, setEditPackageDish] = useState(null),
    [editHall, setEditHall] = useState(null),
    [filter, setFilter] = useState("all"),
    [helpOpen, setHelpOpen] = useState(false);
  const startParam =
    new URLSearchParams(location.search).get("invite") ||
    location.pathname.match(/\/invite\/([A-Za-z0-9_-]+)\/?$/)?.[1] ||
    window.WebApp?.initDataUnsafe?.start_param ||
    "";
  const [invite, setInvite] = useState(startParam.startsWith('event_') ? '' : startParam);
  const [startEvent, setStartEvent] = useState(startParam.startsWith('event_') ? startParam : '');
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [selected, screen, session]);
  const sandbox = useRef(sessionStorage.getItem("banquet-sandbox") || "");
  const notify = useCallback((message) => {
    setToast(message);
  }, []);
  const toggleFavorite = async restaurant => perform(async () => {
    await api(`/restaurants/${restaurant.id}/favorite`, { method: restaurant.favorite ? 'DELETE' : 'PUT' });
    await refresh();
    notify(restaurant.favorite ? 'Ресторан удалён из избранного' : 'Ресторан добавлен в избранное');
  });
  useEffect(() => {
    if (toast) {
      const id = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(id);
    }
  }, [toast]);
  useEffect(() => {
    if (error) {
      const id = setTimeout(() => setError(''), 7000);
      return () => clearTimeout(id);
    }
  }, [error]);
  const remember = (data) => {
    authToken = data.token;
    sessionStorage.setItem("banquet-token", data.token);
    if (data.sandbox) {
      sandbox.current = data.sandbox;
      sessionStorage.setItem("banquet-sandbox", data.sandbox);
    }
    setSession(data.user);
    setSelected(null);
    setDetail(null);
    setScreen("events");
  };
  const refresh = useCallback(async () => {
    const [es, rs] = await Promise.all([api("/events"), api("/restaurants")]);
    setEvents(Array.isArray(es) ? es : es.events);
    setRestaurants(Array.isArray(rs) ? rs : rs.restaurants);
  }, []);
  useEffect(() => {
    (async () => {
      try {
        const c = await api("/config");
        setConfig(c);
        const launch = window.WebApp?.initData;
        if (launch) {
          const login = await api("/auth/max", {
            method: "POST",
            body: { initData: launch },
          });
          remember(login);
          const sp = window.WebApp?.initDataUnsafe?.start_param;
          if (sp) {
            if (sp.startsWith('event_')) setStartEvent(sp);
            else setInvite(sp);
          }
          const launchInvite = sp && !sp.startsWith('event_') ? sp : startParam && !startParam.startsWith('event_') ? startParam : '';
          let verified = login.user.phoneVerified;
          if (launchInvite) {
            try {
              await api(`/invites/${launchInvite}`);
              if (!verified) {
                const contact = await window.WebApp.requestContact();
                if (!contact || contact.error) throw new Error('Подтвердите номер в MAX, чтобы принять приглашение.');
                setSession(await api('/me/phone', { method: 'PUT', body: contact }));
                verified = true;
              }
              const joined = await api(`/invites/${launchInvite}/join`, { method: 'POST', body: {} });
              setSelected(joined.eventId);
              setTab('menu');
              setInvite('');
            } catch (joinError) { setError(joinError.message); }
          }
          if (verified) {
            try {
              const claimed = await api('/me/claim-invitations', { method: 'POST', body: {} });
              if (!launchInvite && !sp && !startParam && claimed.eventIds.length === 1) {
                setSelected(claimed.eventIds[0]);
                setTab('menu');
              }
            } catch (claimError) { setError(claimError.message); }
          }
          await refresh().catch(refreshError => setError(refreshError.message));
        } else if (authToken) {
          const me = await api("/me");
          setSession(me.user || me);
          if (startParam && !startParam.startsWith('event_') && (me.user || me).phoneVerified) {
            try {
              const joined = await api(`/invites/${startParam}/join`, { method: 'POST', body: {} });
              setSelected(joined.eventId);
              setTab('menu');
              setInvite('');
            } catch (joinError) { setError(joinError.message); }
          }
          if ((me.user || me).phoneVerified) {
            const claimed = await api('/me/claim-invitations', { method: 'POST', body: {} });
            if (!startParam && claimed.eventIds.length === 1) {
              setSelected(claimed.eventIds[0]);
              setTab('menu');
            }
          }
          await refresh().catch(refreshError => setError(refreshError.message));
        }
      } catch (e) {
        authToken = "";
        sessionStorage.removeItem("banquet-token");
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);
  useEffect(() => {
    if (session) refresh().catch((e) => setError(e.message));
  }, [session, refresh]);
  // MAX keeps the mini app alive in the background: pick up roles granted meanwhile.
  const sessionKey = session ? JSON.stringify([session.role, session.access, session.phoneVerified, session.notificationsEnabled, session.notificationPreferences, session.botConnected]) : "";
  useEffect(() => {
    if (!sessionKey) return;
    const check = () => {
      if (document.visibilityState === "hidden") return;
      api("/me").then((me) => {
        const key = JSON.stringify([me.role, me.access, me.phoneVerified, me.notificationsEnabled, me.notificationPreferences, me.botConnected]);
        if (key !== sessionKey) setSession(me);
      }).catch(() => {});
    };
    const interval = setInterval(check, 30000);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [sessionKey]);
  useEffect(() => {
    if (screen !== "kitchen" || !session) return;
    setBoard(null);
    api("/kitchen").then(setBoard).catch((e) => setError(e.message));
  }, [screen, session]);
  const go = (next) => {
    setScreen(next);
    setSelected(null);
    setCatalogRestaurant(null);
    setProfileOpen(false);
  };
  const toggleNotifications = () => perform(async () => {
    const updated = await api('/me/notifications', { method: 'PUT', body: { enabled: !session.notificationsEnabled } });
    setSession(updated);
    notify(updated.notificationsEnabled ? (updated.botConnected ? 'Уведомления включены' : 'Уведомления включены. Откройте чат с ботом и нажмите «Начать».') : 'Уведомления выключены');
  });
  const setNotificationCategory = (category, enabled) => perform(async () => {
    const updated = await api('/me/notifications', { method: 'PUT', body: { categories: { [category]: enabled } } });
    setSession(updated);
    notify('Настройки уведомлений сохранены');
  });
  const openBot = () => config?.botUsername && openExternal(`https://max.ru/${config.botUsername}`);
  const exportKitchen = (format, eventIds) => perform(async () => {
    if (!eventIds?.length) throw new Error('Выберите хотя бы одно мероприятие для выгрузки.');
    if (window.WebApp?.initData && window.WebApp?.downloadFile) {
      const { url } = await api('/kitchen/export-link', { method: 'POST', body: { format, eventIds } });
      await window.WebApp.downloadFile(url, `kitchen.${format}`);
      notify('Скачивание запущено. Файл появится в «Загрузках» MAX.');
      return;
    }
    await saveDownload(await downloadResponse(`/kitchen/export?format=${format}&eventIds=${encodeURIComponent(eventIds.join(','))}`), `kitchen.${format}`);
    notify('Файл скачан. Проверьте папку «Загрузки» браузера.');
  });
  const loadDetail = useCallback(async (id) => {
    const d = await api(`/events/${id}`);
    setDetail(d);
    return d;
  }, []);
  useEffect(() => {
    if (!selected || !session) return;
    let alive = true;
    const poll = async () => {
      try {
        const d = await api(`/events/${selected}`);
        if (alive) setDetail(d);
      } catch (e) {
        if (alive) setError(e.message);
      }
    };
    poll();
    const interval = setInterval(poll, 15000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [selected, session]);
  useEffect(() => {
    if (!window.WebApp?.BackButton) return;
    const back = () => {
      setSelected(null);
      setDetail(null);
    };
    const b = window.WebApp.BackButton;
    if (selected) {
      b.show();
      b.onClick(back);
    } else b.hide();
    return () => {
      b.offClick(back);
    };
  }, [selected]);
  const perform = async (fn) => {
    setBusy(true);
    setError("");
    try {
      return await fn();
    } catch (e) {
      setError(russianError(e));
      return null;
    } finally {
      setBusy(false);
    }
  };
  const updateAdmin = (action, message) => perform(async () => {
    await action();
    await loadDetail(selected);
    await refresh();
    notify(message);
  });
  const saveMySelection = values => perform(async () => {
    await api(`/events/${selected}/selection`, { method: 'PUT', body: values });
    await loadDetail(selected);
    await refresh();
    notify(canManage ? 'Ваш выбор сохранён' : 'Заказ отправлен организатору на согласование');
  });
  const chooseMySeat = seatId => perform(async () => {
    await api(`/events/${selected}/seat`, { method: 'PUT', body: { seatId } });
    await loadDetail(selected);
    notify(seatId ? 'Место закреплено за вами' : 'Место освобождено');
  });
  const demo = (role) =>
    perform(async () => {
      const data = await api("/auth/demo", {
        method: "POST",
        body: {
          role,
          ...(sandbox.current ? { sandbox: sandbox.current } : {}),
          ...(invite ? { inviteCode: invite } : {}),
        },
      });
      remember(data);
    });
  const openEvent = (id, asGuest = false) => {
    setScreen('events');
    setSelected(id);
    setDetail(null);
    setTab(asGuest ? "menu" : "guests");
  };
  useEffect(() => {
    if (startEvent && events.some(event => event.id === startEvent)) {
      openEvent(startEvent);
      setStartEvent('');
    }
  }, [events, startEvent]);
  const requestVerifiedPhone = async () => {
    if (!window.WebApp?.initData || !window.WebApp?.requestContact) throw new Error('Для подтверждения номера откройте мини-приложение в MAX.');
    const contact = await window.WebApp.requestContact();
    if (!contact || contact.error) throw new Error('Номер не получен. Разрешите доступ к номеру в MAX и попробуйте снова.');
    const updated = await api('/me/phone', { method: 'PUT', body: contact });
    setSession(updated);
    return updated;
  };
  const findMyInvites = async () => {
    if (!session.phoneVerified) await requestVerifiedPhone();
    const claimed = await api('/me/claim-invitations', { method: 'POST', body: {} });
    await refresh();
    if (claimed.eventIds.length === 1) {
      openEvent(claimed.eventIds[0], true);
      notify('Приглашение найдено — выберите блюда');
    } else if (claimed.eventIds.length > 1) {
      notify('Приглашения найдены — выберите банкет');
    } else {
      notify('На подтверждённый номер приглашений пока нет');
    }
  };
  const joinInvite = () =>
    perform(async () => {
      if (!session.demo && !session.phoneVerified) await requestVerifiedPhone();
      const result = await api(`/invites/${invite}/join`, {
        method: "POST",
        body: {},
      });
      setInvite("");
      await refresh();
      openEvent(result.eventId);
      notify("Вы присоединились к банкету");
    });
  const logout = () => {
    authToken = "";
    sessionStorage.removeItem("banquet-token");
    setSession(null);
    setSelected(null);
    setDetail(null);
  };
  const share = async () => {
    const link =
      (!session.demo && detail.maxInviteUrl) ||
      detail.inviteUrl ||
      `${location.origin}${BASE}/?invite=${detail.inviteCode}`;
    try {
      if (window.WebApp?.initData && window.WebApp?.shareMaxContent) {
        await window.WebApp.shareMaxContent({
          text: `Приглашаю на «${detail.event.title}»! Выберите блюда к нашему вечеру.`,
          link,
        });
      } else {
        await navigator.clipboard.writeText(link);
        notify("Ссылка для гостей скопирована");
      }
    } catch {
      setError(`Ссылка для гостей: ${link}`);
    }
  };
  const exportCSV = () =>
    perform(async () => {
      if (window.WebApp?.initData && window.WebApp?.downloadFile) {
        const { url } = await api(`/events/${selected}/export-link`, {
          method: "POST",
          body: {},
        });
        await window.WebApp.downloadFile(url, "banquet-kitchen.csv");
        notify('Скачивание запущено. Файл появится в «Загрузках» MAX.');
        return;
      }
      const res = await downloadResponse(`/events/${selected}/export.csv`);
      if (!res.ok) throw new Error("Экспорт доступен после утверждения заказа");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "zakaz-kuhne.csv";
      a.click();
      notify('CSV скачан. Проверьте папку «Загрузки» браузера.');
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  if (loading)
    return (
      <div className="loading-screen">
        <Brand />
        <LoaderCircle className="spin" />
        <p>Накрываем на стол…</p>
      </div>
    );
  if (!session)
    return (
      <div className="login-page">
        <div className="login-nav">
          <Brand />
          <span className="max-pill">
            мини-приложение MAX <ArrowUpRight size={14} />
          </span>
        </div>
        <div className="login-grid">
          <div>
            <div className="eyebrow">ХОРОШИЙ ВЕЧЕР НАЧИНАЕТСЯ ЗДЕСЬ</div>
            <h1>
              Один стол.
              <br />
              Разные вкусы.
            </h1>
            <p className="login-lead">
              Соберите банкет, в котором каждому
              <br className="desktop-only" /> достанется любимое блюдо.
            </p>
            <div className="login-steps">
              <span>
                <Link2 /> Пригласите гостей
              </span>
              <span>
                <Utensils /> Соберите выбор
              </span>
              <span>
                <CheckCheck /> Утвердите заказ
              </span>
            </div>
            {config?.maxConfigured && (
              <Button
                onClick={() =>
                  (location.href = `https://max.ru/${config.botUsername}?startapp=${invite || ""}`)
                }
              >
                Открыть в MAX <ArrowUpRight size={17} />
              </Button>
            )}
            {config?.demoEnabled && (
              <Button
                disabled={busy}
                onClick={() => demo(invite ? "guest" : "organizer")}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <Sparkles size={17} />
                )}{" "}
                {invite ? "Посмотреть приглашение" : "Попробовать демо"}
              </Button>
            )}
            <p className="fineprint">
              {config?.demoEnabled
                ? "Демо банкетного зала «Петръ»: четыре роли, готовые банкеты и тестовые гости. Изменения остаются в отдельном пространстве."
                : "Для входа откройте мини-приложение в MAX."}
            </p>
          </div>
          <div className="table-art" aria-hidden="true">
            <div className="art-note">
              Всё, как вы любите <span>↘</span>
            </div>
            <div className="fork">⑂</div>
            <div className="plate">
              <div className="plate-inner">
                <Leaf size={52} />
                <span>за столом.</span>
                <small>ПРИЯТНОГО ВЕЧЕРА</small>
              </div>
            </div>
            <div className="napkin" />
            <div className="art-tag">
              <CheckCircle2 size={20} />
              <div>
                Каждый выбрал своё<small>Осталось только встретиться</small>
              </div>
            </div>
            <span className="art-herb">✳</span>
          </div>
        </div>
        <div className="login-footer">
          Банкеты без бесконечных переписок
          <span>Организатор · Гости · Ресторан</span>
        </div>
        {error && <div className="toast toast-error" role="alert"><CircleHelp size={18} /><span>{russianError(error)}</span><button type="button" className="icon-btn" aria-label="Закрыть ошибку" onClick={() => setError('')}><X size={16} /></button></div>}
      </div>
    );
  const role = session.role,
    isAdminRole = role === 'restaurant' || role === 'admin',
    hasManagedEvents = events.some(event => event.canManage),
    guestFirst = !session.demo && role === 'guest',
    canManage = Boolean(detail?.event.canManage),
    seatingOn = Boolean(detail && detail.seating?.mode !== "off"),
    displayTab = detail && !canManage ? (tab === "seat" && seatingOn ? "seat" : "menu") : tab,
    activeEvents = events.filter((e) => e.status === "collecting"),
    approvedEvents = events.filter((e) => e.status === "approved");
  const filtered = events.filter(
    (e) => filter === "all" || e.status === filter,
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="workspace-label">ВАШЕ ПРОСТРАНСТВО</div>
        <nav>
          <button
            className={screen === "events" ? "active" : ""}
            onClick={() => {
              setScreen("events");
              setSelected(null);
            }}
          >
            <CalendarDays size={19} />
            {isAdminRole ? "Заказы на банкеты" : guestFirst ? 'Мои приглашения' : "Мои банкеты"}
            <span>{events.length}</span>
          </button>
          <button
              className={screen === "catalog" ? "active" : ""}
              onClick={() => {
                setScreen("catalog");
                setSelected(null);
              }}
            >
              <Utensils size={19} />
              Рестораны
            </button>
          {(isAdminRole || hasManagedEvents) && (
            <button
              className={screen === "users" ? "active" : ""}
              onClick={() => go("users")}
            >
              <Users size={19} />
              Доступы
            </button>
          )}
          {isAdminRole && (
            <button
              className={screen === "kitchen" ? "active" : ""}
              onClick={() => {
                setScreen("kitchen");
                setSelected(null);
              }}
            >
              <ChefHat size={19} />
              Кухня
            </button>
          )}
          <button onClick={() => setHelpOpen(true)}>
            <CircleHelp size={19} />
            Как это работает
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="max-connect">
            <span className="max-logo">м</span>
            <div>
              Вместе с MAX
              <small>
                {session.demo ? "Демонстрационный режим" : "Вы вошли через MAX"}
              </small>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="mobile-brand">
            <Brand small />
          </div>
          <div className="breadcrumb desktop-only">
            Моё пространство <ChevronRight size={14} />
            <span>
              {selected ? "Банкет" : screen === "catalog" ? "Рестораны" : screen === "kitchen" ? "Кухня" : screen === "users" ? "Доступы" : "Банкеты"}
            </span>
          </div>
          <div className="topbar-right">
            {session.demo ? (
              <div className="demo-switch">
                <span>Демо</span>
                <select
                  aria-label="Роль в демонстрации"
                  value={role}
                  disabled={busy || !sandbox.current}
                  onChange={(e) => demo(e.target.value)}
                >
                  {['admin', 'restaurant', 'organizer', 'guest'].map(k => (
                    <option key={k} value={k}>
                      {roleNames[k]}
                    </option>
                  ))}
                </select>
                <ChevronDown size={13} />
              </div>
            ) : (
              <span className="connected">
                <ShieldCheck size={15} /> MAX подключён
              </span>
            )}
            <button className="avatar top-avatar profile-trigger" aria-label="Открыть профиль" onClick={() => setProfileOpen(true)}>{session.name?.slice(0, 1)}</button>
          </div>
        </header>
        <main>
          {session.demo && (
            <div className="demo-note">
              <Sparkles size={15} />
              <span>Демо «Петръ» · четыре роли, два банкета и тестовые гости</span>
            </div>
          )}
          {invite && (
            <div className="invite-banner">
              <div>
                <strong>Вас пригласили за стол</strong>
                <p>{!session.demo && !session.phoneVerified ? 'Подтвердите свой номер через MAX, чтобы приглашение закрепилось только за вами.' : 'Присоединитесь к банкету и выберите блюда.'}</p>
              </div>
              <Button disabled={busy} onClick={joinInvite}>
                {!session.demo && !session.phoneVerified ? 'Подтвердить номер' : 'Принять приглашение'} <ArrowUpRight size={16} />
              </Button>
            </div>
          )}
          {screen === "users" && !selected ? (
            <>
              <div className="page-heading">
                <div className="eyebrow">ПРАВА К БАНКЕТАМ И РЕСТОРАНАМ</div>
                <h1>Доступы</h1>
                <p>Здесь видны только участники ваших банкетов и администраторы ваших ресторанов. Добавьте человека по телефону или MAX ID.</p>
              </div>
              <UsersAdmin
                session={session}
                events={events.filter(event => event.canManage)}
                busy={busy}
                load={(q) => api(`/users?q=${encodeURIComponent(q)}`)}
                setRole={(restaurantId, userId, role) => perform(async () => {
                  await api(`/restaurants/${restaurantId}/members/${userId}`, { method: "PUT", body: { role } });
                  notify("Доступ обновлён");
                  return true;
                })}
                setGlobal={(userId, enabled) => perform(async () => {
                  await api(`/admins/${userId}`, { method: 'PUT', body: { enabled } });
                  notify(enabled ? 'Администратор назначен' : 'Роль администратора снята');
                  return true;
                })}
                setOrganizer={(eventId, userId, enabled) => perform(async () => {
                  await api(`/events/${eventId}/organizers/${encodeURIComponent(userId)}`, { method: 'PUT', body: { enabled } });
                  await refresh();
                  notify(enabled ? 'Организатор назначен' : 'Право организатора снято');
                  return true;
                })}
                onError={setError}
              />
            </>
          ) : screen === "kitchen" && !selected ? (
            <>
              <div className="page-heading">
                <div className="eyebrow">ВСЁ ДЛЯ ПОДГОТОВКИ</div>
                <h1>Кухня</h1>
                <p>Порции по каждому запланированному банкету, общий стол, пожелания и места гостей.</p>
              </div>
              {kitchenSelection.length > 0 && <div className="panel kitchen-selection"><strong>Выбрано мероприятий: {kitchenSelection.length}</strong><div className="admin-actions"><Button variant="secondary" disabled={busy} onClick={() => exportKitchen('xlsx', kitchenSelection)}><FileSpreadsheet size={16} /> Общий Excel</Button><Button variant="secondary" disabled={busy} onClick={() => exportKitchen('csv', kitchenSelection)}><Download size={16} /> Общий CSV</Button><button type="button" onClick={() => setKitchenSelection([])}>Снять выбор</button></div></div>}
              <KitchenBoard board={board} selected={kitchenSelection} setSelected={setKitchenSelection} exportOne={exportKitchen} open={(id) => { openEvent(id); setTab("kitchen"); }} />
            </>
          ) : screen === "catalog" ? (
            <>
              <div className="page-heading">
                <div className="eyebrow">ПОДОБРАНО СО ВКУСОМ</div>
                <h1>{catalogRestaurant ? restaurants.find(r => r.id === catalogRestaurant)?.name || 'Меню' : 'Рестораны'}</h1>
                <p>
                  {catalogRestaurant ? 'Меню, пакетные предложения и залы ресторана. Редактирование доступно его администратору.' : 'Все рестораны доступны для просмотра. Выберите ресторан, чтобы посмотреть меню и условия бронирования.'}
                </p>
                {catalogRestaurant && <button className="back-link" type="button" onClick={() => setCatalogRestaurant(null)}><ArrowLeft size={16} /> Все рестораны</button>}
                {session.superAdmin && !catalogRestaurant && (
                  <Button variant="secondary" onClick={() => setRestaurantForm({})}><Store size={16} /> Добавить ресторан</Button>
                )}
              </div>
              {!restaurants.length && <Empty title="Пока нет ресторанов">Администратор может добавить ресторан.</Empty>}
              {!catalogRestaurant && <div className="restaurant-search"><label className="search-field"><Search size={16} /><input type="search" placeholder="Найти ресторан" aria-label="Поиск ресторана" value={restaurantQuery} onChange={event => setRestaurantQuery(event.target.value)} /></label><button type="button" className={favoriteOnly ? 'favorite-filter active' : 'favorite-filter'} onClick={() => setFavoriteOnly(value => !value)}><Star size={16} fill={favoriteOnly ? 'currentColor' : 'none'} /> Избранные</button></div>}
              {!catalogRestaurant && <div className="restaurant-choice-grid">{restaurants.filter(r => (!favoriteOnly || r.favorite) && `${r.name} ${r.address} ${r.description}`.toLocaleLowerCase('ru').includes(restaurantQuery.trim().toLocaleLowerCase('ru'))).sort((a,b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name, 'ru')).map(r => <div className="restaurant-choice panel" key={r.id}><button className="restaurant-choice-open" type="button" onClick={() => setCatalogRestaurant(r.id)}>
                <span className="restaurant-choice-icon"><Store size={25} /></span>
                <strong>{r.name}</strong>
                <small>{r.address || r.description}</small>
                <span>{r.menu?.length || 0} позиций · {r.packages?.length || 0} пакетов <ArrowUpRight size={16} /></span>
              </button><button type="button" className={r.favorite ? 'favorite-button active' : 'favorite-button'} aria-label={r.favorite ? `Убрать ${r.name} из избранного` : `Добавить ${r.name} в избранное`} onClick={() => toggleFavorite(r)}><Star size={20} fill={r.favorite ? 'currentColor' : 'none'} /></button></div>)}</div>}
              {restaurants.filter(r => r.id === catalogRestaurant).map((r) => (
                <section key={r.id}>
                  <div className="section-head">
                    <div>
                      <h2>{r.name}</h2>
                      <p className="muted">{r.address || r.description}</p>
                    </div>
                    {r.access === "admin" && (
                      <div className="admin-actions">
                      <button type="button" onClick={() => setRestaurantForm(r)}><Pencil size={15} /> Ресторан</button>
                      <Button
                        variant="secondary"
                        onClick={() =>
                          setEditItem({
                            restaurantId: r.id,
                            allergens: [],
                            category: "Горячее",
                            price: 0,
                            available: true,
                          })
                        }
                      >
                        <Plus size={16} />
                        Добавить блюдо
                      </Button>
                      </div>
                    )}
                  </div>
                  <div className="section-head package-section-head"><div><h2>Залы и бронирование</h2><p className="muted">Каждый зал бронируется отдельно. Ресторан задаёт готовую схему со стульями или размеры столов для расстановки организатором.</p></div>{r.access === 'admin' && <Button variant="secondary" onClick={() => setEditHall({ restaurantId: r.id, name: '', capacity: 100, windows: [{ weekday: 1, start: '09:00', end: '23:00' }], seatingConfig: { type: 'fixed', fixedLayout: generateLayout('rounds', 20), tablePresets: [{ shape: 'round', seats: 6 }, { shape: 'round', seats: 8 }, { shape: 'rect', seats: 6 }, { shape: 'rect', seats: 10 }] } })}><Plus size={16} /> Добавить зал</Button>}</div>
                  <div className="package-grid">{r.halls?.map(hall => <div className="panel package-card" key={hall.id}><strong>{hall.name}</strong><span>До {hall.capacity} гостей</span><small>{hall.windows.length} окон в неделю · {hall.seatingConfig?.type === 'fixed' ? `готовая схема: ${layoutSeats(hall.seatingConfig.fixedLayout).length} мест, режим рассадки выбирает организатор` : `организатор расставляет столы из ${hall.seatingConfig?.tablePresets.length || 0} размеров`}</small>{r.access === 'admin' && <button type="button" onClick={() => setEditHall({ ...hall, restaurantId: r.id })}>Настроить зал</button>}</div>)}</div>
                  <div className="section-head package-section-head"><div><h2>Блюда только для пакетов</h2><p className="muted">Укажите состав, фото и КБЖУ. Эти блюда не появляются в обычном меню гостей.</p></div>{r.access === 'admin' && <Button variant="secondary" onClick={() => setEditPackageDish({ restaurantId: r.id, name: '', category: 'Холодные закуски', nutrition: { kcal: 0, protein: 0, fat: 0, carbs: 0 }, available: true })}><Plus size={16} /> Добавить блюдо пакета</Button>}</div>
                  <div className="package-grid">{r.packageDishes?.map(dish => <div className="panel package-card" key={dish.id}><strong>{dish.name}</strong><small>Только для пакетного предложения · {dish.category}</small>{dish.photoUrl && <img className="package-dish-photo" src={`${BASE}${dish.photoUrl}`} alt={dish.name} />}<p>{dish.description}</p><small>К {dish.nutrition.kcal} · Б {dish.nutrition.protein} · Ж {dish.nutrition.fat} · У {dish.nutrition.carbs}</small>{r.access === 'admin' && <button type="button" onClick={() => setEditPackageDish({ ...dish, restaurantId: r.id })}>Редактировать</button>}</div>)}</div>
                  {[...new Set((r.menu || []).map(item => item.category))].map((category, index) => <details className="menu-category" key={category} open={index === 0}><summary>{category} <span>{r.menu.filter(item => item.category === category).length}</span></summary><div className="menu-grid catalog">
                    {r.menu?.filter(item => item.category === category).map((item) => (
                      <DishCard
                        key={item.id}
                        item={item}
                        admin={r.access === "admin"}
                        edit={() =>
                          setEditItem({ ...item, restaurantId: r.id })
                        }
                      />
                    ))}
                  </div></details>)}
                  {!r.menu?.length && <p className="muted">В меню пока нет позиций.</p>}
                  {r.name.includes('Петръ') && <p className="photo-note">Для MVP использованы иллюстративные фотографии. Подача блюда в ресторане может отличаться.</p>}
                  <div className="section-head package-section-head"><div><h2>Пакетные предложения</h2><p className="muted">Фиксированная цена на гостя. Состав сохраняется в банкет при выборе пакета.</p></div>
                    {r.access === 'admin' && <Button variant="secondary" onClick={() => setEditPackage({ restaurantId: r.id, name: '', price: 0, items: [] })}><Plus size={16} /> Добавить пакет</Button>}
                  </div>
                  <div className="package-grid">{r.packages?.map(offer => <div className="panel package-card" key={offer.id}><strong>{offer.name}</strong><span>{money(offer.price)} / гость</span><small>{offer.items.length} позиций · {offer.items.reduce((sum, item) => sum + item.grams, 0)} г</small><p>{offer.description}</p>{r.access === 'admin' && <button type="button" onClick={() => setEditPackage({ ...offer, restaurantId: r.id })}>Редактировать</button>}</div>)}</div>
                </section>
              ))}
            </>
          ) : selected ? (
            <>
              {!detail ? (
                <div className="loading-inline">
                  <LoaderCircle className="spin" />
                  Загружаем банкет…
                </div>
              ) : (
                <>
                  <button
                    className="back-link"
                    onClick={() => {
                      setSelected(null);
                      setDetail(null);
                    }}
                  >
                    <ArrowLeft size={16} />
                    Все банкеты
                  </button>
                  {detail.event.photoUrl && <img className="event-detail-photo" src={`${BASE}${detail.event.photoUrl}`} alt={`Фото мероприятия «${detail.event.title}»`} />}
                  <div className="detail-heading">
                    <div>
                      <Tag approved={detail.event.status === "approved"} />
                      <h1>{detail.event.title}</h1>
                      <p>
                        <CalendarDays size={15} />
                        {dateText(detail.event.date, true)} МСК
                        <span>·</span>
                        <Utensils size={15} />
                        {detail.event.restaurantName}
                      </p>
                    </div>
                    {canManage && (
                      <Button variant="secondary" onClick={share}>
                        <Link2 size={17} />
                        Пригласить гостей
                      </Button>
                    )}
                  </div>
                  {!session.demo && config?.maxConfigured && detail.event.status === "collecting" && (!session.notificationsEnabled || !session.botConnected) && (
                    <div className="notify-banner">
                      <Bell size={18} />
                      <div>
                        <strong>{session.notificationsEnabled ? "Осталось открыть чат с ботом" : "Напоминания о банкете в MAX"}</strong>
                        <p>{session.notificationsEnabled ? "Бот сможет писать вам только после того, как вы откроете с ним чат и нажмёте «Начать»." : canManage ? "Бот напишет, когда гости присоединятся и сделают выбор." : "Бот напомнит о сроке выбора и сообщит, когда заказ утвердят."}</p>
                      </div>
                      {session.notificationsEnabled
                        ? <Button variant="secondary" onClick={openBot}><MessageCircle size={16} /> Открыть чат</Button>
                        : <Button variant="secondary" disabled={busy} onClick={toggleNotifications}><Bell size={16} /> Включить</Button>}
                    </div>
                  )}
                  <div className="stats-row">
                    <Stat
                      icon={Users}
                      label={detail.event.selectionMode === 'package' ? 'Готовых пакетов' : 'Выбрали блюда'}
                      value={detail.event.selectionMode === 'package' ? detail.event.expectedGuests : `${detail.event.responded} из ${detail.event.expectedGuests}`}
                      detail={detail.event.selectionMode === 'package' ? 'по числу гостей' : 'гостей за вашим столом'}
                    />
                    {canManage ? (
                      <Stat
                        icon={Wallet}
                        label="Сумма заказа"
                        value={money(detail.event.total)}
                        detail={
                          detail.event.foodBudget || detail.event.drinkBudget
                            ? `На гостя: еда ${money(detail.event.foodBudget)}, напитки ${money(detail.event.drinkBudget)}`
                            : detail.event.selectionMode === 'package' ? 'Фиксированная цена на гостя' : "По выбору гостей"
                        }
                      />
                    ) : (
                      <Stat
                        icon={Wallet}
                        label={detail.event.selectionMode === 'package' ? 'Пакет на гостя' : 'Ваш бюджет'}
                        value={detail.event.selectionMode === 'package' ? money(detail.event.package?.price) : detail.event.foodBudget ? units(detail.event.foodBudget, "pie") : "Без ограничений"}
                        detail={detail.event.selectionMode === 'package' ? 'Блюда выбраны организатором' : detail.event.drinkBudget ? `и ${units(detail.event.drinkBudget, "bottle")} на напитки` : "Напитки без ограничения"}
                      />
                    )}
                    <Stat
                      icon={Clock3}
                      label="Собираем до"
                      value={dateText(detail.event.deadline)}
                      detail={
                        detail.event.status === "approved"
                          ? "Выбор завершён"
                          : `${dateText(detail.event.deadline, true).split(" в ").at(-1)} МСК`
                      }
                    />
                  </div>
                  {detail.event.status === "approved" && (
                    <div className="success-banner">
                      <CheckCircle2 size={21} />
                      <div>
                        <strong>Заказ утверждён. Можно готовить!</strong>
                        <p>
                          Блюда и стоимость зафиксированы. У ресторана есть
                          сводка для кухни.
                        </p>
                      </div>
                    </div>
                  )}
                  <div className="tabs">
                    {canManage && (
                      <button
                        className={displayTab === "guests" ? "active" : ""}
                        onClick={() => setTab("guests")}
                      >
                        Гости <span>{detail.guests?.length || 0}</span>
                      </button>
                    )}
                    {canManage && detail.canSelect && (
                      <button
                        className={displayTab === "menu" ? "active" : ""}
                        onClick={() => setTab("menu")}
                      >
                        Мой выбор блюд
                      </button>
                    )}
                    {canManage && <button className={displayTab === 'eventMenu' ? 'active' : ''} onClick={() => setTab('eventMenu')}>Меню банкета</button>}
                    {!canManage && (
                      <button className={displayTab === 'menu' ? 'active' : ''} onClick={() => setTab('menu')}>
                        {detail.event.selectionMode === 'package' ? 'Состав пакета' : 'Меню и заказ'}
                      </button>
                    )}
                    {!canManage && seatingOn && (
                      <button
                        className={displayTab === "seat" ? "active" : ""}
                        onClick={() => setTab("seat")}
                      >
                        Место {detail.seating.mySeat && <span>✓</span>}
                      </button>
                    )}
                    {canManage && (
                      <button
                        className={displayTab === "kitchen" ? "active" : ""}
                        onClick={() => setTab("kitchen")}
                      >
                        Заказ для кухни
                      </button>
                    )}
                    {canManage && (
                      <button className={displayTab === "seating" ? "active" : ""} onClick={() => setTab("seating")}>
                        Рассадка
                      </button>
                    )}
                    {canManage && (
                      <button className={displayTab === 'admin' ? 'active' : ''} onClick={() => setTab('admin')}>
                        Управление
                      </button>
                    )}
                  </div>
                  {!canManage ? (
                    <>
                      <div hidden={displayTab !== 'menu'}>
                        {detail.event.selectionMode === 'package'
                          ? <PackageView offer={detail.event.package} guests={detail.event.expectedGuests} />
                          : <GuestMenu key={selected} detail={detail} busy={busy} canSelect={detail.canSelect && (session.demo || session.phoneVerified)} guestView save={saveMySelection} />}
                      </div>
                      {displayTab === 'seat' && <SeatPicker detail={detail} busy={busy} canSelect={detail.seating?.mode === 'choice' && detail.event.status === 'collecting' && (session.demo || session.phoneVerified)} choose={chooseMySeat} />}
                    </>
                  ) : displayTab === "menu" ? (
                    detail.event.selectionMode === 'package'
                      ? <PackageView offer={detail.event.package} guests={detail.event.expectedGuests} />
                      : <GuestMenu key={selected} detail={detail} busy={busy} canSelect={detail.canSelect && (session.demo || session.phoneVerified)} guestView={false} save={saveMySelection} />
                  ) : displayTab === "seating" ? (
                    <SeatingAdmin
                      key={selected}
                      detail={detail}
                      busy={busy}
                      notify={notify}
                      save={(values) => updateAdmin(() => api(`/events/${selected}/seating`, { method: "PUT", body: values }), "Рассадка сохранена")}
                      assign={(guest, seatId) => updateAdmin(() => api(`/events/${selected}/seating/assignments`, { method: "PUT", body: { guest, seatId } }), seatId ? "Место назначено" : "Гость снят с места")}
                      autoSeat={() => perform(async () => {
                        const result = await api(`/events/${selected}/seating/auto`, { method: "POST", body: {} });
                        await loadDetail(selected);
                        return result;
                      })}
                    />
                  ) : displayTab === "guests" ? (
                    <div className="detail-columns">
                      <EventAdmin section="guests" detail={detail} busy={busy}
                        addGuest={values => updateAdmin(() => api(`/events/${selected}/guests`, { method: 'POST', body: values }), 'Гость добавлен')}
                        editGuest={(id, values) => updateAdmin(() => api(`/events/${selected}/guests/${id}`, { method: 'PATCH', body: values }), 'Данные гостя обновлены')}
                        deleteGuest={id => updateAdmin(() => api(`/events/${selected}/guests/${id}`, { method: 'DELETE' }), 'Гость удалён')} />
                      <aside className="order-card">
                        <div className="order-icon">
                          <Utensils size={23} />
                        </div>
                        <h2>{detail.event.selectionMode === 'package' ? 'Пакетный заказ' : 'Вечер складывается'}</h2>
                        <p>
                          {detail.event.selectionMode === 'package' ? `${detail.event.package?.name} · ${money(detail.event.package?.price)} на гостя. Проверьте количество гостей и утвердите.` : 'Все предпочтения — в одном заказе. Вам остаётся проверить и утвердить.'}
                        </p>
                        <div className="order-line">
                          <span>{detail.event.selectionMode === 'package' ? 'Пакетов' : 'Выбрали блюда'}</span>
                          <strong>{detail.event.selectionMode === 'package' ? detail.event.expectedGuests : `${detail.event.responded} гостей`}</strong>
                        </div>
                        <div className="order-line total">
                          <span>Итого</span>
                          <strong>{money(detail.event.total)}</strong>
                        </div>
                        {detail.event.budget > 0 && (
                          <div className="order-line">
                            <span>Бюджет {money(detail.event.foodBudget + detail.event.drinkBudget)} × {detail.event.expectedGuests}</span>
                            <strong>{money(detail.event.budget)}</strong>
                          </div>
                        )}
                        {detail.event.budget > 0 &&
                          detail.event.total > detail.event.budget && (
                            <p className="budget-warning">
                              Бюджет превышен на{" "}
                              {money(detail.event.total - detail.event.budget)}
                            </p>
                          )}
                        {canManage &&
                          detail.event.status !== "approved" && (
                            <Button
                              disabled={busy || (detail.event.selectionMode !== 'package' && !detail.event.responded)}
                              onClick={() =>
                                setApproveOpen({
                                  revision: detail.event.revision,
                                  total: detail.event.total,
                                  responded: detail.event.responded,
                                })
                              }
                            >
                              Утвердить заказ <CheckCheck size={17} />
                            </Button>
                          )}
                        {detail.event.status === "approved" && (
                          <Button variant="secondary" onClick={exportCSV}>
                            <Download size={17} />
                            Скачать заказ
                          </Button>
                        )}
                        <small className="order-foot">
                          <ShieldCheck size={14} />
                          После утверждения выбор фиксируется
                        </small>
                      </aside>
                    </div>
                  ) : displayTab === 'admin' || displayTab === 'eventMenu' ? (
                    <EventAdmin
                      section={displayTab === 'admin' ? 'settings' : 'menu'}
                      detail={detail}
                      catalog={restaurants.find((r) => r.id === detail.event.restaurantId)}
                      canEditDishes={session.superAdmin || restaurants.find(r => r.id === detail.event.restaurantId)?.access === 'admin'}
                      busy={busy}
                      setForGuests={(item, forGuests) => updateAdmin(() => api(`/events/${selected}/menu/${item.id}`, { method: 'PATCH', body: { forGuests } }), forGuests ? 'Позиция доступна гостям' : 'Позиция скрыта от гостей')}
                      saveShared={items => updateAdmin(() => api(`/events/${selected}/shared`, { method: 'PUT', body: { items } }), 'Позиции общего стола сохранены')}
                      saveCatalogMenu={itemIds => updateAdmin(() => api(`/events/${selected}/menu/catalog`, { method: 'PUT', body: { itemIds } }), 'Меню банкета обновлено')}
                      saveEvent={values => updateAdmin(() => api(`/events/${selected}`, { method: 'PATCH', body: { ...values, expectedRevision: detail.event.revision } }), 'Настройки банкета обновлены')}
                      removeEvent={detail.event.canDelete ? () => perform(async () => { await api(`/events/${selected}`, { method: 'DELETE' }); setSelected(null); setDetail(null); await refresh(); notify('Банкет удалён'); }) : null}
                      uploadPhoto={file => perform(() => uploadImage(file))}
                      onError={setError}
                      addGuest={values => updateAdmin(() => api(`/events/${selected}/guests`, { method: 'POST', body: values }), 'Гость добавлен')}
                      editGuest={(id, values) => updateAdmin(() => api(`/events/${selected}/guests/${id}`, { method: 'PATCH', body: values }), 'Данные гостя обновлены')}
                      deleteGuest={id => updateAdmin(() => api(`/events/${selected}/guests/${id}`, { method: 'DELETE' }), 'Гость удалён')}
                      editDish={item => setEditItem({ ...item, eventId: selected })}
                      deleteDish={id => updateAdmin(() => api(`/events/${selected}/menu/${id}`, { method: 'DELETE' }), 'Блюдо удалено из банкета')}
                    />
                  ) : (
                    <section className="panel kitchen">
                      <div className="section-head">
                        <div>
                          <h2>Сводка для кухни</h2>
                          <p className="muted">
                            {detail.event.status === "approved"
                              ? "Утверждённые количества и индивидуальные пожелания"
                              : "Предварительный заказ · ожидает утверждения организатором"}
                          </p>
                        </div>
                        <Button
                          variant="secondary"
                          disabled={detail.event.status !== "approved" || busy}
                          onClick={exportCSV}
                        >
                          <Download size={16} />
                          CSV
                        </Button>
                      </div>
                      <div className="kitchen-table">
                        <div className="kitchen-row table-header">
                          <span>Блюдо</span>
                          <span>Порции</span>
                          <span>Стоимость</span>
                        </div>
                        {detail.summary?.map((item) => (
                          <div className="kitchen-row" key={item.menuItemId}>
                            <strong>{item.name}</strong>
                            <span>{item.quantity} шт.</span>
                            <strong>{money(item.total)}</strong>
                          </div>
                        ))}
                        <div className="kitchen-row table-total">
                          <strong>Итого</strong>
                          <span>
                            {detail.summary?.reduce(
                              (n, v) => n + v.quantity,
                              0,
                            )}{" "}
                            шт.
                          </span>
                          <strong>{money(detail.event.total)}</strong>
                        </div>
                      </div>
                      {detail.shared?.length > 0 && (
                        <p className="muted">
                          Из них на общий стол: {detail.shared.map((s) => `${s.name} × ${s.quantity}`).join(", ")}
                        </p>
                      )}
                      <h3>Пожелания гостей</h3>
                      {detail.guests?.filter((g) => g.notes).length ? (
                        detail.guests
                          .filter((g) => g.notes)
                          .map((g) => (
                            <div className="dietary-row" key={g.id}>
                              <Leaf size={16} />
                              <strong>{g.name}</strong>
                              <span>{g.notes}</span>
                            </div>
                          ))
                      ) : (
                        <p className="muted">Особых пожеланий пока нет.</p>
                      )}
                      {seatingOn && <SeatingOverview seating={detail.seating} />}
                    </section>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <div className="page-heading heading-actions">
                <div>
                  <div className="eyebrow">ПОВОД СОБРАТЬСЯ ВМЕСТЕ</div>
                  <h1>
                    {isAdminRole
                      ? "Заказы на банкеты"
                      : role === "guest" || guestFirst
                        ? "Ваши приглашения"
                        : "Мои банкеты"}
                    <span className="heading-dot">.</span>
                  </h1>
                  <p>
                    {isAdminRole
                      ? "Точные количества, пожелания гостей и готовый заказ для кухни."
                      : role === "guest" || guestFirst
                        ? "Хорошая компания уже ждёт. Осталось выбрать любимое."
                        : "Гости выбирают любимое. Вы держите всё под контролем."}
                  </p>
                </div>
                {(
                  <Button onClick={() => setCreateOpen(true)}>
                    <Plus size={18} />
                    Создать банкет
                  </Button>
                )}
              </div>
              {guestFirst && !invite && !events.length && (
                <div className="guest-discovery">
                  <div>
                    <strong>{session.phoneVerified ? 'Приглашений пока нет' : 'Вас пригласили на банкет?'}</strong>
                    <p>{session.phoneVerified ? 'Новые банкеты на ваш номер появятся автоматически при следующем входе. Если вам прислали ссылку, откройте её в MAX.' : 'Подтвердите номер через MAX один раз. После этого новые приглашения будут появляться автоматически.'}</p>
                  </div>
                  {!session.phoneVerified && <Button disabled={busy} onClick={() => perform(findMyInvites)}>Подтвердить номер MAX</Button>}
                  <small className="guest-discovery-hint">Вы можете создать собственный банкет в одном из ресторанов кнопкой «Создать банкет».</small>
                </div>
              )}
              <div className="stats-row">
                <Stat
                  icon={CalendarDays}
                  label="В подготовке"
                  value={activeEvents.length}
                  detail="собираем вкусы и пожелания"
                />
                <Stat
                  icon={Users}
                  label="Приглашённых гостей"
                  value={events.reduce((n, e) => n + e.expectedGuests, 0)}
                  detail="за вашими столами"
                />
                <Stat
                  icon={CheckCheck}
                  label="Утверждено"
                  value={approvedEvents.length}
                  detail="заказов передано ресторану"
                />
              </div>
              <div className="list-heading">
                <h2>
                  Ближайшие встречи <span>{events.length}</span>
                </h2>
                <div className="filter-pills" aria-label="Статус банкета">
                  {[
                    ["all", "Все"],
                    ["collecting", "В подготовке"],
                    ["approved", "Утверждены"],
                  ].map(([k, v]) => (
                    <button
                      key={k}
                      className={filter === k ? "active" : ""}
                      onClick={() => setFilter(k)}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
              <div className="events-grid">
                {filtered.map((event, i) => (
                  <button
                    className="event-card"
                    key={event.id}
                    onClick={() => openEvent(event.id, !event.canManage)}
                  >
                    <div className={`event-art art-${i % 3}`}>
                      {event.photoUrl ? <img className="event-cover" src={`${BASE}${event.photoUrl}`} alt="" loading="lazy" /> : <><div className="mini-plate"><Utensils size={30} /></div><span className="event-art-leaf">✳</span></>}
                      <div className="event-date">
                        <strong>{new Date(event.date).getDate()}</strong>
                        <span>
                          {new Date(event.date)
                            .toLocaleDateString("ru-RU", { month: "short" })
                            .replace(".", "")}
                        </span>
                      </div>
                      <span className="art-caption">
                        {i % 3 === 0
                          ? "СОБИРАЕМ ТЁПЛЫЕ МОМЕНТЫ"
                          : "В ХОРОШЕЙ КОМПАНИИ"}
                      </span>
                    </div>
                    <div className="event-body">
                      <Tag approved={event.status === "approved"} />
                      <h3>{event.title}</h3>
                      <p>
                        <Utensils size={14} />
                        {event.restaurantName}
                      </p>
                      {isAdminRole && event.ownerName && (
                        <p>
                          <Users size={14} />
                          Организатор: {event.ownerName}
                        </p>
                      )}
                      <div className="event-progress">
                        <div>
                          <span>
                            <Users size={14} />
                            {event.selectionMode === 'package' ? `${event.expectedGuests} фиксированных пакетов` : `${event.responded} из ${event.expectedGuests} выбрали`}
                          </span>
                          <strong>
                            {event.selectionMode === 'package' ? 100 : Math.min(
                              100,
                              Math.round(
                                (event.responded / event.expectedGuests) * 100,
                              ),
                            )}
                            %
                          </strong>
                        </div>
                        <div className="progress-track">
                          <span
                            style={{
                              width: `${event.selectionMode === 'package' ? 100 : Math.min(100, (event.responded / event.expectedGuests) * 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                      <div className="event-footer">
                        {event.canManage ? (
                          <span>
                            Сумма заказа<strong>{money(event.total)}</strong>
                          </span>
                        ) : (
                          <span>
                            {event.selectionMode === 'package' ? 'Пакет на гостя' : 'Ваш бюджет'}<strong>{event.selectionMode === 'package' ? money(event.package?.price) : event.foodBudget || event.drinkBudget ? `${units(event.foodBudget, "pie")} · ${units(event.drinkBudget, "bottle")}` : "Без ограничений"}</strong>
                          </span>
                        )}
                        <span className="round-arrow">
                          <ArrowUpRight size={20} />
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
                {filter === "all" && (
                  <button
                    className="new-event-card"
                    onClick={() => setCreateOpen(true)}
                  >
                    <span>
                      <Plus size={26} />
                    </span>
                    <h3>Есть повод собраться?</h3>
                    <p>
                      Создайте банкет и отправьте
                      <br />
                      приглашение в пару кликов.
                    </p>
                    <strong>
                      Новый банкет <ArrowUpRight size={15} />
                    </strong>
                  </button>
                )}
              </div>
              {!filtered.length && role === "guest" && (
                <Empty title="Здесь появятся ваши банкеты">
                  {role === "guest"
                    ? "Откройте ссылку от организатора, чтобы присоединиться."
                    : "Банкеты появятся, когда организатор выберет ваш ресторан."}
                </Empty>
              )}
              <div className="how-strip">
                <div className="how-icon">
                  <Leaf size={23} />
                </div>
                <div>
                  <strong>Меньше переписок. Больше предвкушения.</strong>
                  <p>
                    Одна ссылка вместо десятка сообщений — и каждый гость
                    услышан.
                  </p>
                </div>
                <button onClick={() => setHelpOpen(true)}>
                  Как это работает <ArrowUpRight size={16} />
                </button>
              </div>
            </>
          )}
          <footer className="app-footer">
            <span>
              за столом. <span>Собирает людей и их вкусы</span>
            </span>
            <span>Сделано для MAX</span>
          </footer>
        </main>
        <nav className="mobile-nav">
          <button className={screen === "events" && !profileOpen ? "active" : ""} onClick={() => go("events")}>
            <CalendarDays size={19} />
            Банкеты
          </button>
          <button className={screen === "catalog" && !profileOpen ? "active" : ""} onClick={() => go("catalog")}>
              <Utensils size={19} />
              Рестораны
            </button>
          {isAdminRole && (
            <button className={screen === "kitchen" && !profileOpen ? "active" : ""} onClick={() => go("kitchen")}>
              <ChefHat size={19} />
              Кухня
            </button>
          )}
          {(isAdminRole || hasManagedEvents) && (
            <button className={screen === "users" && !profileOpen ? "active" : ""} onClick={() => go("users")}>
              <Users size={19} />
              Доступы
            </button>
          )}
        </nav>
      </div>
      <PageBackToTop />
      <ConfirmHost />
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
      {error && <div className="toast toast-error" role="alert"><CircleHelp size={18} /><span>{russianError(error)}</span><button type="button" className="icon-btn" aria-label="Закрыть ошибку" onClick={() => setError('')}><X size={16} /></button></div>}
      {createOpen && (
        <CreateEvent
          restaurants={restaurants}
          busy={busy}
          toggleFavorite={toggleFavorite}
          uploadPhoto={file => perform(() => uploadImage(file))}
          onError={setError}
          onClose={() => setCreateOpen(false)}
          submit={(body) =>
            perform(async () => {
              const e = await api("/events", { method: "POST", body });
              await refresh();
              setCreateOpen(false);
              openEvent(e.id || e.event?.id);
              notify("Банкет создан. Пригласите гостей!");
            })
          }
        />
      )}
      {approveOpen && (
        <Modal title="Утвердить заказ?" onClose={() => setApproveOpen(false)}>
          <p>
            В заказе — {detail.event.selectionMode === 'package' ? `${detail.event.expectedGuests} фиксированных пакетов` : `выбор ${approveOpen.responded} гостей`} на{" "}
            <strong>{money(approveOpen.total)}</strong>. После утверждения
            изменить блюда будет нельзя.
          </p>
          {detail.event.selectionMode !== 'package' && detail.event.responded < detail.event.expectedGuests && (
            <div className="alert">
              Ещё{" "}
              {Math.max(
                0,
                detail.event.expectedGuests - detail.event.responded,
              )}{" "}
              гостей не выбрали блюда. Их выбор не войдёт в этот заказ.
            </div>
          )}
          {detail.seating?.mode !== "off" && detail.seating?.people?.some((p) => !p.seatId) && (
            <div className="alert">
              Гостей без места: {detail.seating.people.filter((p) => !p.seatId).length}. При утверждении они будут рассажены автоматически на свободные места.
            </div>
          )}
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setApproveOpen(false)}>
              Вернуться
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                perform(async () => {
                  await api(`/events/${selected}/approve`, {
                    method: "POST",
                    body: { expectedRevision: approveOpen.revision },
                  });
                  await loadDetail(selected);
                  await refresh();
                  setApproveOpen(false);
                  notify("Заказ утверждён и доступен ресторану");
                })
              }
            >
              Подтвердить {money(approveOpen.total)}
            </Button>
          </div>
        </Modal>
      )}
      {editItem && (
        <EditDish
          item={editItem}
          busy={busy}
          onClose={() => setEditItem(null)}
          uploadPhoto={file => perform(() => uploadImage(file))}
          submit={(values) =>
            perform(async () => {
              await api(
                editItem.eventId
                  ? `/events/${editItem.eventId}/menu${editItem.id ? '/' + editItem.id : ''}`
                  : `/restaurants/${editItem.restaurantId}/menu${editItem.id ? "/" + editItem.id : ""}`,
                { method: editItem.id ? "PATCH" : "POST", body: values },
              );
              if (editItem.eventId) await loadDetail(editItem.eventId);
              await refresh();
              setEditItem(null);
              notify("Меню обновлено");
            })
          }
        />
      )}
      {editHall && <HallEditor hall={editHall} busy={busy} onClose={() => setEditHall(null)} submit={values => perform(async () => {
        await api(`/restaurants/${editHall.restaurantId}/halls${editHall.id ? '/' + editHall.id : ''}`, { method: editHall.id ? 'PATCH' : 'POST', body: values });
        await refresh(); setEditHall(null); notify('Настройки зала сохранены');
      })} remove={editHall.id ? () => perform(async () => {
        await api(`/restaurants/${editHall.restaurantId}/halls/${editHall.id}`, { method: 'DELETE' });
        await refresh(); setEditHall(null); notify('Зал удалён');
      }) : null} />}
      {editPackageDish && <PackageDishEditor dish={editPackageDish} busy={busy} uploadPhoto={file => perform(() => uploadImage(file))} onClose={() => setEditPackageDish(null)} submit={values => perform(async () => {
        await api(`/restaurants/${editPackageDish.restaurantId}/package-dishes${editPackageDish.id ? '/' + editPackageDish.id : ''}`, { method: editPackageDish.id ? 'PATCH' : 'POST', body: values });
        await refresh(); setEditPackageDish(null); notify('Блюдо пакета сохранено');
      })} remove={editPackageDish.id ? () => perform(async () => {
        await api(`/restaurants/${editPackageDish.restaurantId}/package-dishes/${editPackageDish.id}`, { method: 'DELETE' });
        await refresh(); setEditPackageDish(null); notify('Блюдо пакета удалено');
      }) : null} />}
      {editPackage && <EditPackage offer={editPackage} dishes={restaurants.find(r => r.id === editPackage.restaurantId)?.packageDishes || []} busy={busy} onError={setError} onClose={() => setEditPackage(null)} submit={values => perform(async () => {
        await api(`/restaurants/${editPackage.restaurantId}/packages${editPackage.id ? '/' + editPackage.id : ''}`, { method: editPackage.id ? 'PATCH' : 'POST', body: values });
        await refresh(); setEditPackage(null); notify('Пакет сохранён');
      })} remove={editPackage.id ? () => perform(async () => {
        await api(`/restaurants/${editPackage.restaurantId}/packages/${editPackage.id}`, { method: 'DELETE' });
        await refresh(); setEditPackage(null); notify('Пакет удалён');
      }) : null} />}
      {profileOpen && (
        <Modal title="Профиль" onClose={() => setProfileOpen(false)}>
          <div className="profile-card">
            <div className="avatar">{session.name?.slice(0, 1) || "Я"}</div>
            <div>
              <strong>{session.name}</strong>
              <small>{roleNames[role]}{session.maxId ? ` · MAX ID ${session.maxId}` : ''}</small>
            </div>
          </div>
          {session.access?.length > 0 && (
            <div className="profile-section">
              <h3>Доступ к ресторанам</h3>
              {session.access.map((entry) => (
                <p key={entry.restaurantId}>{entry.restaurantName} — {session.superAdmin && !session.demo ? 'администратор' : 'администратор ресторана'}</p>
              ))}
            </div>
          )}
          {events.some(event => event.canManage && !session.access?.some(entry => entry.restaurantId === event.restaurantId)) && <div className="profile-section"><h3>Права организатора</h3>{events.filter(event => event.canManage && !session.access?.some(entry => entry.restaurantId === event.restaurantId)).map(event => <p key={event.id}>{event.restaurantName} · {event.title} — организатор банкета</p>)}</div>}
          {session.demo ? (
            <p className="muted">В демо подтверждение номера и уведомления MAX недоступны.</p>
          ) : (
            <>
              <div className="profile-section">
                <h3>Номер телефона</h3>
                <p>{session.phoneVerified ? `+${session.phone} · подтверждён через MAX` : "Не подтверждён. По номеру организатор находит вас в списке гостей."}</p>
                {!session.phoneVerified && <Button variant="secondary" disabled={busy} onClick={() => perform(findMyInvites)}>Подтвердить номер</Button>}
              </div>
              <div className="profile-section">
                <h3>Уведомления в MAX</h3>
                <label className="switch-row">
                  <input type="checkbox" checked={session.notificationsEnabled} disabled={busy} onChange={toggleNotifications} />
                  <span>Включить уведомления в MAX</span>
                </label>
                <div className="notification-preferences" role="group" aria-label="Категории уведомлений">
                  {NOTIFICATION_CATEGORIES.map(category => <label className="notification-category" key={category.key}>
                    <input type="checkbox" checked={(session.notificationPreferences || DEFAULT_NOTIFICATION_PREFERENCES)[category.key]} disabled={busy} onChange={event => setNotificationCategory(category.key, event.target.checked)} />
                    <span><strong>{category.label}</strong><small>{category.description}</small></span>
                  </label>)}
                </div>
                {!session.notificationsEnabled && <p>Выберите нужные категории, затем включите уведомления.</p>}
                {session.notificationsEnabled && (
                  <p className={session.botConnected ? "green" : "budget-warning"}>
                    {session.botConnected ? "Чат с ботом открыт — сообщения будут приходить." : "Чтобы бот мог писать, откройте с ним чат и нажмите «Начать»."}
                  </p>
                )}
                {config?.botUsername && <Button variant="secondary" onClick={openBot}><MessageCircle size={16} /> Открыть чат с ботом</Button>}
              </div>
            </>
          )}
          <div className="modal-actions profile-actions">
            <Button variant="secondary" onClick={() => { setProfileOpen(false); setHelpOpen(true); }}><CircleHelp size={16} /> Как это работает</Button>
            <Button variant="secondary" onClick={() => { setProfileOpen(false); logout(); }}><LogOut size={16} /> Выйти</Button>
          </div>
        </Modal>
      )}
      {restaurantForm && (
        <Modal title={restaurantForm.id ? "Ресторан" : "Новый ресторан"} onClose={() => setRestaurantForm(null)}>
          <form onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const body = { name: f.get("name"), address: f.get("address"), description: f.get("description") };
            perform(async () => {
              await api(restaurantForm.id ? `/restaurants/${restaurantForm.id}` : "/restaurants", { method: restaurantForm.id ? "PATCH" : "POST", body });
              const me = await api("/me");
              setSession(me);
              await refresh();
              setRestaurantForm(null);
              notify(restaurantForm.id ? "Ресторан обновлён" : "Ресторан добавлен. Заполните меню и выдайте доступы.");
            });
          }}>
            <label>Название<input name="name" required maxLength={120} defaultValue={restaurantForm.name} /></label>
            <label>Адрес<input name="address" maxLength={200} defaultValue={restaurantForm.address} /></label>
            <label>Описание<textarea name="description" maxLength={500} defaultValue={restaurantForm.description} /></label>
            <div className="modal-actions">
              <Button type="button" variant="secondary" onClick={() => setRestaurantForm(null)}>Отмена</Button>
              <Button type="submit" disabled={busy}>Сохранить</Button>
            </div>
          </form>
        </Modal>
      )}
      {helpOpen && (
        <Modal
          title="Один банкет — три простых шага"
          onClose={() => setHelpOpen(false)}
        >
          <div className="help-steps">
            {[
              [
                "01",
                "Организатор создаёт банкет",
                "Выберите ресторан, дату и срок сбора ответов. Отправьте гостям одну ссылку.",
              ],
              [
                "02",
                "Каждый выбирает по вкусу",
                "Гость добавляет блюда и оставляет пожелания. Общая стоимость пересчитывается автоматически.",
              ],
              [
                "03",
                "Заказ отправляется на кухню",
                "Организатор утверждает сумму. Ресторан видит порции и выбор каждого гостя, скачивает CSV.",
              ],
            ].map(([n, t, d]) => (
              <div key={n}>
                <span>{n}</span>
                <section>
                  <h3>{t}</h3>
                  <p>{d}</p>
                </section>
              </div>
            ))}
          </div>
          {session.demo && (
            <p className="fineprint">
              В демонстрации переключайте роли в верхнем меню, чтобы проверить
              весь сценарий. Данные тестовые, внешние ресторанные системы не
              подключены.
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
function Stat({ icon: Icon, label, value, detail }) {
  return (
    <div className="stat">
      <div className="stat-top">
        <span>{label}</span>
        <Icon size={18} />
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
function DishCard({ item, quantity = 0, onChange, admin, edit, locked, priceLabel, canAdd = true }) {
  return (
    <article className={`dish-card ${!item.available ? "unavailable" : ""}`}>
      <div className={`dish-visual category-${item.category?.length % 4}`}>
        {item.photoUrl ? <img src={`${BASE}${item.photoUrl}`} alt={item.name} loading="lazy" /> : <span>{item.emoji || "🍽️"}</span>}
        {(item.vegetarian || item.labels?.length > 0) && <div className="dish-badges">
          {item.vegetarian && <span className="veg-tag"><Leaf size={12} /> Вегетарианское</span>}
          {item.labels?.map(label => <span key={label} className="veg-tag">{label}</span>)}
        </div>}
      </div>
      <div className="dish-content">
        <span className="dish-category">
          {item.category} {item.weight ? "· " + item.weight : ""}
        </span>
        <h3>{item.name}</h3>
        <p>{item.description}</p>
        {item.ingredients && <small className="ingredients">Состав: {item.ingredients}</small>}
        {item.nutrition && <small className="nutrition">На порцию: {item.nutrition.kcal} ккал · Б {item.nutrition.protein} г · Ж {item.nutrition.fat} г · У {item.nutrition.carbs} г</small>}
        {item.allergens?.length > 0 && (
          <small className="allergens">
            Аллергены: {item.allergens.join(", ")}
          </small>
        )}
        <div className="dish-bottom">
          <strong>{priceLabel || money(item.price)}</strong>
          {admin ? (
            <button
              className="icon-btn"
              aria-label={`Изменить ${item.name}`}
              onClick={edit}
            >
              <Settings2 size={18} />
            </button>
          ) : onChange ? (
            <div className="quantity">
              <button
                disabled={locked || quantity === 0 || !item.available}
                aria-label={`Убрать ${item.name}`}
                onClick={() => onChange(Math.max(0, quantity - 1))}
              >
                <Minus size={16} />
              </button>
              <span>{quantity}</span>
              <button
                disabled={locked || quantity >= 10 || !item.available || !canAdd}
                aria-label={`Добавить ${item.name}`}
                onClick={() => onChange(quantity + 1)}
              >
                <Plus size={16} />
              </button>
            </div>
          ) : null}
        </div>
        {!item.available && <small>Временно недоступно</small>}
      </div>
    </article>
  );
}
/** Food (pie slices) and drinks (bottles) have independent per-guest limits. */
function BudgetMeter({ foodBudget, drinkBudget, spent, guestView }) {
  const rows = [
    ["pie", "Еда", foodBudget, spent.pie],
    ["bottle", "Напитки", drinkBudget, spent.bottle],
  ];
  const show = (value, unit) => (guestView ? units(value, unit) : money(value));
  return (
    <div className="budget-meter">
      <span className="budget-meter-title">Ваш бюджет</span>
      {rows.map(([unit, label, limit, used]) => (
        <div key={unit} className={`budget-row ${limit > 0 && used > limit ? "over" : ""}`}>
          <div className="budget-meter-top">
            <span>{label}</span>
            <strong>{limit > 0 ? `${show(used, unit)} из ${show(limit, unit)}` : `${show(used, unit)} · без ограничения`}</strong>
          </div>
          {limit > 0 && (
            <>
              <div className="progress-track"><span style={{ width: `${Math.min(100, Math.round((used / limit) * 100))}%` }} /></div>
              <small>{used > limit ? "Бюджет превышен" : `Осталось ${show(limit - used, unit)}`}</small>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
function BudgetHelp({ guest = false }) {
  return <div className={guest ? 'budget-help guest-budget-help' : 'budget-help'}>
    <strong>{guest ? 'Что означают 🥧 и 🍾?' : 'Как работает бюджет гостя'}</strong>
    {guest ? <>
      <p>Кусочки пирога 🥧 показывают, сколько можно выбрать еды, а бутылочки 🍾 — напитков. Это условные единицы для отображения бюджета, их не нужно покупать.</p>
      <p>Нажимайте «+» у блюд и напитков ниже: стоимость каждой порции вычитается из соответствующего остатка. Еду нельзя оплатить бутылочками, а напитки — кусочками пирога. Если написано «без ограничения», для этой категории лимита нет.</p>
    </> : <>
      <p>Укажите суммы в рублях на одного гостя отдельно для еды и напитков. Гостю они показываются условными единицами: 1 🥧 = 10 ₽ для еды, 1 🍾 = 100 ₽ для напитков. Например, 2 500 ₽ на еду — это 250 🥧, а 600 ₽ на напитки — 6 🍾.</p>
      <p>Цена каждого блюда или напитка показывается в своей единице и уменьшает соответствующий остаток при выборе порции. Лимиты не объединяются: остаток на еду не переносится на напитки. Значение 0 означает «без ограничения». Это только способ показать бюджет; стоимость заказа для ресторана остаётся в рублях.</p>
    </>}
  </div>;
}
function PackageView({ offer, guests }) {
  if (!offer) return <Empty title="Пакет ещё не выбран">Организатор уточняет состав заказа.</Empty>;
  const categories = [...new Set(offer.items.map(item => item.category))];
  return <section className="panel package-view"><div className="section-head"><div><h2>{offer.name}</h2><p className="muted">Фиксированный пакет · {money(offer.price)} на гостя · {guests} гостей</p></div></div>
    <p className="package-notice">Организатор выбрал единый пакет для банкета. Вам не нужно выбирать блюда; ниже можно посмотреть его состав.</p>
    {categories.map(category => <div className="package-category" key={category}><h3>{category}</h3>{offer.items.filter(item => item.category === category).map((item, index) => <div className="package-item package-item-rich" key={`${category}-${index}`}>{item.photoUrl && <img src={`${BASE}${item.photoUrl}`} alt="" />}<div><strong>{item.name}</strong><small>Только для пакетного предложения · {item.grams} г</small>{item.description && <p>{item.description}</p>}<small>К {item.nutrition?.kcal ?? '—'} · Б {item.nutrition?.protein ?? '—'} · Ж {item.nutrition?.fat ?? '—'} · У {item.nutrition?.carbs ?? '—'}</small>{item.labels?.length > 0 && <small>{item.labels.join(' · ')}</small>}</div></div>)}</div>)}
  </section>;
}
function GuestMenu({ detail, busy, save, canSelect, guestView }) {
  const selection = detail.selection;
  const [items, setItems] = useState(() =>
      Object.fromEntries(
        (selection?.items || []).map((i) => [i.menuItemId, i.quantity]),
      ),
    ),
    [notes, setNotes] = useState(selection?.notes || ""),
    [category, setCategory] = useState("Все блюда"),
    [vegetarian, setVegetarian] = useState(false),
    [selectedLabels, setSelectedLabels] = useState([]),
    [dirty, setDirty] = useState(false);
  const locked =
    detail.event.status === "approved" ||
    new Date(detail.event.deadline).getTime() < Date.now() || !canSelect;
  const shared = detail.shared || [];
  const sharedIds = new Set(shared.map((s) => s.menuItemId));
  const selectable = detail.menu.filter((i) => i.forGuests !== false && !sharedIds.has(i.id));
  const categories = [
    "Все блюда",
    ...new Set(selectable.map((i) => i.category)),
  ];
  const chosen = selectable
      .filter((i) => items[i.id] > 0)
      .map((i) => ({ ...i, quantity: items[i.id] })),
    total = chosen.reduce((n, i) => n + i.price * i.quantity, 0),
    count = chosen.reduce((n, i) => n + i.quantity, 0),
    spent = spentByUnit(chosen),
    limits = { pie: detail.event.foodBudget || 0, bottle: detail.event.drinkBudget || 0 },
    budgeted = limits.pie > 0 || limits.bottle > 0,
    over = Object.keys(limits).some((unit) => limits[unit] > 0 && spent[unit] > limits[unit]);
  const price = (item) => (guestView ? units(item.price, unitOf(item)) : money(item.price));
  const fits = (item) => {
    const unit = unitOf(item);
    return !limits[unit] || spent[unit] + item.price <= limits[unit];
  };
  const visible = selectable.filter(i => (category === 'Все блюда' || i.category === category) && (!vegetarian || i.vegetarian) && selectedLabels.every(label => i.labels?.includes(label)));
  useEffect(() => {
    const fn = (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", fn);
    if (dirty) window.WebApp?.enableClosingConfirmation?.();
    else window.WebApp?.disableClosingConfirmation?.();
    return () => {
      window.removeEventListener("beforeunload", fn);
      window.WebApp?.disableClosingConfirmation?.();
    };
  }, [dirty]);
  return (
    <>
      <div className="menu-heading">
        <div>
          <h2>{locked ? "Ваш выбор" : "Что вам приготовить?"}</h2>
          <p className="muted">
            {!canSelect ? 'Просмотр меню. Для выбора блюд войдите как приглашённый гость и подтвердите номер MAX.' : !guestView && !locked ? 'Вы тоже можете выбрать блюда для себя — они войдут в общий заказ.' : locked
              ? "Сбор завершён. Ваши блюда сохранены в заказе."
              : budgeted
                ? "Выберите блюда и напитки в пределах бюджета. Еда стоит кусочки пирога 🥧, напитки — бутылочки 🍾. Это две отдельные валюты."
                : "Выберите блюда и укажите пожелания. До утверждения заказ можно изменить."}
          </p>
        </div>
      </div>
      {guestView && <BudgetHelp guest />}
      {budgeted && <BudgetMeter foodBudget={limits.pie} drinkBudget={limits.bottle} spent={spent} guestView={guestView} />}
      <section className="selection-bottom" aria-label="Оформление заказа">
        <div className="selection-summary">
          <strong>Ваш заказ</strong>
          {chosen.length ? (
            <ul className="selection-items">
              {chosen.map(item => <li key={item.id}><span>{item.name}</span><b>× {item.quantity}</b></li>)}
            </ul>
          ) : <p className="muted">Пока ничего не выбрано. Добавьте блюда или напитки из меню ниже.</p>}
        </div>
        <label>
          Пожелания для кухни
          <textarea
            value={notes}
            disabled={locked}
            maxLength={500}
            onChange={(e) => {
              setNotes(e.target.value);
              setDirty(true);
            }}
            placeholder="Например, соус отдельно. Укажите пищевые ограничения."
          />
          <small>Пожелания увидят организатор и ресторан. Состав блюд уточняется у ресторана.</small>
        </label>
        <div className="selection-total">
          <span>Ваш выбор · {count} {portionWord(count)}</span>
          {guestView ? <strong className="unit-total">{units(spent.pie, "pie")} · {units(spent.bottle, "bottle")}</strong> : <strong>{money(total)}</strong>}
          <Button
            disabled={busy || locked || count === 0 || over}
            onClick={async () => {
              const result = await save({
                items: Object.entries(items)
                  .filter(([id, q]) => q > 0 && selectable.some((i) => i.id === id))
                  .map(([menuItemId, quantity]) => ({ menuItemId, quantity })),
                notes,
              });
              if (result !== null) setDirty(false);
            }}
          >
            {busy ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}{" "}
            {locked ? "Выбор зафиксирован" : "Сохранить"}
          </Button>
          {over ? <small className="budget-warning">Выбор превышает бюджет — уберите что-нибудь</small>
            : dirty ? <small>Есть несохранённые изменения</small>
              : detail.event.status === "approved" && selection?.submitted ? <small className="green">Организатор согласовал заказ</small>
                : selection?.submitted ? <small className="green">Отправлено организатору на согласование</small> : null}
        </div>
      </section>
      {!locked && canSelect && <div className="guest-guide"><strong>Как выбрать</strong><p>Добавьте порции кнопками у блюд и напитков ниже. Состав заказа обновится в карточке выше — там же можно добавить пожелания и сохранить выбор.</p>{budgeted && <p>У еды и напитков отдельные лимиты. Индикаторы показывают, сколько вы уже выбрали и сколько осталось. Блюдо сверх лимита добавить нельзя.</p>}</div>}
      {shared.length > 0 && (
        <section className="shared-table">
          <h3>Позиции общего стола</h3>
          <p className="muted">Эти блюда организатор заказал для всех. Добавлять их в свой заказ не нужно.</p>
          <div className="shared-list">
            {shared.map((s) => {
              const item = detail.menu.find((m) => m.id === s.menuItemId);
              return (
                <div key={s.menuItemId} className="shared-item">
                  <span className="shared-emoji">{item?.photoUrl ? <img src={`${BASE}${item.photoUrl}`} alt="" loading="lazy" /> : item?.emoji || "🍽️"}</span>
                  <div>
                    <strong>{s.name}</strong>
                    <small>{item?.category}{item?.weight ? ` · ${item.weight}` : ""}</small>
                  </div>
                  <span className="shared-qty">× {s.quantity}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}
      <div className="diet-filters" aria-label="Фильтры блюд">
        <label className="vegetarian-filter"><input type="checkbox" checked={vegetarian} onChange={event => setVegetarian(event.target.checked)} /><Leaf size={15} /> Без мяса</label>
        {MENU_LABELS.map(label => <label key={label} className="vegetarian-filter"><input type="checkbox" checked={selectedLabels.includes(label)} onChange={event => setSelectedLabels(values => event.target.checked ? [...values, label] : values.filter(value => value !== label))} />{label}</label>)}
      </div>
      <div className="category-tabs">
        {categories.map((c) => (
          <button
            key={c}
            className={c === category ? "active" : ""}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="menu-grid">
        {visible.map((i) => (
            <DishCard
              key={i.id}
              item={i}
              locked={locked}
              priceLabel={price(i)}
              canAdd={fits(i)}
              quantity={items[i.id] || 0}
              onChange={(q) => {
                setItems((v) => ({ ...v, [i.id]: q }));
                setDirty(true);
              }}
            />
          ))}
      </div>
      {!visible.length && <p className="muted">По выбранным фильтрам блюд нет. Снимите одну из пометок.</p>}
    </>
  );
}
function EventAdmin({ section, detail, catalog, canEditDishes, busy, saveEvent, removeEvent, uploadPhoto, onError, addGuest, editGuest, deleteDish, editDish, setForGuests, saveShared, saveCatalogMenu }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [modeDraft, setModeDraft] = useState(detail.event.selectionMode || 'individual');
  const [packageDraft, setPackageDraft] = useState(detail.event.package?.id || '');
  const [dateDraft, setDateDraft] = useState(localDateTime(detail.event.date));
  const [deadlineDraft, setDeadlineDraft] = useState(localDateTime(detail.event.deadline));
  const [hallDraft, setHallDraft] = useState(detail.event.hallId);
  const [durationDraft, setDurationDraft] = useState(detail.event.durationHours || 4);
  const [photoDraft, setPhotoDraft] = useState({ file: null, removed: false });
  const [editing, setEditing] = useState(null);
  const [importing, setImporting] = useState(null);
  const [catalogQuery, setCatalogQuery] = useState('');
  const serverShared = JSON.stringify(detail.shared || []);
  const toDraft = () => Object.fromEntries((detail.shared || []).map(s => [s.menuItemId, s.quantity]));
  const [shared, setShared] = useState(toDraft);
  const [sharedDirty, setSharedDirty] = useState(false);
  useEffect(() => { if (!sharedDirty) setShared(toDraft()); }, [serverShared]);
  useEffect(() => { setModeDraft(detail.event.selectionMode || 'individual'); }, [detail.event.selectionMode]);
  useEffect(() => { setPackageDraft(detail.event.package?.id || ''); }, [detail.event.package?.id]);
  useEffect(() => { setDateDraft(localDateTime(detail.event.date)); setDeadlineDraft(localDateTime(detail.event.deadline)); setHallDraft(detail.event.hallId); setDurationDraft(detail.event.durationHours || 4); }, [detail.event.id, detail.event.date, detail.event.deadline, detail.event.hallId, detail.event.durationHours]);
  useEffect(() => { setPhotoDraft({ file: null, removed: false }); }, [detail.event.id, detail.event.photoUrl]);
  const chooseEventDate = selected => {
    setDateDraft(selected);
    if (selected && (!deadlineDraft || moscowIso(deadlineDraft) >= moscowIso(selected))) setDeadlineDraft(deadlineBefore(selected));
  };
  const active = detail.event.status === 'collecting';
  const durations = bookingDurationOptions(catalog?.halls?.find(hall => hall.id === hallDraft), dateDraft, durationDraft);
  const validDurations = durationOptions(catalog?.halls?.find(hall => hall.id === hallDraft), dateDraft);
  const packages = [...(catalog?.packages || [])];
  if (detail.event.package && !packages.some(offer => offer.id === detail.event.package.id)) packages.push(detail.event.package);
  const selectedOffer = packages.find(offer => offer.id === packageDraft) || packages[0];
  const hotChoices = selectedOffer?.items.filter(item => item.choiceGroup) || [];
  const inMenu = new Set(detail.menu.map(item => item.id));
  const catalogItems = (catalog?.menu || []).filter(item => item.available || inMenu.has(item.id));
  const visibleCatalogItems = catalogItems.filter(item => `${item.name} ${item.category} ${item.description || ''}`.toLocaleLowerCase('ru').includes(catalogQuery.trim().toLocaleLowerCase('ru')));
  const invited = detail.invitedGuests || [];
  const unlistedGuests = detail.guests.filter(guest => !invited.some(entry => entry.userId === guest.id));
  const orderedIds = new Set(detail.guests.flatMap(guest => guest.items.map(item => item.menuItemId)));
  const lockedCatalogIds = new Set([...orderedIds, ...(detail.shared || []).map(item => item.menuItemId)]);
  const sharedLines = detail.menu.filter(item => (shared[item.id] || 0) > 0).map(item => ({ ...item, quantity: shared[item.id], lineTotal: item.price * shared[item.id] }));
  const sharedTotal = sharedLines.reduce((sum, item) => sum + item.lineTotal, 0);
  const setSharedQty = (id, quantity) => { setShared(value => ({ ...value, [id]: quantity })); setSharedDirty(true); };
  return (
    <div className="admin-layout">
      {!active && <div className="alert">Заказ утверждён: параметры, гости и меню больше не меняются.</div>}
      {section === 'settings' && <section className="panel admin-panel">
        <div className="section-head"><div><h2>Параметры банкета</h2><p className="muted">Дата, срок выбора, число гостей и бюджет на одного гостя.</p></div></div>
        <form onSubmit={async event => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          let photoUrl = photoDraft.removed ? '' : detail.event.photoUrl || '';
          if (photoDraft.file) {
            const uploaded = await uploadPhoto(photoDraft.file);
            if (!uploaded) return;
            photoUrl = uploaded.photoUrl;
          }
          const nextMode = form.get('selectionMode');
          const nextPackage = form.get('packageId');
          const nextChoice = form.get('packageChoice');
          const currentHot = detail.event.package?.items.find(item => item.category === 'Горячее')?.dishId;
          const changePackage = nextMode === 'package' && (nextPackage !== detail.event.package?.id || (nextChoice && nextChoice !== currentHot));
          saveEvent({ title: form.get('title'), photoUrl, date: moscowIso(dateDraft), deadline: moscowIso(deadlineDraft), durationHours: durationDraft, hallId: form.get('hallId'), expectedGuests: Number(form.get('expectedGuests')), foodBudget: Math.round(Number(form.get('foodBudget') || 0) * 100), drinkBudget: Math.round(Number(form.get('drinkBudget') || 0) * 100), selectionMode: nextMode, ...(changePackage ? { packageId: nextPackage, ...(nextChoice ? { packageChoice: nextChoice } : {}) } : {}) });
        }}>
          <label>Название<input name="title" required maxLength={120} defaultValue={detail.event.title} disabled={!active} /></label>
          <EventPhotoField currentSrc={detail.event.photoUrl ? `${BASE}${detail.event.photoUrl}` : ''} file={photoDraft.file} removed={photoDraft.removed} onChange={setPhotoDraft} onError={onError} disabled={!active || busy} />
          <label>Формат заказа<select name="selectionMode" defaultValue={detail.event.selectionMode || 'individual'} disabled={!active} onChange={event => setModeDraft(event.target.value)}><option value="individual">Гости выбирают блюда сами</option><option value="package" disabled={!packages.length}>Фиксированный пакет на гостя</option></select></label>
          {modeDraft === 'package' && <label>Пакетное предложение<select name="packageId" value={selectedOffer?.id || ''} onChange={event => setPackageDraft(event.target.value)} disabled={!active}>{packages.map(offer => <option key={offer.id} value={offer.id}>{offer.name} · {money(offer.price)}{catalog?.packages?.some(item => item.id === offer.id) ? '' : ' · сохранён в банкете'}</option>)}</select></label>}
          {modeDraft === 'package' && hotChoices.length > 0 && <label>Горячее блюдо для всех гостей<select key={selectedOffer?.id} name="packageChoice" defaultValue={hotChoices.some(item => item.dishId === detail.event.package?.items.find(item => item.category === 'Горячее')?.dishId) ? detail.event.package.items.find(item => item.category === 'Горячее').dishId : hotChoices[0].dishId} disabled={!active}>{hotChoices.map(choice => <option key={choice.dishId} value={choice.dishId}>{choice.name}</option>)}</select></label>}
          <div className="form-grid">
            <label>Длительность, часов<select name="durationHours" required value={durationDraft || ''} onChange={event => setDurationDraft(Number(event.target.value))} disabled={!active}><option value="" disabled>{durations.length ? 'Выберите длительность' : 'Нет времени до закрытия'}</option>{durations.map(hours => <option key={hours} value={hours}>{hours} {hours === 1 ? 'час' : hours < 5 ? 'часа' : 'часов'}{hours === durationDraft && !validDurations.includes(hours) ? ' · выберите время в календаре' : ''}</option>)}</select></label>
            <label>Зал<select name="hallId" value={hallDraft} onChange={event => setHallDraft(event.target.value)} disabled={!active}>{catalog?.halls?.map(hall => <option key={hall.id} value={hall.id}>{hall.name} · до {hall.capacity} гостей</option>)}</select></label>
            <RussianDateTimeInput key={`${detail.event.id}-deadline-${detail.event.deadline}`} name="deadline" label="Выбор блюд до · МСК" required value={deadlineDraft} onChange={setDeadlineDraft} disabled={!active} />
            <label>Количество гостей<input type="number" name="expectedGuests" min="1" max={Math.min(1000, catalog?.halls?.find(hall => hall.id === hallDraft)?.capacity || 1000, catalog?.halls?.find(hall => hall.id === hallDraft)?.seatingConfig?.type === 'fixed' ? layoutSeats(catalog.halls.find(hall => hall.id === hallDraft).seatingConfig.fixedLayout).length : 1000)} required defaultValue={detail.event.expectedGuests} disabled={!active} /></label>
            {modeDraft === 'individual' && <label>Бюджет на еду на гостя, ₽<input type="number" name="foodBudget" min="0" max="100000000" step="0.01" defaultValue={detail.event.foodBudget / 100} disabled={!active} /></label>}
            {modeDraft === 'individual' && <label>Бюджет на напитки на гостя, ₽<input type="number" name="drinkBudget" min="0" max="100000000" step="0.01" defaultValue={detail.event.drinkBudget / 100} disabled={!active} /></label>}
            {modeDraft === 'individual' && <BudgetHelp />}
          </div>
          {active && <BookingMiniCalendar restaurantId={detail.event.restaurantId} hallId={hallDraft} durationHours={durationDraft} value={dateDraft} onChange={chooseEventDate} excludeEventId={detail.event.id} />}
          {!active && <p className="muted">Дата мероприятия: {formatRussianDateTime(dateDraft)} МСК.</p>}
          {active && <Button type="submit" disabled={busy || !dateDraft}>Сохранить параметры</Button>}
        </form>
        {removeEvent && <div className="danger-zone"><strong>Удаление банкета</strong><p>Банкет, заявки гостей и рассадка будут удалены без возможности восстановления.</p><Button type="button" variant="secondary" disabled={busy} onClick={async () => { if (await ask(`Удалить банкет «${detail.event.title}» вместе с заказами и рассадкой?`, { confirmLabel: 'Удалить банкет' })) removeEvent(); }}>Удалить банкет</Button></div>}
      </section>}
      {section === 'guests' && <section className="panel admin-panel">
        <div className="section-head"><div><h2>Приглашённые гости</h2><p className="muted">Гость подтвердит свой номер в MAX; статус и место видны ниже.</p></div><span>{detail.invitedGuests?.length || 0} из {detail.event.expectedGuests}</span></div>
        <div className="admin-guest-list">
          {invited.length ? invited.map(guest => {
            const person = detail.guests.find(entry => entry.id === guest.userId);
            const seat = person?.seat || detail.seating?.people?.find(entry => entry.key === `invite:${guest.id}`)?.seatId;
            return <div className="admin-guest" key={guest.id}>
            <div><strong>{guest.name}</strong><small>+{guest.phone} · MAX ID: {guest.maxId || 'не привязан'}</small><small>{detail.seating?.mode === 'off' ? 'Рассадка не включена' : seat || 'Место не назначено'} · {detail.event.selectionMode === 'package' ? (guest.joined ? 'Присоединился' : 'Ожидает входа') : guest.submitted ? 'Выбор сохранён' : guest.joined ? 'Выбирает блюда' : 'Ожидает входа'}</small>{person?.submitted && <small>{person.items.map(item => `${item.name} × ${item.quantity}`).join(', ')} · {money(person.total)}</small>}{person?.notes && <small>Пожелания: {person.notes}</small>}</div>
            {active && <div className="admin-actions"><button type="button" onClick={() => setEditing({ ...guest, phone: `+${guest.phone}` })}>Изменить</button><button type="button" disabled={busy || guest.submitted} onClick={async () => { if (await ask(`Удалить ${guest.name} из списка гостей?`, { confirmLabel: 'Удалить' })) deleteGuest(guest.id); }}>Удалить</button></div>}
          </div>;
          }) : <p className="muted">Добавьте гостей перед отправкой приглашения. Один номер соответствует одному гостю.</p>}
          {unlistedGuests.map(guest => <div className="admin-guest" key={guest.id}><div><strong>{guest.name}</strong><small>{guest.phone ? `+${guest.phone}` : 'Номер не указан'} · MAX ID: {guest.maxId || 'не привязан'}</small><small>{guest.seat || 'Место не назначено'} · {detail.event.selectionMode === 'package' ? 'Фиксированный пакет' : guest.submitted ? `Выбор сохранён · ${money(guest.total)}` : 'Пока не выбрал блюда'}</small>{guest.submitted && <small>{guest.items.map(item => `${item.name} × ${item.quantity}`).join(', ')}</small>}</div></div>)}
        </div>
        {active && <form className="admin-guest-form" onSubmit={async event => {
          event.preventDefault();
          const result = await addGuest({ name, phone });
          if (result !== null) { setName(''); setPhone(''); }
        }}>
          <input aria-label="Имя гостя" placeholder="Имя гостя" maxLength={100} required value={name} onChange={event => setName(event.target.value)} />
          <PhoneInput aria-label="Телефон гостя" required value={phone} onChange={setPhone} />
          <Button type="submit" disabled={busy}><Plus size={16} /> Добавить гостя</Button>
        </form>}
      </section>}
      {section === 'menu' && (detail.event.selectionMode === 'package' ? <PackageView offer={detail.event.package} guests={detail.event.expectedGuests} /> : <section className="panel admin-panel">
        <div className="section-head"><div><h2>Меню этого банкета</h2><p className="muted">Здесь вы определяете состав меню только для этого мероприятия.</p></div>
          {active && <div className="admin-actions">
            <button type="button" onClick={() => { setCatalogQuery(''); setImporting(catalogItems.filter(item => inMenu.has(item.id)).map(item => item.id)); }}><Plus size={15} /> Выбрать из каталога</button>
            {canEditDishes && <button type="button" onClick={() => editDish({ category: 'Закуски', price: 0, available: true, vegetarian: false, allergens: [], nutrition: { kcal: 0, protein: 0, fat: 0, carbs: 0 } })}><Plus size={15} /> Своя позиция</button>}
          </div>}
        </div>
        <div className="event-menu-guide">
          <p><strong>1. Выберите блюда из каталога.</strong> Отметьте в карточках «Гостям на выбор», чтобы гости могли сами заказать эти позиции.</p>
          <p><strong>2. Укажите количество для общего стола.</strong> Эти порции заказываются сразу для всех, не предлагаются гостям для личного выбора и не расходуют их бюджет. Состав и итоговую стоимость проверьте ниже, затем сохраните.</p>
        </div>
        <div className="shared-summary">
          <div className="shared-summary-heading">
            <div><strong>Позиции общего стола</strong><small>{positions(sharedLines.length)} · не входит в бюджет гостей</small></div>
            <b>{money(sharedTotal)}</b>
          </div>
          {sharedLines.length ? <ul className="shared-summary-list">{sharedLines.map(item => <li key={item.id}><span>{item.name}</span><span>× {item.quantity}</span><strong>{money(item.lineTotal)}</strong></li>)}</ul> : <p className="shared-summary-empty">Пока ничего не выбрано для общего стола.</p>}
          {active && sharedDirty && <div className="shared-summary-actions"><span>Есть несохранённые изменения</span>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => { setShared(toDraft()); setSharedDirty(false); }}>Отменить</Button>
            <Button type="button" disabled={busy} onClick={async () => {
              const result = await saveShared(Object.entries(shared).filter(([, quantity]) => quantity > 0).map(([menuItemId, quantity]) => ({ menuItemId, quantity })));
              if (result !== null) setSharedDirty(false);
            }}>Сохранить позиции общего стола</Button>
          </div>}
        </div>
        <div className="menu-grid catalog">{detail.menu.map(item => {
          const onShared = (shared[item.id] || 0) > 0;
          return <div key={item.id} className={`event-dish ${item.forGuests === false && !onShared ? 'hidden-dish' : ''}`}>
            <DishCard item={item} admin={active && canEditDishes} edit={() => editDish(item)} />
            <div className="event-dish-controls">
              <div className="event-dish-controls-header"><strong>Для блюда «{item.name}»</strong><small>Настройка в этом банкете</small></div>
              <label className="check">
                <input type="checkbox" checked={item.forGuests !== false && !onShared} disabled={!active || busy || onShared || (item.forGuests !== false && orderedIds.has(item.id))} onChange={event => setForGuests(item, event.target.checked)} />
                Гостям на выбор
              </label>
              <div className="shared-control">
                <span>На общий стол</span>
                <div className="stepper">
                  <button type="button" aria-label={`Меньше «${item.name}» на общий стол`} disabled={!active || !onShared} onClick={() => setSharedQty(item.id, (shared[item.id] || 0) - 1)}><Minus size={14} /></button>
                  <span>{shared[item.id] || 0}</span>
                  <button type="button" aria-label={`Больше «${item.name}» на общий стол`} disabled={!active || !item.available || orderedIds.has(item.id)} onClick={() => setSharedQty(item.id, (shared[item.id] || 0) + 1)}><Plus size={14} /></button>
                </div>
              </div>
              {active && <button type="button" className="text-button" disabled={busy || onShared || orderedIds.has(item.id)} onClick={async () => { if (await ask(`Убрать «${item.name}» из меню банкета?`, { confirmLabel: 'Убрать' })) deleteDish(item.id); }}>Убрать из меню</button>}
            </div>
          </div>;
        })}</div>
      </section>)}
      {section === 'menu' && importing && <Modal title="Выбрать блюда из каталога" onClose={() => setImporting(null)}>
        <p className="muted">Отмеченные блюда входят в меню этого банкета. Уже выбранные гостями блюда и общий стол нельзя убрать.</p>
        <label>Поиск блюда<input type="search" placeholder="Название или категория" value={catalogQuery} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} onChange={event => setCatalogQuery(event.target.value)} /></label>
        <div className="catalog-selection-tools"><span>В меню: {importing.length} из {catalogItems.length}</span><button type="button" onClick={() => setImporting(current => [...new Set([...current, ...visibleCatalogItems.filter(item => item.available).map(item => item.id)])])}>Выбрать найденные</button><button type="button" onClick={() => setImporting(current => current.filter(id => lockedCatalogIds.has(id) || !visibleCatalogItems.some(item => item.id === id)))}>Снять найденные</button></div>
        <div className="import-list">
          {visibleCatalogItems.map(item => <label key={item.id} className="check">
            <input type="checkbox" checked={importing.includes(item.id)} disabled={lockedCatalogIds.has(item.id)} onChange={event => setImporting(event.target.checked ? [...importing, item.id] : importing.filter(id => id !== item.id))} />
            <span>{item.emoji || '🍽️'} {item.name}<small>{item.category} · {money(item.price)}{lockedCatalogIds.has(item.id) ? ' · уже в заказе' : !item.available ? ' · недоступно в каталоге' : ''}</small></span>
          </label>)}
          {!visibleCatalogItems.length && <p className="muted">Подходящих блюд не найдено.</p>}
        </div>
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={() => setImporting(null)}>Отмена</Button>
          <Button type="button" disabled={busy} onClick={async () => { const result = await saveCatalogMenu(importing); if (result !== null) setImporting(null); }}>Сохранить выбор</Button>
        </div>
      </Modal>}
      {section === 'guests' && editing && <Modal title="Данные гостя" onClose={() => setEditing(null)}>
        <form onSubmit={async event => {
          event.preventDefault();
          const result = await editGuest(editing.id, { name: editing.name, phone: editing.phone });
          if (result !== null) setEditing(null);
        }}>
          <label>Имя<input required maxLength={100} value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} /></label>
          <label>Телефон<PhoneInput required value={formatPhone(editing.phone)} disabled={editing.joined} onChange={phone => setEditing({ ...editing, phone })} /></label>
          {editing.joined && <p className="muted">Номер закреплён за аккаунтом MAX. Имя можно изменить.</p>}
          <div className="modal-actions"><Button type="button" variant="secondary" onClick={() => setEditing(null)}>Отмена</Button><Button type="submit" disabled={busy}>Сохранить</Button></div>
        </form>
      </Modal>}
    </div>
  );
}
function UsersAdmin({ session, events, busy, load, setRole, setGlobal, setOrganizer, onError }) {
  const administered = (session.access || []).filter(entry => entry.role === 'admin');
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState(null);
  const [identity, setIdentity] = useState('');
  const [kind, setKind] = useState(events.length ? 'organizer' : session.superAdmin ? 'restaurant' : 'organizer');
  const [eventId, setEventId] = useState(events[0]?.id || '');
  const [restaurantId, setRestaurantId] = useState(administered[0]?.restaurantId || '');
  const reload = async () => setUsers(await load(query));
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => load(query).then(list => { if (active) setUsers(list); }).catch(error => onError(error.message)), query ? 250 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [query, events.length]);
  const grant = async (target, nextKind = kind, targetId = nextKind === 'organizer' ? eventId : restaurantId, enabled = true) => {
    const result = nextKind === 'global' ? await setGlobal(target, enabled) : nextKind === 'restaurant' ? await setRole(targetId, target, enabled ? 'admin' : 'none') : await setOrganizer(targetId, target, enabled);
    if (result !== null) await reload();
    return result;
  };
  return <section className="panel admin-panel users-admin">
    {!session.demo && <form className="grant-max-form" onSubmit={async event => {
      event.preventDefault();
      const raw = identity.trim();
      const target = raw.includes('@') ? '' : raw.startsWith('+') || /^8[\s(]*\d/.test(raw) ? `phone:${raw.replace(/[^+\d]/g, '')}` : /^(?:max:)?[1-9]\d{0,18}$/.test(raw) ? `max:${raw.replace(/^max:/, '')}` : '';
      if (!target) return onError('Укажите номер телефона или числовой MAX ID.');
      if (await grant(target) !== null) setIdentity('');
    }}>
      <strong>Добавить человека</strong>
      <input aria-label="Телефон или MAX ID" placeholder="+7 999 123-45-67 или MAX ID" value={identity} onChange={event => setIdentity(event.target.value)} required />
      <select aria-label="Назначаемая роль" value={kind} onChange={event => setKind(event.target.value)}>
        {events.length > 0 && <option value="organizer">Организатор банкета</option>}
        {session.superAdmin && administered.length > 0 && <option value="restaurant">Администратор ресторана</option>}
        {session.superAdmin && <option value="global">Администратор сервиса</option>}
      </select>
      {kind === 'organizer' && <select aria-label="Банкет" value={eventId} onChange={event => setEventId(event.target.value)}>{events.map(event => <option value={event.id} key={event.id}>{event.title} · {event.restaurantName}</option>)}</select>}
      {kind === 'restaurant' && <select aria-label="Ресторан" value={restaurantId} onChange={event => setRestaurantId(event.target.value)}>{administered.map(entry => <option value={entry.restaurantId} key={entry.restaurantId}>{entry.restaurantName}</option>)}</select>}
      <Button type="submit" disabled={busy || (kind === 'organizer' && !eventId) || (kind === 'restaurant' && !restaurantId)}>Назначить</Button>
      <small className="muted">При назначении по телефону доступ появится после подтверждения этого номера в MAX.</small>
    </form>}
    <label className="search-field"><Search size={16} /><input type="search" placeholder="Поиск среди участников и администраторов" value={query} onChange={event => setQuery(event.target.value)} aria-label="Поиск пользователя" /></label>
    {!users ? <div className="loading-inline"><LoaderCircle className="spin" />Загружаем доступы…</div> : users.length ? <div className="admin-guest-list">{users.map(user => <div className="user-row" key={user.id}>
      <div><strong>{user.name}{user.isYou ? ' (вы)' : ''}</strong><small>{[user.maxId && `MAX ID ${user.maxId}`, user.phone && `+${user.phone}`].filter(Boolean).join(' · ') || 'Номер не подтверждён'}</small></div>
      <div className="user-roles">
        {session.superAdmin && !session.demo && <label><span>Сервис</span><select value={user.superAdmin ? 'admin' : 'none'} disabled={busy || user.isYou || user.fixedGlobal} onChange={event => grant(user.id, 'global', '', event.target.value === 'admin')}><option value="none">Нет роли</option><option value="admin">Администратор</option></select></label>}
        {administered.map(entry => <label key={entry.restaurantId}><span>{entry.restaurantName}</span><select value={user.roles[entry.restaurantId] || 'none'} disabled={busy || !session.superAdmin || user.isYou || user.fixed || user.superAdmin} onChange={event => grant(user.id, 'restaurant', entry.restaurantId, event.target.value === 'admin')}><option value="none">Нет роли</option><option value="admin">Администратор ресторана</option></select></label>)}
        {events.map(event => <label key={event.id}><span>{event.title} · {event.restaurantName}{user.eventOwned?.[event.id] ? ' · создатель' : ''}</span><select value={user.eventRoles?.[event.id] ? 'organizer' : 'none'} disabled={busy || user.eventOwned?.[event.id]} onChange={input => grant(user.id, 'organizer', event.id, input.target.value === 'organizer')}><option value="none">Нет роли</option><option value="organizer">Организатор банкета</option></select></label>)}
      </div>
    </div>)}</div> : <p className="muted">{query ? 'Совпадений нет.' : 'Участников и администраторов пока нет.'}</p>}
  </section>;
}
function KitchenBoard({ board, open, selected, setSelected, exportOne }) {
  if (!board) return <div className="loading-inline"><LoaderCircle className="spin" />Загружаем заказы…</div>;
  if (!board.length) return <Empty title="Запланированных банкетов нет">Когда организатор создаст банкет, он появится здесь.</Empty>;
  return (
    <div className="kitchen-board">
      {board.map(({ event, summary, shared, guests }) => (
        <section className="panel kitchen" key={event.id}>
          <div className="section-head">
            <div>
              <label className="check kitchen-pick"><input type="checkbox" checked={selected.includes(event.id)} onChange={e => setSelected(value => e.target.checked ? [...value, event.id] : value.filter(id => id !== event.id))} /> В общую выгрузку</label>
              <Tag approved={event.status === "approved"} />
              <h2>{event.title}</h2>
              <p className="muted">{dateText(event.date, true)} · Организатор: {event.ownerName || "—"} · {event.selectionMode === 'package' ? `${event.expectedGuests} фиксированных пакетов` : `ответили ${event.responded} из ${event.expectedGuests}`}</p>
            </div>
            <div className="admin-actions"><Button variant="secondary" onClick={() => open(event.id)}>Открыть</Button><Button variant="secondary" onClick={() => exportOne('xlsx', [event.id])}><FileSpreadsheet size={16} /> Excel</Button><Button variant="secondary" onClick={() => exportOne('csv', [event.id])}><Download size={16} /> CSV</Button></div>
          </div>
          <div className="kitchen-table">
            <div className="kitchen-row table-header"><span>Блюдо</span><span>Порции</span><span>Стоимость</span></div>
            {summary.map(item => <div className="kitchen-row" key={item.menuItemId}><strong>{item.name}</strong><span>{item.quantity} шт.</span><strong>{money(item.total)}</strong></div>)}
            <div className="kitchen-row table-total"><strong>Итого</strong><span>{summary.reduce((n, v) => n + v.quantity, 0)} шт.</span><strong>{money(event.total)}</strong></div>
          </div>
          {shared.length > 0 && <p className="muted">Из них на общий стол: {shared.map(item => `${item.name} × ${item.quantity}`).join(", ")}</p>}
          {guests.some(guest => guest.notes || guest.seat) && <>
            <h3>Гости</h3>
            {guests.filter(guest => guest.notes || guest.seat).map((guest, index) => <div className="dietary-row" key={index}>
              <Leaf size={16} /><strong>{guest.name}</strong><span>{[guest.seat, guest.notes].filter(Boolean).join(" · ")}</span>
            </div>)}
          </>}
        </section>
      ))}
    </div>
  );
}
const WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
function HallEditor({ hall, busy, onClose, submit, remove }) {
  const [name, setName] = useState(hall.name || '');
  const [capacity, setCapacity] = useState(hall.capacity || 100);
  const [windows, setWindows] = useState(hall.windows || []);
  const previousWindows = useRef(alwaysOpen(hall.windows) ? [{ weekday: 1, start: '09:00', end: '23:00' }] : hall.windows || []);
  const [seatingConfig, setSeatingConfig] = useState(hall.seatingConfig || { type: 'fixed', fixedLayout: generateLayout('rounds', Math.min(hall.capacity || 100, 20)), tablePresets: [{ shape: 'round', seats: 6 }, { shape: 'round', seats: 8 }, { shape: 'rect', seats: 6 }, { shape: 'rect', seats: 10 }] });
  const updateConfig = patch => setSeatingConfig(current => ({ ...current, ...patch }));
  const updateWindow = (index, field, value) => setWindows(current => current.map((item, i) => i === index ? { ...item, [field]: field === 'weekday' ? Number(value) : value } : item));
  return <Modal title={hall.id ? 'Настроить зал' : 'Новый зал'} onClose={onClose}><form onSubmit={event => { event.preventDefault(); submit({ name, capacity: Number(capacity), windows, seatingConfig }); }}>
    <label>Название зала<input required maxLength={100} value={name} onChange={event => setName(event.target.value)} /></label>
    <label>Вместимость, гостей<input required type="number" min="1" max="1000" value={capacity} onChange={event => setCapacity(event.target.value)} /></label>
    <h3>Окна бронирования</h3><p className="muted">Время по Москве, в 24-часовом формате. Для работы без перерыва включите «Круглосуточно»: 23:59 оставляет последнюю минуту дня вне бронирования.</p>
    <label className="seating-option always-open-option"><input type="checkbox" checked={alwaysOpen(windows)} onChange={event => { if (event.target.checked) { previousWindows.current = windows; setWindows(Array.from({ length: 7 }, (_, weekday) => ({ weekday, start: '00:00', end: '24:00' }))); } else setWindows(previousWindows.current.length && !alwaysOpen(previousWindows.current) ? previousWindows.current : [{ weekday: 1, start: '09:00', end: '23:00' }]); }} /><span>Круглосуточно · 24/7</span></label>
    <div className="booking-windows">{windows.map((window, index) => <div className="booking-window" key={index}><select aria-label={`День ${index + 1}`} value={window.weekday} onChange={event => updateWindow(index, 'weekday', event.target.value)}>{WEEKDAYS.map((day, weekday) => <option key={day} value={weekday}>{day}</option>)}</select><input type="text" inputMode="text" maxLength={5} required pattern="([01][0-9]|2[0-3]):[0-5][0-9]" placeholder="00:00" aria-label={`Начало окна ${index + 1}, 24 часа`} value={window.start} onChange={event => updateWindow(index, 'start', event.target.value)} /><input type="text" inputMode="text" maxLength={5} required pattern="(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)" placeholder="24:00" aria-label={`Конец окна ${index + 1}, 24 часа`} value={window.end} onChange={event => updateWindow(index, 'end', event.target.value)} /><button type="button" className="icon-btn" aria-label="Удалить окно" onClick={() => setWindows(current => current.filter((_, i) => i !== index))}><X size={16} /></button></div>)}</div>
    <button type="button" className="text-button" onClick={() => setWindows(current => [...current, { weekday: 1, start: '09:00', end: '23:00' }])}>+ Добавить окно</button>
    <h3>Столы и стулья</h3><p className="muted">Настройка применяется к новым банкетам. Уже созданные сохраняют свою схему.</p>
    <div className="hall-policy-options" role="radiogroup" aria-label="Кто расставляет столы"><label className="seating-option"><input type="radio" name="layoutPolicy" checked={seatingConfig.type === 'fixed'} onChange={() => updateConfig({ type: 'fixed' })} /><span><strong>Готовая схема ресторана</strong><small>Столы и стулья закреплены. Организатор выбирает: гости садятся сами, места назначает он или рассадки нет.</small></span></label><label className="seating-option"><input type="radio" name="layoutPolicy" checked={seatingConfig.type === 'flexible'} onChange={() => updateConfig({ type: 'flexible' })} /><span><strong>Столы расставляет организатор</strong><small>Он использует только разрешённые рестораном формы и размеры столов.</small></span></label></div>
    {seatingConfig.type === 'fixed' ? <HallLayoutDesigner layout={seatingConfig.fixedLayout} onChange={fixedLayout => updateConfig({ fixedLayout })} capacity={Number(capacity)} /> : <div className="hall-presets"><strong>Доступные столы</strong><p className="muted">Укажите, какие столы и сколько стульев за каждым можно использовать.</p><details><summary>Изменить набор · {seatingConfig.tablePresets.length} размеров</summary><div className="hall-presets-list">{seatingConfig.tablePresets.map((preset, index) => <div className="hall-preset-row" key={index}><select aria-label={`Форма стола ${index + 1}`} value={preset.shape} onChange={event => updateConfig({ tablePresets: seatingConfig.tablePresets.map((item, i) => i === index ? { ...item, shape: event.target.value } : item) })}><option value="round">Круглый</option><option value="rect">Прямоугольный</option></select><input aria-label={`Мест за столом ${index + 1}`} type="number" min="1" max="40" value={preset.seats} onChange={event => updateConfig({ tablePresets: seatingConfig.tablePresets.map((item, i) => i === index ? { ...item, seats: Number(event.target.value) } : item) })} /><button type="button" aria-label={`Убрать размер ${index + 1}`} onClick={() => updateConfig({ tablePresets: seatingConfig.tablePresets.filter((_, i) => i !== index) })}><X size={15} /></button></div>)}</div><button type="button" className="text-button" onClick={() => updateConfig({ tablePresets: [...seatingConfig.tablePresets, { shape: 'round', seats: 8 }] })}>+ Добавить размер</button></details></div>}
    <div className="modal-actions">{remove && <Button type="button" variant="secondary" disabled={busy} onClick={async () => { if (await ask(`Удалить зал «${hall.name}»?`, { confirmLabel: 'Удалить' })) remove(); }}>Удалить зал</Button>}<Button type="button" variant="secondary" onClick={onClose}>Отмена</Button><Button type="submit" disabled={busy || !windows.length}>Сохранить</Button></div>
  </form></Modal>;
}
function PackageDishEditor({ dish, busy, uploadPhoto, onClose, submit, remove }) {
  const [photoUrl, setPhotoUrl] = useState(dish.photoUrl || '');
  const [nutrition, setNutrition] = useState(dish.nutrition || { kcal: 0, protein: 0, fat: 0, carbs: 0 });
  const [labels, setLabels] = useState(dish.labels || []);
  return <Modal title={dish.id ? 'Блюдо пакетного предложения' : 'Новое блюдо пакета'} onClose={onClose}><form onSubmit={async event => { event.preventDefault(); const form = new FormData(event.currentTarget); const file = form.get('photo'); let nextPhoto = photoUrl; if (file?.size) { const uploaded = await uploadPhoto(file); if (!uploaded) return; nextPhoto = uploaded.photoUrl; } submit({ name: form.get('name'), category: form.get('category'), description: form.get('description'), weight: form.get('weight'), photoUrl: nextPhoto, vegetarian: form.get('vegetarian') === 'on', available: form.get('available') === 'on', nutrition: Object.fromEntries(Object.entries(nutrition).map(([key, value]) => [key, Number(value)])), labels, allergens: String(form.get('allergens') || '').split(',').map(value => value.trim()).filter(Boolean) }); }}>
    <p className="muted">Только для пакетного предложения. В обычное меню это блюдо не попадёт.</p>
    <label>Название<input name="name" required maxLength={120} defaultValue={dish.name || ''} /></label><label>Категория<input name="category" required maxLength={80} defaultValue={dish.category || ''} /></label><label>Описание<textarea name="description" maxLength={500} defaultValue={dish.description || ''} /></label><label>Вес порции<input name="weight" maxLength={40} defaultValue={dish.weight || ''} placeholder="100 г" /></label>
    {photoUrl && <div className="package-photo-preview"><img src={`${BASE}${photoUrl}`} alt="Фото блюда" /><button type="button" onClick={() => setPhotoUrl('')}>Убрать фото</button></div>}
    <label>Фото (JPEG, PNG, WebP, до 10 МБ)<input type="file" name="photo" accept="image/jpeg,image/png,image/webp" /></label>
    <div className="form-grid">{[['kcal', 'Ккал'], ['protein', 'Белки, г'], ['fat', 'Жиры, г'], ['carbs', 'Углеводы, г']].map(([key, label]) => <label key={key}>{label}<input type="number" required min="0" max="10000" step={key === 'kcal' ? '1' : '0.1'} value={nutrition[key]} onChange={event => setNutrition(current => ({ ...current, [key]: event.target.value }))} /></label>)}</div>
    <label>Аллергены через запятую<input name="allergens" defaultValue={(dish.allergens || []).join(', ')} /></label><label className="check"><input type="checkbox" name="vegetarian" defaultChecked={dish.vegetarian || false} /> Без мяса</label><label className="check"><input type="checkbox" name="available" defaultChecked={dish.available !== false} /> Доступно для пакетов</label>
    {MENU_LABELS.map(label => <label className="check" key={label}><input type="checkbox" checked={labels.includes(label)} onChange={event => setLabels(current => event.target.checked ? [...current, label] : current.filter(value => value !== label))} /> {label}</label>)}
    <div className="modal-actions">{remove && <Button type="button" variant="secondary" disabled={busy} onClick={async () => { if (await ask(`Удалить блюдо «${dish.name}»?`, { confirmLabel: 'Удалить' })) remove(); }}>Удалить</Button>}<Button type="button" variant="secondary" onClick={onClose}>Отмена</Button><Button type="submit" disabled={busy}>Сохранить</Button></div>
  </form></Modal>;
}
function EditPackage({ offer, dishes, busy, onError, onClose, submit, remove }) {
  const [name, setName] = useState(offer.name || '');
  const [description, setDescription] = useState(offer.description || '');
  const [price, setPrice] = useState((offer.price || 0) / 100);
  const [items, setItems] = useState((offer.items || []).map(item => ({ dishId: item.dishId, grams: item.grams, choiceGroup: item.choiceGroup || '' })));
  const update = (index, changes) => setItems(current => current.map((item, i) => i === index ? { ...item, ...changes } : item));
  return <Modal title={offer.id ? 'Пакетное предложение' : 'Новый пакет'} onClose={onClose}><form onSubmit={event => { event.preventDefault(); if (!items.length || items.some(item => !item.dishId || !Number.isInteger(Number(item.grams)) || Number(item.grams) < 1)) return onError('Добавьте хотя бы одно блюдо и укажите граммы.'); submit({ name, description, price: Math.round(Number(price) * 100), items: items.map(item => ({ ...item, grams: Number(item.grams) })) }); }}>
    <label>Название<input required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label><label>Цена на гостя, ₽<input required type="number" min="0.01" step="0.01" value={price} onChange={event => setPrice(event.target.value)} /></label><label>Описание<textarea maxLength={500} value={description} onChange={event => setDescription(event.target.value)} /></label>
    <h3>Состав пакета</h3><p className="muted">Выбирайте блюда из каталога «Только для пакетов». Для нескольких вариантов горячего включите «На выбор» у каждого.</p>
    {items.map((item, index) => <div className="package-edit-row" key={index}><select aria-label={`Блюдо ${index + 1}`} value={item.dishId} onChange={event => update(index, { dishId: event.target.value })}><option value="">Выберите блюдо</option>{dishes.filter(dish => dish.available || dish.id === item.dishId).map(dish => <option key={dish.id} value={dish.id}>{dish.category} · {dish.name}</option>)}</select><input type="number" min="1" max="10000" aria-label={`Граммы ${index + 1}`} value={item.grams} onChange={event => update(index, { grams: event.target.value })} /><span>г</span><label className="check"><input type="checkbox" checked={Boolean(item.choiceGroup)} onChange={event => update(index, { choiceGroup: event.target.checked ? 'Горячее' : '' })} /> На выбор</label><button type="button" className="icon-btn" aria-label="Убрать блюдо" onClick={() => setItems(current => current.filter((_, i) => i !== index))}><X size={16} /></button></div>)}
    <button type="button" className="text-button" disabled={!dishes.length} onClick={() => setItems(current => [...current, { dishId: dishes.find(dish => dish.available)?.id || '', grams: 100, choiceGroup: '' }])}>+ Добавить блюдо</button>{!dishes.length && <p className="muted">Сначала добавьте блюдо для пакетного предложения в разделе выше.</p>}
    <div className="modal-actions">{remove && <Button type="button" variant="secondary" disabled={busy} onClick={async () => { if (await ask(`Удалить пакет «${offer.name}»?`, { confirmLabel: 'Удалить' })) remove(); }}>Удалить</Button>}<Button type="button" variant="secondary" onClick={onClose}>Отмена</Button><Button type="submit" disabled={busy || !dishes.length}>Сохранить</Button></div>
  </form></Modal>;
}
function CreateEvent({ restaurants, busy, toggleFavorite, uploadPhoto, onError, onClose, submit }) {
  const firstHall = restaurants[0]?.halls?.[0];
  const hallDefaultMode = entry => entry?.seatingConfig?.type === 'fixed' ? 'choice' : entry?.allowedSeating.includes('fixed') ? 'fixed' : entry?.allowedSeating.includes('choice') ? 'choice' : 'off';
  const [seatingMode, setSeatingMode] = useState(hallDefaultMode(firstHall));
  const [restaurantId, setRestaurantId] = useState(restaurants[0]?.id || '');
  const [restaurantSearch, setRestaurantSearch] = useState('');
  const [showFavorites, setShowFavorites] = useState(false);
  const [hallId, setHallId] = useState(restaurants[0]?.halls?.[0]?.id || '');
  const [selectionMode, setSelectionMode] = useState('individual');
  const [packageId, setPackageId] = useState('');
  const restaurant = restaurants.find(entry => entry.id === restaurantId);
  const halls = restaurant?.halls || [];
  const hall = halls.find(entry => entry.id === hallId) || halls[0];
  const canCustomizeSeating = hall?.seatingConfig?.type === 'flexible';
  const maxGuests = Math.min(500, hall?.capacity || 500, hall?.seatingConfig?.type === 'fixed' ? layoutSeats(hall.seatingConfig.fixedLayout).length : 500);
  const [guestCount, setGuestCount] = useState(String(Math.min(12, maxGuests)));
  const [photoDraft, setPhotoDraft] = useState({ file: null, removed: false });
  useEffect(() => { setSeatingMode(hallDefaultMode(hall)); }, [hall?.id]);
  useEffect(() => { setGuestCount(current => current && Number(current) > maxGuests ? String(maxGuests) : current); }, [maxGuests]);
  const packages = restaurant?.packages || [];
  const selectedOffer = packages.find(offer => offer.id === packageId) || packages[0];
  const hotChoices = selectedOffer?.items.filter(item => item.choiceGroup) || [];
  const future = (days) => {
    const d = new Date(Date.now() + days * 86400000);
    return `${d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' })}T18:00`;
  };
  const [eventDate, setEventDate] = useState('');
  const [deadline, setDeadline] = useState(future(5));
  const chooseEventDate = selected => {
    setEventDate(selected);
    if (selected && (!deadline || moscowIso(deadline) >= moscowIso(selected))) setDeadline(deadlineBefore(selected));
  };
  const [duration, setDuration] = useState(4);
  const durations = bookingDurationOptions(hall, eventDate, duration);
  const validDurations = durationOptions(hall, eventDate);
  const visibleRestaurants = restaurants.filter(r => (!showFavorites || r.favorite) && `${r.name} ${r.address}`.toLocaleLowerCase('ru').includes(restaurantSearch.trim().toLocaleLowerCase('ru'))).sort((a,b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name, 'ru'));
  return (
    <Modal title="Новый банкет" onClose={onClose}>
      <p className="muted">
        Задайте детали вечера. Меню выбранного ресторана будет доступно каждому
        гостю.
      </p>
      {!restaurants.length && <div className="alert">Пока нет ресторанов для бронирования. Попросите администратора добавить ресторан.</div>}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          let photoUrl = '';
          if (photoDraft.file) {
            const uploaded = await uploadPhoto(photoDraft.file);
            if (!uploaded) return;
            photoUrl = uploaded.photoUrl;
          }
          submit({
            title: f.get("title"),
            photoUrl,
            restaurantId: f.get("restaurantId"),
            hallId: f.get('hallId'),
            durationHours: duration,
            selectionMode,
            ...(selectionMode === 'package' ? { packageId: f.get('packageId'), ...(hotChoices.length ? { packageChoice: f.get('packageChoice') } : {}) } : {}),
            date: moscowIso(eventDate),
            deadline: moscowIso(f.get("deadline")),
            expectedGuests: Number(f.get("guests")),
            foodBudget: Math.round(Number(f.get("foodBudget") || 0) * 100),
            drinkBudget: Math.round(Number(f.get("drinkBudget") || 0) * 100),
            seating: { mode: seatingMode },
          });
        }}
      >
        <label>
          Название события
          <input
            autoFocus
            name="title"
            required
            maxLength={100}
            placeholder="Например, день рождения Ани"
          />
        </label>
        <EventPhotoField file={photoDraft.file} removed={photoDraft.removed} onChange={setPhotoDraft} onError={onError} disabled={busy} />
        <div className="restaurant-picker" role="group" aria-label="Выбор ресторана">
          <div className="restaurant-picker-heading"><strong>Ресторан</strong><span>{restaurant ? `Выбран: ${restaurant.name}` : 'Выберите ресторан'}</span></div>
          <div className="restaurant-search"><label className="search-field"><Search size={16} /><input type="search" placeholder="Название или адрес" aria-label="Поиск ресторана" autoComplete="off" value={restaurantSearch} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} onChange={event => setRestaurantSearch(event.target.value)} /></label><button type="button" className={showFavorites ? 'favorite-filter active' : 'favorite-filter'} aria-pressed={showFavorites} onClick={() => setShowFavorites(value => !value)}><Star size={16} fill={showFavorites ? 'currentColor' : 'none'} /> Избранные</button></div>
          <div className="restaurant-results" aria-live="polite">
            {visibleRestaurants.map(r => <button key={r.id} type="button" className={restaurantId === r.id ? 'restaurant-result selected' : 'restaurant-result'} aria-pressed={restaurantId === r.id} onClick={() => { setRestaurantId(r.id); setHallId(r.halls?.[0]?.id || ''); setPackageId(''); if (!r.packages?.length) setSelectionMode('individual'); }}><span className="restaurant-result-icon"><Store size={18} /></span><span className="restaurant-result-copy"><strong>{r.name}</strong><small>{r.address || r.description || 'Адрес уточняется'}</small></span>{r.favorite && <Star className="restaurant-result-star" size={15} fill="currentColor" />}{restaurantId === r.id && <Check className="restaurant-result-check" size={19} />}</button>)}
            {!visibleRestaurants.length && <p className="restaurant-no-results">Рестораны не найдены. Попробуйте другое название или отключите «Избранные».</p>}
          </div>
          <input type="hidden" name="restaurantId" value={restaurantId} />
          {restaurant && <button type="button" className={restaurant.favorite ? 'favorite-inline active' : 'favorite-inline'} onClick={() => toggleFavorite(restaurant)}><Star size={16} fill={restaurant.favorite ? 'currentColor' : 'none'} /> {restaurant.favorite ? 'Убрать выбранный ресторан из избранного' : 'Добавить выбранный ресторан в избранное'}</button>}
        </div>
        <label>Формат заказа<select name="selectionMode" value={selectionMode} onChange={event => setSelectionMode(event.target.value)}><option value="individual">Гости выбирают блюда сами</option><option value="package" disabled={!packages.length}>Фиксированный пакет на гостя</option></select></label>
        {selectionMode === 'package' && <label>Пакетное предложение<select name="packageId" required value={selectedOffer?.id || ''} onChange={event => setPackageId(event.target.value)}>{packages.map(offer => <option key={offer.id} value={offer.id}>{offer.name} · {money(offer.price)} / гость</option>)}</select><small className="muted">Гости увидят состав пакета и не смогут менять блюда.</small></label>}
        {selectionMode === 'package' && hotChoices.length > 0 && <label>Горячее блюдо для всех гостей<select name="packageChoice" required>{hotChoices.map(choice => <option key={choice.dishId} value={choice.dishId}>{choice.name}</option>)}</select></label>}
        <label>Зал<select name="hallId" required value={hall?.id || ''} onChange={event => setHallId(event.target.value)}>{halls.map(entry => <option key={entry.id} value={entry.id}>{entry.name} · до {entry.capacity} гостей</option>)}</select></label>
        <div className="form-grid">
          <RussianDateTimeInput
              name="deadline"
              label="Собрать выбор до · МСК"
              required
              value={deadline}
              onChange={setDeadline}
            />
          <label>
            Длительность, часов
            <select name="durationHours" required value={duration || ''} onChange={event => setDuration(Number(event.target.value))}><option value="" disabled>{durations.length ? 'Выберите длительность' : 'Нет свободного времени до закрытия'}</option>{durations.map(hours => <option key={hours} value={hours}>{hours} {hours === 1 ? 'час' : hours < 5 ? 'часа' : 'часов'}{hours === duration && !validDurations.includes(hours) ? ' · выберите время в календаре' : ''}</option>)}</select>
          </label>
          <label>
            Количество гостей
            <input
              type="text"
              inputMode="numeric"
              pattern="[1-9][0-9]*"
              name="guests"
              title={`Введите от 1 до ${maxGuests} гостей`}
              value={guestCount}
              onFocus={event => event.target.select()}
              onChange={event => { const next = event.target.value.replace(/\D/g, '').replace(/^0+/, ''); setGuestCount(next); event.target.setCustomValidity(next && Number(next) > maxGuests ? `В зале не больше ${maxGuests} мест.` : ''); }}
              required
            />
          </label>
          {selectionMode === 'individual' && <label>
            Еда на гостя, ₽ <span className="optional">необязательно</span>
            <input type="number" name="foodBudget" min={0} max={1000000} step="1" placeholder="Например, 2 500" />
          </label>}
          {selectionMode === 'individual' && <label>
            Напитки на гостя, ₽ <span className="optional">необязательно</span>
            <input type="number" name="drinkBudget" min={0} max={1000000} step="1" placeholder="Например, 600" />
          </label>}
          {selectionMode === 'individual' && <BudgetHelp />}
        </div>
        <BookingMiniCalendar restaurantId={restaurantId} hallId={hall?.id} durationHours={duration} value={eventDate} onChange={chooseEventDate} />
        {hall && <div className="hall-seating-choice"><label>Рассадка<select name="seatingMode" value={seatingMode} onChange={event => setSeatingMode(event.target.value)}>{Object.entries(SEATING_MODE_NAMES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>{canCustomizeSeating ? <small>После создания банкета вы сможете расставить столы из набора ресторана во вкладке «Рассадка».</small> : <><strong>Готовая схема зала · {layoutSeats(hall.seatingConfig.fixedLayout).length} мест</strong><small>Расположение столов и стульев закреплено рестораном. Режим рассадки можно изменить позже.</small><details><summary>Посмотреть схему</summary><SeatingMap layout={hall.seatingConfig.fixedLayout} /></details></>}</div>}
        <div className="modal-actions">
          <Button variant="secondary" type="button" onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={busy || !restaurants.length || !eventDate} type="submit">
            Создать банкет <ArrowUpRight size={17} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function EditDish({ item, busy, onClose, submit, uploadPhoto }) {
  return (
    <Modal
      title={item.id ? "Изменить блюдо" : "Добавить блюдо"}
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          let photoUrl = item.photoUrl || '';
          const photo = f.get('photo');
          if (photo?.size) {
            const uploaded = await uploadPhoto(photo);
            if (!uploaded) return;
            photoUrl = uploaded.photoUrl;
          }
          await submit({
            name: f.get("name"),
            description: f.get("description"),
            ingredients: f.get("ingredients"),
            category: f.get("category"),
            price: Math.round(Number(f.get("price")) * 100),
            weight: f.get("weight"),
            allergens: f
              .get("allergens")
              .split(",")
              .map((v) => v.trim())
              .filter(Boolean),
            labels: f.getAll('labels'),
            vegetarian: f.get("vegetarian") === "on",
            available: f.get("available") === "on",
            emoji: f.get("emoji") || "🍽️",
            photoUrl,
            nutrition: { kcal: Number(f.get('kcal')), protein: Number(f.get('protein')), fat: Number(f.get('fat')), carbs: Number(f.get('carbs')) },
          });
        }}
      >
        <label>
          Название
          <input
            name="name"
            required
            defaultValue={item.name}
            maxLength={100}
          />
        </label>
        <label>
          Описание
          <textarea
            name="description"
            defaultValue={item.description}
            maxLength={500}
          />
        </label>
        <label>
          Состав
          <textarea
            name="ingredients"
            defaultValue={item.ingredients}
            maxLength={1000}
            placeholder="Например: филе лосося, лимон, оливковое масло, соль"
          />
        </label>
        <label>Фото блюда или напитка (JPEG, PNG, WebP, до 10 МБ)
          <input type="file" name="photo" accept="image/jpeg,image/png,image/webp" />
          {item.photoUrl && <small>Текущее фото сохранится, если не выбрать новый файл.</small>}
        </label>
        <div className="form-grid">
          <label>
            Категория
            <input name="category" required defaultValue={item.category} />
          </label>
          <label>
            Цена, ₽
            <input
              type="number"
              step="0.01"
              min={1}
              max={100000}
              name="price"
              required
              defaultValue={item.price / 100}
            />
          </label>
          <label>
            Вес / объём
            <input
              name="weight"
              defaultValue={item.weight}
              placeholder="250 г"
            />
          </label>
          <label>
            Иллюстрация (эмодзи)
            <input
              name="emoji"
              defaultValue={item.emoji || "🍽️"}
              maxLength={10}
            />
          </label>
        </div>
        <div className="form-grid nutrition-fields">
          <label>Калории, ккал<input type="number" name="kcal" min="0" max="10000" step="1" required defaultValue={item.nutrition?.kcal ?? ''} /></label>
          <label>Белки, г<input type="number" name="protein" min="0" max="1000" step="0.1" required defaultValue={item.nutrition?.protein ?? ''} /></label>
          <label>Жиры, г<input type="number" name="fat" min="0" max="1000" step="0.1" required defaultValue={item.nutrition?.fat ?? ''} /></label>
          <label>Углеводы, г<input type="number" name="carbs" min="0" max="1000" step="0.1" required defaultValue={item.nutrition?.carbs ?? ''} /></label>
        </div>
        <small className="muted">КБЖУ указываются на одну порцию. Для демонстрационных блюд значения ориентировочные.</small>
        <fieldset className="dish-label-fieldset">
          <legend>Пометки блюда</legend>
          <div className="dish-label-options">{MENU_LABELS.map(label => <label key={label}><input type="checkbox" name="labels" value={label} defaultChecked={item.labels?.includes(label)} />{label}</label>)}</div>
          <small className="muted">«Халяль» отмечайте только для подтверждённых рестораном блюд.</small>
        </fieldset>
        <label>
          Аллергены, через запятую
          <input name="allergens" defaultValue={item.allergens?.join(", ")} />
        </label>
        <div className="check-row">
          <label>
            <input
              type="checkbox"
              name="vegetarian"
              defaultChecked={item.vegetarian}
            />
            Вегетарианское
          </label>
          <label>
            <input
              type="checkbox"
              name="available"
              defaultChecked={item.available}
            />
            Доступно для заказа
          </label>
        </div>
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" disabled={busy}>
            Сохранить
          </Button>
        </div>
      </form>
    </Modal>
  );
}
createRoot(document.getElementById("root")).render(<App />);
