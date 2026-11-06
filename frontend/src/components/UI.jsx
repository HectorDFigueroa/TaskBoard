import { useEffect, useState } from 'react';
import { escucharLentitud } from '../api.js';
import { Rayo } from './Doodles.jsx';

/** Aviso cuando el servidor de Render está "despertando" */
export function AvisoDespertando() {
  const [lento, setLento] = useState(false);
  useEffect(() => escucharLentitud(setLento), []);
  if (!lento) return null;
  return (
    <div className="aviso-despertando" role="status">
      <Rayo className="aviso-rayo" color="#0b0b10" />
      <div>
        <strong>Despertando el servidor…</strong>
        <span>El plan gratis de Render se duerme si nadie lo usa. Puede tardar hasta un minuto.</span>
      </div>
    </div>
  );
}

export function Cargando({ texto = 'Cargando…' }) {
  return (
    <div className="cargando" role="status">
      <span className="spinner" />
      <span>{texto}</span>
    </div>
  );
}

export function ErrorCaja({ mensaje, onReintentar }) {
  return (
    <div className="error-caja" role="alert">
      <p>😵 {mensaje}</p>
      {onReintentar && <button className="btn btn-borde btn-sm" onClick={onReintentar}>Reintentar</button>}
    </div>
  );
}

export function Errores({ lista }) {
  if (!lista?.length) return null;
  return (
    <ul className="errores" role="alert">
      {lista.map((e) => <li key={e}>{e}</li>)}
    </ul>
  );
}

export function Modal({ titulo, onCerrar, children, ancho }) {
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onCerrar();
    document.addEventListener('keydown', esc);
    document.body.classList.add('sin-scroll');
    return () => { document.removeEventListener('keydown', esc); document.body.classList.remove('sin-scroll'); };
  }, [onCerrar]);

  return (
    <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="modal" style={ancho ? { maxWidth: ancho } : undefined} role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="modal-cabeza">
          <h2 className="marcador">{titulo}</h2>
          <button className="btn-icono" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Mensajes flotantes de éxito o error */
export function Toasts({ lista }) {
  return (
    <div className="toasts" aria-live="polite">
      {lista.map((t) => (
        <div key={t.id} className={`toast toast-${t.tipo}`}>{t.texto}</div>
      ))}
    </div>
  );
}
