// Pruebas de la API de punta a punta contra una base de datos de PRUEBA.
// ⚠️ Borra todos los datos de la base indicada en TEST_DATABASE_URL.
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

test('health y JSON inválido', async () => {
  const hc = (await api('GET', '/api/health')).body;
  assert.equal(hc.status, 'ok');
  assert.equal(hc.db, 'conectada');
  const res = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{malo',
  });
  assert.equal(res.status, 400);
});
