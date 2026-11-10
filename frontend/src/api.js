// Cliente de la API. Todas las peticiones pasan por aquí:
// - agrega el token JWT
// - convierte los errores del backend  en excepciones
// - avisa cuando una petición tarda (el plan gratis de Render "duerme" el servidor)

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000').replace(/\/+$/, '');
const TIEMPO_LENTO_MS = 2500;   // a partir de aquí mostramos "despertando el servidor"
const TIEMPO_LIMITE_MS = 75000; // Render puede tardar 1 minuto en despertar

let token = null;
let alExpirar = () => {};
const oyentesLento = new Set();
let pendientesLentas = 0;

export function setToken(t) { token = t; }
export function alExpirarSesion(fn) { alExpirar = fn; }
export function escucharLentitud(fn) { oyentesLento.add(fn); return () => oyentesLento.delete(fn); }
const avisar = () => oyentesLento.forEach((fn) => fn(pendientesLentas > 0));

export class ApiError extends Error {
  constructor(status, errores) {
    super(errores.join('\n'));
    this.status = status;
    this.errores = errores;
  }
}

export async function api(ruta, { method = 'GET', body } = {}) {
  const control = new AbortController();
  const limite = setTimeout(() => control.abort(), TIEMPO_LIMITE_MS);
  let marcadaLenta = false;
  const lento = setTimeout(() => { marcadaLenta = true; pendientesLentas++; avisar(); }, TIEMPO_LENTO_MS);

  try {
    let res;
    try {
      res = await fetch(API_URL + ruta, {
        method,
        signal: control.signal,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, [
        'No pudimos conectar con el servidor. Revisa tu internet o inténtalo de nuevo en un momento.',
      ]);
    }

    const texto = await res.text();
    let datos = null;
    try { datos = texto ? JSON.parse(texto) : null; } catch { /* respuesta no JSON */ }

    if (res.status === 401 && token) alExpirar(); // sesión vencida → volver al login
    if (!res.ok) {
      throw new ApiError(res.status, datos?.errores || [`Error inesperado del servidor (${res.status})`]);
    }
    return datos;
  } finally {
    clearTimeout(limite);
    clearTimeout(lento);
    if (marcadaLenta) { pendientesLentas--; avisar(); }
  }
}
