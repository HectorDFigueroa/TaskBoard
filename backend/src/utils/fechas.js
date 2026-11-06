// Utilidades de fechas. Todas las fechas se manejan como texto 'YYYY-MM-DD'.

// RNF-08: "hoy" según la hora de Colombia (UTC-5), no la del servidor (UTC)
export function hoyISO() {
  return new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
}

export function esFechaValida(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Días completos entre dos fechas 'YYYY-MM-DD' (b - a)
export function diasEntre(a, b) {
  const ms = Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z');
  return Math.round(ms / 86_400_000);
}
