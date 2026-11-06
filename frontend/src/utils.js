// Formatos y cálculos del lado del cliente

const cop = new Intl.NumberFormat('es-CO', {
  style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0,
});
export const pesos = (n) => cop.format(Math.round(Number(n) || 0));

// "Hoy" en Colombia (UTC-5), igual que el backend
export const hoyISO = () => new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);

const fechaCorta = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const fecha = (iso) => (iso ? fechaCorta.format(new Date(iso + 'T00:00:00Z')) : '');

export const diasEntre = (a, b) =>
  Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400e3);

// Misma fórmula que el backend, para la vista previa del formulario
//   simple: P(1 + r·t)     compuesto: P(1 + r)^t     t = días / 30
export function totalConInteres(monto, tipo, tasa, dias) {
  const P = Number(monto) || 0;
  const r = (Number(tasa) || 0) / 100;
  const t = Math.max(0, dias) / 30;
  if (tipo === 'simple') return P * (1 + r * t);
  if (tipo === 'compuesto') return P * Math.pow(1 + r, t);
  return P;
}

// Saldo de una deuda a una fecha, con sus abonos. Misma fórmula que el backend:
// cada abono cubre primero el interés acumulado y luego el capital.
export function saldoALaFecha({ monto, tipo_interes, tasa_interes, fecha: inicio, pagos = [] }, hasta) {
  const r = (Number(tasa_interes) || 0) / 100;
  let capital = Number(monto) || 0;
  let interes = 0;
  let desde = inicio;
  const avanzarHasta = (f) => {
    const t = Math.max(0, diasEntre(desde, f)) / 30;
    if (tipo_interes === 'simple') interes += capital * r * t;
    else if (tipo_interes === 'compuesto') interes += (capital + interes) * (Math.pow(1 + r, t) - 1);
    desde = f;
  };
  for (const pago of pagos) {
    avanzarHasta(pago.fecha);
    const aInteres = Math.min(pago.monto, interes);
    interes -= aInteres;
    capital -= pago.monto - aInteres;
  }
  avanzarHasta(hasta);
  return { capital, interes, saldo: Math.round((capital + interes) * 100) / 100 };
}

export const iniciales = (nombre = '') =>
  nombre.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';

export const primerNombre = (nombre = '') => nombre.trim().split(/\s+/)[0] || '';
