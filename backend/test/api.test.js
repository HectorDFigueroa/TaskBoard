// Pruebas de la API de punta a punta contra una base de datos de PRUEBA.
//   Borra todos los datos de la base indicada en TEST_DATABASE_URL.
//
// Uso:
//   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/quien_me_debe_test npm test

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

if (!process.env.TEST_DATABASE_URL) {
  console.error('Define TEST_DATABASE_URL (una base de datos SOLO para pruebas)');
  process.exit(1);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET = 'secreto_de_pruebas';
process.env.TASA_USURA_EA = '25'; // ≈ 1.88 % mensual
process.env.FRONTEND_URL = '*';

const { crearApp } = await import('../src/app.js');
const { pool, initDb } = await import('../src/db.js');
const { calcularInteres } = await import('../src/utils/interes.js');

let server;
let base;

// Cliente HTTP mínimo
async function api(metodo, ruta, { token, body } = {}) {
  const res = await fetch(base + ruta, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const texto = await res.text();
  return { status: res.status, body: texto ? JSON.parse(texto) : null };
}

const hace = (dias) => new Date(Date.now() - 5 * 3600e3 - dias * 86400e3).toISOString().slice(0, 10);

let hector, juan, ana;

before(async () => {
  await initDb();
  await pool.query('TRUNCATE deudas, usuarios RESTART IDENTITY CASCADE');
  server = crearApp().listen(0);
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  server.close();
  await pool.end();
});

// ---------------------------------------------------------------- AUTH
test('registro: crea usuarios y devuelve token sin password_hash', async () => {
  const r = await api('POST', '/api/auth/register', {
    body: { nombre: 'Hector Figueroa', username: '@Hector', email: 'HECTOR@mail.com', password: 'clave1234' },
  });
  assert.equal(r.status, 201);
  assert.ok(r.body.token);
  assert.equal(r.body.usuario.username, 'hector');
  assert.equal(r.body.usuario.email, 'hector@mail.com');
  assert.equal(r.body.usuario.password_hash, undefined);
  hector = r.body.token;

  juan = (await api('POST', '/api/auth/register', {
    body: { nombre: 'Juan Pérez', username: 'juan', email: 'juan@mail.com', password: 'clave1234' },
  })).body.token;
  ana = (await api('POST', '/api/auth/register', {
    body: { nombre: 'Ana Ruiz', username: 'ana', email: 'ana@mail.com', password: 'clave1234' },
  })).body.token;
});

test('registro: valida datos y duplicados', async () => {
  let r = await api('POST', '/api/auth/register', { body: { nombre: 'X', username: 'a b', email: 'no', password: '123' } });
  assert.equal(r.status, 400);
  assert.equal(r.body.errores.length, 4);

  r = await api('POST', '/api/auth/register', {
    body: { nombre: 'Otro', username: 'juan', email: 'otro@mail.com', password: 'clave1234' },
  });
  assert.equal(r.status, 409);
  assert.match(r.body.errores[0], /usuario/);

  r = await api('POST', '/api/auth/register', {
    body: { nombre: 'Otro', username: 'otro', email: 'Juan@Mail.com', password: 'clave1234' },
  });
  assert.equal(r.status, 409);
  assert.match(r.body.errores[0], /correo/);
});

test('login: correcto, incorrecto con mensaje genérico, y /me', async () => {
  let r = await api('POST', '/api/auth/login', { body: { email: 'hector@mail.com', password: 'clave1234' } });
  assert.equal(r.status, 200);

  r = await api('POST', '/api/auth/login', { body: { email: 'hector@mail.com', password: 'mala_clave' } });
  assert.equal(r.status, 401);
  const r2 = await api('POST', '/api/auth/login', { body: { email: 'noexiste@mail.com', password: 'clave1234' } });
  assert.deepEqual(r.body, r2.body); // RNF-13

  r = await api('GET', '/api/auth/me', { token: hector });
  assert.equal(r.body.username, 'hector');
});

test('rutas protegidas sin token responden 401', async () => {
  assert.equal((await api('GET', '/api/deudas')).status, 401);
  assert.equal((await api('GET', '/api/deudas', { token: 'basura' })).status, 401);
});

test('buscar usuario: exacto, inexistente y a uno mismo', async () => {
  assert.equal((await api('GET', '/api/usuarios/buscar?username=@JUAN', { token: hector })).body.nombre, 'Juan Pérez');
  assert.equal((await api('GET', '/api/usuarios/buscar?username=jua', { token: hector })).status, 404);
  assert.equal((await api('GET', '/api/usuarios/buscar?username=hector', { token: hector })).status, 400);
});

// ---------------------------------------------------------------- CRUD
let idPedro;

test('crear deuda simple y validar reglas', async () => {
  let r = await api('POST', '/api/deudas', {
    token: hector, body: { tipo: 'me_deben', persona: '  Pedro   Gómez ', monto: 50000, concepto: 'Almuerzo' },
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.persona, 'Pedro Gómez');
  assert.equal(r.body.total_a_hoy, 50000);
  assert.equal(r.body.permisos.editar, true);
  idPedro = r.body.id;

  r = await api('POST', '/api/deudas', { token: hector, body: { tipo: 'x', monto: -5, fecha: '2999-01-01' } });
  assert.equal(r.status, 400);
  assert.ok(r.body.errores.length >= 4);

  r = await api('POST', '/api/deudas', {
    token: hector, body: { tipo: 'debo', persona: 'Ana', monto: 0.1, fecha: hace(2), fecha_limite: hace(5) },
  });
  assert.equal(r.status, 400); // fecha límite anterior
});

test('interés: simple, compuesto, sin tasa y límite de usura', async () => {
  // 5 % supera la usura configurada (25 % EA ≈ 1.88 % mensual)
  let r = await api('POST', '/api/deudas', {
    token: hector, body: { tipo: 'me_deben', persona: 'Carlos', monto: 500000, tipo_interes: 'simple', tasa_interes: 5 },
  });
  assert.equal(r.status, 400);
  assert.match(r.body.errores[0], /usura/);

  r = await api('POST', '/api/deudas', {
    token: hector, body: { tipo: 'me_deben', persona: 'Carlos', monto: 500000, tipo_interes: 'simple', tasa_interes: 0 },
  });
  assert.equal(r.status, 400);

  r = await api('POST', '/api/deudas', {
    token: hector,
    body: { tipo: 'me_deben', persona: 'Carlos', monto: 500000, tipo_interes: 'simple', tasa_interes: 1.5, fecha: hace(90) },
  });
  assert.equal(r.status, 201);
  // 90 días = 3 meses → 500.000 · (1 + 0.015·3) = 522.500
  assert.equal(r.body.total_a_hoy, 522500);
  assert.equal(r.body.interes_acumulado, 22500);

  r = await api('POST', '/api/deudas', {
    token: hector,
    body: { tipo: 'debo', persona: 'Banco Mamá', monto: 500000, tipo_interes: 'compuesto', tasa_interes: 1.5, fecha: hace(90) },
  });
  // 500.000 · 1.015³ = 522.839,19
  assert.equal(r.body.total_a_hoy, 522839.19);
});

test('cálculo de interés (función pura)', () => {
  const base = { monto: 500000, tasa_interes: 5, fecha: '2026-01-01' };
  assert.equal(calcularInteres({ ...base, tipo_interes: 'simple' }, '2026-04-01').total, 575000);    // 90 días = 3 meses
  assert.equal(calcularInteres({ ...base, tipo_interes: 'compuesto' }, '2026-04-01').total, 578812.5); // 1.05³
  assert.equal(calcularInteres({ ...base, tipo_interes: 'simple' }, '2026-01-31').total, 525000);
  assert.equal(calcularInteres({ ...base, tipo_interes: 'compuesto' }, '2026-01-31').total, 525000);
  assert.equal(calcularInteres({ ...base, tipo_interes: 'ninguno' }, '2026-12-31').total, 500000);
});

test('editar, pagar, no pagar dos veces, no editar pagada, reabrir', async () => {
  let r = await api('PUT', `/api/deudas/${idPedro}`, { token: hector, body: { monto: 60000 } });
  assert.equal(r.status, 200);
  assert.equal(r.body.monto, 60000);

  r = await api('PATCH', `/api/deudas/${idPedro}/pagar`, { token: hector });
  assert.equal(r.status, 200);
  assert.equal(r.body.pagada, true);
  assert.equal(r.body.monto_pagado, 60000);

  assert.equal((await api('PATCH', `/api/deudas/${idPedro}/pagar`, { token: hector })).status, 409);
  assert.equal((await api('PUT', `/api/deudas/${idPedro}`, { token: hector, body: { monto: 1 } })).status, 409);

  r = await api('PATCH', `/api/deudas/${idPedro}/reabrir`, { token: hector });
  assert.equal(r.body.pagada, false);
  assert.equal(r.body.monto_pagado, null);
});

test('aislamiento: otro usuario no ve ni toca deudas ajenas (404)', async () => {
  assert.equal((await api('GET', `/api/deudas/${idPedro}`, { token: juan })).status, 404);
  assert.equal((await api('DELETE', `/api/deudas/${idPedro}`, { token: juan })).status, 404);
  assert.equal((await api('GET', '/api/deudas', { token: ana })).body.length, 0);
});

// ---------------------------------------------------------------- VINCULADAS
let idVinc;

test('deuda vinculada: solicitud, vista invertida y aceptación', async () => {
  let r = await api('POST', '/api/deudas', {
    token: hector, body: { tipo: 'me_deben', contraparte: '@juan', monto: 80000, concepto: 'Boletas' },
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.persona, 'Juan Pérez');
  assert.equal(r.body.estado_vinculo, 'pendiente');
  idVinc = r.body.id;

  // No se puede pagar mientras está pendiente
  assert.equal((await api('PATCH', `/api/deudas/${idVinc}/pagar`, { token: hector })).status, 409);

  // Juan la ve como solicitud, desde su lado
  r = await api('GET', '/api/deudas/solicitudes', { token: juan });
  assert.equal(r.body.total, 1);
  assert.equal(r.body.solicitudes[0].tipo, 'debo');
  assert.equal(r.body.solicitudes[0].persona, 'Hector Figueroa');
  assert.equal(r.body.solicitudes[0].usuario_vinculado, 'hector');
  // ...pero no en su lista principal ni en su balance todavía (RN-14)
  assert.equal((await api('GET', '/api/deudas', { token: juan })).body.length, 0);
  assert.equal((await api('GET', '/api/deudas/balance', { token: juan })).body.total_debo, 0);

  // Juan no puede editarla ni borrarla
  assert.equal((await api('PUT', `/api/deudas/${idVinc}`, { token: juan, body: { monto: 1 } })).status, 403);
  assert.equal((await api('DELETE', `/api/deudas/${idVinc}`, { token: juan })).status, 403);
  // Hector no puede aceptarla por Juan
  assert.equal((await api('PATCH', `/api/deudas/${idVinc}/aceptar`, { token: hector })).status, 403);
  // Ana ni la ve
  assert.equal((await api('PATCH', `/api/deudas/${idVinc}/aceptar`, { token: ana })).status, 404);

  r = await api('PATCH', `/api/deudas/${idVinc}/aceptar`, { token: juan });
  assert.equal(r.status, 200);
  assert.equal(r.body.estado_vinculo, 'aceptada');
  assert.equal((await api('PATCH', `/api/deudas/${idVinc}/aceptar`, { token: juan })).status, 409);
  assert.equal((await api('GET', '/api/deudas/balance', { token: juan })).body.total_debo, 80000);
});

test('deuda aceptada: solo concepto editable, no se borra, solo el acreedor paga', async () => {
  assert.equal((await api('PUT', `/api/deudas/${idVinc}`, { token: hector, body: { monto: 1 } })).status, 409);
  assert.equal((await api('PUT', `/api/deudas/${idVinc}`, { token: hector, body: { concepto: 'Boletas concierto' } })).status, 200);
  assert.equal((await api('DELETE', `/api/deudas/${idVinc}`, { token: hector })).status, 409);

  // Juan (deudor) no puede marcarla pagada; Hector (acreedor) sí
  assert.equal((await api('PATCH', `/api/deudas/${idVinc}/pagar`, { token: juan })).status, 403);
  const r = await api('PATCH', `/api/deudas/${idVinc}/pagar`, { token: hector });
  assert.equal(r.status, 200);

  const vistaJuan = await api('GET', `/api/deudas/${idVinc}`, { token: juan });
  assert.equal(vistaJuan.body.pagada, true);
  assert.equal(vistaJuan.body.concepto, 'Boletas concierto');
});

test('acreedor es la contraparte cuando el creador registra "debo"', async () => {
  let r = await api('POST', '/api/deudas', { token: ana, body: { tipo: 'debo', contraparte: 'juan', monto: 30000 } });
  const id = r.body.id;
  await api('PATCH', `/api/deudas/${id}/aceptar`, { token: juan });
  // Ana (creadora pero deudora) no puede marcarla pagada; Juan (acreedor) sí
  assert.equal((await api('PATCH', `/api/deudas/${id}/pagar`, { token: ana })).status, 403);
  r = await api('PATCH', `/api/deudas/${id}/pagar`, { token: juan });
  assert.equal(r.status, 200);
});

test('rechazo: la contraparte deja de verla y el creador puede corregir y reenviar', async () => {
  let r = await api('POST', '/api/deudas', { token: hector, body: { tipo: 'me_deben', contraparte: 'ana', monto: 10000 } });
  const id = r.body.id;
  r = await api('PATCH', `/api/deudas/${id}/rechazar`, { token: ana });
  assert.equal(r.body.estado_vinculo, 'rechazada');
  assert.equal((await api('GET', `/api/deudas/${id}`, { token: ana })).status, 404);
  assert.equal((await api('GET', `/api/deudas/${id}`, { token: hector })).body.estado_vinculo, 'rechazada');

  r = await api('PUT', `/api/deudas/${id}`, { token: hector, body: { monto: 8000 } });
  assert.equal(r.body.estado_vinculo, 'pendiente');
  assert.equal((await api('GET', '/api/deudas/solicitudes', { token: ana })).body.total, 1);
});

test('no se puede vincular con uno mismo ni con usuario inexistente', async () => {
  assert.equal((await api('POST', '/api/deudas', { token: hector, body: { tipo: 'debo', contraparte: 'hector', monto: 1 } })).status, 400);
  assert.equal((await api('POST', '/api/deudas', { token: hector, body: { tipo: 'debo', contraparte: 'fantasma', monto: 1 } })).status, 404);
});

// ---------------------------------------------------------------- BALANCE Y FILTROS
test('balance neto por persona agrupa nombres sin importar mayúsculas', async () => {
  await api('POST', '/api/deudas', { token: hector, body: { tipo: 'me_deben', persona: 'Luisa', monto: 50000 } });
  await api('POST', '/api/deudas', { token: hector, body: { tipo: 'debo', persona: 'luisa', monto: 20000 } });

  const r = await api('GET', '/api/deudas/balance', { token: hector });
  const luisa = r.body.personas.find((p) => p.persona.toLowerCase() === 'luisa');
  assert.equal(luisa.me_deben, 50000);
  assert.equal(luisa.debo, 20000);
  assert.equal(luisa.neto, 30000);
  assert.equal(r.body.balance_neto, Math.round((r.body.total_me_deben - r.body.total_debo) * 100) / 100);
});

test('filtros de la lista', async () => {
  const todas = (await api('GET', '/api/deudas', { token: hector })).body;
  const debo = (await api('GET', '/api/deudas?tipo=debo', { token: hector })).body;
  const pagadas = (await api('GET', '/api/deudas?estado=pagada', { token: hector })).body;
  const luisa = (await api('GET', '/api/deudas?q=LUI', { token: hector })).body;
  assert.ok(debo.length > 0 && debo.every((d) => d.tipo === 'debo'));
  assert.ok(pagadas.every((d) => d.pagada));
  assert.equal(luisa.length, 2);
  assert.ok(todas.length > debo.length);
  assert.equal((await api('GET', '/api/deudas?estado=raro', { token: hector })).status, 400);
});

test('vencida y eliminar', async () => {
  let r = await api('POST', '/api/deudas', {
    token: hector, body: { tipo: 'me_deben', persona: 'Mario', monto: 1000, fecha: hace(10), fecha_limite: hace(1) },
  });
  assert.equal(r.body.vencida, true);
  assert.equal((await api('DELETE', `/api/deudas/${r.body.id}`, { token: hector })).status, 204);
  assert.equal((await api('GET', `/api/deudas/${r.body.id}`, { token: hector })).status, 404);
});

// ---------------------------------------------------------------- APUESTAS
const apuestaBase = { titulo: 'Quién gana el clásico', postura_creador: 'Gana Nacional', postura_oponente: 'Gana Millonarios', monto: 20000 };

// Crea una apuesta hector vs juan con ana de jueza, opcionalmente ya aceptada
async function crearApuesta({ activa = false } = {}) {
  const { body } = await api('POST', '/api/apuestas', {
    token: hector, body: { ...apuestaBase, oponente: '@juan', juez: 'ana' },
  });
  if (activa) {
    await api('PATCH', `/api/apuestas/${body.id}/aceptar`, { token: juan });
    await api('PATCH', `/api/apuestas/${body.id}/aceptar`, { token: ana });
  }
  return body.id;
}

test('apuestas: exigen sesión y que los tres sean usuarios registrados y distintos', async () => {
  assert.equal((await api('GET', '/api/apuestas')).status, 401);

  const crear = (extra) => api('POST', '/api/apuestas', { token: hector, body: { ...apuestaBase, ...extra } });
  let r = await crear({ juez: 'ana' }); // falta el oponente
  assert.equal(r.status, 400);
  r = await crear({ oponente: 'juan' }); // falta el juez
  assert.equal(r.status, 400);
  r = await crear({ oponente: 'Pedro Gómez', juez: 'ana' }); // nombre libre, no @usuario
  assert.equal(r.status, 400);

  r = await crear({ oponente: 'fantasma', juez: 'ana' });
  assert.equal(r.status, 404);
  assert.match(r.body.errores[0], /fantasma/);
  r = await crear({ oponente: 'juan', juez: 'fantasma' });
  assert.equal(r.status, 404);

  assert.equal((await crear({ oponente: 'hector', juez: 'ana' })).status, 400);
  assert.equal((await crear({ oponente: 'juan', juez: 'hector' })).status, 400);
  assert.equal((await crear({ oponente: 'juan', juez: '@JUAN' })).status, 400);

  r = await crear({ oponente: 'juan', juez: 'ana', monto: -1, titulo: 'x' });
  assert.equal(r.status, 400);
  assert.equal(r.body.errores.length, 2);
});

test('apuestas: la base de datos rechaza partes repetidas', async () => {
  await assert.rejects(
    pool.query(
      `INSERT INTO apuestas (creador_id, oponente_id, juez_id, titulo, postura_creador, postura_oponente, monto)
       VALUES (1, 2, 2, 'Prueba', 'Sí', 'No', 1000)`
    ),
    { code: '23514' }
  );
});

test('apuestas: queda activa solo cuando aceptan oponente y juez', async () => {
  const id = await crearApuesta();
  const url = `/api/apuestas/${id}`;

  let r = await api('GET', url, { token: hector });
  assert.equal(r.body.estado, 'pendiente');
  assert.equal(r.body.mi_rol, 'creador');
  assert.equal(r.body.oponente.username, 'juan');
  assert.equal(r.body.juez.username, 'ana');
  assert.equal(r.body.permisos.responder, false);
  assert.equal((await api('GET', url, { token: ana })).body.mi_rol, 'juez');
  assert.equal((await api('GET', url, { token: juan })).body.permisos.responder, true);

  // El creador no responde por los demás y el juez no decide antes de tiempo
  assert.equal((await api('PATCH', `${url}/aceptar`, { token: hector })).status, 403);
  assert.equal((await api('PATCH', `${url}/decidir`, { token: ana, body: { ganador: 'juan' } })).status, 409);

  r = await api('PATCH', `${url}/aceptar`, { token: juan });
  assert.equal(r.body.estado, 'pendiente');
  assert.equal(r.body.oponente.acepto, true);
  assert.equal(r.body.permisos.responder, false);
  assert.equal((await api('PATCH', `${url}/aceptar`, { token: juan })).status, 409);

  r = await api('PATCH', `${url}/aceptar`, { token: ana });
  assert.equal(r.body.estado, 'activa');
  assert.equal(r.body.permisos.decidir, true);
  assert.equal((await api('GET', url, { token: juan })).body.permisos.decidir, false);
});

test('apuestas: solo los participantes la ven', async () => {
  const carlos = (await api('POST', '/api/auth/register', {
    body: { nombre: 'Carlos Díaz', username: 'carlos', email: 'carlos@mail.com', password: 'clave1234' },
  })).body.token;
  const id = await crearApuesta({ activa: true });

  assert.equal((await api('GET', `/api/apuestas/${id}`, { token: carlos })).status, 404);
  assert.equal((await api('GET', '/api/apuestas', { token: carlos })).body.length, 0);
  assert.equal((await api('PATCH', `/api/apuestas/${id}/decidir`, { token: carlos, body: { ganador: 'hector' } })).status, 404);
  assert.ok((await api('GET', '/api/apuestas', { token: ana })).body.some((a) => a.id === id));
});

test('apuestas: el rechazo de un invitado la termina y el creador puede eliminarla', async () => {
  const id = await crearApuesta();
  const url = `/api/apuestas/${id}`;

  // Solo el creador elimina
  assert.equal((await api('DELETE', url, { token: juan })).status, 403);

  let r = await api('PATCH', `${url}/rechazar`, { token: ana });
  assert.equal(r.body.estado, 'rechazada');
  assert.equal(r.body.rechazada_por, 'ana');
  assert.equal((await api('PATCH', `${url}/aceptar`, { token: juan })).status, 409);

  assert.equal((await api('DELETE', url, { token: hector })).status, 204);
  assert.equal((await api('GET', url, { token: hector })).status, 404);
});

test('apuestas: solo el juez decide, y el perdedor queda debiendo al ganador', async () => {
  const id = await crearApuesta({ activa: true });
  const url = `/api/apuestas/${id}`;
  const deboAntes = (await api('GET', '/api/deudas/balance', { token: juan })).body.total_debo;
  const deudasAna = (await api('GET', '/api/deudas', { token: ana })).body.length;

  // Los apostadores no pueden decidir ni eliminar una apuesta activa
  assert.equal((await api('PATCH', `${url}/decidir`, { token: hector, body: { ganador: 'hector' } })).status, 403);
  assert.equal((await api('PATCH', `${url}/anular`, { token: juan })).status, 403);
  assert.equal((await api('DELETE', url, { token: hector })).status, 409);

  // El ganador debe ser uno de los dos apostadores
  assert.equal((await api('PATCH', `${url}/decidir`, { token: ana, body: { ganador: 'ana' } })).status, 400);
  assert.equal((await api('PATCH', `${url}/decidir`, { token: ana })).status, 400);

  let r = await api('PATCH', `${url}/decidir`, { token: ana, body: { ganador: '@hector' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.estado, 'resuelta');
  assert.equal(r.body.ganador, 'hector');
  assert.equal(r.body.perdedor, 'juan');
  assert.equal(r.body.deuda.pagada, false);

  // La decisión es definitiva y no genera una segunda deuda
  assert.equal((await api('PATCH', `${url}/decidir`, { token: ana, body: { ganador: 'juan' } })).status, 409);
  assert.equal((await api('PATCH', `${url}/anular`, { token: ana })).status, 409);

  // La deuda entra al balance del perdedor sin pedirle aceptarla
  const deudaId = r.body.deuda.id;
  const deuda = (await api('GET', `/api/deudas/${deudaId}`, { token: juan })).body;
  assert.equal(deuda.tipo, 'debo');
  assert.equal(deuda.monto, 20000);
  assert.equal(deuda.estado_vinculo, 'aceptada');
  assert.equal(deuda.concepto, 'Apuesta: Quién gana el clásico');
  assert.equal((await api('GET', '/api/deudas/balance', { token: juan })).body.total_debo, deboAntes + 20000);

  // Al juez no le queda ninguna deuda
  assert.equal((await api('GET', '/api/deudas', { token: ana })).body.length, deudasAna);
  assert.equal((await api('GET', `/api/deudas/${deudaId}`, { token: ana })).status, 404);

  // Las partes no pueden borrar la deuda; el ganador la marca pagada y el juez lo ve
  assert.equal((await api('DELETE', `/api/deudas/${deudaId}`, { token: hector })).status, 409);
  assert.equal((await api('PATCH', `/api/deudas/${deudaId}/pagar`, { token: juan })).status, 403);
  assert.equal((await api('PATCH', `/api/deudas/${deudaId}/pagar`, { token: hector })).status, 200);
  r = await api('GET', url, { token: ana });
  assert.equal(r.body.deuda.pagada, true);
});

test('apuestas: dos decisiones simultáneas crean una sola deuda', async () => {
  const id = await crearApuesta({ activa: true });
  const respuestas = await Promise.all(['hector', 'juan'].map((ganador) =>
    api('PATCH', `/api/apuestas/${id}/decidir`, { token: ana, body: { ganador } })));

  assert.deepEqual(respuestas.map((r) => r.status).sort(), [200, 409]);
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM deudas
     WHERE id IN (SELECT deuda_id FROM apuestas WHERE id = $1)`,
    [id]
  );
  assert.equal(rows[0].n, 1);
});

test('apuestas: el juez puede anular y no se crea deuda', async () => {
  const id = await crearApuesta({ activa: true });
  const r = await api('PATCH', `/api/apuestas/${id}/anular`, { token: ana });
  assert.equal(r.status, 200);
  assert.equal(r.body.estado, 'anulada');
  assert.equal(r.body.ganador, null);
  assert.equal(r.body.deuda, null);
});

// Apuesta decidida por ana a favor de hector, con juan como perdedor
async function apuestaDecidida() {
  const id = await crearApuesta({ activa: true });
  const { body } = await api('PATCH', `/api/apuestas/${id}/decidir`, { token: ana, body: { ganador: 'hector' } });
  return { id, url: `/api/apuestas/${id}`, deudaId: body.deuda.id };
}

test('cambiar la decisión: exige el acuerdo de los dos apostadores y el juez decide de nuevo', async () => {
  const { url, deudaId } = await apuestaDecidida();

  // Sin solicitud no se puede aceptar ni rechazar, y el juez no participa
  assert.equal((await api('PATCH', `${url}/revision/aceptar`, { token: juan })).status, 409);
  assert.equal((await api('PATCH', `${url}/revision/rechazar`, { token: juan })).status, 409);
  assert.equal((await api('PATCH', `${url}/revision/pedir`, { token: ana })).status, 403);

  let r = await api('PATCH', `${url}/revision/pedir`, { token: juan });
  assert.equal(r.status, 200);
  assert.equal(r.body.revision_pedida_por, 'juan');
  assert.equal(r.body.estado, 'resuelta');
  assert.equal(r.body.permisos.cancelar_revision, true);
  assert.equal((await api('GET', url, { token: hector })).body.permisos.responder_revision, true);
  assert.equal((await api('PATCH', `${url}/revision/pedir`, { token: hector })).status, 409);

  // Ni quien la pidió ni el juez pueden aceptarla: la deuda sigue en pie
  assert.equal((await api('PATCH', `${url}/revision/aceptar`, { token: juan })).status, 403);
  assert.equal((await api('PATCH', `${url}/revision/aceptar`, { token: ana })).status, 403);
  assert.equal((await api('GET', `/api/deudas/${deudaId}`, { token: juan })).status, 200);

  // Si el otro la rechaza, la decisión se mantiene
  r = await api('PATCH', `${url}/revision/rechazar`, { token: hector });
  assert.equal(r.body.revision_pedida_por, null);
  assert.equal(r.body.ganador, 'hector');

  // Con el acuerdo de ambos: se borra la deuda y vuelve a estar activa
  await api('PATCH', `${url}/revision/pedir`, { token: juan });
  r = await api('PATCH', `${url}/revision/aceptar`, { token: hector });
  assert.equal(r.status, 200);
  assert.equal(r.body.estado, 'activa');
  assert.equal(r.body.ganador, null);
  assert.equal(r.body.deuda, null);
  assert.equal(r.body.revision_pedida_por, null);
  assert.equal((await api('GET', `/api/deudas/${deudaId}`, { token: juan })).status, 404);

  // El juez vuelve a decidir, y esta vez el ganador es otro
  r = await api('PATCH', `${url}/decidir`, { token: ana, body: { ganador: 'juan' } });
  assert.equal(r.body.ganador, 'juan');
  assert.equal((await api('GET', `/api/deudas/${r.body.deuda.id}`, { token: hector })).body.tipo, 'debo');
});

test('cambiar la decisión: quien la pidió puede retirarla, y también aplica a una apuesta anulada', async () => {
  const id = await crearApuesta({ activa: true });
  const url = `/api/apuestas/${id}`;
  await api('PATCH', `${url}/anular`, { token: ana });

  await api('PATCH', `${url}/revision/pedir`, { token: hector });
  let r = await api('PATCH', `${url}/revision/rechazar`, { token: hector });
  assert.equal(r.body.revision_pedida_por, null);

  await api('PATCH', `${url}/revision/pedir`, { token: hector });
  r = await api('PATCH', `${url}/revision/aceptar`, { token: juan });
  assert.equal(r.body.estado, 'activa');
  assert.equal(r.body.fecha_decision, null);

  // Una apuesta activa no tiene decisión que cambiar
  assert.equal((await api('PATCH', `${url}/revision/pedir`, { token: juan })).status, 409);
});

test('cambiar la decisión: no se puede con pagos registrados hasta deshacerlos', async () => {
  const { url, deudaId } = await apuestaDecidida();
  const abono = (await api('POST', `/api/deudas/${deudaId}/pagos`, { token: hector, body: { monto: 5000 } })).body;

  let r = await api('PATCH', `${url}/revision/pedir`, { token: juan });
  assert.equal(r.status, 409);
  assert.match(r.body.errores[0], /pagos/);

  // Las tres partes ven lo abonado
  r = await api('GET', url, { token: ana });
  assert.equal(r.body.deuda.abonado, 5000);
  assert.equal(r.body.deuda.saldo, 15000);
  assert.equal(r.body.permisos.pedir_revision, false);

  await api('DELETE', `/api/deudas/${deudaId}/pagos/${abono.pagos[0].id}`, { token: hector });
  assert.equal((await api('PATCH', `${url}/revision/pedir`, { token: juan })).status, 200);

  // Un pago registrado mientras la solicitud está abierta también la bloquea
  await api('POST', `/api/deudas/${deudaId}/pagos`, { token: hector, body: { monto: 1000 } });
  assert.equal((await api('PATCH', `${url}/revision/aceptar`, { token: hector })).status, 409);
  await api('PATCH', `${url}/revision/rechazar`, { token: juan });
  assert.equal((await api('GET', `/api/deudas/${deudaId}`, { token: juan })).body.abonado, 1000);
});

// ---------------------------------------------------------------- PAGOS PARCIALES
test('abonos: bajan el saldo y el balance, y el último salda la deuda', async () => {
  let r = await api('POST', '/api/deudas', { token: ana, body: { tipo: 'me_deben', persona: 'Rosa', monto: 50000 } });
  const url = `/api/deudas/${r.body.id}`;
  const antes = (await api('GET', '/api/deudas/balance', { token: ana })).body.total_me_deben;

  r = await api('POST', `${url}/pagos`, { token: ana, body: { monto: 20000 } });
  assert.equal(r.status, 201);
  assert.equal(r.body.pagada, false);
  assert.equal(r.body.total_a_hoy, 30000);
  assert.equal(r.body.abonado, 20000);
  assert.equal(r.body.pagos.length, 1);
  assert.equal((await api('GET', '/api/deudas/balance', { token: ana })).body.total_me_deben, antes - 20000);

  // Validaciones
  assert.equal((await api('POST', `${url}/pagos`, { token: ana, body: { monto: 30000.01 } })).status, 400);
  assert.equal((await api('POST', `${url}/pagos`, { token: ana, body: { monto: 0 } })).status, 400);
  assert.equal((await api('POST', `${url}/pagos`, { token: ana })).status, 400);
  assert.equal((await api('POST', `${url}/pagos`, { token: ana, body: { monto: 1, fecha: '2999-01-01' } })).status, 400);
  assert.equal((await api('POST', `${url}/pagos`, { token: ana, body: { monto: 1, fecha: hace(1) } })).status, 400);
  assert.equal((await api('POST', `${url}/pagos`, { token: juan, body: { monto: 1 } })).status, 404);

  // Con abonos solo se edita el concepto
  r = await api('PUT', url, { token: ana, body: { monto: 90000 } });
  assert.equal(r.status, 409);
  assert.equal((await api('PUT', url, { token: ana, body: { concepto: 'Mercado' } })).status, 200);

  // Marcar pagada cobra lo que falta y conserva los abonos
  r = await api('PATCH', `${url}/pagar`, { token: ana });
  assert.equal(r.body.pagada, true);
  assert.equal(r.body.monto_pagado, 50000);
  assert.equal(r.body.pagos.length, 2);
  assert.equal((await api('POST', `${url}/pagos`, { token: ana, body: { monto: 1 } })).status, 409);

  // Reabrir solo deshace el pago que la saldó
  r = await api('PATCH', `${url}/reabrir`, { token: ana });
  assert.equal(r.body.pagada, false);
  assert.equal(r.body.total_a_hoy, 30000);

  // Un abono exacto por el saldo también la deja pagada
  r = await api('POST', `${url}/pagos`, { token: ana, body: { monto: 30000 } });
  assert.equal(r.body.pagada, true);
  assert.equal(r.body.monto_pagado, 50000);
});

test('abonos: solo el acreedor los registra o deshace, y solo el último', async () => {
  let r = await api('POST', '/api/deudas', { token: hector, body: { tipo: 'me_deben', contraparte: 'juan', monto: 10000 } });
  const url = `/api/deudas/${r.body.id}`;

  // Con la vinculación pendiente no se puede abonar
  assert.equal((await api('POST', `${url}/pagos`, { token: hector, body: { monto: 1000 } })).status, 409);
  await api('PATCH', `${url}/aceptar`, { token: juan });

  assert.equal((await api('POST', `${url}/pagos`, { token: juan, body: { monto: 1000 } })).status, 403);
  await api('POST', `${url}/pagos`, { token: hector, body: { monto: 1000 } });
  r = await api('POST', `${url}/pagos`, { token: hector, body: { monto: 2000 } });
  const [primero, segundo] = r.body.pagos;

  // El deudor ve los abonos, pero no los puede deshacer
  r = await api('GET', url, { token: juan });
  assert.equal(r.body.total_a_hoy, 7000);
  assert.equal(r.body.permisos.deshacer_abono, false);
  assert.equal((await api('DELETE', `${url}/pagos/${segundo.id}`, { token: juan })).status, 403);

  assert.equal((await api('DELETE', `${url}/pagos/${primero.id}`, { token: hector })).status, 409);
  r = await api('DELETE', `${url}/pagos/${segundo.id}`, { token: hector });
  assert.equal(r.status, 200);
  assert.equal(r.body.total_a_hoy, 9000);
});

test('abonos con interés: cubren primero el interés y el resto corre sobre el nuevo capital', async () => {
  const deuda = { monto: 500000, tasa_interes: 1.5, fecha: hace(90) };
  // 30 días generan 7.500; un abono de 107.500 deja 400.000, que corren 60 días más
  const pago = { monto: 107500, fecha: hace(60) };
  for (const [tipo_interes, saldo] of [['simple', 412000], ['compuesto', 412090]]) {
    let r = await api('POST', '/api/deudas', {
      token: hector, body: { ...deuda, tipo: 'me_deben', persona: 'Con interés', tipo_interes },
    });
    r = await api('POST', `/api/deudas/${r.body.id}/pagos`, { token: hector, body: { monto: pago.monto, fecha: pago.fecha } });
    assert.equal(r.status, 201);
    assert.equal(r.body.total_a_hoy, saldo);
    assert.equal(r.body.interes_acumulado, saldo + pago.monto - deuda.monto);

    r = await api('PATCH', `/api/deudas/${r.body.id}/pagar`, { token: hector });
    assert.equal(r.body.monto_pagado, saldo + pago.monto);
  }
  // Abono menor que el interés: no toca el capital
  const { total } = calcularInteres(
    { monto: 100000, tasa_interes: 2, tipo_interes: 'simple', fecha: '2026-01-01' },
    '2026-03-02',
    [{ monto: 1000, fecha: '2026-01-31' }]
  );
  assert.equal(total, 103000); // 2.000 - 1.000 + 2.000 de interés sobre 100.000
});

test('abonos: dos pagos simultáneos no superan el saldo', async () => {
  let r = await api('POST', '/api/deudas', { token: ana, body: { tipo: 'me_deben', persona: 'Simultánea', monto: 10000 } });
  const url = `/api/deudas/${r.body.id}/pagos`;
  const respuestas = await Promise.all([1, 2].map(() => api('POST', url, { token: ana, body: { monto: 7000 } })));
  assert.deepEqual(respuestas.map((x) => x.status).sort(), [201, 400]);
});

test('health y JSON inválido', async () => {
  const hc = (await api('GET', '/api/health')).body;
  assert.equal(hc.status, 'ok');
  assert.equal(hc.db, 'conectada');
  const res = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{malo',
  });
  assert.equal(res.status, 400);
});
