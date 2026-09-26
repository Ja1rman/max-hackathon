import React, { useEffect, useState } from "react";

// In-app confirmation dialog. Native confirm() is not reliable inside the MAX WebView,
// where it may be suppressed and silently return false.
let open = null;

/** Resolves true when the person confirms. */
export function ask(message, { confirmLabel = "Подтвердить", danger = true } = {}) {
  return new Promise(resolve => {
    if (!open) return resolve(window.confirm(message));
    open({ message, confirmLabel, danger, resolve });
  });
}

export function ConfirmHost() {
  const [request, setRequest] = useState(null);
  useEffect(() => {
    open = setRequest;
    return () => { open = null; };
  }, []);
  useEffect(() => {
    if (!request) return;
    const onKey = event => { if (event.key === "Escape") finish(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [request]);
  if (!request) return null;
  const finish = value => { request.resolve(value); setRequest(null); };
  return (
    <div className="modal-backdrop confirm-backdrop" onMouseDown={event => event.target === event.currentTarget && finish(false)}>
      <section role="alertdialog" aria-modal="true" aria-label={request.message} className="modal confirm-modal">
        <p>{request.message}</p>
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={() => finish(false)}>Отмена</button>
          <button type="button" className={`btn ${request.danger ? "danger" : ""}`} autoFocus onClick={() => finish(true)}>{request.confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}
