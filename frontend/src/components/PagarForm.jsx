import { useState } from 'react';
import { api } from '../api.js';
import { hoyISO, pesos, totalConInteres, diasEntre } from '../utils.js';
import { Errores } from './UI.jsx';

export default function PagarForm({ deuda, onPagada, onCancelar }) {
  const [fechaPago, setFechaPago] = useState(hoyISO());
  const [errores, setErrores] = useState([]);
  const [enviando, setEnviando] = useState(false);

  const dias = diasEntre(deuda.fecha, fechaPago);
  const total = totalConInteres(deuda.monto, deuda.tipo_interes, deuda.tasa_interes, dias);
  const conInteres = deuda.tipo_interes !== 'ninguno';

  async function pagar(e) {
    e.preventDefault();
    if (fechaPago < deuda.fecha) return setErrores(['La fecha de pago no puede ser antes de la deuda']);
    setEnviando(true);
    try {
      onPagada(await api(`/api/deudas/${deuda.id}/pagar`, { method: 'PATCH', body: { fecha_pago: fechaPago } }));
    } catch (err) {
      setErrores(err.errores);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className="form" onSubmit={pagar}>
      <div className="resumen-pago">
        <div><span>Capital</span><strong>{pesos(deuda.monto)}</strong></div>
        {conInteres && <div><span>Interés ({dias} días)</span><strong>{pesos(total - deuda.monto)}</strong></div>}
        <div className="resumen-total"><span>Total pagado</span><strong>{pesos(total)}</strong></div>
      </div>
      <label className="campo">
        <span className="campo-label">¿Cuándo se pagó?</span>
        <input type="date" value={fechaPago} min={deuda.fecha} max={hoyISO()} onChange={(e) => setFechaPago(e.target.value)} />
      </label>
      <Errores lista={errores} />
      <div className="form-acciones">
        <button type="button" className="btn btn-borde" onClick={onCancelar}>Cancelar</button>
        <button type="submit" className="btn btn-lima" disabled={enviando}>{enviando ? 'Guardando…' : 'Confirmar pago'}</button>
      </div>
    </form>
  );
}
