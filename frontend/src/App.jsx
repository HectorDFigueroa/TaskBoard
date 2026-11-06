import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { useAuth } from './auth.jsx';
import { pesos } from './utils.js';
import Login from './pages/Login.jsx';
import Inicio from './pages/Inicio.jsx';
import Deudas from './pages/Deudas.jsx';
import Solicitudes from './pages/Solicitudes.jsx';
import Apuestas from './pages/Apuestas.jsx';
import DeudaForm from './components/DeudaForm.jsx';
import PagarForm from './components/PagarForm.jsx';
import ApuestaForm from './components/ApuestaForm.jsx';
import DecidirForm from './components/DecidirForm.jsx';
import { AvisoDespertando, Cargando, ErrorCaja, Modal, Toasts } from './components/UI.jsx';

export default function App() {
  const { usuario, estado, error, reintentar } = useAuth();

  if (estado === 'cargando') {
    return (<><AvisoDespertando /><div className="centrado"><Cargando texto="Abriendo tu cuenta…" /></div></>);
  }
  if (estado === 'error') {
    return (<><AvisoDespertando /><div className="centrado"><ErrorCaja mensaje={error} onReintentar={reintentar} /></div></>);
  }
  return (
    <>
      <AvisoDespertando />
      {usuario ? <AppConSesion /> : <Login />}
    </>
  );
}

function AppConSesion() {
  const { usuario, cerrarSesion } = useAuth();
  const [vista, setVista] = useState('inicio');
  const [busqueda, setBusqueda] = useState('');
  const [version, setVersion] = useState(0);         // al cambiar, las páginas recargan
  const [modal, setModal] = useState(null);           // { tipo, deuda | apuesta }
  const [ocupado, setOcupado] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [solicitudes, setSolicitudes] = useState(0);
  const [apuestasPorAtender, setApuestasPorAtender] = useState(0);
  const [menuAbierto, setMenuAbierto] = useState(false);
  const idToast = useRef(0);

  const recargar = useCallback(() => setVersion((v) => v + 1), []);

  const avisar = useCallback((texto, tipo = 'ok') => {
    const id = ++idToast.current;
    setToasts((t) => [...t, { id, texto, tipo }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  // Contador de solicitudes para el menú (RF-23)
  useEffect(() => {
    api('/api/deudas/solicitudes').then((r) => setSolicitudes(r.total)).catch(() => {});
    // Apuestas que esperan una respuesta mía o mi decisión como juez
    api('/api/apuestas')
      .then((lista) => setApuestasPorAtender(
        lista.filter(({ permisos: p }) => p.responder || p.decidir || p.responder_revision).length
      ))
      .catch(() => {});
  }, [version]);

  const irA = useCallback((v, buscar = '') => {
    setVista(v);
    setBusqueda(buscar);
    setMenuAbierto(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Ejecuta una acción simple (PATCH) con manejo de errores
  const accion = useCallback(async (ruta, metodo, exito) => {
    setOcupado(true);
    try {
      await api(ruta, { method: metodo });
      avisar(exito);
      recargar();
    } catch (e) {
      avisar(e.errores[0], 'error');
    } finally {
      setOcupado(false);
    }
  }, [avisar, recargar]);

  const acciones = useMemo(() => ({
    nueva: () => setModal({ tipo: 'nueva' }),
    tarjeta: {
      ocupado,
      onPagar: (d) => setModal({ tipo: 'pagar', deuda: d }),
      onEditar: (d) => setModal({ tipo: 'editar', deuda: d }),
      onEliminar: (d) => setModal({ tipo: 'eliminar', deuda: d }),
      onReabrir: (d) => accion(`/api/deudas/${d.id}/reabrir`, 'PATCH', 'Deuda reabierta'),
      onAceptar: (d) => accion(`/api/deudas/${d.id}/aceptar`, 'PATCH', `Aceptaste la deuda con ${d.persona} 🤝`),
      onRechazar: (d) => accion(`/api/deudas/${d.id}/rechazar`, 'PATCH', 'Solicitud rechazada'),
      onDeshacerAbono: (d, pago) => accion(`/api/deudas/${d.id}/pagos/${pago.id}`, 'DELETE', 'Abono deshecho'),
    },
    nuevaApuesta: () => setModal({ tipo: 'nueva-apuesta' }),
    apuesta: {
      ocupado,
      onAceptar: (a) => accion(`/api/apuestas/${a.id}/aceptar`, 'PATCH', a.mi_rol === 'juez' ? 'Aceptaste ser el juez ⚖' : '¡Apuesta aceptada! 🤝'),
      onRechazar: (a) => accion(`/api/apuestas/${a.id}/rechazar`, 'PATCH', 'Apuesta rechazada'),
      onDecidir: (a) => setModal({ tipo: 'decidir', apuesta: a }),
      onEliminar: (a) => setModal({ tipo: 'eliminar-apuesta', apuesta: a }),
      onPedirRevision: (a) => {
        const otro = a.mi_rol === 'creador' ? a.oponente : a.creador;
        accion(`/api/apuestas/${a.id}/revision/pedir`, 'PATCH', `Le pediste a @${otro.username} cambiar la decisión`);
      },
      onAceptarRevision: (a) => setModal({ tipo: 'aceptar-revision', apuesta: a }),
      onRechazarRevision: (a) => accion(`/api/apuestas/${a.id}/revision/rechazar`, 'PATCH', 'La decisión del juez se mantiene'),
    },
  }), [accion, ocupado]);

  const cerrarModal = useCallback(() => setModal(null), []);

  function eliminarApuesta() {
    const { id } = modal.apuesta;
    cerrarModal();
    accion(`/api/apuestas/${id}`, 'DELETE', 'Apuesta eliminada');
  }

  function aceptarRevision() {
    const { id } = modal.apuesta;
    cerrarModal();
    accion(`/api/apuestas/${id}/revision/aceptar`, 'PATCH', 'La apuesta volvió a manos del juez ⚖');
  }

  async function eliminar() {
    const d = modal.deuda;
    cerrarModal();
    setOcupado(true);
    try {
      await api(`/api/deudas/${d.id}`, { method: 'DELETE' });
      avisar('Deuda eliminada');
      recargar();
    } catch (e) {
      avisar(e.errores[0], 'error');
    } finally {
      setOcupado(false);
    }
  }

  const NAV = [
    ['inicio', '⌂', 'Inicio'],
    ['deudas', '☰', 'Deudas'],
    ['solicitudes', '✉', 'Solicitudes'],
    ['apuestas', '⚖', 'Apuestas'],
  ];
  const AVISOS = { solicitudes, apuestas: apuestasPorAtender };

  return (
    <div className="app">
      <header className="barra">
        <button className="logo marcador" onClick={() => irA('inicio')}>¿Quién me debe<span>?</span></button>
        <nav className="nav-escritorio">
          {NAV.map(([v, , t]) => (
            <button key={v} className={vista === v ? 'activo' : ''} onClick={() => irA(v)}>
              {t}{AVISOS[v] > 0 && <span className="badge">{AVISOS[v]}</span>}
            </button>
          ))}
        </nav>
        <div className="barra-derecha">
          <button className="btn btn-lima btn-sm solo-escritorio" onClick={acciones.nueva}>＋ Nueva deuda</button>
          <button className="btn-menu" onClick={() => setMenuAbierto((m) => !m)} aria-label="Menú de usuario">
            <span /><span /><span />
          </button>
          {menuAbierto && (
            <div className="menu-usuario">
              <strong>{usuario.nombre}</strong>
              <span className="usuario">@{usuario.username}</span>
              <span className="menu-correo">{usuario.email}</span>
              <button className="btn btn-borde btn-sm btn-bloque" onClick={cerrarSesion}>Cerrar sesión</button>
            </div>
          )}
        </div>
      </header>

      <main onClick={() => menuAbierto && setMenuAbierto(false)}>
        {vista === 'inicio' && <Inicio version={version} acciones={acciones} irA={irA} />}
        {vista === 'deudas' && <Deudas version={version} acciones={acciones} busquedaInicial={busqueda} />}
        {vista === 'solicitudes' && <Solicitudes version={version} acciones={acciones} />}
        {vista === 'apuestas' && <Apuestas version={version} acciones={acciones} />}
      </main>

      {/* Navegación inferior en celular */}
      <nav className="nav-movil">
        {NAV.slice(0, 2).map(([v, i, t]) => (
          <button key={v} className={vista === v ? 'activo' : ''} onClick={() => irA(v)}><span>{i}</span>{t}</button>
        ))}
        <button className="nav-mas" onClick={acciones.nueva} aria-label="Nueva deuda">＋</button>
        {NAV.slice(2).map(([v, i, t]) => (
          <button key={v} className={vista === v ? 'activo' : ''} onClick={() => irA(v)}>
            <span>{i}{AVISOS[v] > 0 && <i className="badge">{AVISOS[v]}</i>}</span>{t}
          </button>
        ))}
        <button onClick={() => setMenuAbierto((m) => !m)}><span>☺</span>Yo</button>
      </nav>

      {modal?.tipo === 'nueva' && (
        <Modal titulo="Nueva deuda" onCerrar={cerrarModal}>
          <DeudaForm onCancelar={cerrarModal} onGuardada={(d) => {
            cerrarModal(); recargar();
            avisar(d.estado_vinculo === 'pendiente' ? `Enviada a @${d.usuario_vinculado} para que la acepte` : 'Deuda registrada ✓');
          }} />
        </Modal>
      )}
      {modal?.tipo === 'editar' && (
        <Modal titulo="Editar deuda" onCerrar={cerrarModal}>
          <DeudaForm deuda={modal.deuda} onCancelar={cerrarModal} onGuardada={() => { cerrarModal(); recargar(); avisar('Cambios guardados ✓'); }} />
        </Modal>
      )}
      {modal?.tipo === 'pagar' && (
        <Modal titulo="Registrar pago" onCerrar={cerrarModal} ancho="440px">
          <PagarForm deuda={modal.deuda} onCancelar={cerrarModal} onPagada={(d) => {
            cerrarModal(); recargar();
            avisar(d.pagada ? `¡Listo! Se pagaron ${pesos(d.monto_pagado)} 💸` : `Abono registrado. Faltan ${pesos(d.total_a_hoy)}`);
          }} />
        </Modal>
      )}
      {modal?.tipo === 'eliminar' && (
        <Modal titulo="¿Eliminar deuda?" onCerrar={cerrarModal} ancho="420px">
          <p className="confirmar-texto">
            Vas a eliminar la deuda con <b>{modal.deuda.persona}</b> por <b>{pesos(modal.deuda.monto)}</b>. Esto no se puede deshacer.
          </p>
          <div className="form-acciones">
            <button className="btn btn-borde" onClick={cerrarModal}>Cancelar</button>
            <button className="btn btn-peligro" onClick={eliminar}>Sí, eliminar</button>
          </div>
        </Modal>
      )}

      {modal?.tipo === 'nueva-apuesta' && (
        <Modal titulo="Nueva apuesta" onCerrar={cerrarModal}>
          <ApuestaForm onCancelar={cerrarModal} onCreada={(a) => {
            cerrarModal(); recargar();
            avisar(`Enviada a @${a.oponente.username} y al juez @${a.juez.username}`);
          }} />
        </Modal>
      )}
      {modal?.tipo === 'decidir' && (
        <Modal titulo="Decidir apuesta" onCerrar={cerrarModal} ancho="480px">
          <DecidirForm apuesta={modal.apuesta} onCancelar={cerrarModal} onDecidida={(a) => {
            cerrarModal(); recargar();
            avisar(a.estado === 'anulada' ? 'Apuesta anulada' : `Ganó @${a.ganador} 🏆`);
          }} />
        </Modal>
      )}
      {modal?.tipo === 'eliminar-apuesta' && (
        <Modal titulo="¿Eliminar apuesta?" onCerrar={cerrarModal} ancho="420px">
          <p className="confirmar-texto">
            Vas a eliminar la apuesta <b>{modal.apuesta.titulo}</b>. Esto no se puede deshacer.
          </p>
          <div className="form-acciones">
            <button className="btn btn-borde" onClick={cerrarModal}>Cancelar</button>
            <button className="btn btn-peligro" onClick={eliminarApuesta}>Sí, eliminar</button>
          </div>
        </Modal>
      )}

      {modal?.tipo === 'aceptar-revision' && (
        <Modal titulo="¿Cambiar la decisión?" onCerrar={cerrarModal} ancho="440px">
          <p className="confirmar-texto">
            @{modal.apuesta.revision_pedida_por} pidió cambiar la decisión de <b>{modal.apuesta.titulo}</b>.
            Si aceptas, se borra el resultado actual y el juez @{modal.apuesta.juez.username} decide de nuevo.
          </p>
          <div className="form-acciones">
            <button className="btn btn-borde" onClick={cerrarModal}>Cancelar</button>
            <button className="btn btn-lima" onClick={aceptarRevision}>Sí, aceptar</button>
          </div>
        </Modal>
      )}

      <Toasts lista={toasts} />
    </div>
  );
}
