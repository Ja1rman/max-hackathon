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
} from "lucide-react";
import "./styles.css";

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
  restaurant: "Ресторан",
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
    [tab, setTab] = useState("guests");
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
  const [invite, setInvite] = useState(startParam);
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
          remember(
            await api("/auth/max", {
              method: "POST",
              body: { initData: launch },
            }),
          );
          const sp = window.WebApp?.initDataUnsafe?.start_param;
          if (sp) setInvite(sp);
        } else if (authToken) {
          const me = await api("/me");
          setSession(me.user || me);
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
  const openEvent = (id) => {
    setSelected(id);
    setDetail(null);
    setTab(session?.role === "guest" ? "menu" : "guests");
  };
  const joinInvite = () =>
    perform(async () => {
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
    canManage = Boolean(detail?.event.isOwner) || role === "restaurant",
    displayTab = detail && !canManage ? "menu" : tab,
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
            {role === "restaurant" ? "Заказы на банкеты" : "Мои банкеты"}
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
              {role === "restaurant" ? "Меню ресторана" : "Меню ресторанов"}
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
          <div className="profile">
            <div className="avatar">{session.name?.slice(0, 1) || "Я"}</div>
            <div>
              <strong>{session.name}</strong>
              <small>{roleNames[role]}</small>
            </div>
            <button aria-label="Выйти" onClick={logout} className="icon-btn">
              <LogOut size={17} />
            </button>
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
              {selected ? "Банкет" : screen === "catalog" ? "Меню" : "Банкеты"}
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
                  {Object.entries(roleNames).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
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
            <div className="avatar top-avatar">{session.name?.slice(0, 1)}</div>
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
                <p>Присоединитесь к банкету и выберите блюда.</p>
              </div>
              <Button disabled={busy} onClick={joinInvite}>
                Принять приглашение <ArrowUpRight size={16} />
              </Button>
            </div>
          )}
          {screen === "catalog" ? (
            <>
              <div className="page-heading">
                <div className="eyebrow">ПОДОБРАНО СО ВКУСОМ</div>
                <h1>
                  {role === "restaurant" ? "Меню ресторана" : "Меню ресторанов"}
                </h1>
                <p>
                  {role === "restaurant"
                    ? "Изменения меню будут доступны в новых банкетах."
                    : "Выберите ресторан при создании банкета. Цены сохранятся для вашего события."}
                </p>
              </div>
              {restaurants.map((r) => (
                <section key={r.id}>
                  <div className="section-head">
                    <div>
                      <h2>{r.name}</h2>
                      <p className="muted">{r.address || r.description}</p>
                    </div>
                    {role === "restaurant" && (
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
                    )}
                  </div>
                  <div className="menu-grid catalog">
                    {r.menu?.map((item) => (
                      <DishCard
                        key={item.id}
                        item={item}
                        admin={role === "restaurant"}
                        edit={() =>
                          setEditItem({ ...item, restaurantId: r.id })
                        }
                      />
                    ))}
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
                  <div className="stats-row">
                    <Stat
                      icon={Users}
                      label="Выбрали блюда"
                      value={`${detail.event.responded} из ${detail.event.expectedGuests}`}
                      detail="гостей за вашим столом"
                    />
                    <Stat
                      icon={Wallet}
                      label="Сумма заказа"
                      value={money(detail.event.total)}
                      detail={
                        detail.event.budget
                          ? `Бюджет: ${money(detail.event.budget)}`
                          : "По выбору гостей"
                      }
                    />
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
                    {role !== "restaurant" && (
                      <button
                        className={displayTab === "menu" ? "active" : ""}
                        onClick={() => setTab("menu")}
                      >
                        {!canManage ? "Выбрать блюда" : "Мой выбор"}
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
                  </div>
                  {displayTab === "menu" ? (
                    <GuestMenu
                      key={selected}
                      detail={detail}
                      busy={busy}
                      save={(values) =>
                        perform(async () => {
                          await api(`/events/${selected}/selection`, {
                            method: "PUT",
                            body: values,
                          });
                          await loadDetail(selected);
                          await refresh();
                          notify("Ваш выбор сохранён");
                        })
                      }
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
                    {role === "restaurant"
                      ? "Заказы на банкеты"
                      : role === "guest"
                        ? "Ваши приглашения"
                        : "Мои банкеты"}
                    <span className="heading-dot">.</span>
                  </h1>
                  <p>
                    {role === "restaurant"
                      ? "Точные количества, пожелания гостей и готовый заказ для кухни."
                      : role === "guest"
                        ? "Хорошая компания уже ждёт. Осталось выбрать любимое."
                        : "Гости выбирают любимое. Вы держите всё под контролем."}
                  </p>
                </div>
                {role === "organizer" && (
                  <Button onClick={() => setCreateOpen(true)}>
                    <Plus size={18} />
                    Создать банкет
                  </Button>
                )}
              </div>
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
                    onClick={() => openEvent(event.id)}
                  >
                    <div className={`event-art art-${i % 3}`}>
                      <div className="mini-plate">
                        <Utensils size={30} />
                      </div>
                      <span className="event-art-leaf">✳</span>
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
                        <span>
                          Сумма заказа<strong>{money(event.total)}</strong>
                        </span>
                        <span className="round-arrow">
                          <ArrowUpRight size={20} />
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
                {role === "organizer" && filter === "all" && (
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
              {!filtered.length && role !== "organizer" && (
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
          <button
            onClick={() => {
              setScreen("events");
              setSelected(null);
            }}
          >
            <CalendarDays size={19} />
            Банкеты
          </button>
          {role !== "guest" && (
            <button
              onClick={() => {
                setScreen("catalog");
                setSelected(null);
              }}
            >
              <Utensils size={19} />
              Меню
            </button>
          )}
          <button onClick={() => setHelpOpen(true)}>
            <CircleHelp size={19} />
            Помощь
          </button>
        </nav>
      </div>
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
          submit={(values) =>
            perform(async () => {
              await api(
                `/restaurants/${editItem.restaurantId}/menu${editItem.id ? "/" + editItem.id : ""}`,
                { method: editItem.id ? "PATCH" : "POST", body: values },
              );
              await refresh();
              setEditItem(null);
              notify("Меню обновлено");
            })
          }
        />
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
function DishCard({ item, quantity = 0, onChange, admin, edit, locked }) {
  return (
    <article className={`dish-card ${!item.available ? "unavailable" : ""}`}>
      <div className={`dish-visual category-${item.category?.length % 4}`}>
        <span>{item.emoji || "🍽️"}</span>
        {item.vegetarian && (
          <span className="veg-tag">
            <Leaf size={12} />
            Вегетарианское
          </span>
        )}
      </div>
      <div className="dish-content">
        <span className="dish-category">
          {item.category} {item.weight ? "· " + item.weight : ""}
        </span>
        <h3>{item.name}</h3>
        <p>{item.description}</p>
        {item.allergens?.length > 0 && (
          <small className="allergens">
            Аллергены: {item.allergens.join(", ")}
          </small>
        )}
        <div className="dish-bottom">
          <strong>{money(item.price)}</strong>
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
                disabled={locked || quantity >= 10 || !item.available}
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
function GuestMenu({ detail, busy, save }) {
  const selection = detail.selection;
  const [items, setItems] = useState(() =>
      Object.fromEntries(
        (selection?.items || []).map((i) => [i.menuItemId, i.quantity]),
      ),
    ),
    [notes, setNotes] = useState(selection?.notes || ""),
    [category, setCategory] = useState("Все блюда"),
    [vegetarian, setVegetarian] = useState(false),
    [dirty, setDirty] = useState(false);
  const locked =
    detail.event.status === "approved" ||
    new Date(detail.event.deadline).getTime() < Date.now();
  const categories = [
    "Все блюда",
    ...new Set(detail.menu.map((i) => i.category)),
  ];
  const total = detail.menu.reduce(
      (n, i) => n + i.price * (items[i.id] || 0),
      0,
    ),
    count = Object.values(items).reduce((a, b) => a + b, 0);
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
            {locked
              ? "Сбор завершён. Ваши блюда сохранены в заказе."
              : "Выберите блюда и укажите пожелания. До утверждения заказ можно изменить."}
          </p>
        </div>
        <label className="vegetarian-filter">
          <input
            type="checkbox"
            checked={vegetarian}
            onChange={(e) => setVegetarian(e.target.checked)}
          />
          <Leaf size={15} />
          Без мяса
        </label>
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
        {detail.menu
          .filter(
            (i) =>
              (category === "Все блюда" || i.category === category) &&
              (!vegetarian || i.vegetarian),
          )
          .map((i) => (
            <DishCard
              key={i.id}
              item={i}
              locked={locked}
              quantity={items[i.id] || 0}
              onChange={(q) => {
                setItems((v) => ({ ...v, [i.id]: q }));
                setDirty(true);
              }}
            />
          ))}
      </div>
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
          <strong>{money(total)}</strong>
          <Button
            disabled={busy || locked || count === 0}
            onClick={async () => {
              const result = await save({
                items: Object.entries(items)
                  .filter(([, q]) => q > 0)
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
                ? "Обновить выбор"
                : "Сохранить выбор"}
          </Button>
          {dirty ? (
            <small>Есть несохранённые изменения</small>
          ) : selection?.submitted ? (
            <small className="green">Ваш выбор сохранён</small>
          ) : null}
        </div>
      </div>
    </>
  );
}
function CreateEvent({ restaurants, busy, onClose, submit }) {
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
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          submit({
            title: f.get("title"),
            restaurantId: f.get("restaurantId"),
            date: new Date(f.get("date")).toISOString(),
            deadline: new Date(f.get("deadline")).toISOString(),
            expectedGuests: Number(f.get("guests")),
            budget: Math.round(Number(f.get("budget") || 0) * 100),
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
            Бюджет, ₽ <span className="optional">необязательно</span>
            <input
              type="number"
              name="budget"
              min={0}
              max={10000000}
              step="1"
              placeholder="Например, 40 000"
            />
          </label>
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
function EditDish({ item, busy, onClose, submit }) {
  return (
    <Modal
      title={item.id ? "Изменить блюдо" : "Добавить блюдо"}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          submit({
            name: f.get("name"),
            description: f.get("description"),
            category: f.get("category"),
            price: Math.round(Number(f.get("price")) * 100),
            weight: f.get("weight"),
            allergens: f
              .get("allergens")
              .split(",")
              .map((v) => v.trim())
              .filter(Boolean),
            vegetarian: f.get("vegetarian") === "on",
            available: f.get("available") === "on",
            emoji: f.get("emoji") || "🍽️",
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
