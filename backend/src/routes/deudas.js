import { Router } from 'express';
import { pool, enTransaccion } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { validarDeuda, validarId, errorMonto } from '../validators/deudas.js';
import { ErrorHttp } from '../utils/errores.js';
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
  const tieneAbonos = fila.pagos.length > 0;
  if (tieneAbonos && Object.keys(datos).some((c) => c !== 'concepto')) {
    return conflicto(res, 'Esta deuda ya tiene abonos: solo puedes cambiar el concepto');
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
  } else if (fila.estado_vinculo === 'rechazada' && !tieneAbonos) {
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
 * Bloquea la deuda y la carga dentro de una transacción, para que dos pagos
 * simultáneos no puedan sumar más que el saldo.
 */
async function bloquear(req, db) {
  const id = validarId(req.params.id);
  if (!id) throw new ErrorHttp(400, 'id inválido');
  await db.query('SELECT 1 FROM deudas WHERE id = $1 FOR UPDATE', [id]);
  const fila = await buscarVisible(id, req.usuario.id, db);
  if (!fila) throw new ErrorHttp(404, 'La deuda no existe'); // RN-11
  return fila;
}

/**
 * Registra un pago. Sin monto, paga todo el saldo a esa fecha.
 * Si el pago cubre el saldo, la deuda queda pagada y monto_pagado congela lo pagado en total.
 */
async function registrarPago(req, { monto, fecha: fechaEnviada }) {
  return enTransaccion(async (db) => {
    const fila = await bloquear(req, db);

    if (fila.pagada) throw new ErrorHttp(409, 'Esta deuda ya está marcada como pagada'); // RN-05
    if (fila.estado_vinculo === 'pendiente') {
      throw new ErrorHttp(409, 'La otra persona todavía no ha aceptado esta deuda');
    }
    if (!permisos(fila).pagar) {
      throw new ErrorHttp(403, 'Solo quien prestó el dinero puede registrar pagos de esta deuda'); // RN-16
    }

    const fecha = fechaEnviada || hoyISO();
    const ultimoPago = fila.pagos.at(-1)?.fecha;
    if (!esFechaValida(fecha)) throw new ErrorHttp(400, 'La fecha del pago debe tener formato YYYY-MM-DD');
    if (fecha > hoyISO()) throw new ErrorHttp(400, 'La fecha del pago no puede estar en el futuro');
    if (fecha < fila.fecha) throw new ErrorHttp(400, 'La fecha del pago no puede ser anterior a la fecha de la deuda');
    if (ultimoPago && fecha < ultimoPago) throw new ErrorHttp(400, 'La fecha del pago no puede ser anterior a la del último abono');

    const { total: saldo, abonado } = calcularInteres(fila, fecha, fila.pagos);
    const pago = monto ?? saldo;
    if (pago > saldo) throw new ErrorHttp(400, `El abono no puede superar el saldo de $${saldo.toLocaleString('es-CO')}`);

    await db.query('INSERT INTO pagos (deuda_id, monto, fecha) VALUES ($1, $2, $3)', [fila.id, pago, fecha]);
    if (pago === saldo) {
      await db.query(
        `UPDATE deudas SET pagada = TRUE, fecha_pago = $1, monto_pagado = $2, updated_at = NOW()
         WHERE id = $3`,
        [fecha, Math.round((abonado + pago) * 100) / 100, fila.id]
      );
    } else {
      await db.query('UPDATE deudas SET updated_at = NOW() WHERE id = $1', [fila.id]);
    }
    return formatear(await buscarVisible(fila.id, req.usuario.id, db));
  });
}

/**
 * PATCH /api/deudas/:id/pagar — RF-06. Paga todo el saldo.
 * body opcional: { "fecha_pago": "YYYY-MM-DD" } (por defecto hoy)
 */
router.patch('/:id/pagar', h(async (req, res) => {
  res.json(await registrarPago(req, { fecha: req.body?.fecha_pago }));
}));

/**
 * POST /api/deudas/:id/pagos — Abono parcial. body: { "monto": 20000, "fecha": "YYYY-MM-DD" }
 * Si el abono cubre todo el saldo, la deuda queda pagada.
 */
router.post('/:id/pagos', h(async (req, res) => {
  const monto = typeof req.body?.monto === 'string' ? Number(req.body.monto) : req.body?.monto;
  const error = errorMonto(monto);
  if (error) return res.status(400).json({ errores: [error] });
  res.status(201).json(await registrarPago(req, { monto, fecha: req.body?.fecha }));
}));

/** DELETE /api/deudas/:id/pagos/:pagoId — Deshace un abono. Solo el último, para no alterar los siguientes */
router.delete('/:id/pagos/:pagoId', h(async (req, res) => {
  const resultado = await enTransaccion(async (db) => {
    const fila = await bloquear(req, db);
    if (fila.pagada) throw new ErrorHttp(409, 'Esta deuda ya está pagada; primero reábrela');
    if (!permisos(fila).deshacer_abono) {
      throw new ErrorHttp(403, 'Solo quien prestó el dinero puede deshacer abonos de esta deuda');
    }
    if (fila.pagos.at(-1)?.id !== validarId(req.params.pagoId)) {
      throw new ErrorHttp(409, 'Solo se puede deshacer el último abono');
    }
    await db.query('DELETE FROM pagos WHERE id = $1', [req.params.pagoId]);
    await db.query('UPDATE deudas SET updated_at = NOW() WHERE id = $1', [fila.id]);
    return formatear(await buscarVisible(fila.id, req.usuario.id, db));
  });
  res.json(resultado);
}));

/**
 * PATCH /api/deudas/:id/reabrir — RF-07
 * Deshace el pago que saldó la deuda; los abonos anteriores se conservan.
 */
router.patch('/:id/reabrir', h(async (req, res) => {
  const resultado = await enTransaccion(async (db) => {
    const fila = await bloquear(req, db);
    if (!fila.pagada) throw new ErrorHttp(409, 'Esta deuda todavía está pendiente');
    if (!permisos(fila).reabrir) throw new ErrorHttp(403, 'Solo quien prestó el dinero puede reabrir esta deuda');

    const ultimoPago = fila.pagos.at(-1);
    if (ultimoPago) await db.query('DELETE FROM pagos WHERE id = $1', [ultimoPago.id]);
    await db.query(
      `UPDATE deudas SET pagada = FALSE, fecha_pago = NULL, monto_pagado = NULL, updated_at = NOW()
       WHERE id = $1`,
      [fila.id]
    );
    return formatear(await buscarVisible(fila.id, req.usuario.id, db));
  });
  res.json(resultado);
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
