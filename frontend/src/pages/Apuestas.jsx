import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { Cargando, ErrorCaja } from '../components/UI.jsx';
import ApuestaCard from '../components/ApuestaCard.jsx';
import { Garabato, Estrella } from '../components/Doodles.jsx';

const ABIERTAS = ['pendiente', 'activa'];
const FILTROS = [['abiertas', 'Abiertas'], ['cerradas', 'Cerradas'], ['todas', 'Todas']];

export default function Apuestas({ version, acciones }) {
  const [apuestas, setApuestas] = useState(null);
  const [filtro, setFiltro] = useState('abiertas');
  const [error, setError] = useState(null);

  const cargar = useCallback(async () => {
    setError(null);
    try { setApuestas(await api('/api/apuestas')); }
    catch (e) { setError(e.errores[0]); }
  }, []);

  useEffect(() => { cargar(); }, [cargar, version]);

  // Una apuesta con un cambio de decisión pendiente sigue necesitando atención
  const estaAbierta = (a) => ABIERTAS.includes(a.estado) || !!a.revision_pedida_por;
  const visibles = apuestas?.filter((a) => filtro === 'todas' || (filtro === 'abiertas') === estaAbierta(a));

  return (
    <div className="pagina">
      <div className="pagina-cabeza">
        <h1 className="marcador titulo-seccion">Apuestas <Garabato className="garabato-titulo" /></h1>
        <button className="btn btn-lima" onClick={acciones.nuevaApuesta}>＋ Nueva</button>
      </div>
      <p className="intro">
        Dos usuarios apuestan y un tercero hace de juez. Cuando el juez decide,
        quien perdió queda debiéndole el monto a quien ganó.
      </p>

      <div className="filtros">
        <div className="filtros-grupo">
          {FILTROS.map(([valor, texto]) => (
            <button key={valor} className={`filtro ${filtro === valor ? 'activo' : ''}`} onClick={() => setFiltro(valor)}>{texto}</button>
          ))}
        </div>
      </div>

      {error && <ErrorCaja mensaje={error} onReintentar={cargar} />}
      {!apuestas && !error && <Cargando texto="Buscando tus apuestas…" />}

      {visibles?.length === 0 && (
        <div className="vacio">
          <Estrella className="vacio-icono" />
          <p>{filtro === 'abiertas' ? 'No tienes apuestas abiertas.' : 'No hay apuestas aquí.'}</p>
        </div>
      )}

      {visibles?.length > 0 && (
        <div className="deudas-grid">
          {visibles.map((a) => <ApuestaCard key={a.id} a={a} {...acciones.apuesta} />)}
        </div>
      )}
    </div>
  );
}
