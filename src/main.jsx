import React, { useEffect, useState, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
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
  UserRound,
} from "lucide-react";
import "./styles.css";
import { MENU_LABELS } from '../shared/menu-labels.mjs';
import { SEATING_TEMPLATES, generateLayout } from '../shared/seating.mjs';
import { formatUnits, spentByUnit, unitOf } from '../shared/currency.mjs';
const units = (kopecks, unit) => formatUnits(kopecks, unit, { short: true });
import { SEATING_MODE_NAMES, SeatPicker, SeatingAdmin, SeatingOverview } from './seating.jsx';
import { ConfirmHost, ask } from './confirm.jsx';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const money = (value = 0) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(value / 100);
const dateText = (value, time = false) =>
  value
    ? new Date(value).toLocaleString("ru-RU", {
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
  const response = await fetch(`${BASE}/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Не удалось выполнить запрос");
  return data;
}
async function uploadImage(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 3 * 1024 * 1024) throw new Error('Выберите JPEG, PNG или WebP до 3 МБ.');
  const response = await fetch(`${BASE}/api/media`, { method: 'POST', headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': file.type }, body: file });
  const result = await response.json();
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
function openExternal(link) {
  if (window.WebApp?.openMaxLink) window.WebApp.openMaxLink(link);
  else if (window.WebApp?.openLink) window.WebApp.openLink(link);
  else window.open(link, "_blank", "noopener");
}
const positions = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? "позиция" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "позиции" : "позиций"}`;
const localDateTime = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
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
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.focus();
    const handler = (e) => {
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
      >
        <div className="section-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Закрыть" onClick={onClose}>
            <X />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
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
    [profileOpen, setProfileOpen] = useState(false),
    [restaurantForm, setRestaurantForm] = useState(null);
  const [createOpen, setCreateOpen] = useState(false),
    [approveOpen, setApproveOpen] = useState(false),
    [editItem, setEditItem] = useState(null),
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
  useEffect(() => {
    if (toast) {
      const id = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(id);
    }
  }, [toast]);
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
  const sessionKey = session ? JSON.stringify([session.role, session.access, session.phoneVerified, session.notificationsEnabled, session.botConnected]) : "";
  useEffect(() => {
    if (!sessionKey) return;
    const check = () => {
      if (document.visibilityState === "hidden") return;
      api("/me").then((me) => {
        const key = JSON.stringify([me.role, me.access, me.phoneVerified, me.notificationsEnabled, me.botConnected]);
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
    setProfileOpen(false);
  };
  const toggleNotifications = () => perform(async () => {
    const updated = await api('/me/notifications', { method: 'PUT', body: { enabled: !session.notificationsEnabled } });
    setSession(updated);
    notify(updated.notificationsEnabled ? (updated.botConnected ? 'Уведомления включены' : 'Уведомления включены. Откройте чат с ботом и нажмите «Начать».') : 'Уведомления выключены');
  });
  const openBot = () => config?.botUsername && openExternal(`https://max.ru/${config.botUsername}`);
  const exportKitchen = (format) => perform(async () => {
    if (window.WebApp?.initData && window.WebApp?.downloadFile) {
      const { url } = await api('/kitchen/export-link', { method: 'POST', body: { format } });
      await window.WebApp.downloadFile(url, `kitchen.${format}`);
      notify('Скачивание запущено. Файл появится в «Загрузках» MAX.');
      return;
    }
    await saveDownload(await fetch(`${BASE}/api/kitchen/export?format=${format}`, { headers: { Authorization: `Bearer ${authToken}` } }), `kitchen.${format}`);
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
      setError(e.message);
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
    setTab(asGuest || session?.role === "guest" ? "menu" : "guests");
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
      const res = await fetch(`${BASE}/api/events/${selected}/export.csv`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
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
            {error && (
              <div role="alert" className="alert error">
                {error}
              </div>
            )}
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
                ? "Демонстрация с тестовым рестораном и меню. Ваши изменения сохраняются в отдельном пространстве."
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
      </div>
    );
  const role = session.role,
    isAdminRole = role === 'restaurant' || role === 'admin',
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
          {role !== "guest" && (
            <button
              className={screen === "catalog" ? "active" : ""}
              onClick={() => {
                setScreen("catalog");
                setSelected(null);
              }}
            >
              <Utensils size={19} />
              {isAdminRole ? "Меню ресторана" : "Меню ресторанов"}
            </button>
          )}
          {isAdminRole && (
            <button
              className={screen === "users" ? "active" : ""}
              onClick={() => go("users")}
            >
              <Users size={19} />
              Пользователи
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
              {selected ? "Банкет" : screen === "catalog" ? "Меню" : screen === "kitchen" ? "Кухня" : screen === "users" ? "Пользователи" : "Банкеты"}
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
                  {['organizer', 'guest', 'restaurant'].map(k => (
                    <option key={k} value={k}>
                      {k === 'restaurant' ? 'Ресторан' : roleNames[k]}
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
              <span>Демо-пространство · тестовый ресторан, гости и меню</span>
            </div>
          )}
          {error && (
            <div
              className={`alert error ${createOpen || approveOpen || editItem ? "floating-error" : ""}`}
              role="alert"
            >
              <span>{error}</span>
              <button
                className="icon-btn"
                aria-label="Закрыть ошибку"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
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
                <div className="eyebrow">ДОСТУПЫ К РЕСТОРАНАМ</div>
                <h1>Пользователи</h1>
                <p>Человек появляется здесь, когда впервые откроет мини-приложение в MAX. Выберите его роль в каждом из ваших ресторанов: администратор, организатор или обычный гость.</p>
              </div>
              <UsersAdmin
                session={session}
                busy={busy}
                load={(q) => api(`/users?q=${encodeURIComponent(q)}`)}
                setRole={(restaurantId, userId, role) => perform(async () => {
                  await api(`/restaurants/${restaurantId}/members/${userId}`, { method: "PUT", body: { role } });
                  notify("Доступ обновлён");
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
                <div className="heading-downloads">
                  <Button variant="secondary" disabled={busy || !board?.length} onClick={() => exportKitchen("xlsx")}><FileSpreadsheet size={16} /> Скачать Excel</Button>
                  <Button variant="secondary" disabled={busy || !board?.length} onClick={() => exportKitchen("csv")}><Download size={16} /> CSV</Button>
                </div>
              </div>
              <KitchenBoard board={board} open={(id) => { openEvent(id); setTab("kitchen"); }} />
            </>
          ) : screen === "catalog" ? (
            <>
              <div className="page-heading">
                <div className="eyebrow">ПОДОБРАНО СО ВКУСОМ</div>
                <h1>
                  {isAdminRole ? "Меню ресторана" : "Меню ресторанов"}
                </h1>
                <p>
                  {isAdminRole
                    ? "Изменения меню будут доступны в новых банкетах."
                    : "Выберите ресторан при создании банкета. Цены сохранятся для вашего события."}
                </p>
                {session.superAdmin && (
                  <Button variant="secondary" onClick={() => setRestaurantForm({})}><Store size={16} /> Добавить ресторан</Button>
                )}
              </div>
              {!restaurants.length && <Empty title="Нет доступных ресторанов">Попросите администратора ресторана выдать вам доступ.</Empty>}
              {restaurants.map((r) => (
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
                  <div className="menu-grid catalog">
                    {r.menu?.map((item) => (
                      <DishCard
                        key={item.id}
                        item={item}
                        admin={r.access === "admin"}
                        edit={() =>
                          setEditItem({ ...item, restaurantId: r.id })
                        }
                      />
                    ))}
                    {!r.menu?.length && <p className="muted">В меню пока нет позиций.</p>}
                  </div>
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
                        {dateText(detail.event.date, true)}
                        <span>·</span>
                        <Utensils size={15} />
                        {detail.event.restaurantName}
                      </p>
                    </div>
                    {detail.event.isOwner && (
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
                      label="Выбрали блюда"
                      value={`${detail.event.responded} из ${detail.event.expectedGuests}`}
                      detail="гостей за вашим столом"
                    />
                    {canManage ? (
                      <Stat
                        icon={Wallet}
                        label="Сумма заказа"
                        value={money(detail.event.total)}
                        detail={
                          detail.event.foodBudget || detail.event.drinkBudget
                            ? `На гостя: еда ${money(detail.event.foodBudget)}, напитки ${money(detail.event.drinkBudget)}`
                            : "По выбору гостей"
                        }
                      />
                    ) : (
                      <Stat
                        icon={Wallet}
                        label="Ваш бюджет"
                        value={detail.event.foodBudget ? units(detail.event.foodBudget, "pie") : "Без ограничений"}
                        detail={detail.event.drinkBudget ? `и ${units(detail.event.drinkBudget, "bottle")} на напитки` : "Напитки без ограничения"}
                      />
                    )}
                    <Stat
                      icon={Clock3}
                      label="Собираем до"
                      value={dateText(detail.event.deadline)}
                      detail={
                        detail.event.status === "approved"
                          ? "Выбор завершён"
                          : dateText(detail.event.deadline, true)
                              .split(" в ")
                              .at(-1)
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
                        Мой выбор
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
                  {displayTab === "menu" ? (
                    <GuestMenu
                      key={selected}
                      detail={detail}
                      busy={busy}
                      canSelect={detail.canSelect && (session.demo || session.phoneVerified)}
                      guestView={!canManage}
                      save={(values) =>
                        perform(async () => {
                          await api(`/events/${selected}/selection`, {
                            method: "PUT",
                            body: values,
                          });
                          await loadDetail(selected);
                          await refresh();
                          notify(canManage ? "Ваш выбор сохранён" : "Заказ отправлен организатору на согласование");
                        })
                      }
                    />
                  ) : displayTab === "seat" ? (
                    <SeatPicker
                      detail={detail}
                      busy={busy}
                      canSelect={detail.canSelect && (session.demo || session.phoneVerified)}
                      choose={(seatId) =>
                        perform(async () => {
                          await api(`/events/${selected}/seat`, { method: "PUT", body: { seatId } });
                          await loadDetail(selected);
                          notify(seatId ? "Место закреплено за вами" : "Место освобождено");
                        })
                      }
                    />
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
                      <section className="panel">
                        <div className="section-head">
                          <h2>Каждому — по вкусу</h2>
                          <span className="muted">
                            {detail.event.responded} ответили
                          </span>
                        </div>
                        {detail.guests?.length ? (
                          <div className="guest-list">
                            {detail.guests.map((g, i) => (
                              <div className="guest-row" key={g.id}>
                                <div className={`avatar color-${i % 4}`}>
                                  {g.name
                                    ?.split(" ")
                                    .map((v) => v[0])
                                    .slice(0, 2)
                                    .join("")}
                                </div>
                                <div className="guest-info">
                                  <strong>{g.name}</strong>
                                  {g.seat && <span className="guest-seat">{g.seat}</span>}
                                  <small>
                                    {g.submitted
                                      ? g.items
                                          ?.map(
                                            (v) =>
                                              `${detail.menu.find((m) => m.id === v.menuItemId)?.name || "Блюдо"}${v.quantity > 1 ? " × " + v.quantity : ""}`,
                                          )
                                          .join(", ")
                                      : "Пока выбирает блюда"}
                                  </small>
                                  {g.notes && (
                                    <span className="guest-note">
                                      {g.notes}
                                    </span>
                                  )}
                                </div>
                                <div className="guest-result">
                                  <strong>
                                    {g.submitted ? money(g.total) : "—"}
                                  </strong>
                                  <small className={g.submitted ? "green" : ""}>
                                    {g.submitted ? (
                                      <>
                                        <Check size={12} /> Выбор сохранён
                                      </>
                                    ) : (
                                      "Ждём ответа"
                                    )}
                                  </small>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <Empty title="Пока никого за столом">
                            Отправьте гостям ссылку на ваш банкет.
                          </Empty>
                        )}
                      </section>
                      <aside className="order-card">
                        <div className="order-icon">
                          <Utensils size={23} />
                        </div>
                        <h2>Вечер складывается</h2>
                        <p>
                          Все предпочтения — в одном заказе. Вам остаётся
                          проверить и утвердить.
                        </p>
                        <div className="order-line">
                          <span>Выбрали блюда</span>
                          <strong>{detail.event.responded} гостей</strong>
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
                        {detail.event.isOwner &&
                          detail.event.status !== "approved" && (
                            <Button
                              disabled={busy || !detail.event.responded}
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
                  ) : displayTab === 'admin' ? (
                    <EventAdmin
                      detail={detail}
                      catalog={restaurants.find((r) => r.id === detail.event.restaurantId)}
                      busy={busy}
                      setForGuests={(item, forGuests) => updateAdmin(() => api(`/events/${selected}/menu/${item.id}`, { method: 'PATCH', body: { forGuests } }), forGuests ? 'Позиция доступна гостям' : 'Позиция скрыта от гостей')}
                      saveShared={items => updateAdmin(() => api(`/events/${selected}/shared`, { method: 'PUT', body: { items } }), 'Общий стол сохранён')}
                      importItems={itemIds => updateAdmin(() => api(`/events/${selected}/menu/import`, { method: 'POST', body: { itemIds } }), 'Позиции добавлены в меню банкета')}
                      saveEvent={values => updateAdmin(() => api(`/events/${selected}`, { method: 'PATCH', body: { ...values, expectedRevision: detail.event.revision } }), 'Настройки банкета обновлены')}
                      uploadPhoto={file => perform(() => uploadImage(file))}
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
                {role === "organizer" && !guestFirst && (
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
                  <small className="guest-discovery-hint">Вы организатор? Попросите администратора ресторана выдать вам роль «Организатор» в разделе «Пользователи». Кнопка «Создать банкет» появится здесь сама, перезапускать приложение не нужно.</small>
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
                            {event.responded} из {event.expectedGuests} выбрали
                          </span>
                          <strong>
                            {Math.min(
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
                              width: `${Math.min(100, (event.responded / event.expectedGuests) * 100)}%`,
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
                            Ваш бюджет<strong>{event.foodBudget || event.drinkBudget ? `${units(event.foodBudget, "pie")} · ${units(event.drinkBudget, "bottle")}` : "Без ограничений"}</strong>
                          </span>
                        )}
                        <span className="round-arrow">
                          <ArrowUpRight size={20} />
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
                {role !== "guest" && !guestFirst && filter === "all" && (
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
          {role !== "guest" && (
            <button className={screen === "catalog" && !profileOpen ? "active" : ""} onClick={() => go("catalog")}>
              <Utensils size={19} />
              Меню
            </button>
          )}
          {isAdminRole && (
            <button className={screen === "kitchen" && !profileOpen ? "active" : ""} onClick={() => go("kitchen")}>
              <ChefHat size={19} />
              Кухня
            </button>
          )}
          {isAdminRole && (
            <button className={screen === "users" && !profileOpen ? "active" : ""} onClick={() => go("users")}>
              <Users size={19} />
              Доступы
            </button>
          )}
        </nav>
      </div>
      <ConfirmHost />
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
      {createOpen && (
        <CreateEvent
          restaurants={restaurants}
          busy={busy}
          uploadPhoto={file => perform(() => uploadImage(file))}
          onClose={() => setCreateOpen(false)}
          submit={({ seating, ...body }) =>
            perform(async () => {
              const e = await api("/events", { method: "POST", body });
              if (seating.mode !== "off") {
                await api(`/events/${e.id}/seating`, { method: "PUT", body: { mode: seating.mode, layout: generateLayout(seating.template, body.expectedGuests) } });
              }
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
            В заказе — выбор {approveOpen.responded} гостей на{" "}
            <strong>{money(approveOpen.total)}</strong>. После утверждения
            изменить блюда будет нельзя.
          </p>
          {detail.event.responded < detail.event.expectedGuests && (
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
                <p key={entry.restaurantId}>{entry.restaurantName} — {entry.role === "admin" ? (session.superAdmin && !session.demo ? "администратор" : "администратор ресторана") : "организатор"}</p>
              ))}
            </div>
          )}
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
                  <span>Присылать напоминания и новости о банкетах</span>
                </label>
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
      {budgeted && <BudgetMeter foodBudget={limits.pie} drinkBudget={limits.bottle} spent={spent} guestView={guestView} />}
      {!locked && canSelect && <div className="guest-guide"><strong>Как выбрать</strong><p>Добавьте нужное количество порций кнопками у блюд и напитков, затем нажмите «Отправить организатору» внизу страницы. До окончания сбора заказ можно изменить кнопкой «Обновить заказ».</p>{budgeted && <p>У еды и напитков отдельные лимиты. Индикаторы выше показывают, сколько вы уже выбрали и сколько осталось. Блюдо сверх лимита добавить нельзя.</p>}</div>}
      {shared.length > 0 && (
        <section className="shared-table">
          <h3>Уже на общем столе</h3>
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
      <div className="selection-bottom">
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
          <small>
            Пожелания увидят организатор и ресторан. Состав блюд уточняется у
            ресторана.
          </small>
        </label>
        <div className="selection-total">
          <span>Ваш выбор · {count} порций</span>
          {guestView ? (
            <strong className="unit-total">
              {units(spent.pie, "pie")} · {units(spent.bottle, "bottle")}
            </strong>
          ) : (
            <strong>{money(total)}</strong>
          )}
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
            {busy ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              <Check size={17} />
            )}{" "}
            {locked
              ? "Выбор зафиксирован"
              : selection?.submitted
                ? "Обновить заказ"
                : "Отправить организатору"}
          </Button>
          {over ? (
            <small className="budget-warning">Выбор превышает бюджет — уберите что-нибудь</small>
          ) : dirty ? (
            <small>Есть несохранённые изменения</small>
          ) : detail.event.status === "approved" && selection?.submitted ? (
            <small className="green">Организатор согласовал заказ</small>
          ) : selection?.submitted ? (
            <small className="green">Отправлено организатору на согласование</small>
          ) : null}
        </div>
      </div>
    </>
  );
}
function EventAdmin({ detail, catalog, busy, saveEvent, uploadPhoto, addGuest, editGuest, deleteGuest, editDish, deleteDish, setForGuests, saveShared, importItems }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [editing, setEditing] = useState(null);
  const [importing, setImporting] = useState(null);
  const serverShared = JSON.stringify(detail.shared || []);
  const toDraft = () => Object.fromEntries((detail.shared || []).map(s => [s.menuItemId, s.quantity]));
  const [shared, setShared] = useState(toDraft);
  const [sharedDirty, setSharedDirty] = useState(false);
  useEffect(() => { if (!sharedDirty) setShared(toDraft()); }, [serverShared]);
  const active = detail.event.status === 'collecting';
  const inMenu = new Set(detail.menu.map(item => item.id));
  const missing = (catalog?.menu || []).filter(item => item.available && !inMenu.has(item.id));
  const orderedIds = new Set(detail.guests.flatMap(guest => guest.items.map(item => item.menuItemId)));
  const sharedTotal = detail.menu.reduce((sum, item) => sum + item.price * (shared[item.id] || 0), 0);
  const setSharedQty = (id, quantity) => { setShared(value => ({ ...value, [id]: quantity })); setSharedDirty(true); };
  return (
    <div className="admin-layout">
      {!active && <div className="alert">Заказ утверждён: параметры, гости и меню больше не меняются.</div>}
      <section className="panel admin-panel">
        <div className="section-head"><div><h2>Параметры банкета</h2><p className="muted">Дата, срок выбора, число гостей и бюджет на одного гостя.</p></div></div>
        <form onSubmit={async event => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const file = form.get('photo');
          let photoUrl = form.get('removePhoto') ? '' : detail.event.photoUrl || '';
          if (file?.size) {
            const uploaded = await uploadPhoto(file);
            if (!uploaded) return;
            photoUrl = uploaded.photoUrl;
          }
          saveEvent({ title: form.get('title'), photoUrl, date: new Date(form.get('date')).toISOString(), deadline: new Date(form.get('deadline')).toISOString(), expectedGuests: Number(form.get('expectedGuests')), foodBudget: Math.round(Number(form.get('foodBudget') || 0) * 100), drinkBudget: Math.round(Number(form.get('drinkBudget') || 0) * 100) });
        }}>
          <label>Название<input name="title" required maxLength={120} defaultValue={detail.event.title} disabled={!active} /></label>
          <label>Фото мероприятия (JPEG, PNG, WebP, до 3 МБ)<input type="file" name="photo" accept="image/jpeg,image/png,image/webp" disabled={!active} /></label>
          {detail.event.photoUrl && <label className="inline-check"><input type="checkbox" name="removePhoto" disabled={!active} /> Убрать текущее фото</label>}
          <div className="form-grid">
            <label>Дата мероприятия<input type="datetime-local" name="date" required defaultValue={localDateTime(detail.event.date)} disabled={!active} /></label>
            <label>Выбор блюд до<input type="datetime-local" name="deadline" required defaultValue={localDateTime(detail.event.deadline)} disabled={!active} /></label>
            <label>Количество гостей<input type="number" name="expectedGuests" min="1" max="1000" required defaultValue={detail.event.expectedGuests} disabled={!active} /></label>
            <label>Бюджет на еду на гостя, ₽<input type="number" name="foodBudget" min="0" max="100000000" step="0.01" defaultValue={detail.event.foodBudget / 100} disabled={!active} /></label>
            <label>Бюджет на напитки на гостя, ₽<input type="number" name="drinkBudget" min="0" max="100000000" step="0.01" defaultValue={detail.event.drinkBudget / 100} disabled={!active} /></label>
          </div>
          <small className="muted">Два независимых лимита: гость видит бюджет на еду в кусочках пирога 🥧 (1 = 10 ₽), на напитки — в бутылочках 🍾 (1 = 100 ₽). 0 — без ограничения.</small>
          {active && <Button type="submit" disabled={busy}>Сохранить параметры</Button>}
        </form>
      </section>
      <section className="panel admin-panel">
        <div className="section-head"><div><h2>Приглашённые гости</h2><p className="muted">Гость подтвердит свой номер в MAX и сможет выбрать блюда только за себя.</p></div><span>{detail.invitedGuests?.length || 0} из {detail.event.expectedGuests}</span></div>
        {active && <form className="admin-guest-form" onSubmit={async event => {
          event.preventDefault();
          const result = await addGuest({ name, phone });
          if (result !== null) { setName(''); setPhone(''); }
        }}>
          <input aria-label="Имя гостя" placeholder="Имя гостя" maxLength={100} required value={name} onChange={event => setName(event.target.value)} />
          <PhoneInput aria-label="Телефон гостя" required value={phone} onChange={setPhone} />
          <Button type="submit" disabled={busy}><Plus size={16} /> Добавить</Button>
        </form>}
        <div className="admin-guest-list">
          {detail.invitedGuests?.length ? detail.invitedGuests.map(guest => <div className="admin-guest" key={guest.id}>
            <div><strong>{guest.name}</strong><small>+{guest.phone} · {guest.submitted ? 'Выбор сохранён' : guest.joined ? 'Номер подтверждён' : 'Ожидает входа'}</small></div>
            {active && <div className="admin-actions"><button type="button" onClick={() => setEditing({ ...guest, phone: `+${guest.phone}` })}>Изменить</button><button type="button" disabled={busy || guest.submitted} onClick={async () => { if (await ask(`Удалить ${guest.name} из списка гостей?`, { confirmLabel: 'Удалить' })) deleteGuest(guest.id); }}>Удалить</button></div>}
          </div>) : <p className="muted">Добавьте гостей перед отправкой приглашения. Один номер соответствует одному гостю.</p>}
        </div>
      </section>
      <section className="panel admin-panel">
        <div className="section-head"><div><h2>Меню этого банкета</h2><p className="muted">Отметьте, что могут выбрать гости, и что поставить на общий стол. Изменения действуют только для этого мероприятия.</p></div>
          {active && <div className="admin-actions">
            <button type="button" disabled={!missing.length} onClick={() => setImporting([])}><Plus size={15} /> Из каталога{missing.length ? ` (${missing.length})` : ''}</button>
            <button type="button" onClick={() => editDish({ category: 'Закуски', price: 0, available: true, vegetarian: false, allergens: [], nutrition: { kcal: 0, protein: 0, fat: 0, carbs: 0 } })}><Plus size={15} /> Своя позиция</button>
          </div>}
        </div>
        <div className="shared-summary">
          <div>
            <strong>Общий стол</strong>
            <small>{positions(Object.values(shared).filter(Boolean).length)} · {money(sharedTotal)} · не входит в бюджет гостей</small>
          </div>
          {active && sharedDirty && <>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => { setShared(toDraft()); setSharedDirty(false); }}>Отменить</Button>
            <Button type="button" disabled={busy} onClick={async () => {
              const result = await saveShared(Object.entries(shared).filter(([, quantity]) => quantity > 0).map(([menuItemId, quantity]) => ({ menuItemId, quantity })));
              if (result !== null) setSharedDirty(false);
            }}>Сохранить общий стол</Button>
          </>}
        </div>
        <div className="menu-grid catalog">{detail.menu.map(item => {
          const onShared = (shared[item.id] || 0) > 0;
          return <div key={item.id} className={`event-dish ${item.forGuests === false && !onShared ? 'hidden-dish' : ''}`}>
            <DishCard item={item} admin={active} edit={() => editDish(item)} />
            <div className="event-dish-controls">
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
      </section>
      {importing && <Modal title="Добавить из каталога" onClose={() => setImporting(null)}>
        <p className="muted">Позиции общего меню ресторана, которых ещё нет в этом банкете.</p>
        <div className="import-list">
          {missing.map(item => <label key={item.id} className="check">
            <input type="checkbox" checked={importing.includes(item.id)} onChange={event => setImporting(event.target.checked ? [...importing, item.id] : importing.filter(id => id !== item.id))} />
            <span>{item.emoji || '🍽️'} {item.name}</span>
            <small>{item.category} · {money(item.price)}</small>
          </label>)}
        </div>
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={() => setImporting(null)}>Отмена</Button>
          <Button type="button" disabled={busy || !importing.length} onClick={async () => { const result = await importItems(importing); if (result !== null) setImporting(null); }}>Добавить {importing.length || ''}</Button>
        </div>
      </Modal>}
      {editing && <Modal title="Данные гостя" onClose={() => setEditing(null)}>
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
const ROLE_OPTIONS = [["none", "Нет роли"], ["organizer", "Организатор"], ["admin", "Администратор ресторана"]];
function UsersAdmin({ session, busy, load, setRole, onError }) {
  const administered = (session.access || []).filter((entry) => entry.role === "admin");
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState(null);
  const [newMaxId, setNewMaxId] = useState('');
  const [newRestaurant, setNewRestaurant] = useState(administered[0]?.restaurantId || '');
  const [newRole, setNewRole] = useState('organizer');
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => load(query).then((list) => alive && setUsers(list)).catch((e) => onError(e.message)), query ? 250 : 0);
    return () => { alive = false; clearTimeout(timer); };
  }, [query]);
  const change = async (user, restaurantId, role) => {
    const previous = users;
    setUsers(users.map((entry) => (entry.id === user.id ? { ...entry, roles: { ...entry.roles, [restaurantId]: role } } : entry)));
    if ((await setRole(restaurantId, user.id, role)) === null) setUsers(previous);
  };
  return (
    <section className="panel admin-panel users-admin">
      <label className="search-field">
        <Search size={16} />
        <input type="search" placeholder="Имя, телефон или MAX ID" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Поиск пользователя" />
      </label>
      {!session.demo && <form className="grant-max-form" onSubmit={async event => {
        event.preventDefault();
        if (!/^[1-9][0-9]{0,18}$/.test(newMaxId)) return onError('Укажите числовой MAX ID пользователя.');
        if (await setRole(newRestaurant, newMaxId, newRole) !== null) {
          setNewMaxId('');
          setUsers(await load(query));
        }
      }}>
        <strong>Назначить роль по MAX ID</strong>
        <input aria-label="MAX ID пользователя" inputMode="numeric" pattern="[1-9][0-9]{0,18}" placeholder="MAX ID пользователя" value={newMaxId} onChange={event => setNewMaxId(event.target.value)} required />
        <select aria-label="Ресторан для назначения" value={newRestaurant} onChange={event => setNewRestaurant(event.target.value)}>{administered.map(entry => <option key={entry.restaurantId} value={entry.restaurantId}>{entry.restaurantName}</option>)}</select>
        <select aria-label="Назначаемая роль" value={newRole} onChange={event => setNewRole(event.target.value)}>{ROLE_OPTIONS.filter(([value]) => value !== 'none' && (session.superAdmin || value !== 'admin')).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select>
        <Button type="submit" disabled={busy || !newRestaurant}>Назначить</Button>
      </form>}
      {session.demo && <p className="muted">В демо роли переключаются вверху справа; изменения здесь действуют только на гостей демо.</p>}
      {!users ? (
        <div className="loading-inline"><LoaderCircle className="spin" />Загружаем пользователей…</div>
      ) : users.length ? (
        <div className="admin-guest-list">
          {users.map((user) => (
            <div className="user-row" key={user.id}>
              <div>
                <strong>{user.name}{user.isYou ? " (вы)" : ""}</strong>
                <small>{[user.superAdmin && "суперадминистратор", user.maxId && `MAX ID ${user.maxId}`, user.phone && `+${user.phone}`].filter(Boolean).join(" · ") || "Номер не подтверждён"}</small>
              </div>
              <div className="user-roles">
                {administered.map((entry) => (
                  <label key={entry.restaurantId}>
                    {administered.length > 1 && <span>{entry.restaurantName}</span>}
                    <select
                      value={user.roles[entry.restaurantId] || "none"}
                      disabled={busy || user.isYou || user.fixed || (!session.superAdmin && user.roles[entry.restaurantId] === 'admin')}
                      onChange={(e) => change(user, entry.restaurantId, e.target.value)}
                      aria-label={`Роль ${user.name} в ресторане ${entry.restaurantName}`}
                    >
                      {ROLE_OPTIONS.filter(([value]) => session.superAdmin || value !== 'admin' || user.roles[entry.restaurantId] === 'admin').map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">{query ? "Никого не нашли." : "Пока никто не открывал приложение."}</p>
      )}
    </section>
  );
}
function KitchenBoard({ board, open }) {
  if (!board) return <div className="loading-inline"><LoaderCircle className="spin" />Загружаем заказы…</div>;
  if (!board.length) return <Empty title="Запланированных банкетов нет">Когда организатор создаст банкет, он появится здесь.</Empty>;
  return (
    <div className="kitchen-board">
      {board.map(({ event, summary, shared, guests }) => (
        <section className="panel kitchen" key={event.id}>
          <div className="section-head">
            <div>
              <Tag approved={event.status === "approved"} />
              <h2>{event.title}</h2>
              <p className="muted">{dateText(event.date, true)} · Организатор: {event.ownerName || "—"} · ответили {event.responded} из {event.expectedGuests}</p>
            </div>
            <Button variant="secondary" onClick={() => open(event.id)}>Открыть</Button>
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
function CreateEvent({ restaurants, busy, uploadPhoto, onClose, submit }) {
  const [seatingMode, setSeatingMode] = useState("off");
  const future = (days) => {
    const d = new Date(Date.now() + days * 86400000);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  };
  return (
    <Modal title="Новый банкет" onClose={onClose}>
      <p className="muted">
        Задайте детали вечера. Меню выбранного ресторана будет доступно каждому
        гостю.
      </p>
      {!restaurants.length && <div className="alert">Нет ресторанов, где у вас есть доступ организатора. Попросите администратора ресторана выдать его.</div>}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const file = f.get('photo');
          let photoUrl = '';
          if (file?.size) {
            const uploaded = await uploadPhoto(file);
            if (!uploaded) return;
            photoUrl = uploaded.photoUrl;
          }
          submit({
            title: f.get("title"),
            photoUrl,
            restaurantId: f.get("restaurantId"),
            date: new Date(f.get("date")).toISOString(),
            deadline: new Date(f.get("deadline")).toISOString(),
            expectedGuests: Number(f.get("guests")),
            foodBudget: Math.round(Number(f.get("foodBudget") || 0) * 100),
            drinkBudget: Math.round(Number(f.get("drinkBudget") || 0) * 100),
            seating: { mode: f.get("seatingMode"), template: f.get("seatingTemplate") },
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
        <label>Фото мероприятия (JPEG, PNG, WebP, до 3 МБ)<input type="file" name="photo" accept="image/jpeg,image/png,image/webp" /></label>
        <label>
          Ресторан
          <select name="restaurantId" required>
            {restaurants.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <div className="form-grid">
          <label>
            Когда встречаемся
            <input
              type="datetime-local"
              name="date"
              required
              defaultValue={future(7)}
            />
          </label>
          <label>
            Собрать выбор до
            <input
              type="datetime-local"
              name="deadline"
              required
              defaultValue={future(5)}
            />
          </label>
          <label>
            Количество гостей
            <input
              type="number"
              name="guests"
              min={1}
              max={500}
              defaultValue={12}
              required
            />
          </label>
          <label>
            Еда на гостя, ₽ <span className="optional">необязательно</span>
            <input type="number" name="foodBudget" min={0} max={1000000} step="1" placeholder="Например, 2 500" />
          </label>
          <label>
            Напитки на гостя, ₽ <span className="optional">необязательно</span>
            <input type="number" name="drinkBudget" min={0} max={1000000} step="1" placeholder="Например, 600" />
          </label>
        </div>
        <div className="form-grid">
          <label>
            Рассадка
            <select name="seatingMode" value={seatingMode} onChange={(e) => setSeatingMode(e.target.value)}>
              {Object.entries(SEATING_MODE_NAMES).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
          {seatingMode !== "off" && (
            <label>
              Схема зала
              <select name="seatingTemplate" defaultValue="rounds">
                {SEATING_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="modal-actions">
          <Button variant="secondary" type="button" onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={busy || !restaurants.length} type="submit">
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
        <label>Фото блюда или напитка (JPEG, PNG, WebP, до 3 МБ)
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
