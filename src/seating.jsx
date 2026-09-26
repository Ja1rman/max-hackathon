import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Armchair, Circle, Crosshair, Minus, Plus, RectangleHorizontal, RotateCw, Shuffle, Trash2, UserMinus, Wand2, X } from "lucide-react";
import {
  RECT_SIDES,
  SEATING_TEMPLATES,
  SEAT_RADIUS,
  fitTable,
  generateLayout,
  layoutBounds,
  layoutSeats,
  newTableId,
  nextLabel,
  seatTitle,
  tableSeats,
  tableTitle,
} from "../shared/seating.mjs";

export const SEATING_MODE_NAMES = {
  off: "Без рассадки",
  choice: "Гости выбирают места",
  fixed: "Рассаживает организатор",
};
const MIN_SEAT_PX = 24;
const SIDE_NAMES = { top: "Сверху", right: "Справа", bottom: "Снизу", left: "Слева" };
const initials = (name = "") => name.split(/\s+/).filter(Boolean).map(part => part[0]).slice(0, 2).join("").toUpperCase();

/**
 * SVG hall plan. `editable` enables moving tables; `onSeat` makes chairs clickable.
 * `names` maps seatId → guest name; `occupied` is a Set of taken seat ids.
 * On touch screens a table is dragged only after it has been selected, so scrolling the plan never moves tables.
 * `onEmptyTap` receives plan coordinates of a tap on free floor; `toolbar` is rendered over the plan.
 */
export function SeatingMap({ layout, occupied = new Set(), mySeat = null, names, onSeat, canPick, editable = false, selectedTable, onSelectTable, onMoveTable, selectedSeat, onEmptyTap, toolbar, showMine = false }) {
  const svg = useRef(null);
  const scroller = useRef(null);
  const drag = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [frozen, setFrozen] = useState(null);
  const [inspected, setInspected] = useState(null);
  const bounds = frozen || (editable ? padBounds(layoutBounds(layout, 80)) : layoutBounds(layout));
  useEffect(() => {
    // On phones start zoomed in so a chair is at least ~28px wide and easy to tap.
    const width = scroller.current?.clientWidth;
    if (!width) return;
    const needed = (MIN_SEAT_PX / (SEAT_RADIUS * 2)) * (bounds.w / width);
    setZoom(Math.min(2, Math.max(1, Math.ceil(needed * 2) / 2)));
  }, []);
  useEffect(() => {
    // Keep the guest's own chair in view when the plan is zoomed.
    const box = scroller.current;
    const seat = mySeat && layoutSeats(layout).find(entry => entry.id === mySeat);
    if (!box || !seat || zoom === 1) return;
    box.scrollLeft = ((seat.x - bounds.x) / bounds.w) * box.scrollWidth - box.clientWidth / 2;
    box.scrollTop = ((seat.y - bounds.y) / bounds.h) * box.scrollHeight - box.clientHeight / 2;
  }, [zoom, mySeat]);
  const point = event => {
    const matrix = svg.current.getScreenCTM().inverse();
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix);
    return { x: p.x, y: p.y };
  };
  const startDrag = (event, table) => {
    const wasSelected = selectedTable === table.id;
    onSelectTable?.(table.id);
    if (!editable || (event.pointerType !== "mouse" && !wasSelected)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const start = point(event);
    drag.current = { id: table.id, dx: start.x - table.x, dy: start.y - table.y, moved: false };
    setFrozen(bounds);
  };
  const moveDrag = event => {
    if (!drag.current) return;
    const p = point(event);
    const snap = value => Math.round(value / 10) * 10;
    drag.current.moved = true;
    onMoveTable?.(drag.current.id, snap(p.x - drag.current.dx), snap(p.y - drag.current.dy));
  };
  const endDrag = () => {
    drag.current = null;
    setFrozen(null);
  };
  return (
    <div className="seating-map">
      <div className="seating-zoom">
        <button type="button" aria-label="Уменьшить схему" disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value - 0.5))}><Minus size={15} /></button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label="Увеличить схему" disabled={zoom >= 3} onClick={() => setZoom(value => Math.min(3, value + 0.5))}><Plus size={15} /></button>
      </div>
      <div className="seating-scroll" ref={scroller}>
        <svg
          ref={svg}
          viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`}
          style={{ width: `${zoom * 100}%` }}
          role="group"
          aria-label="Схема зала"
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onClick={event => {
            if (event.target !== svg.current) return;
            setInspected(null);
            if (onEmptyTap) onEmptyTap(point(event));
            else onSelectTable?.(null);
          }}
        >
          {layout.tables.map(table => {
            const cx = table.x + table.w / 2, cy = table.y + table.h / 2;
            return (
              <g key={table.id} className={`seating-table ${selectedTable === table.id ? "selected" : ""} ${editable ? "editable" : ""}`} onClick={() => setInspected(null)}>
                <g transform={`rotate(${table.rotation || 0} ${cx} ${cy})`} onPointerDown={event => startDrag(event, table)}>
                  {table.shape === "round"
                    ? <circle cx={cx} cy={cy} r={table.w / 2} />
                    : <rect x={table.x} y={table.y} width={table.w} height={table.h} rx="8" />}
                </g>
                <text x={cx} y={cy} className="table-label" pointerEvents="none">{table.label}</text>
                {tableSeats(table).map(seat => {
                  const taken = occupied.has(seat.id);
                  const mine = seat.id === mySeat;
                  const name = names?.get(seat.id);
                  const clickable = onSeat && (canPick ? canPick(seat.id) : true);
                  const title = `${tableTitle(table)}, место ${seat.number}${mine ? " — ваше место" : name ? ` — ${name}` : taken ? " — занято" : " — свободно"}`;
                  const activate = clickable ? () => onSeat(seat.id) : (taken || mine) ? () => setInspected(title) : undefined;
                  return (
                    <g
                      key={seat.id}
                      className={`seat ${mine ? "mine" : taken ? "taken" : "free"} ${selectedSeat === seat.id ? "selected" : ""} ${clickable ? "clickable" : ""}`}
                      onClick={activate ? event => { event.stopPropagation(); activate(); } : undefined}
                      onKeyDown={activate ? event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); } } : undefined}
                      role={activate ? "button" : undefined}
                      tabIndex={activate ? 0 : undefined}
                      aria-label={title}
                    >
                      <title>{title}</title>
                      {activate && <circle className="hit" cx={seat.x} cy={seat.y} r={SEAT_RADIUS + 8} />}
                      <circle cx={seat.x} cy={seat.y} r={SEAT_RADIUS} />
                      <text x={seat.x} y={seat.y}>{name ? initials(name) : seat.number}</text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
      {toolbar}
      {inspected && <div className="seat-inspect" role="status">{inspected}</div>}
      <div className="seating-legend">
        <span><i className="free" /> Свободно</span>
        <span><i className="taken" /> Занято · нажмите, чтобы увидеть гостя</span>
        {showMine && <span><i className="mine" /> Ваше место</span>}
      </div>
    </div>
  );
}

function padBounds(bounds) {
  // Keep some free floor in the editor so tables can be dragged outward.
  return { x: bounds.x, y: bounds.y, w: Math.max(bounds.w + 160, 560), h: Math.max(bounds.h + 100, 340) };
}

/** Guest view: pick a chair (choice mode) or see the assigned one (fixed mode). */
export function SeatPicker({ detail, busy, canSelect, choose }) {
  const seating = detail.seating;
  const occupied = useMemo(() => new Set(seating.occupied), [seating.occupied]);
  const names = useMemo(() => new Map(Object.entries(seating.names || {})), [seating.names]);
  const locked = detail.event.status === "approved" || new Date(detail.event.deadline).getTime() < Date.now() || !canSelect;
  const choice = seating.mode === "choice";
  const pickable = choice && !locked;
  return (
    <section className="panel seat-picker">
      <div className="section-head">
        <div>
          <h2>{choice && !locked ? "Где вы хотите сидеть?" : "Ваше место"}</h2>
          <p className="muted">
            {!canSelect
              ? "Выбрать место может приглашённый гость с подтверждённым номером MAX."
              : !choice
                ? "Места распределяет организатор."
                : locked
                  ? "Выбор мест закрыт."
                  : "Нажмите на свободный стул. Если не выберете место, мы посадим вас автоматически при утверждении заказа."}
          </p>
        </div>
      </div>
      <div className={`my-seat ${seating.mySeat ? "set" : ""}`}>
        <Armchair size={20} />
        <div>
          <strong>{seating.mySeat ? seatTitle(seating.layout, seating.mySeat) : "Место не выбрано"}</strong>
          <small>{seating.mySeat ? "Это место закреплено за вами" : choice ? "Свободно мест: " + (seating.seatCount - seating.occupied.length) : "Организатор назначит место позже"}</small>
        </div>
        {pickable && seating.mySeat && (
          <button type="button" className="btn secondary" disabled={busy} onClick={() => choose(null)}>
            <UserMinus size={15} /> Освободить
          </button>
        )}
      </div>
      {seating.layout.tables.length ? (
        <SeatingMap
          layout={seating.layout}
          occupied={occupied}
          mySeat={seating.mySeat}
          names={names}
          showMine
          onSeat={pickable && !busy ? seatId => choose(seatId) : undefined}
          canPick={seatId => !occupied.has(seatId)}
        />
      ) : (
        <p className="muted">Организатор ещё готовит схему зала.</p>
      )}
      <TableGuests layout={seating.layout} names={names} mySeat={seating.mySeat} />
    </section>
  );
}

/** Manager editor: mode, templates, draggable tables, per-table settings and manual seating. */
export function SeatingAdmin({ detail, busy, save, assign, autoSeat, notify }) {
  const seating = detail.seating;
  const active = detail.event.status === "collecting";
  const serverKey = JSON.stringify([seating.mode, seating.layout]);
  const [mode, setMode] = useState(seating.mode);
  const [layout, setLayout] = useState(seating.layout);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState(null);
  const [placing, setPlacing] = useState(false);
  const [template, setTemplate] = useState("rounds");
  const [guests, setGuests] = useState(Math.max(detail.event.expectedGuests || 1, detail.invitedGuests?.length || 0));
  useEffect(() => {
    // Polling refreshes the detail; keep unsaved edits intact.
    if (!dirty) { setMode(seating.mode); setLayout(seating.layout); }
  }, [serverKey]);
  const people = seating.people || [];
  const occupied = useMemo(() => new Set(people.filter(person => person.seatId).map(person => person.seatId)), [people]);
  const names = useMemo(() => new Map(people.filter(person => person.seatId).map(person => [person.seatId, person.name])), [people]);
  const seats = layoutSeats(layout);
  const table = layout.tables.find(entry => entry.id === selected);
  const change = tables => { setLayout({ tables }); setDirty(true); };
  const updateTable = (id, patch, refit = false) => change(layout.tables.map(entry => entry.id === id ? (refit ? fitTable({ ...entry, ...patch }) : { ...entry, ...patch }) : entry));
  const addTable = shape => {
    const bounds = layoutBounds(layout, 0);
    const base = { id: newTableId(layout.tables), shape, label: nextLabel(layout.tables), x: layout.tables.length ? bounds.x + bounds.w + 40 : 60, y: layout.tables.length ? bounds.y : 60, w: 0, h: 0, rotation: 0, seats: shape === "round" ? 8 : 6, ...(shape === "rect" ? { sides: ["top", "bottom"] } : {}) };
    const created = fitTable(base);
    change([...layout.tables, created]);
    setSelected(created.id);
  };
  const applyTemplate = () => {
    if (layout.tables.length && !window.confirm("Заменить текущую схему шаблоном?")) return;
    change(generateLayout(template, guests).tables);
    setSelected(null);
  };
  const unseated = people.filter(person => !person.seatId).length;
  const saved = !dirty;
  const nudge = (dx, dy) => updateTable(table.id, { x: table.x + dx, y: table.y + dy });
  const select = id => { setSelected(id); if (!id) setPlacing(false); };
  const toolbar = table && active ? (
    <div className="map-toolbar" onPointerDown={event => event.stopPropagation()}>
      <strong>{tableTitle(table)}</strong>
      <div className="map-toolbar-row">
        <button type="button" aria-label="Сдвинуть влево" onClick={() => nudge(-20, 0)}><ArrowLeft size={16} /></button>
        <button type="button" aria-label="Сдвинуть вверх" onClick={() => nudge(0, -20)}><ArrowUp size={16} /></button>
        <button type="button" aria-label="Сдвинуть вниз" onClick={() => nudge(0, 20)}><ArrowDown size={16} /></button>
        <button type="button" aria-label="Сдвинуть вправо" onClick={() => nudge(20, 0)}><ArrowRight size={16} /></button>
        <button type="button" className={placing ? "active" : ""} aria-pressed={placing} onClick={() => setPlacing(value => !value)}><Crosshair size={16} /> Сюда</button>
      </div>
      <div className="map-toolbar-row">
        <button type="button" aria-label="Меньше мест" disabled={table.seats <= 0} onClick={() => updateTable(table.id, { seats: table.seats - 1 }, true)}><Minus size={16} /></button>
        <span>{table.seats} мест</span>
        <button type="button" aria-label="Больше мест" disabled={table.seats >= 40} onClick={() => updateTable(table.id, { seats: table.seats + 1 }, true)}><Plus size={16} /></button>
        <button type="button" aria-label="Повернуть" onClick={() => updateTable(table.id, { rotation: ((table.rotation || 0) + 90) % 360 })}><RotateCw size={16} /></button>
        <button type="button" aria-label="Удалить стол" onClick={() => { change(layout.tables.filter(entry => entry.id !== table.id)); select(null); }}><Trash2 size={16} /></button>
        <button type="button" aria-label="Снять выделение" onClick={() => select(null)}><X size={16} /></button>
      </div>
      {placing && <small>Нажмите на свободное место схемы — стол переместится туда.</small>}
    </div>
  ) : null;
  return (
    <div className="admin-layout seating-admin">
      <section className="panel admin-panel">
        <div className="section-head">
          <div>
            <h2>Рассадка</h2>
            <p className="muted">Можно собирать только блюда, а можно добавить схему зала и места.</p>
          </div>
        </div>
        <div className="mode-switch" role="radiogroup" aria-label="Режим рассадки">
          {Object.entries(SEATING_MODE_NAMES).map(([key, label]) => (
            <button key={key} type="button" role="radio" aria-checked={mode === key} className={mode === key ? "active" : ""} disabled={!active} onClick={() => { setMode(key); setDirty(true); }}>
              {label}
            </button>
          ))}
        </div>
        {mode !== "off" && active && (
          <div className="template-row">
            <label>
              Шаблон
              <select value={template} onChange={event => setTemplate(event.target.value)}>
                {SEATING_TEMPLATES.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
              </select>
            </label>
            <label>
              Гостей
              <input type="number" min="1" max="1000" value={guests} onChange={event => setGuests(Number(event.target.value))} />
            </label>
            <button type="button" className="btn secondary" onClick={applyTemplate}><Wand2 size={16} /> Сгенерировать</button>
          </div>
        )}
        {mode !== "off" && active && <p className="muted template-hint">{SEATING_TEMPLATES.find(entry => entry.id === template)?.hint}</p>}
        {(dirty || mode !== seating.mode) && active && (
          <div className="seating-save">
            <span>Есть несохранённые изменения</span>
            <button type="button" className="btn secondary" disabled={busy} onClick={() => { setMode(seating.mode); setLayout(seating.layout); setDirty(false); }}>Отменить</button>
            <button type="button" className="btn" disabled={busy} onClick={async () => { const result = await save({ mode, layout }); if (result !== null) setDirty(false); }}>Сохранить рассадку</button>
          </div>
        )}
      </section>
      {mode !== "off" && (
        <section className="panel admin-panel">
          <div className="section-head">
            <div>
              <h2>Схема зала</h2>
              <p className="muted">{layout.tables.length} столов · {seats.length} мест · занято {occupied.size}. Нажмите на стол, чтобы выбрать его: затем двигайте пальцем, стрелками или кнопкой «Сюда».</p>
            </div>
            {active && (
              <div className="admin-actions seating-tools">
                <button type="button" onClick={() => addTable("round")}><Circle size={15} /> Круглый</button>
                <button type="button" onClick={() => addTable("rect")}><RectangleHorizontal size={15} /> Прямоугольный</button>
              </div>
            )}
          </div>
          {layout.tables.length ? (
            <SeatingMap
              layout={layout}
              occupied={occupied}
              names={names}
              editable={active}
              selectedTable={selected}
              onSelectTable={select}
              onMoveTable={(id, x, y) => updateTable(id, { x, y })}
              onEmptyTap={active ? point => {
                if (placing && table) {
                  const snap = value => Math.round(value / 10) * 10;
                  updateTable(table.id, { x: snap(point.x - table.w / 2), y: snap(point.y - table.h / 2) });
                  setPlacing(false);
                } else select(null);
              } : undefined}
              toolbar={toolbar}
            />
          ) : (
            <p className="muted">Выберите шаблон или добавьте столы вручную.</p>
          )}
          {table && active && (
            <div className="table-editor">
              <label>
                Название
                <input maxLength={24} value={table.label} onChange={event => updateTable(table.id, { label: event.target.value })} />
              </label>
              <label>
                Мест
                <div className="stepper">
                  <button type="button" aria-label="Меньше мест" disabled={table.seats <= 0} onClick={() => updateTable(table.id, { seats: table.seats - 1 }, true)}><Minus size={14} /></button>
                  <span>{table.seats}</span>
                  <button type="button" aria-label="Больше мест" disabled={table.seats >= 40} onClick={() => updateTable(table.id, { seats: table.seats + 1 }, true)}><Plus size={14} /></button>
                </div>
              </label>
              <label>
                Форма
                <select value={table.shape} onChange={event => updateTable(table.id, { shape: event.target.value, sides: event.target.value === "rect" ? ["top", "bottom"] : undefined }, true)}>
                  <option value="round">Круглый</option>
                  <option value="rect">Прямоугольный</option>
                </select>
              </label>
              {table.shape === "rect" && (
                <fieldset className="sides">
                  <legend>Стулья</legend>
                  {RECT_SIDES.map(side => (
                    <label key={side} className="check">
                      <input
                        type="checkbox"
                        checked={table.sides.includes(side)}
                        disabled={table.sides.length === 1 && table.sides.includes(side)}
                        onChange={event => updateTable(table.id, { sides: event.target.checked ? [...table.sides, side] : table.sides.filter(entry => entry !== side) }, true)}
                      />
                      {SIDE_NAMES[side]}
                    </label>
                  ))}
                </fieldset>
              )}
              <div className="admin-actions">
                <button type="button" onClick={() => updateTable(table.id, { rotation: ((table.rotation || 0) + 90) % 360 })}><RotateCw size={14} /> Повернуть</button>
                <button type="button" onClick={() => { change(layout.tables.filter(entry => entry.id !== table.id)); setSelected(null); }}><Trash2 size={14} /> Удалить стол</button>
              </div>
            </div>
          )}
        </section>
      )}
      {mode !== "off" && (
        <section className="panel admin-panel">
          <div className="section-head">
            <div>
              <h2>Кто где сидит</h2>
              <p className="muted">{mode === "choice" ? "Гости выбирают места сами. " : ""}При утверждении заказа гостей без места рассадим автоматически.</p>
            </div>
            {active && (
              <button type="button" className="btn secondary" disabled={busy || !saved || mode !== seating.mode || !unseated} title={!saved ? "Сначала сохраните схему" : undefined} onClick={async () => {
                const result = await autoSeat();
                if (result) notify(result.unseated ? `Рассадили ${result.assigned}, без места осталось ${result.unseated}: добавьте стулья` : `Рассадили гостей: ${result.assigned}`);
              }}>
                <Shuffle size={16} /> Рассадить остальных
              </button>
            )}
          </div>
          {people.length > seating.seatCount && <div className="alert">Мест меньше, чем гостей: {seating.seatCount} из {people.length}.</div>}
          {people.length ? (
            <div className="admin-guest-list">
              {people.map(person => (
                <div className="admin-guest" key={person.key}>
                  <div>
                    <strong>{person.name}</strong>
                    <small>{person.seatId ? `${seatTitle(seating.layout, person.seatId)}${person.source === "auto" ? " · автоматически" : person.source === "admin" ? " · назначено" : ""}` : "Без места"}</small>
                  </div>
                  {active && (
                    <select
                      aria-label={`Место для ${person.name}`}
                      value={person.seatId || ""}
                      disabled={busy || dirty}
                      onChange={event => assign(person.key, event.target.value || null)}
                    >
                      <option value="">Без места</option>
                      {layoutSeats(seating.layout).map(seat => (
                        <option key={seat.id} value={seat.id}>
                          {seatTitle(seating.layout, seat.id)}{names.has(seat.id) && seat.id !== person.seatId ? ` — ${names.get(seat.id)} (поменять местами)` : ""}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">Добавьте гостей в разделе «Управление».</p>
          )}
        </section>
      )}
    </div>
  );
}

/** Read-only plan grouped by table, for the kitchen tab. */
export function SeatingOverview({ seating }) {
  const byTable = useMemo(() => {
    const names = new Map(seating.people?.filter(person => person.seatId).map(person => [person.seatId, person.name]));
    return seating.layout.tables.map(table => ({ table, guests: tableSeats(table).filter(seat => names.has(seat.id)).map(seat => ({ number: seat.number, name: names.get(seat.id) })) })).filter(entry => entry.guests.length);
  }, [seating]);
  const unseated = seating.people?.filter(person => !person.seatId) || [];
  if (!byTable.length && !unseated.length) return null;
  return (
    <>
      <h3>Рассадка</h3>
      <div className="seating-overview">
        {byTable.map(({ table, guests }) => (
          <div key={table.id}>
            <strong>{tableTitle(table)}</strong>
            {guests.map(guest => <span key={guest.number}>{guest.number}. {guest.name}</span>)}
          </div>
        ))}
        {unseated.length > 0 && (
          <div>
            <strong>Без места</strong>
            {unseated.map(person => <span key={person.key}>{person.name}</span>)}
          </div>
        )}
      </div>
    </>
  );
}

/** Who sits at which table — visible to every participant. */
function TableGuests({ layout, names, mySeat }) {
  const tables = layout.tables
    .map(table => ({ table, guests: tableSeats(table).filter(seat => names.has(seat.id)).map(seat => ({ seat, name: names.get(seat.id) })) }))
    .filter(entry => entry.guests.length);
  if (!tables.length) return null;
  return (
    <div className="seating-overview table-guests">
      {tables.map(({ table, guests }) => (
        <div key={table.id}>
          <strong>{tableTitle(table)}</strong>
          {guests.map(({ seat, name }) => <span key={seat.id} className={seat.id === mySeat ? "mine" : ""}>{seat.number}. {name}{seat.id === mySeat ? " (вы)" : ""}</span>)}
        </div>
      ))}
    </div>
  );
}
