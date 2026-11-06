import { useState } from 'react';
import { api } from '../api.js';
import { Errores } from './UI.jsx';

const limpiar = (u) => u.trim().replace(/^@/, '').toLowerCase();

/** Campo de @usuario con verificación: en las apuestas todos deben estar registrados */
function CampoUsuario({ etiqueta, ayuda, valor, encontrado, onCambiar, onEncontrado, onError }) {
  const [buscando, setBuscando] = useState(false);

  async function verificar() {
    const u = limpiar(valor);
    if (!u) return onError(['Escribe el @usuario que quieres buscar']);
    setBuscando(true);
    onError([]);
    try {
      onEncontrado(await api(`/api/usuarios/buscar?username=${encodeURIComponent(u)}`));
    } catch (e) {
      onEncontrado(null);
      onError(e.errores);
    } finally {
      setBuscando(false);
    }
  }

  return (
    <div className="campo">
      <span className="campo-label">{etiqueta}</span>
      <div className="fila-input">
        <input value={valor} onChange={(e) => { onCambiar(e.target.value); onEncontrado(null); }}
          placeholder="@usuario" aria-label={etiqueta} autoCapitalize="none" autoCorrect="off" maxLength={21} />
        <button type="button" className="btn btn-borde btn-sm" onClick={verificar} disabled={buscando}>
          {buscando ? 'Buscando…' : 'Verificar'}
        </button>
      </div>
      {encontrado
        ? <span className="ayuda ayuda-ok">✓ {encontrado.nombre} (@{encontrado.username})</span>
        : <span className="ayuda">{ayuda}</span>}
    </div>
  );
}

/** Formulario para crear una apuesta. Una vez creada, sus términos no se editan. */
export default function ApuestaForm({ onCreada, onCancelar }) {
  const [f, setF] = useState({ titulo: '', postura_creador: '', postura_oponente: '', monto: '', oponente: '', juez: '' });
  const [encontrados, setEncontrados] = useState({ oponente: null, juez: null });
  const [errores, setErrores] = useState([]);
  const [guardando, setGuardando] = useState(false);

  const cambiar = (campo) => (e) => setF((prev) => ({ ...prev, [campo]: e.target.value }));

  // Validación en el cliente (el backend vuelve a validar todo)
  function validar() {
    const e = [];
    if (f.titulo.trim().length < 3) e.push('Escribe sobre qué es la apuesta');
    if (!limpiar(f.oponente)) e.push('Escribe el @usuario de tu oponente');
    if (!limpiar(f.juez)) e.push('Escribe el @usuario del juez');
    if (limpiar(f.oponente) && limpiar(f.oponente) === limpiar(f.juez)) e.push('El juez debe ser distinto a tu oponente');
    if (f.postura_creador.trim().length < 2) e.push('Escribe qué apuestas tú');
    if (f.postura_oponente.trim().length < 2) e.push('Escribe qué apuesta tu oponente');
    if (!(Number(f.monto) > 0)) e.push('El monto debe ser mayor que 0');
    return e;
  }

  async function enviar(e) {
    e.preventDefault();
    const lista = validar();
    setErrores(lista);
    if (lista.length) return;

    setGuardando(true);
    try {
      onCreada(await api('/api/apuestas', {
        method: 'POST',
        body: { ...f, monto: Number(f.monto), oponente: limpiar(f.oponente), juez: limpiar(f.juez) },
      }));
    } catch (err) {
      setErrores(err.errores);
    } finally {
      setGuardando(false);
    }
  }

  const usuario = (campo) => ({
    valor: f[campo],
    encontrado: encontrados[campo],
    onCambiar: (v) => setF((prev) => ({ ...prev, [campo]: v })),
    onEncontrado: (u) => setEncontrados((prev) => ({ ...prev, [campo]: u })),
    onError: setErrores,
  });

  return (
    <form className="form" onSubmit={enviar} noValidate>
      <label className="campo">
        <span className="campo-label">¿Sobre qué es la apuesta?</span>
        <input value={f.titulo} onChange={cambiar('titulo')} placeholder="Ej: Quién gana el clásico" maxLength={120} />
      </label>

      <CampoUsuario etiqueta="Tu oponente" ayuda="Tiene que estar registrado y aceptar la apuesta." {...usuario('oponente')} />
      <CampoUsuario etiqueta="El juez" ayuda="Un tercero registrado: acepta el cargo y decide quién gana." {...usuario('juez')} />

      <div className="fila-2">
        <label className="campo">
          <span className="campo-label">Tú apuestas que…</span>
          <input value={f.postura_creador} onChange={cambiar('postura_creador')} placeholder="Gana Nacional" maxLength={120} />
        </label>
        <label className="campo">
          <span className="campo-label">Tu oponente apuesta que…</span>
          <input value={f.postura_oponente} onChange={cambiar('postura_oponente')} placeholder="Gana Millonarios" maxLength={120} />
        </label>
      </div>

      <label className="campo">
        <span className="campo-label">Monto (COP)</span>
        <input type="number" inputMode="decimal" min="1" step="any" value={f.monto} onChange={cambiar('monto')} placeholder="20000" />
        <span className="ayuda">Quien pierda quedará debiendo este valor a quien gane.</span>
      </label>

      <Errores lista={errores} />

      <div className="form-acciones">
        <button type="button" className="btn btn-borde" onClick={onCancelar}>Cancelar</button>
        <button type="submit" className="btn btn-lima" disabled={guardando}>
          {guardando ? 'Enviando…' : 'Enviar apuesta'}
        </button>
      </div>
    </form>
  );
}
