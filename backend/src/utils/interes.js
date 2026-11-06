import { diasEntre, hoyISO } from './fechas.js';

const DIAS_POR_MES = 30; // convención comercial

const redondear = (n) => Math.round(n * 100) / 100;

/**
 * RF-10: calcula el interés de una deuda hasta una fecha.
 *   P = capital, r = tasa mensual (decimal), t = meses = días / 30
 *   simple:    total = P * (1 + r*t)
 *   compuesto: total = P * (1 + r)^t
 *
 * Con pagos (en orden de fecha), el interés se calcula por tramos: cada pago cubre
 * primero el interés acumulado y luego el capital, y el siguiente tramo corre sobre
 * lo que quedó.
 *
 * Devuelve:
 *   total   = saldo pendiente en esa fecha
 *   interes = interés generado en toda la deuda, incluido el ya pagado
 */
export function calcularInteres({ monto, tipo_interes, tasa_interes, fecha }, hasta = hoyISO(), pagos = []) {
  const r = Number(tasa_interes) / 100;
  const P = Number(monto);
  let capital = P;
  let interes = 0;
  let abonado = 0;
  let desde = fecha;

  const avanzarHasta = (f) => {
    const t = Math.max(0, diasEntre(desde, f)) / DIAS_POR_MES;
    if (tipo_interes === 'simple') interes += capital * r * t;
    else if (tipo_interes === 'compuesto') interes += (capital + interes) * (Math.pow(1 + r, t) - 1);
    desde = f;
  };

  for (const pago of pagos) {
    avanzarHasta(pago.fecha);
    const aInteres = Math.min(pago.monto, interes);
    interes -= aInteres;
    capital -= pago.monto - aInteres;
    abonado += pago.monto;
  }
  avanzarHasta(hasta);

  const total = redondear(capital + interes);
  return {
    dias: Math.max(0, diasEntre(fecha, hasta)),
    interes: redondear(total + abonado - P),
    total,
    abonado: redondear(abonado),
  };
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
