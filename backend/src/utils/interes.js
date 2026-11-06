import { diasEntre, hoyISO } from './fechas.js';

const DIAS_POR_MES = 30; // convención comercial

const redondear = (n) => Math.round(n * 100) / 100;

/**
 * RF-10: calcula el interés de una deuda hasta una fecha.
 *   P = capital, r = tasa mensual (decimal), t = meses = días / 30
 *   simple:    total = P * (1 + r*t)
 *   compuesto: total = P * (1 + r)^t
 */
export function calcularInteres({ monto, tipo_interes, tasa_interes, fecha }, hasta = hoyISO()) {
  const dias = Math.max(0, diasEntre(fecha, hasta));
  const t = dias / DIAS_POR_MES;
  const r = Number(tasa_interes) / 100;
  const P = Number(monto);

  let total = P;
  if (tipo_interes === 'simple') total = P * (1 + r * t);
  else if (tipo_interes === 'compuesto') total = P * Math.pow(1 + r, t);

  total = redondear(total);
  return { dias, interes: redondear(total - P), total };
}

/**
 * RN-07: convierte la tasa de usura efectiva anual (%) a tasa mensual (%)
 *   r_m = (1 + EA)^(1/12) - 1
 * Devuelve null si no está configurada.
 */
export function tasaUsuraMensual() {
  const ea = Number(process.env.TASA_USURA_EA);
  if (!process.env.TASA_USURA_EA || !Number.isFinite(ea) || ea <= 0) return null;
  return (Math.pow(1 + ea / 100, 1 / 12) - 1) * 100;
}
