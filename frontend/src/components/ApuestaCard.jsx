import { pesos, fecha } from '../utils.js';
import { Avatar } from './DeudaCard.jsx';

const ROLES = { creador: 'Creaste esta apuesta', oponente: 'Te retaron', juez: '⚖ Eres el juez' };

function Apostador({ p, ganador }) {
  return (
    <div className={`apostador ${ganador ? 'apostador-ganador' : ''}`}>
      <Avatar nombre={p.nombre} />
      <strong>{ganador && '🏆 '}{p.nombre}</strong>
      <span className="usuario">@{p.username}</span>
      <span className="apostador-postura">{p.postura}</span>
    </div>
  );
}

function Estado({ a }) {
  switch (a.estado) {
    case 'pendiente':
      return (
        <>
          {!a.oponente.acepto && <span className="chip chip-espera">⏳ Falta @{a.oponente.username}</span>}
          {!a.juez.acepto && <span className="chip chip-espera">⏳ Falta el juez</span>}
        </>
      );
    case 'activa':
      return <span className="chip chip-ok">🔥 En juego</span>;
    case 'rechazada':
      return <span className="chip chip-mal">✕ @{a.rechazada_por} la rechazó</span>;
    case 'anulada':
      return <span className="chip">⊘ Anulada el {fecha(a.fecha_decision)}</span>;
    case 'resuelta':
      return (
        <>
          <span className="chip">⚖ Decidida el {fecha(a.fecha_decision)}</span>
          {a.deuda?.pagada && <span className="chip chip-ok">✓ Pagada el {fecha(a.deuda.fecha_pago)}</span>}
          {a.deuda && !a.deuda.pagada && (
            a.deuda.abonado > 0
              ? <span className="chip chip-espera">💸 Abonado {pesos(a.deuda.abonado)} · faltan {pesos(a.deuda.saldo)}</span>
              : <span className="chip chip-mal">💸 Falta el pago</span>
          )}
        </>
      );
    default:
      return null;
  }
}

/** Tarjeta de una apuesta. Los botones dependen de `a.permisos`, que calcula el backend. */
export default function ApuestaCard({
  a, onAceptar, onRechazar, onDecidir, onEliminar, onPedirRevision, onAceptarRevision, onRechazarRevision, ocupado,
}) {
  const p = a.permisos;

  return (
    <article className={`deuda apuesta apuesta-${a.estado}`}>
      <div className="apuesta-cabeza">
        <h3>{a.titulo}</h3>
        <span className="monto">{pesos(a.monto)}</span>
      </div>

      <div className="apuesta-versus">
        <Apostador p={a.creador} ganador={a.ganador === a.creador.username} />
        <span className="marcador apuesta-vs">VS</span>
        <Apostador p={a.oponente} ganador={a.ganador === a.oponente.username} />
      </div>

      <p className="apuesta-juez">⚖ Juez: <b>{a.juez.nombre}</b> <span className="usuario">@{a.juez.username}</span></p>

      {a.estado === 'resuelta' && (
        <p className="nota">@{a.perdedor} le debe {pesos(a.monto)} a @{a.ganador}</p>
      )}

      <div className="deuda-chips">
        <span className="chip">{ROLES[a.mi_rol]}</span>
        <Estado a={a} />
        {a.revision_pedida_por && <span className="chip chip-espera">↺ @{a.revision_pedida_por} pidió cambiar la decisión</span>}
      </div>

      <div className="deuda-acciones">
        {p.responder && (
          <>
            <button className="btn btn-lima btn-sm" disabled={ocupado} onClick={() => onAceptar(a)}>
              ✓ {a.mi_rol === 'juez' ? 'Aceptar ser juez' : 'Aceptar apuesta'}
            </button>
            <button className="btn btn-borde btn-sm" disabled={ocupado} onClick={() => onRechazar(a)}>Rechazar</button>
          </>
        )}
        {p.decidir && <button className="btn btn-lima btn-sm" disabled={ocupado} onClick={() => onDecidir(a)}>⚖ Decidir ganador</button>}
        {p.pedir_revision && (
          <button className="btn btn-borde btn-sm" disabled={ocupado} onClick={() => onPedirRevision(a)}>↺ Pedir cambiar decisión</button>
        )}
        {p.responder_revision && (
          <>
            <button className="btn btn-lima btn-sm" disabled={ocupado} onClick={() => onAceptarRevision(a)}>✓ Aceptar cambio</button>
            <button className="btn btn-borde btn-sm" disabled={ocupado} onClick={() => onRechazarRevision(a)}>Rechazar cambio</button>
          </>
        )}
        {p.cancelar_revision && (
          <button className="btn btn-borde btn-sm" disabled={ocupado} onClick={() => onRechazarRevision(a)}>Retirar solicitud</button>
        )}
        {p.eliminar && (
          <button className="btn btn-texto btn-sm" disabled={ocupado} onClick={() => onEliminar(a)} aria-label="Eliminar">🗑</button>
        )}
      </div>
    </article>
  );
}
