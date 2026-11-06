import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { validarDeuda, validarId } from '../validators/deudas.js';
import { SQL_VISTA, buscarVisible, permisos, formatear } from '../services/deudas.js';
import { calcularInteres } from '../utils/interes.js';
import { hoyISO, esFechaValida } from '../utils/fechas.js';

const router = Router();
const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// RNF-11: todas las rutas de deudas exigen sesión
router.use(requireAuth);

const noExiste = (res) => res.status(404).json({ errores: ['La deuda no existe'] }); // RN-11
const prohibido = (res, msg) => res.status(403).json({ errores: [msg] });
const conflicto = (res, msg) => res.status(409).json({ errores: [msg] });

// Carga la deuda visible para el usuario o responde 404
async function cargar(req, res) {
  const id = validarId(req.params.id);
  if (!id) { res.status(400).json({ errores: ['id inválido'] }); return null; }
  const fila = await buscarVisible(id, req.usuario.id);
  if (!fila) { noExiste(res); return null; }
  return fila;
}

// Busca un @usuario para vincular. Devuelve el usuario o responde el error.
async function resolverContraparte(username, req, res) {
  if (username === req.usuario.username) {
    res.status(400).json({ errores: ['No puedes vincular una deuda contigo mismo'] }); // RN-13
    return null;
  }
  const { rows } = await pool.query('SELECT id, nombre, username FROM usuarios WHERE username = $1', [username]);
  if (!rows[0]) {
    res.status(404).json({ errores: [`No existe el usuario @${username}`] });
    return null;
  }
  return rows[0];
}

// ============================================================
// Consultas
// ============================================================

/**
 * GET /api/deudas/balance — RF-12, RF-13
 * Balance por persona (me deben / debo / neto) con intereses a hoy.
 * Solo cuentan deudas pendientes; las vinculadas que me hicieron otros
 * solo cuentan si ya las acepté (RN-14).
 */
router.get('/balance', h(async (req, res) => {
  const { rows } = await pool.query(
    `${SQL_VISTA}
       AND d.pagada = FALSE
       AND (d.usuario_id = $1 OR d.estado_vinculo = 'aceptada')`,
    [req.usuario.id]
  );

  const personas = new Map();
  let totalMeDeben = 0;
  let totalDebo = 0;

  for (const fila of rows) {
    const deuda = formatear(fila);
    // Si está vinculada, se agrupa por usuario; si no, por nombre (sin mayúsculas)
    const clave = fila.otro_id ? `u:${fila.otro_id}` : `n:${deuda.persona.toLowerCase()}`;
    if (!personas.has(clave)) {
      personas.set(clave, {
        persona: deuda.persona,
        usuario: deuda.usuario_vinculado,
        me_deben: 0, debo: 0, neto: 0, deudas_pendientes: 0, vencidas: 0,
      });
    }
    const p = personas.get(clave);
    if (deuda.tipo === 'me_deben') { p.me_deben += deuda.total_a_hoy; totalMeDeben += deuda.total_a_hoy; }
    else { p.debo += deuda.total_a_hoy; totalDebo += deuda.total_a_hoy; }
    p.deudas_pendientes += 1;
    if (deuda.vencida) p.vencidas += 1;
  }

  const r2 = (n) => Math.round(n * 100) / 100;
  const lista = [...personas.values()]
    .map((p) => ({ ...p, me_deben: r2(p.me_deben), debo: r2(p.debo), neto: r2(p.me_deben - p.debo) }))
    .sort((a, b) => Math.abs(b.neto) - Math.abs(a.neto));

  res.json({
    total_me_deben: r2(totalMeDeben),
    total_debo: r2(totalDebo),
    balance_neto: r2(totalMeDeben - totalDebo),
    personas: lista,
  });
}));

/** GET /api/deudas/solicitudes — RF-21, RF-23: deudas que otros me vincularon y debo responder */
router.get('/solicitudes', h(async (req, res) => {
  const { rows } = await pool.query(
    `${SQL_VISTA} AND d.contraparte_id = $1 AND d.estado_vinculo = 'pendiente'
     ORDER BY d.created_at DESC`,
    [req.usuario.id]
  );
  res.json({ total: rows.length, solicitudes: rows.map(formatear) });
}));

/**
 * GET /api/deudas?tipo=me_deben|debo&estado=pendiente|pagada|todas&q=juan — RF-02, RF-03
 * Las solicitudes pendientes de responder no salen aquí (salen en /solicitudes).
 */
router.get('/', h(async (req, res) => {
  const { tipo, estado, q } = req.query;
  const valores = [req.usuario.id];
  const filtros = [`NOT (d.contraparte_id = $1 AND d.estado_vinculo = 'pendiente')`];

  if (tipo === 'me_deben' || tipo === 'debo') {
    valores.push(tipo);
    filtros.push(`(CASE WHEN d.usuario_id = $1 THEN d.tipo
                        WHEN d.tipo = 'me_deben' THEN 'debo' ELSE 'me_deben' END) = $${valores.length}`);
  } else if (tipo && tipo !== 'todas') {
    return res.status(400).json({ errores: ['tipo debe ser me_deben, debo o todas'] });
  }

  if (estado === 'pendiente') filtros.push('d.pagada = FALSE');
  else if (estado === 'pagada') filtros.push('d.pagada = TRUE');
  else if (estado && estado !== 'todas') {
    return res.status(400).json({ errores: ['estado debe ser pendiente, pagada o todas'] });
  }

  if (q && String(q).trim()) {
    valores.push(`%${String(q).trim().toLowerCase()}%`);
    const n = valores.length;
    filtros.push(`(LOWER(CASE WHEN d.usuario_id = $1 THEN d.persona ELSE creador.nombre END) LIKE $${n}
                   OR LOWER(COALESCE(CASE WHEN d.usuario_id = $1 THEN contra.username ELSE creador.username END, '')) LIKE $${n})`);
  }

  const { rows } = await pool.query(
    `${SQL_VISTA} AND ${filtros.join(' AND ')}
     ORDER BY d.pagada ASC, d.fecha DESC, d.id DESC`,
    valores
  );
  res.json(rows.map(formatear));
}));

/** GET /api/deudas/:id — RF-04 */
router.get('/:id', h(async (req, res) => {
  const fila = await cargar(req, res);
  if (fila) res.json(formatear(fila));
}));

// ============================================================
// Crear / editar / eliminar
// ============================================================

/** POST /api/deudas — RF-01, RF-09, RF-20 */
router.post('/', h(async (req, res) => {
  const { datos, errores } = validarDeuda(req.body);
  if (errores.length) return res.status(400).json({ errores });

  let contraparte = null;
  if (datos.contraparte) {
    contraparte = await resolverContraparte(datos.contraparte, req, res);
    if (!contraparte) return;
  }

  const { rows } = await pool.query(
    `INSERT INTO deudas
       (usuario_id, tipo, persona, contraparte_id, estado_vinculo, concepto, monto,
        tipo_interes, tasa_interes, fecha, fecha_limite)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      req.usuario.id,
      datos.tipo,
      contraparte ? contraparte.nombre : datos.persona,
      contraparte?.id ?? null,
      contraparte ? 'pendiente' : 'ninguno',
      datos.concepto ?? null,
      datos.monto,
      datos.tipo_interes ?? 'ninguno',
      datos.tasa_interes ?? 0,
      datos.fecha ?? hoyISO(),  // RNF-08: fecha de Colombia, no la del servidor de BD
      datos.fecha_limite ?? null,
    ]
  );
  const creada = await buscarVisible(rows[0].id, req.usuario.id);
  res.status(201).json(formatear(creada));
}));

/**
 * PUT /api/deudas/:id — RF-05
 * Solo el creador. No se edita si está pagada (RN-04).
 * Si está aceptada por la otra persona, solo se puede cambiar el concepto (RN-15).
 * Si se cambian datos de una vinculada rechazada, vuelve a quedar pendiente.
 */
router.put('/:id', h(async (req, res) => {
  const fila = await cargar(req, res);
  if (!fila) return;

  const { datos, errores } = validarDeuda(req.body, { parcial: true });
  if (errores.length) return res.status(400).json({ errores });
  if (Object.keys(datos).length === 0) {
    return res.status(400).json({ errores: ['No se envió ningún campo para actualizar'] });
  }

  const p = permisos(fila);
  if (!fila.es_creador) return prohibido(res, 'Solo quien creó la deuda puede editarla');
  if (fila.pagada) return conflicto(res, 'No se puede editar una deuda pagada; primero reábrela');
  if (fila.estado_vinculo === 'aceptada' && Object.keys(datos).some((c) => c !== 'concepto')) {
    return conflicto(res, 'La otra persona ya aceptó esta deuda: solo puedes cambiar el concepto');
  }
  if (!p.editar && !p.editar_concepto) return prohibido(res, 'No puedes editar esta deuda');

  // Fechas contra las que ya están guardadas (RN-03)
  const fecha = datos.fecha ?? fila.fecha;
  const limite = datos.fecha_limite !== undefined ? datos.fecha_limite : fila.fecha_limite;
  if (limite && limite < fecha) {
    return res.status(400).json({ errores: ['fecha_limite no puede ser anterior a la fecha de la deuda'] });
  }

  const cambios = { ...datos };
  delete cambios.contraparte;

  // Cambio de vinculación
  if (datos.contraparte !== undefined) {
    if (datos.contraparte === null) {
      cambios.contraparte_id = null;
      cambios.estado_vinculo = 'ninguno';
      if (!cambios.persona) cambios.persona = fila.persona;
    } else {
      const c = await resolverContraparte(datos.contraparte, req, res);
      if (!c) return;
      cambios.contraparte_id = c.id;
      cambios.persona = c.nombre;
      cambios.estado_vinculo = 'pendiente';
    }
  } else if (fila.estado_vinculo === 'rechazada') {
    // Si corrige una deuda rechazada, se le vuelve a enviar a la otra persona
    cambios.estado_vinculo = 'pendiente';
  }
  // Si está vinculada, el nombre siempre es el del usuario (no se edita a mano)
  if (fila.contraparte_id && datos.contraparte === undefined) delete cambios.persona;

  const campos = Object.keys(cambios);
  if (campos.length === 0) return res.json(formatear(fila));

  await pool.query(
    `UPDATE deudas SET ${campos.map((c, i) => `${c} = $${i + 1}`).join(', ')}, updated_at = NOW()
     WHERE id = $${campos.length + 1}`,
    [...campos.map((c) => cambios[c]), fila.id]
  );
  res.json(formatear(await buscarVisible(fila.id, req.usuario.id)));
}));

/** DELETE /api/deudas/:id — RF-08. Solo el creador y si no fue aceptada (RN-15) */
router.delete('/:id', h(async (req, res) => {
  const fila = await cargar(req, res);
  if (!fila) return;
  if (!fila.es_creador) return prohibido(res, 'Solo quien creó la deuda puede eliminarla');
  if (fila.estado_vinculo === 'aceptada') {
    return conflicto(res, 'La otra persona ya aceptó esta deuda, no se puede eliminar');
  }
  await pool.query('DELETE FROM deudas WHERE id = $1', [fila.id]);
  res.status(204).end();
}));

// ============================================================
// Acciones
// ============================================================

/**
 * PATCH /api/deudas/:id/pagar — RF-06
 * body opcional: { "fecha_pago": "YYYY-MM-DD" } (por defecto hoy)
 * Congela el total con intereses en monto_pagado.
 */
router.patch('/:id/pagar', h(async (req, res) => {
  const fila = await cargar(req, res);
  if (!fila) return;

  if (fila.pagada) return conflicto(res, 'Esta deuda ya está marcada como pagada'); // RN-05
  if (fila.estado_vinculo === 'pendiente') {
    return conflicto(res, 'La otra persona todavía no ha aceptado esta deuda');
  }
  if (!permisos(fila).pagar) {
    return prohibido(res, 'Solo quien prestó el dinero puede marcar esta deuda como pagada'); // RN-16
  }

  const fechaPago = req.body?.fecha_pago || hoyISO();
  if (!esFechaValida(fechaPago)) return res.status(400).json({ errores: ['fecha_pago debe tener formato YYYY-MM-DD'] });
  if (fechaPago > hoyISO()) return res.status(400).json({ errores: ['fecha_pago no puede estar en el futuro'] });
  if (fechaPago < fila.fecha) return res.status(400).json({ errores: ['fecha_pago no puede ser anterior a la fecha de la deuda'] });

  const { total } = calcularInteres(fila, fechaPago);
  await pool.query(
    `UPDATE deudas SET pagada = TRUE, fecha_pago = $1, monto_pagado = $2, updated_at = NOW()
     WHERE id = $3`,
    [fechaPago, total, fila.id]
  );
  res.json(formatear(await buscarVisible(fila.id, req.usuario.id)));
}));

/** PATCH /api/deudas/:id/reabrir — RF-07 */
router.patch('/:id/reabrir', h(async (req, res) => {
  const fila = await cargar(req, res);
  if (!fila) return;
  if (!fila.pagada) return conflicto(res, 'Esta deuda todavía está pendiente');
  if (!permisos(fila).reabrir) return prohibido(res, 'Solo quien prestó el dinero puede reabrir esta deuda');

  await pool.query(
    `UPDATE deudas SET pagada = FALSE, fecha_pago = NULL, monto_pagado = NULL, updated_at = NOW()
     WHERE id = $1`,
    [fila.id]
  );
  res.json(formatear(await buscarVisible(fila.id, req.usuario.id)));
}));

/** PATCH /api/deudas/:id/aceptar y /rechazar — RF-21. Solo la contraparte */
for (const accion of ['aceptar', 'rechazar']) {
  router.patch(`/:id/${accion}`, h(async (req, res) => {
    const fila = await cargar(req, res);
    if (!fila) return;
    if (fila.es_creador) return prohibido(res, 'Solo la otra persona puede responder esta solicitud');
    if (fila.estado_vinculo !== 'pendiente') return conflicto(res, 'Esta solicitud ya fue respondida');

    const nuevo = accion === 'aceptar' ? 'aceptada' : 'rechazada';
    await pool.query(
      'UPDATE deudas SET estado_vinculo = $1, updated_at = NOW() WHERE id = $2',
      [nuevo, fila.id]
    );

    if (nuevo === 'rechazada') return res.json({ id: fila.id, estado_vinculo: 'rechazada' });
    res.json(formatear(await buscarVisible(fila.id, req.usuario.id)));
  }));
}

export default router;
