import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { Cargando, ErrorCaja } from '../components/UI.jsx';
import DeudaCard from '../components/DeudaCard.jsx';
import { Garabato, Estrella } from '../components/Doodles.jsx';

export default function Deudas({ version, acciones, busquedaInicial = '' }) {
  const [tipo, setTipo] = useState('todas');
  const [estado, setEstado] = useState('pendiente');
  const [q, setQ] = useState(busquedaInicial);
  const [qDebounced, setQDebounced] = useState(busquedaInicial);
  const [deudas, setDeudas] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { setQ(busquedaInicial); setQDebounced(busquedaInicial); }, [busquedaInicial]);
  useEffect(() => { const t = setTimeout(() => setQDebounced(q), 300); return () => clearTimeout(t); }, [q]);

  const cargar = useCallback(async () => {
    setError(null);
    const params = new URLSearchParams({ tipo, estado });
    if (qDebounced.trim()) params.set('q', qDebounced.trim().replace(/^@/, ''));
    try {
      setDeudas(await api(`/api/deudas?${params}`));
    } catch (e) {
      setError(e.errores[0]);
    }
  }, [tipo, estado, qDebounced]);

  useEffect(() => { cargar(); }, [cargar, version]);

  const Filtro = ({ valor, actual, set, children, clase = '' }) => (
    <button className={`filtro ${actual === valor ? `activo ${clase}` : ''}`} onClick={() => set(valor)}>{children}</button>
  );

  return (
    <div className="pagina">
      <div className="pagina-cabeza">
        <h1 className="marcador titulo-seccion">Mis deudas <Garabato className="garabato-titulo" /></h1>
        <button className="btn btn-lima" onClick={acciones.nueva}>＋ Nueva</button>
      </div>

      <div className="filtros">
        <div className="filtros-grupo">
          <Filtro valor="todas" actual={tipo} set={setTipo}>Todas</Filtro>
          <Filtro valor="me_deben" actual={tipo} set={setTipo} clase="activo-meDeben">↓ Me deben</Filtro>
          <Filtro valor="debo" actual={tipo} set={setTipo} clase="activo-debo">↑ Debo</Filtro>
        </div>
        <div className="filtros-grupo">
          <Filtro valor="pendiente" actual={estado} set={setEstado}>Pendientes</Filtro>
          <Filtro valor="pagada" actual={estado} set={setEstado}>Pagadas</Filtro>
          <Filtro valor="todas" actual={estado} set={setEstado}>Todas</Filtro>
        </div>
        <input className="buscador" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Buscar persona o @usuario" />
      </div>

      {error && <ErrorCaja mensaje={error} onReintentar={cargar} />}
      {!deudas && !error && <Cargando texto="Buscando tus deudas…" />}

      {deudas && deudas.length === 0 && (
        <div className="vacio">
          <Estrella className="vacio-icono" />
          <p>{q || tipo !== 'todas' || estado !== 'pendiente' ? 'No hay deudas con esos filtros.' : '¡Nadie te debe y no le debes a nadie!'}</p>
        </div>
      )}

      {deudas && deudas.length > 0 && (
        <div className="deudas-grid">
          {deudas.map((d) => <DeudaCard key={d.id} d={d} {...acciones.tarjeta} />)}
        </div>
      )}
    </div>
  );
}
