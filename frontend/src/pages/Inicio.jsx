import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { pesos, primerNombre } from '../utils.js';
import { Cargando, ErrorCaja } from '../components/UI.jsx';
import DeudaCard, { Avatar, colorDe } from '../components/DeudaCard.jsx';
import { Mancha, Estrella, Rayo, Corona, Subrayado, Garabato, Flecha, Chispas } from '../components/Doodles.jsx';

export default function Inicio({ version, acciones, irA }) {
  const { usuario } = useAuth();
  const [balance, setBalance] = useState(null);
  const [recientes, setRecientes] = useState([]);
  const [error, setError] = useState(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const [b, lista] = await Promise.all([api('/api/deudas/balance'), api('/api/deudas?estado=pendiente')]);
      setBalance(b);
      setRecientes(lista.slice(0, 3));
    } catch (e) {
      setError(e.errores[0]);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar, version]);

  const neto = balance?.balance_neto ?? 0;

  return (
    <div className="pagina">
      <section className="hero">
        <Mancha className="mancha mancha-morada" color="#7c4dff" variante={0} />
        <Mancha className="mancha mancha-naranja" color="#ff6a3d" variante={2} />

        <div className="hero-texto">
          <p className="saludo marcador">Hey, {primerNombre(usuario.nombre)} <Flecha className="flecha-saludo" /></p>
          <span className="hero-label">Tu balance neto</span>
          <h1 className={`titulo-gigante marcador ${neto < 0 ? 'texto-debo' : ''}`}>
            {balance ? pesos(neto) : '—'}
            <Subrayado className="subrayado" color={neto < 0 ? '#ff6a3d' : '#d4ff3a'} />
            <Corona className="doodle corona" />
          </h1>
          <p className="tagline">
            {neto > 0 ? 'Vas ganando: te deben más de lo que debes' : neto < 0 ? 'Ojo: debes más de lo que te deben' : 'Estás a paz y salvo con todos'}
          </p>
          <div className="hero-botones">
            <button className="btn btn-lima" onClick={acciones.nueva}>＋ Nueva deuda</button>
            <button className="btn btn-borde" onClick={() => irA('deudas')}>Ver mis deudas ↗</button>
          </div>
        </div>

        <div className="burbuja burbuja-hero">¡Cuentas claras, amistades largas!</div>
        <Estrella className="doodle estrella-1" />
        <Rayo className="doodle rayo-1" />
        <Chispas className="doodle chispas-1" />
      </section>

      {error && <ErrorCaja mensaje={error} onReintentar={cargar} />}
      {!balance && !error && <Cargando texto="Haciendo cuentas…" />}

      {balance && (
        <>
          <section className="stats">
            <div className="stat stat-meDeben">
              <span className="stat-label">↓ Me deben</span>
              <span className="stat-valor">{pesos(balance.total_me_deben)}</span>
            </div>
            <div className="stat stat-debo">
              <span className="stat-label">↑ Yo debo</span>
              <span className="stat-valor">{pesos(balance.total_debo)}</span>
            </div>
            <div className="stat stat-personas">
              <span className="stat-label">👥 Personas</span>
              <span className="stat-valor">{balance.personas.length}</span>
            </div>
          </section>

          <section className="bloque">
            <div className="bloque-cabeza">
              <h2 className="marcador">Balance por persona <Garabato className="garabato-titulo" /></h2>
            </div>
            {balance.personas.length === 0 ? (
              <div className="vacio">
                <Estrella className="vacio-icono" />
                <p>Todavía no tienes deudas pendientes.</p>
                <button className="btn btn-lima btn-sm" onClick={acciones.nueva}>Registrar la primera</button>
              </div>
            ) : (
              <div className="personas">
                {balance.personas.map((p) => (
                  <button key={(p.usuario ?? '') + p.persona} className="persona" onClick={() => irA('deudas', p.usuario ?? p.persona)}>
                    <div className="persona-portada" style={{ background: colorDe(p.persona) }}>
                      <Avatar nombre={p.persona} grande />
                      {p.vencidas > 0 && <span className="persona-alerta">🔥 {p.vencidas} vencida{p.vencidas > 1 ? 's' : ''}</span>}
                    </div>
                    <div className="persona-info">
                      <div>
                        <h3>{p.persona}</h3>
                        <span className="usuario">{p.usuario ? `@${p.usuario}` : `${p.deudas_pendientes} pendiente${p.deudas_pendientes > 1 ? 's' : ''}`}</span>
                      </div>
                      <span className={`persona-neto ${p.neto >= 0 ? 'texto-meDeben' : 'texto-debo'}`}>
                        {p.neto >= 0 ? '+' : '−'}{pesos(Math.abs(p.neto))}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          {recientes.length > 0 && (
            <section className="bloque">
              <div className="bloque-cabeza">
                <h2 className="marcador">Pendientes recientes</h2>
                <button className="link-lima" onClick={() => irA('deudas')}>Ver todas →</button>
              </div>
              <div className="deudas-grid">
                {recientes.map((d) => <DeudaCard key={d.id} d={d} {...acciones.tarjeta} />)}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
