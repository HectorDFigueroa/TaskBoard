import { useState } from 'react';
import { api } from '../api.js';
import { pesos } from '../utils.js';
import { Errores } from './UI.jsx';

const ANULAR = 'anular';

/** El juez elige al ganador o anula la apuesta. Solo cambia si los dos apostadores están de acuerdo. */
export default function DecidirForm({ apuesta, onDecidida, onCancelar }) {
  const { creador, oponente, monto, titulo } = apuesta;
  const [eleccion, setEleccion] = useState(null);
  const [errores, setErrores] = useState([]);
  const [guardando, setGuardando] = useState(false);

  const ganador = [creador, oponente].find((p) => p.username === eleccion);
  const perdedor = ganador && (ganador === creador ? oponente : creador);

  async function confirmar() {
    setGuardando(true);
    setErrores([]);
    try {
      onDecidida(eleccion === ANULAR
        ? await api(`/api/apuestas/${apuesta.id}/anular`, { method: 'PATCH' })
        : await api(`/api/apuestas/${apuesta.id}/decidir`, { method: 'PATCH', body: { ganador: eleccion } }));
    } catch (e) {
      setErrores(e.errores);
      setGuardando(false);
    }
  }

  return (
    <div className="form">
      <p className="confirmar-texto decidir-titulo"><b>{titulo}</b></p>

      <div className="decidir-opciones" role="radiogroup" aria-label="Resultado de la apuesta">
        {[creador, oponente].map((p) => (
          <button key={p.username} type="button" role="radio" aria-checked={eleccion === p.username}
            className={`decidir-opcion ${eleccion === p.username ? 'activo' : ''}`}
            onClick={() => setEleccion(p.username)}>
            <strong>🏆 Ganó {p.nombre}</strong>
            <span>{p.postura}</span>
          </button>
        ))}
        <button type="button" role="radio" aria-checked={eleccion === ANULAR}
          className={`decidir-opcion ${eleccion === ANULAR ? 'activo' : ''}`}
          onClick={() => setEleccion(ANULAR)}>
          <strong>⊘ Anular apuesta</strong>
          <span>Empate o no se pudo definir</span>
        </button>
      </div>

      {ganador && (
        <p className="nota">
          @{perdedor.username} quedará debiéndole {pesos(monto)} a @{ganador.username}. Solo se podrá cambiar si los dos apostadores están de acuerdo.
        </p>
      )}
      {eleccion === ANULAR && (
        <p className="nota">Nadie le deberá nada a nadie. Solo se podrá cambiar si los dos apostadores están de acuerdo.</p>
      )}

      <Errores lista={errores} />

      <div className="form-acciones">
        <button type="button" className="btn btn-borde" onClick={onCancelar}>Cancelar</button>
        <button type="button" className="btn btn-lima" disabled={!eleccion || guardando} onClick={confirmar}>
          {guardando ? 'Guardando…' : 'Confirmar decisión'}
        </button>
      </div>
    </div>
  );
}
