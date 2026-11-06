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

export const iniciales = (nombre = '') =>
  nombre.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';

export const primerNombre = (nombre = '') => nombre.trim().split(/\s+/)[0] || '';
