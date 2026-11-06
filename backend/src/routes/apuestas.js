import { Router } from 'express';
import { pool, enTransaccion } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { ErrorHttp } from '../utils/errores.js';
import { validarApuesta } from '../validators/apuestas.js';
import { validarId } from '../validators/deudas.js';
import { normalizarUsername } from '../validators/auth.js';
import { SQL_VISTA, buscarVisible, permisos, formatear } from '../services/apuestas.js';
import { hoyISO } from '../utils/fechas.js';

const router = Router();
const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Las apuestas son solo entre usuarios registrados
router.use(requireAuth);

const prohibido = (res, msg) => res.status(403).json({ errores: [msg] });
const conflicto = (res, msg) => res.status(409).json({ errores: [msg] });

// Carga la apuesta si el usuario participa en ella, o responde 404
async function cargar(req, res) {
  const id = validarId(req.params.id);
  if (!id) { res.status(400).json({ errores: ['id inválido'] }); return null; }
  const fila = await buscarVisible(id, req.usuario.id);
  if (!fila) { res.status(404).json({ errores: ['La apuesta no existe'] }); return null; }
  return fila;
}

const responderApuesta = async (id, req, res) =>
  res.json(formatear(await buscarVisible(id, req.usuario.id)));

/** GET /api/apuestas — Apuestas en las que participo (como apostador o como juez) */
router.get('/', h(async (req, res) => {
  const { rows } = await pool.query(`${SQL_VISTA} ORDER BY a.id DESC`, [req.usuario.id]);
  res.json(rows.map(formatear));
}));

/** GET /api/apuestas/:id */
router.get('/:id', h(async (req, res) => {
  const fila = await cargar(req, res);
  if (fila) res.json(formatear(fila));
}));

/**
 * POST /api/apuestas
 * El oponente y el juez deben existir y ser personas distintas.
 * Ambos reciben la apuesta como invitación y deben aceptarla.
 */
router.post('/', h(async (req, res) => {
  const { datos, errores } = validarApuesta(req.body);
  if (errores.length) return res.status(400).json({ errores });

  const { oponente, juez } = datos;
  if (oponente === req.usuario.username) {
    return res.status(400).json({ errores: ['No puedes apostar contra ti mismo'] });
  }
  if (juez === req.usuario.username) {
    return res.status(400).json({ errores: ['No puedes ser juez de tu propia apuesta'] });
  }
  if (juez === oponente) {
    return res.status(400).json({ errores: ['El juez debe ser una persona distinta a los dos apostadores'] });
  }

  const { rows: usuarios } = await pool.query(
    'SELECT id, username FROM usuarios WHERE username = ANY($1)',
    [[oponente, juez]]
  );
  const idDe = (username) => usuarios.find((u) => u.username === username)?.id;
  for (const username of [oponente, juez]) {
    if (!idDe(username)) return res.status(404).json({ errores: [`No existe el usuario @${username}`] });
  }

  const { rows } = await pool.query(
    `INSERT INTO apuestas (creador_id, oponente_id, juez_id, titulo, postura_creador, postura_oponente, monto)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [req.usuario.id, idDe(oponente), idDe(juez), datos.titulo, datos.postura_creador, datos.postura_oponente, datos.monto]
  );
  res.status(201).json(formatear(await buscarVisible(rows[0].id, req.usuario.id)));
}));

/** DELETE /api/apuestas/:id — Solo el creador, mientras no esté activa */
router.delete('/:id', h(async (req, res) => {
  const fila = await cargar(req, res);
  if (!fila) return;
  if (fila.mi_rol !== 'creador') return prohibido(res, 'Solo quien creó la apuesta puede eliminarla');
  if (!permisos(fila).eliminar) return conflicto(res, 'Esta apuesta ya no se puede eliminar');

  const { rowCount } = await pool.query(
    `DELETE FROM apuestas WHERE id = $1 AND estado IN ('pendiente', 'rechazada')`,
    [fila.id]
  );
  if (!rowCount) return conflicto(res, 'Esta apuesta ya no se puede eliminar');
  res.status(204).end();
}));

/** PATCH /api/apuestas/:id/aceptar — El oponente o el juez. Con ambos, la apuesta queda activa */
router.patch('/:id/aceptar', h(async (req, res) => {
  const fila = await cargar(req, res);
  if (!fila) return;
  if (fila.mi_rol === 'creador') return prohibido(res, 'Solo los invitados pueden responder esta apuesta');
  if (!permisos(fila).responder) return conflicto(res, 'Esta invitación ya fue respondida');

  // Una sola sentencia para que dos aceptaciones simultáneas no se pisen
  const [mia, otra] = fila.mi_rol === 'oponente'
    ? ['acepto_oponente', 'acepto_juez']
    : ['acepto_juez', 'acepto_oponente'];
  const { rowCount } = await pool.query(
    `UPDATE apuestas
     SET ${mia} = TRUE,
         estado = CASE WHEN ${otra} THEN 'activa' ELSE 'pendiente' END,
         updated_at = NOW()
     WHERE id = $1 AND estado = 'pendiente' AND ${mia} = FALSE`,
    [fila.id]
  );
  if (!rowCount) return conflicto(res, 'Esta invitación ya fue respondida');
  await responderApuesta(fila.id, req, res);
}));

/** PATCH /api/apuestas/:id/rechazar — Si un invitado rechaza, la apuesta no se realiza */
router.patch('/:id/rechazar', h(async (req, res) => {
  const fila = await cargar(req, res);
  if (!fila) return;
  if (fila.mi_rol === 'creador') return prohibido(res, 'Solo los invitados pueden responder esta apuesta');
  if (!permisos(fila).responder) return conflicto(res, 'Esta invitación ya fue respondida');

  const { rowCount } = await pool.query(
    `UPDATE apuestas SET estado = 'rechazada', rechazada_por = $1, updated_at = NOW()
     WHERE id = $2 AND estado = 'pendiente'`,
    [req.usuario.id, fila.id]
  );
  if (!rowCount) return conflicto(res, 'Esta invitación ya fue respondida');
  await responderApuesta(fila.id, req, res);
}));

/**
 * PATCH /api/apuestas/:id/decidir — Solo el juez. body: { "ganador": "@usuario" }
 * Crea una deuda ya aceptada del perdedor al ganador, que entra al balance de ambos.
 * El ganador registra los pagos. La decisión solo cambia con el acuerdo de los dos apostadores.
 */
router.patch('/:id/decidir', h(async (req, res) => {
  const fila = await cargar(req, res);
  if (!fila) return;
  if (fila.mi_rol !== 'juez') return prohibido(res, 'Solo el juez puede decidir esta apuesta');
  if (!permisos(fila).decidir) return conflicto(res, 'Solo se puede decidir una apuesta activa');

  const username = normalizarUsername(req.body?.ganador);
  let ganadorId, perdedorId, perdedorNombre;
  if (username === fila.creador_username) {
    [ganadorId, perdedorId, perdedorNombre] = [fila.creador_id, fila.oponente_id, fila.oponente_nombre];
  } else if (username === fila.oponente_username) {
    [ganadorId, perdedorId, perdedorNombre] = [fila.oponente_id, fila.creador_id, fila.creador_nombre];
  } else {
    return res.status(400).json({ errores: ['ganador debe ser uno de los dos apostadores'] });
  }

  const hoy = hoyISO();
  await enTransaccion(async (db) => {
    // El estado se comprueba al actualizar: una decisión doble no crea dos deudas
    const { rowCount } = await db.query(
      `UPDATE apuestas SET estado = 'resuelta', ganador_id = $1, fecha_decision = $2, updated_at = NOW()
       WHERE id = $3 AND estado = 'activa'`,
      [ganadorId, hoy, fila.id]
    );
    if (!rowCount) throw new ErrorHttp(409, 'Solo se puede decidir una apuesta activa');

    const { rows } = await db.query(
      `INSERT INTO deudas (usuario_id, tipo, persona, contraparte_id, estado_vinculo, concepto, monto, fecha)
       VALUES ($1, 'me_deben', $2, $3, 'aceptada', $4, $5, $6)
       RETURNING id`,
      [ganadorId, perdedorNombre, perdedorId, `Apuesta: ${fila.titulo}`, fila.monto, hoy]
    );
    await db.query('UPDATE apuestas SET deuda_id = $1 WHERE id = $2', [rows[0].id, fila.id]);
  });

  await responderApuesta(fila.id, req, res);
}));

/** PATCH /api/apuestas/:id/anular — Solo el juez: empate o no se pudo definir. No crea deuda */
router.patch('/:id/anular', h(async (req, res) => {
  const fila = await cargar(req, res);
  if (!fila) return;
  if (fila.mi_rol !== 'juez') return prohibido(res, 'Solo el juez puede anular esta apuesta');
  if (!permisos(fila).decidir) return conflicto(res, 'Solo se puede anular una apuesta activa');

  const { rowCount } = await pool.query(
    `UPDATE apuestas SET estado = 'anulada', fecha_decision = $1, updated_at = NOW()
     WHERE id = $2 AND estado = 'activa'`,
    [hoyISO(), fila.id]
  );
  if (!rowCount) return conflicto(res, 'Solo se puede anular una apuesta activa');
  await responderApuesta(fila.id, req, res);
}));

// ============================================================
// Cambiar la decisión: un apostador lo pide y el otro debe estar de acuerdo.
// Entonces la apuesta vuelve a estar activa y el juez decide de nuevo.
// ============================================================

const CON_PAGOS = 'Ya hay pagos registrados: el ganador debe deshacerlos antes de cambiar la decisión';

/** PATCH /api/apuestas/:id/revision/pedir — Uno de los apostadores */
router.patch('/:id/revision/pedir', h(async (req, res) => {
  const fila = await cargar(req, res);
  if (!fila) return;
  if (fila.mi_rol === 'juez') return prohibido(res, 'Solo los apostadores pueden pedir cambiar la decisión');
  if (fila.deuda_abonado) return conflicto(res, CON_PAGOS);
  if (!permisos(fila).pedir_revision) return conflicto(res, 'No se puede pedir un cambio en esta apuesta');

  const { rowCount } = await pool.query(
    `UPDATE apuestas SET revision_pedida_por = $1, updated_at = NOW()
     WHERE id = $2 AND estado IN ('resuelta', 'anulada') AND revision_pedida_por IS NULL`,
    [req.usuario.id, fila.id]
  );
  if (!rowCount) return conflicto(res, 'No se puede pedir un cambio en esta apuesta');
  await responderApuesta(fila.id, req, res);
}));

/** PATCH /api/apuestas/:id/revision/aceptar — El otro apostador. Borra la deuda y reabre la apuesta */
router.patch('/:id/revision/aceptar', h(async (req, res) => {
  const fila = await cargar(req, res);
  if (!fila) return;

  await enTransaccion(async (db) => {
    await db.query('SELECT 1 FROM apuestas WHERE id = $1 FOR UPDATE', [fila.id]);
    const actual = await buscarVisible(fila.id, req.usuario.id, db);
    if (actual.mi_rol === 'juez') throw new ErrorHttp(403, 'Solo los apostadores pueden aceptar este cambio');
    if (!actual.revision_pedida_por) throw new ErrorHttp(409, 'Nadie ha pedido cambiar esta decisión');
    if (actual.revision_mia) throw new ErrorHttp(403, 'El otro apostador es quien debe aceptar el cambio');

    // Se bloquea la deuda antes de mirar sus pagos, por si el ganador está registrando uno
    if (actual.deuda_id) await db.query('SELECT 1 FROM deudas WHERE id = $1 FOR UPDATE', [actual.deuda_id]);
    const { rows } = await db.query('SELECT 1 FROM pagos WHERE deuda_id = $1 LIMIT 1', [actual.deuda_id]);
    if (rows.length) throw new ErrorHttp(409, CON_PAGOS);

    await db.query(
      `UPDATE apuestas
       SET estado = 'activa', ganador_id = NULL, fecha_decision = NULL, deuda_id = NULL,
           revision_pedida_por = NULL, updated_at = NOW()
       WHERE id = $1`,
      [actual.id]
    );
    if (actual.deuda_id) await db.query('DELETE FROM deudas WHERE id = $1', [actual.deuda_id]);
  });

  await responderApuesta(fila.id, req, res);
}));

/** PATCH /api/apuestas/:id/revision/rechazar — El otro la rechaza, o quien la pidió la retira */
router.patch('/:id/revision/rechazar', h(async (req, res) => {
  const fila = await cargar(req, res);
  if (!fila) return;
  if (fila.mi_rol === 'juez') return prohibido(res, 'Solo los apostadores pueden responder este cambio');

  const { rowCount } = await pool.query(
    `UPDATE apuestas SET revision_pedida_por = NULL, updated_at = NOW()
     WHERE id = $1 AND revision_pedida_por IS NOT NULL`,
    [fila.id]
  );
  if (!rowCount) return conflicto(res, 'Nadie ha pedido cambiar esta decisión');
  await responderApuesta(fila.id, req, res);
}));

export default router;
