import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { Cargando, ErrorCaja } from '../components/UI.jsx';
import DeudaCard from '../components/DeudaCard.jsx';
import { Garabato, Estrella } from '../components/Doodles.jsx';

export default function Solicitudes({ version, acciones }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);

  const cargar = useCallback(async () => {
    setError(null);
    try { setDatos(await api('/api/deudas/solicitudes')); }
    catch (e) { setError(e.errores[0]); }
  }, []);

  useEffect(() => { cargar(); }, [cargar, version]);

  return (
    <div className="pagina">
      <div className="pagina-cabeza">
        <h1 className="marcador titulo-seccion">Solicitudes <Garabato className="garabato-titulo" /></h1>
      </div>
      <p className="intro">
        Deudas que otras personas registraron contigo. Solo cuentan en tu balance cuando las aceptas.
      </p>

      {error && <ErrorCaja mensaje={error} onReintentar={cargar} />}
      {!datos && !error && <Cargando />}

      {datos?.total === 0 && (
        <div className="vacio">
          <Estrella className="vacio-icono" />
          <p>No tienes solicitudes pendientes.</p>
        </div>
      )}

      {datos?.total > 0 && (
        <div className="deudas-grid">
          {datos.solicitudes.map((d) => <DeudaCard key={d.id} d={d} {...acciones.tarjeta} />)}
        </div>
      )}
    </div>
  );
}
