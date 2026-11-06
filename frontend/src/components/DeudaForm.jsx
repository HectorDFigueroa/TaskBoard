import { useState } from 'react';
import { api } from '../api.js';
import { hoyISO, pesos, totalConInteres, diasEntre } from '../utils.js';
import { Errores } from './UI.jsx';

/**
 * Formulario para crear o editar una deuda.
 * - deuda = undefined → crear
 * - deuda = {...}     → editar (solo los campos que el backend permite)
 */
export default function DeudaForm({ deuda, onGuardada, onCancelar }) {
  const editando = !!deuda;
  const conAbonos = editando && deuda.pagos.length > 0;
  const soloConcepto = editando && (deuda.estado_vinculo === 'aceptada' || conAbonos);
  const vinculada = editando && !!deuda.usuario_vinculado;

  const [f, setF] = useState({
    tipo: deuda?.tipo ?? 'me_deben',
    modo: vinculada ? 'usuario' : 'nombre',
    persona: vinculada ? '' : deuda?.persona ?? '',
    contraparte: deuda?.usuario_vinculado ?? '',
    monto: deuda?.monto ?? '',
    concepto: deuda?.concepto ?? '',
    fecha: deuda?.fecha ?? hoyISO(),
    fecha_limite: deuda?.fecha_limite ?? '',
    tipo_interes: deuda?.tipo_interes ?? 'ninguno',
    tasa_interes: deuda && deuda.tipo_interes !== 'ninguno' ? deuda.tasa_interes : '',
  });
  const [encontrado, setEncontrado] = useState(vinculada ? { nombre: deuda.persona, username: deuda.usuario_vinculado } : null);
  const [buscando, setBuscando] = useState(false);
  const [errores, setErrores] = useState([]);
  const [guardando, setGuardando] = useState(false);

  const cambiar = (campo) => (e) => {
    const valor = e.target.value;
    setF((prev) => ({ ...prev, [campo]: valor }));
    if (campo === 'contraparte') setEncontrado(null);
  };

  const buscarUsuario = async () => {
    const u = f.contraparte.trim().replace(/^@/, '').toLowerCase();
    if (!u) return setErrores(['Escribe el @usuario que quieres buscar']);
    setBuscando(true);
    setErrores([]);
    try {
      setEncontrado(await api(`/api/usuarios/buscar?username=${encodeURIComponent(u)}`));
    } catch (e) {
      setEncontrado(null);
      setErrores(e.errores);
    } finally {
      setBuscando(false);
    }
  };

  // Validación en el cliente (el backend vuelve a validar todo)
  function validar() {
    const e = [];
    if (soloConcepto) return e;
    if (f.modo === 'nombre' && f.persona.trim().length < 2) e.push('Escribe el nombre de la persona (mínimo 2 letras)');
    if (f.modo === 'usuario' && !f.contraparte.trim()) e.push('Escribe el @usuario de la otra persona');
    if (!(Number(f.monto) > 0)) e.push('El monto debe ser mayor que 0');
    if (f.fecha > hoyISO()) e.push('La fecha no puede estar en el futuro');
    if (f.fecha_limite && f.fecha_limite < f.fecha) e.push('La fecha límite no puede ser antes de la fecha de la deuda');
    if (f.tipo_interes !== 'ninguno' && !(Number(f.tasa_interes) > 0)) e.push('Escribe la tasa de interés mensual');
    return e;
  }

  function cuerpo() {
    if (soloConcepto) return { concepto: f.concepto };
    const b = {
      tipo: f.tipo,
      monto: Number(f.monto),
      concepto: f.concepto,
      fecha: f.fecha,
      fecha_limite: f.fecha_limite || null,
      tipo_interes: f.tipo_interes,
      tasa_interes: f.tipo_interes === 'ninguno' ? 0 : Number(f.tasa_interes),
    };
    if (f.modo === 'nombre') {
      b.persona = f.persona;
      if (vinculada) b.contraparte = null; // pasó de @usuario a nombre libre
    } else {
      const u = f.contraparte.trim().replace(/^@/, '').toLowerCase();
      if (!editando || u !== deuda.usuario_vinculado) b.contraparte = u;
    }
    return b;
  }

  async function enviar(e) {
    e.preventDefault();
    const lista = validar();
    setErrores(lista);
    if (lista.length) return;

    setGuardando(true);
    try {
      const guardada = editando
        ? await api(`/api/deudas/${deuda.id}`, { method: 'PUT', body: cuerpo() })
        : await api('/api/deudas', { method: 'POST', body: cuerpo() });
      onGuardada(guardada);
    } catch (err) {
      setErrores(err.errores);
    } finally {
      setGuardando(false);
    }
  }

  // Vista previa del interés
  const conInteres = f.tipo_interes !== 'ninguno' && Number(f.tasa_interes) > 0 && Number(f.monto) > 0;
  const plazos = f.fecha_limite && f.fecha_limite > f.fecha
    ? [{ etiqueta: 'A la fecha límite', dias: diasEntre(f.fecha, f.fecha_limite) }]
    : [];
  plazos.push({ etiqueta: '1 mes', dias: 30 }, { etiqueta: '3 meses', dias: 90 }, { etiqueta: '6 meses', dias: 180 });

  return (
    <form className="form" onSubmit={enviar} noValidate>
      {soloConcepto && (
        <p className="nota">
          {conAbonos
            ? '💸 Esta deuda ya tiene abonos, así que solo puedes cambiar el concepto.'
            : `🤝 @${deuda.usuario_vinculado} ya aceptó esta deuda, así que solo puedes cambiar el concepto.`}
        </p>
      )}

      {!soloConcepto && (
        <>
          <div className="segmentado" role="radiogroup" aria-label="Tipo de deuda">
            <button type="button" className={f.tipo === 'me_deben' ? 'activo activo-meDeben' : ''}
              onClick={() => setF({ ...f, tipo: 'me_deben' })}>↓ Me deben</button>
            <button type="button" className={f.tipo === 'debo' ? 'activo activo-debo' : ''}
              onClick={() => setF({ ...f, tipo: 'debo' })}>↑ Yo debo</button>
          </div>

          <div className="campo">
            <span className="campo-label">¿Con quién?</span>
            <div className="pestanas-mini">
              <button type="button" className={f.modo === 'nombre' ? 'activo' : ''} onClick={() => setF({ ...f, modo: 'nombre' })}>
                Nombre
              </button>
              <button type="button" className={f.modo === 'usuario' ? 'activo' : ''} onClick={() => setF({ ...f, modo: 'usuario' })}>
                @Usuario de la app
              </button>
            </div>
            {f.modo === 'nombre' ? (
              <input value={f.persona} onChange={cambiar('persona')} placeholder="Ej: Juan Pérez" maxLength={80} />
            ) : (
              <>
                <div className="fila-input">
                  <input value={f.contraparte} onChange={cambiar('contraparte')} placeholder="@usuario"
                    autoCapitalize="none" autoCorrect="off" maxLength={21} />
                  <button type="button" className="btn btn-borde btn-sm" onClick={buscarUsuario} disabled={buscando}>
                    {buscando ? 'Buscando…' : 'Verificar'}
                  </button>
                </div>
                {encontrado
                  ? <span className="ayuda ayuda-ok">✓ {encontrado.nombre} (@{encontrado.username}) — tendrá que aceptarla</span>
                  : <span className="ayuda">La deuda aparecerá también en su cuenta cuando la acepte.</span>}
              </>
            )}
          </div>

          <div className="fila-2">
            <label className="campo">
              <span className="campo-label">Monto (COP)</span>
              <input type="number" inputMode="decimal" min="1" step="any" value={f.monto} onChange={cambiar('monto')} placeholder="50000" />
            </label>
            <label className="campo">
              <span className="campo-label">Fecha</span>
              <input type="date" value={f.fecha} max={hoyISO()} onChange={cambiar('fecha')} />
            </label>
          </div>
        </>
      )}

      <label className="campo">
        <span className="campo-label">Concepto <em>(opcional)</em></span>
        <input value={f.concepto ?? ''} onChange={cambiar('concepto')} placeholder="Ej: Almuerzo, pasajes, préstamo…" maxLength={150} />
      </label>

      {!soloConcepto && (
        <>
          <label className="campo">
            <span className="campo-label">Fecha límite <em>(opcional)</em></span>
            <input type="date" value={f.fecha_limite} min={f.fecha} onChange={cambiar('fecha_limite')} />
          </label>

          <div className="campo">
            <span className="campo-label">Interés</span>
            <div className="pestanas-mini">
              {[['ninguno', 'Sin interés'], ['simple', 'Simple'], ['compuesto', 'Compuesto']].map(([v, t]) => (
                <button key={v} type="button" className={f.tipo_interes === v ? 'activo' : ''}
                  onClick={() => setF({ ...f, tipo_interes: v })}>{t}</button>
              ))}
            </div>
            {f.tipo_interes !== 'ninguno' && (
              <div className="fila-input">
                <input type="number" inputMode="decimal" min="0.01" step="0.01" value={f.tasa_interes}
                  onChange={cambiar('tasa_interes')} placeholder="Tasa" />
                <span className="sufijo">% mensual</span>
              </div>
            )}
          </div>

          {conInteres && (
            <div className="preview-interes">
              <span className="marcador preview-titulo">Así crece 📈</span>
              {plazos.map((pl) => (
                <div key={pl.etiqueta} className="preview-fila">
                  <span>{pl.etiqueta}</span>
                  <strong>{pesos(totalConInteres(f.monto, f.tipo_interes, f.tasa_interes, pl.dias))}</strong>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <Errores lista={errores} />

      <div className="form-acciones">
        <button type="button" className="btn btn-borde" onClick={onCancelar}>Cancelar</button>
        <button type="submit" className="btn btn-lima" disabled={guardando}>
          {guardando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear deuda'}
        </button>
      </div>
    </form>
  );
}
