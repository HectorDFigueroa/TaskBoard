import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, setToken, alExpirarSesion } from './api.js';

const CLAVE = 'qmd_token';
const AuthContext = createContext(null);

// localStorage puede fallar (modo privado, etc.): siempre con try/catch
const leer = () => { try { return localStorage.getItem(CLAVE); } catch { return null; } };
const guardar = (t) => { try { t ? localStorage.setItem(CLAVE, t) : localStorage.removeItem(CLAVE); } catch { /* */ } };

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(null);
  const [estado, setEstado] = useState('cargando'); // cargando | listo | error
  const [error, setError] = useState(null);

  const cerrarSesion = useCallback(() => {
    setToken(null);
    guardar(null);
    setUsuario(null);
    setEstado('listo');
  }, []);

  const cargarSesion = useCallback(async () => {
    const t = leer();
    if (!t) { setEstado('listo'); return; }
    setToken(t);
    setEstado('cargando');
    try {
      setUsuario(await api('/api/auth/me'));
      setEstado('listo');
    } catch (e) {
      if (e.status === 401) cerrarSesion();
      else { setError(e.errores[0]); setEstado('error'); }
    }
  }, [cerrarSesion]);

  useEffect(() => {
    alExpirarSesion(cerrarSesion);
    cargarSesion();
  }, [cargarSesion, cerrarSesion]);

  const entrar = (respuesta) => {
    setToken(respuesta.token);
    guardar(respuesta.token);
    setUsuario(respuesta.usuario);
    setEstado('listo');
  };

  const login = async (email, password) =>
    entrar(await api('/api/auth/login', { method: 'POST', body: { email, password } }));

  const registro = async (datos) =>
    entrar(await api('/api/auth/register', { method: 'POST', body: datos }));

  return (
    <AuthContext.Provider value={{ usuario, estado, error, login, registro, cerrarSesion, reintentar: cargarSesion }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
