import { useState } from 'react';
import { api } from '../api.js';
import { hoyISO, pesos, saldoALaFecha } from '../utils.js';
import { Errores } from './UI.jsx';

/** Registra un pago: todo el saldo o un abono parcial */
export default function PagarForm({ deuda, onPagada, onCancelar }) {
  const [modo, setModo] = useState('total');
  const [monto, setMonto] = useState('');
  const [fechaPago, setFechaPago] = useState(hoyISO());
  const [errores, setErrores] = useState([]);
  const [enviando, setEnviando] = useState(false);

  // El pago no puede ser anterior a la deuda ni al último abono
  const minimo = deuda.pagos.at(-1)?.fecha ?? deuda.fecha;
  const { capital, interes, saldo } = saldoALaFecha(deuda, fechaPago);
  const conInteres = deuda.tipo_interes !== 'ninguno';
  const abono = Number(monto);
  const parcial = modo === 'parcial';

  function validar() {
    const e = [];
    if (fechaPago < minimo) e.push(`La fecha no puede ser antes del ${minimo}`);
    if (fechaPago > hoyISO()) e.push('La fecha no puede estar en el futuro');
    if (parcial && !(abono > 0)) e.push('Escribe cuánto abonaron');
    if (parcial && abono > saldo) e.push(`El abono no puede superar el saldo de ${pesos(saldo)}`);
    return e;
  }

  async function pagar(e) {
    e.preventDefault();
    const lista = validar();
    setErrores(lista);
    if (lista.length) return;

    setEnviando(true);
    try {
      onPagada(parcial
        ? await api(`/api/deudas/${deuda.id}/pagos`, { method: 'POST', body: { monto: abono, fecha: fechaPago } })
        : await api(`/api/deudas/${deuda.id}/pagar`, { method: 'PATCH', body: { fecha_pago: fechaPago } }));
    } catch (err) {
      setErrores(err.errores);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className="form" onSubmit={pagar} noValidate>
      <div className="pestanas-mini">
        <button type="button" className={!parcial ? 'activo' : ''} onClick={() => setModo('total')}>Todo el saldo</button>
        <button type="button" className={parcial ? 'activo' : ''} onClick={() => setModo('parcial')}>Abono parcial</button>
      </div>

      <div className="resumen-pago">
        <div><span>Capital pendiente</span><strong>{pesos(capital)}</strong></div>
        {conInteres && <div><span>Interés pendiente</span><strong>{pesos(interes)}</strong></div>}
        <div className="resumen-total"><span>{parcial ? 'Saldo actual' : 'Total a pagar'}</span><strong>{pesos(saldo)}</strong></div>
      </div>

      {parcial && (
        <label className="campo">
          <span className="campo-label">¿Cuánto abonaron? (COP)</span>
          <input type="number" inputMode="decimal" min="1" max={saldo} step="any" value={monto}
            onChange={(e) => setMonto(e.target.value)} placeholder="20000" autoFocus />
          {abono > 0 && abono <= saldo && (
            <span className="ayuda ayuda-ok">
              {abono === saldo ? 'Con este abono la deuda queda pagada' : `Quedarían faltando ${pesos(saldo - abono)}`}
            </span>
          )}
          {conInteres && <span className="ayuda">El abono cubre primero el interés y luego el capital.</span>}
        </label>
      )}

      <label className="campo">
        <span className="campo-label">¿Cuándo se pagó?</span>
        <input type="date" value={fechaPago} min={minimo} max={hoyISO()} onChange={(e) => setFechaPago(e.target.value)} />
      </label>
      <Errores lista={errores} />
      <div className="form-acciones">
        <button type="button" className="btn btn-borde" onClick={onCancelar}>Cancelar</button>
        <button type="submit" className="btn btn-lima" disabled={enviando}>
          {enviando ? 'Guardando…' : parcial ? 'Registrar abono' : 'Confirmar pago'}
        </button>
      </div>
    </form>
  );
}
