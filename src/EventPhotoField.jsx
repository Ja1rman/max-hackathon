import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value));

function CropDialog({ file, onCancel, onSave, onError }) {
  const [source, setSource] = useState('');
  const [dimensions, setDimensions] = useState(null);
  const [frame, setFrame] = useState({ width: 1, height: 1 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const stageRef = useRef(null);
  const dragRef = useRef(null);
  const closeRef = useRef(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSource(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => setFrame({ width: stage.clientWidth, height: stage.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = event => {
      if (event.key === 'Escape') { event.stopPropagation(); onCancel(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);
  const base = dimensions ? Math.max(frame.width / dimensions.width, frame.height / dimensions.height) : 1;
  const scale = base * zoom;
  const imageWidth = dimensions ? dimensions.width * scale : 0;
  const imageHeight = dimensions ? dimensions.height * scale : 0;
  const maxX = Math.max(0, (imageWidth - frame.width) / 2);
  const maxY = Math.max(0, (imageHeight - frame.height) / 2);
  const position = { x: clamp(offset.x, maxX), y: clamp(offset.y, maxY) };
  const save = async () => {
    if (!dimensions || saving) return;
    setSaving(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1600;
      canvas.height = 900;
      const context = canvas.getContext('2d');
      if (!context) throw new Error();
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      const image = stageRef.current.querySelector('img');
      const cropWidth = frame.width / scale;
      const cropHeight = frame.height / scale;
      context.drawImage(image, (dimensions.width - cropWidth) / 2 - position.x / scale, (dimensions.height - cropHeight) / 2 - position.y / scale, cropWidth, cropHeight, 0, 0, 1600, 900);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      if (!blob) throw new Error();
      onSave(new File([blob], `${file.name.replace(/\.[^.]+$/, '')}-cover.jpg`, { type: 'image/jpeg' }));
    } catch {
      onError?.('Не удалось обрезать фото. Выберите другое изображение.');
      setSaving(false);
    }
  };
  return createPortal(<div className="photo-crop-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className="photo-crop-dialog" role="dialog" aria-modal="true" aria-label="Обрезка обложки">
      <div className="photo-crop-heading"><div><strong>Обрезать обложку</strong><small>Переместите фото и настройте масштаб. Обложка сохранится в формате 16:9.</small></div><button ref={closeRef} type="button" className="photo-crop-close" aria-label="Закрыть обрезку" onClick={onCancel}>×</button></div>
      <div className="photo-crop-stage" ref={stageRef}
        onPointerDown={event => { if (!dimensions) return; event.currentTarget.setPointerCapture(event.pointerId); dragRef.current = { x: event.clientX, y: event.clientY, offset: position }; }}
        onPointerMove={event => { if (!dragRef.current) return; setOffset({ x: clamp(dragRef.current.offset.x + event.clientX - dragRef.current.x, maxX), y: clamp(dragRef.current.offset.y + event.clientY - dragRef.current.y, maxY) }); }}
        onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }}>
        {source && <img src={source} alt="Предпросмотр обложки" draggable="false" onLoad={event => { const image = event.currentTarget; setDimensions({ width: image.naturalWidth, height: image.naturalHeight }); }} onError={() => { onError?.('Не удалось открыть фото. Выберите другое изображение.'); onCancel(); }} style={dimensions ? { width: imageWidth, height: imageHeight, transform: `translate(calc(-50% + ${position.x}px), calc(-50% + ${position.y}px))` } : undefined} />}
        <div className="photo-crop-grid" aria-hidden="true" />
      </div>
      <label className="photo-crop-zoom">Масштаб <input type="range" min="1" max="3" step="0.01" value={zoom} onChange={event => { const next = Number(event.target.value); setZoom(next); setOffset({ x: clamp(position.x, Math.max(0, (dimensions.width * base * next - frame.width) / 2)), y: clamp(position.y, Math.max(0, (dimensions.height * base * next - frame.height) / 2)) }); }} disabled={!dimensions} /></label>
      <div className="photo-crop-actions"><button type="button" onClick={onCancel}>Отмена</button><button type="button" className="photo-crop-apply" onClick={save} disabled={!dimensions || saving}>{saving ? 'Обработка…' : 'Сохранить обрезку'}</button></div>
    </section>
  </div>, document.body);
}

export default function EventPhotoField({ currentSrc = '', file, removed, onChange, onError, disabled = false }) {
  const inputRef = useRef(null);
  const [pending, setPending] = useState(null);
  const [preview, setPreview] = useState('');
  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const visible = preview || (!removed && currentSrc);
  return <div className="event-photo-field">
    <strong>Фото мероприятия <span>(JPEG, PNG, WebP, до 10 МБ)</span></strong>
    {visible && <img className="event-photo-preview" src={visible} alt="Обложка мероприятия" />}
    <div className="event-photo-actions">
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={disabled} onChange={event => {
        const selected = event.target.files?.[0];
        event.target.value = '';
        if (!selected) return;
        if (!TYPES.includes(selected.type) || selected.size > MAX_BYTES) { onError?.('Выберите JPEG, PNG или WebP до 10 МБ.'); return; }
        setPending(selected);
      }} />
      <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()}>{visible ? 'Заменить фото' : 'Выбрать фото'}</button>
      {visible && <button type="button" disabled={disabled} onClick={() => onChange({ file: null, removed: true })}>Убрать фото</button>}
    </div>
    {pending && <CropDialog file={pending} onCancel={() => setPending(null)} onSave={cropped => { onChange({ file: cropped, removed: false }); setPending(null); }} onError={onError} />}
  </div>;
}
