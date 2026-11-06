// Validación de los datos de una deuda. Devuelve { datos, errores }.
// parcial = true en PUT: solo se validan los campos que vienen en el body.

import { esFechaValida, hoyISO } from '../utils/fechas.js';
import { tasaUsuraMensual } from '../utils/interes.js';
import { normalizarUsername } from './auth.js';

const MONTO_MAX = 100_000_000;
const TIPOS = ['me_deben', 'debo'];
const TIPOS_INTERES = ['ninguno', 'simple', 'compuesto'];

const viene = (body, campo) => body[campo] !== undefined;
const vacio = (v) => v === null || v === '';

export function validarDeuda(body = {}, { parcial = false } = {}) {
  const errores = [];
  const datos = {};

  // tipo
  if (viene(body, 'tipo') || !parcial) {
    if (!TIPOS.includes(body.tipo)) errores.push('tipo debe ser "me_deben" o "debo"');
    else datos.tipo = body.tipo;
  }

  // contraparte: @usuario registrado (opcional). null o '' = desvincular
  if (viene(body, 'contraparte')) {
    if (vacio(body.contraparte)) datos.contraparte = null;
    else {
      const u = normalizarUsername(body.contraparte);
      if (!/^[a-z0-9_]{3,20}$/.test(u)) errores.push('contraparte debe ser un @usuario válido');
      else datos.contraparte = u;
    }
  }

  // persona: obligatoria si NO hay contraparte (si hay, se usa el nombre del usuario)
  if (viene(body, 'persona') && !vacio(body.persona)) {
    const p = typeof body.persona === 'string' ? body.persona.trim().replace(/\s+/g, ' ') : '';
    if (p.length < 2 || p.length > 80) errores.push('persona debe tener entre 2 y 80 caracteres'); // RN-02
    else datos.persona = p;
  } else if (!parcial && !datos.contraparte) {
    errores.push('Indica el nombre de la persona o un @usuario registrado');
  }

  // monto (RN-01)
  if (viene(body, 'monto') || !parcial) {
    const m = typeof body.monto === 'string' ? Number(body.monto) : body.monto;
    if (typeof m !== 'number' || !Number.isFinite(m)) errores.push('monto es obligatorio y debe ser numérico');
    else if (m <= 0) errores.push('monto debe ser mayor que 0');
    else if (m > MONTO_MAX) errores.push('monto no puede superar $100.000.000');
    else if (Math.abs(Math.round(m * 100) - m * 100) > 1e-6) errores.push('monto admite máximo 2 decimales');
    else datos.monto = m;
  }

  // concepto (opcional)
  if (viene(body, 'concepto')) {
    if (vacio(body.concepto)) datos.concepto = null;
    else if (typeof body.concepto !== 'string') errores.push('concepto debe ser texto');
    else if (body.concepto.trim().length > 150) errores.push('concepto no puede tener más de 150 caracteres');
    else datos.concepto = body.concepto.trim();
  }

  // interés (RF-09, RN-06, RN-07)
  if (viene(body, 'tipo_interes') || viene(body, 'tasa_interes')) {
    const tipoI = body.tipo_interes ?? 'ninguno';
    const tasa = vacio(body.tasa_interes) || body.tasa_interes === undefined ? 0 : Number(body.tasa_interes);

    if (!TIPOS_INTERES.includes(tipoI)) {
      errores.push('tipo_interes debe ser "ninguno", "simple" o "compuesto"');
    } else if (!Number.isFinite(tasa) || tasa < 0) {
      errores.push('tasa_interes debe ser un número mayor o igual a 0');
    } else if (tipoI === 'ninguno' && tasa !== 0) {
      errores.push('Si no hay interés, la tasa debe ser 0');
    } else if (tipoI !== 'ninguno' && tasa <= 0) {
      errores.push('Para un préstamo con interés, la tasa mensual debe ser mayor que 0');
    } else {
      const usura = tasaUsuraMensual();
      if (usura !== null && tasa > usura) {
        errores.push(`La tasa supera el límite de usura (máximo ${usura.toFixed(2)} % mensual)`);
      } else if (tasa > 100) {
        errores.push('tasa_interes no puede superar 100 % mensual');
      } else {
        datos.tipo_interes = tipoI;
        datos.tasa_interes = tasa;
      }
    }
  }

  // fecha (RN-03): opcional, por defecto hoy, no puede ser futura
  if (viene(body, 'fecha') && !vacio(body.fecha)) {
    if (!esFechaValida(body.fecha)) errores.push('fecha debe tener formato YYYY-MM-DD');
    else if (body.fecha > hoyISO()) errores.push('fecha no puede estar en el futuro');
    else datos.fecha = body.fecha;
  }

  // fecha_limite (RF-11): opcional
  if (viene(body, 'fecha_limite')) {
    if (vacio(body.fecha_limite)) datos.fecha_limite = null;
    else if (!esFechaValida(body.fecha_limite)) errores.push('fecha_limite debe tener formato YYYY-MM-DD');
    else datos.fecha_limite = body.fecha_limite;
  }

  // RN-03: la fecha límite no puede ser anterior a la fecha de la deuda
  const fechaBase = datos.fecha ?? (parcial ? null : hoyISO());
  if (datos.fecha_limite && fechaBase && datos.fecha_limite < fechaBase) {
    errores.push('fecha_limite no puede ser anterior a la fecha de la deuda');
  }

  return { datos, errores };
}

export function validarId(param) {
  const id = Number(param);
  return Number.isInteger(id) && id > 0 && id <= 2_147_483_647 ? id : null;
}
