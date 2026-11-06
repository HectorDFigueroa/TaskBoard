import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { Errores } from '../components/UI.jsx';
import { Mancha, Estrella, Rayo, Corona, Subrayado, Garabato, Chispas } from '../components/Doodles.jsx';

export default function Login() {
  const { login, registro } = useAuth();
  const [modo, setModo] = useState('login');
  const [f, setF] = useState({ nombre: '', username: '', email: '', password: '' });
  const [errores, setErrores] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const cambiar = (c) => (e) => setF({ ...f, [c]: e.target.value });

  function validar() {
    const e = [];
    if (modo === 'registro') {
      if (f.nombre.trim().length < 2) e.push('Escribe tu nombre');
      if (!/^@?[a-zA-Z0-9_]{3,20}$/.test(f.username.trim())) e.push('El usuario debe tener 3 a 20 letras, números o _');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) e.push('Escribe un correo válido');
    if (modo === 'registro' ? f.password.length < 8 : !f.password) {
      e.push(modo === 'registro' ? 'La contraseña debe tener al menos 8 caracteres' : 'Escribe tu contraseña');
    }
    return e;
  }

  async function enviar(e) {
    e.preventDefault();
    const lista = validar();
    setErrores(lista);
    if (lista.length) return;
    setEnviando(true);
    try {
      if (modo === 'login') await login(f.email, f.password);
      else await registro({ ...f, username: f.username.replace(/^@/, '').toLowerCase() });
    } catch (err) {
      setErrores(err.errores);
      setEnviando(false);
    }
  }

  return (
    <div className="login">
      <Mancha className="mancha mancha-morada" color="#7c4dff" variante={0} />
      <Mancha className="mancha mancha-azul" color="#3aa0ff" variante={1} />
      <Mancha className="mancha mancha-naranja" color="#ff6a3d" variante={2} />

      <section className="login-hero">
        <p className="saludo marcador">Hey, parcero <span className="flechita">↘</span></p>
        <h1 className="titulo-gigante marcador">
          <Corona className="doodle corona" />
          ¿Quién<br />me debe?
          <Subrayado className="subrayado" />
        </h1>
        <p className="tagline">Préstamos <b>•</b> Deudas <b>•</b> Intereses <b>•</b> Cuentas claras</p>
        <div className="burbuja">¡Cuentas claras, amistades largas!</div>
        <Estrella className="doodle estrella-1" />
        <Rayo className="doodle rayo-1" />
        <Chispas className="doodle chispas-1" />
        <Garabato className="doodle garabato-1" />
      </section>

      <section className="tarjeta login-card">
        <div className="pestanas">
          <button className={modo === 'login' ? 'activo' : ''} onClick={() => { setModo('login'); setErrores([]); }}>Ingresar</button>
          <button className={modo === 'registro' ? 'activo' : ''} onClick={() => { setModo('registro'); setErrores([]); }}>Crear cuenta</button>
        </div>

        <form className="form" onSubmit={enviar} noValidate>
          {modo === 'registro' && (
            <>
              <label className="campo">
                <span className="campo-label">Tu nombre</span>
                <input value={f.nombre} onChange={cambiar('nombre')} placeholder="Hector Figueroa" autoComplete="name" />
              </label>
              <label className="campo">
                <span className="campo-label">Usuario <em>(para que tus amigos te encuentren)</em></span>
                <input value={f.username} onChange={cambiar('username')} placeholder="@hector" autoCapitalize="none" autoComplete="username" />
              </label>
            </>
          )}
          <label className="campo">
            <span className="campo-label">Correo</span>
            <input type="email" value={f.email} onChange={cambiar('email')} placeholder="tu@correo.com" autoComplete="email" />
          </label>
          <label className="campo">
            <span className="campo-label">Contraseña</span>
            <input type="password" value={f.password} onChange={cambiar('password')} placeholder={modo === 'registro' ? 'Mínimo 8 caracteres' : '••••••••'}
              autoComplete={modo === 'login' ? 'current-password' : 'new-password'} />
          </label>

          <Errores lista={errores} />

          <button className="btn btn-lima btn-bloque" disabled={enviando}>
            {enviando ? 'Un momento…' : modo === 'login' ? '▶ Entrar' : '★ Crear mi cuenta'}
          </button>
        </form>
      </section>
    </div>
  );
}
