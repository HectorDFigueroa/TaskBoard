import { pesos, fecha, iniciales } from '../utils.js';

const COLORES = ['#ffc531', '#ff6a3d', '#7c4dff', '#3aa0ff', '#2ee6a6', '#ff4fa3'];
export const colorDe = (texto = '') =>
  COLORES[[...texto.toLowerCase()].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORES.length];

export function Avatar({ nombre, grande }) {
  return (
    <span className={`avatar ${grande ? 'avatar-grande' : ''}`} style={{ background: colorDe(nombre) }}>
      {iniciales(nombre)}
    </span>
  );
}

function EstadoVinculo({ d }) {
  if (d.estado_vinculo === 'pendiente') {
    return d.es_creador
      ? <span className="chip chip-espera">⏳ Esperando a @{d.usuario_vinculado}</span>
      : <span className="chip chip-espera">📩 Solicitud de @{d.usuario_vinculado}</span>;
  }
  if (d.estado_vinculo === 'rechazada') return <span className="chip chip-mal">✕ @{d.usuario_vinculado} la rechazó</span>;
  if (d.estado_vinculo === 'aceptada') return <span className="chip chip-ok">🤝 Aceptada por ambos</span>;
  return null;
}

/**
 * Tarjeta de una deuda. Los botones dependen de `d.permisos`,
 * que calcula el backend (así el frontend no repite las reglas de negocio).
 */
export default function DeudaCard({ d, onPagar, onReabrir, onEditar, onEliminar, onAceptar, onRechazar, onDeshacerAbono, ocupado }) {
  const meDeben = d.tipo === 'me_deben';
  const conInteres = d.tipo_interes !== 'ninguno';
  const p = d.permisos;
  const tieneAbonos = d.pagos.length > 0;

  return (
    <article className={`deuda ${meDeben ? 'deuda-meDeben' : 'deuda-debo'} ${d.pagada ? 'deuda-pagada' : ''}`}>
      <div className="deuda-top">
        <Avatar nombre={d.persona} />
        <div className="deuda-quien">
          <h3>{d.persona}</h3>
          {d.usuario_vinculado && <span className="usuario">@{d.usuario_vinculado}</span>}
        </div>
        <span className={`etiqueta ${meDeben ? 'etiqueta-meDeben' : 'etiqueta-debo'}`}>
          {meDeben ? '↓ Me debe' : '↑ Le debo'}
        </span>
      </div>

      {d.concepto && <p className="deuda-concepto">{d.concepto}</p>}

      <div className="deuda-monto">
        <span className="monto">{pesos(d.pagada ? d.monto_pagado : d.total_a_hoy)}</span>
        {conInteres && (
          <span className="monto-detalle">
            {pesos(d.monto)} + {pesos(d.interes_acumulado)} de interés
            <br />
            {d.tasa_interes}% mensual {d.tipo_interes} · {d.dias_transcurridos} días
          </span>
        )}
        {tieneAbonos && !d.pagada && (
          <span className="monto-detalle">Saldo pendiente · ya abonaron {pesos(d.abonado)}</span>
        )}
      </div>

      {tieneAbonos && (
        <details className="abonos">
          <summary>{d.pagos.length === 1 ? '1 pago registrado' : `${d.pagos.length} pagos registrados`}</summary>
          <ul>
            {d.pagos.map((pago, i) => (
              <li key={pago.id}>
                <span>{fecha(pago.fecha)}</span>
                <strong>{pesos(pago.monto)}</strong>
                {p.deshacer_abono && i === d.pagos.length - 1 && (
                  <button className="link-lima" disabled={ocupado} onClick={() => onDeshacerAbono(d, pago)}>Deshacer</button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="deuda-chips">
        <span className="chip">📅 {fecha(d.fecha)}</span>
        {d.fecha_limite && !d.pagada && (
          <span className={`chip ${d.vencida ? 'chip-mal' : ''}`}>
            {d.vencida ? '🔥 Venció el ' : '⏰ Hasta el '}{fecha(d.fecha_limite)}
          </span>
        )}
        {d.pagada && <span className="chip chip-ok">✓ Pagada el {fecha(d.fecha_pago)}</span>}
        <EstadoVinculo d={d} />
      </div>

      <div className="deuda-acciones">
        {p.responder && (
          <>
            <button className="btn btn-lima btn-sm" disabled={ocupado} onClick={() => onAceptar(d)}>✓ Aceptar</button>
            <button className="btn btn-borde btn-sm" disabled={ocupado} onClick={() => onRechazar(d)}>Rechazar</button>
          </>
        )}
        {p.pagar && <button className="btn btn-lima btn-sm" disabled={ocupado} onClick={() => onPagar(d)}>💸 Registrar pago</button>}
        {p.reabrir && <button className="btn btn-borde btn-sm" disabled={ocupado} onClick={() => onReabrir(d)}>↺ Reabrir</button>}
        {(p.editar || p.editar_concepto) && (
          <button className="btn btn-borde btn-sm" disabled={ocupado} onClick={() => onEditar(d)}>✎ Editar</button>
        )}
        {p.eliminar && (
          <button className="btn btn-texto btn-sm" disabled={ocupado} onClick={() => onEliminar(d)} aria-label="Eliminar">🗑</button>
        )}
      </div>

      {d.pagada && <span className="sello">PAGADA</span>}
    </article>
  );
}
