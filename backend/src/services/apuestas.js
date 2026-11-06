// Lógica compartida de apuestas: consulta, permisos y formato de respuesta.

import { pool } from '../db.js';

/**
 * Consulta base. $1 = id del usuario que consulta.
 * Solo los tres participantes pueden ver una apuesta.
 */
export const SQL_VISTA = `
  SELECT
    a.*,
    CASE $1::int
      WHEN a.creador_id  THEN 'creador'
      WHEN a.oponente_id THEN 'oponente'
      ELSE 'juez'
    END AS mi_rol,
    creador.nombre    AS creador_nombre,
    creador.username  AS creador_username,
    oponente.nombre   AS oponente_nombre,
    oponente.username AS oponente_username,
    juez.nombre       AS juez_nombre,
    juez.username     AS juez_username,
    rechazo.username  AS rechazada_por_username,
    revision.username AS revision_pedida_por_username,
    (a.revision_pedida_por = $1) AS revision_mia,
    d.pagada          AS deuda_pagada,
    d.fecha_pago      AS deuda_fecha_pago,
    (SELECT COALESCE(SUM(p.monto), 0) FROM pagos p WHERE p.deuda_id = a.deuda_id) AS deuda_abonado
  FROM apuestas a
  JOIN usuarios creador  ON creador.id  = a.creador_id
  JOIN usuarios oponente ON oponente.id = a.oponente_id
  JOIN usuarios juez     ON juez.id     = a.juez_id
  LEFT JOIN usuarios rechazo ON rechazo.id = a.rechazada_por
  LEFT JOIN usuarios revision ON revision.id = a.revision_pedida_por
  LEFT JOIN deudas d ON d.id = a.deuda_id
  WHERE $1 IN (a.creador_id, a.oponente_id, a.juez_id)
`;

export async function buscarVisible(id, usuarioId, db = pool) {
  const { rows } = await db.query(`${SQL_VISTA} AND a.id = $2`, [usuarioId, id]);
  return rows[0] ?? null;
}

/**
 * Qué puede hacer el usuario con la apuesta.
 * Se usa en las rutas y se envía al frontend para mostrar u ocultar botones.
 */
export function permisos(fila) {
  const yaAcepte =
    (fila.mi_rol === 'oponente' && fila.acepto_oponente) ||
    (fila.mi_rol === 'juez' && fila.acepto_juez);
  const apostador = fila.mi_rol !== 'juez';
  const decidida = ['resuelta', 'anulada'].includes(fila.estado);
  const hayRevision = !!fila.revision_pedida_por;

  return {
    // La decisión solo cambia si los dos apostadores están de acuerdo
    pedir_revision:     decidida && apostador && !hayRevision && !fila.deuda_abonado,
    responder_revision: decidida && apostador && hayRevision && !fila.revision_mia,
    cancelar_revision:  decidida && apostador && hayRevision && !!fila.revision_mia,
    responder: fila.estado === 'pendiente' && fila.mi_rol !== 'creador' && !yaAcepte,
    decidir:   fila.estado === 'activa' && fila.mi_rol === 'juez',
    eliminar:  ['pendiente', 'rechazada'].includes(fila.estado) && fila.mi_rol === 'creador',
  };
}

/** Convierte una fila de la BD en la respuesta JSON de la API */
export function formatear(fila) {
  const creador = { nombre: fila.creador_nombre, username: fila.creador_username, postura: fila.postura_creador };
  const oponente = {
    nombre: fila.oponente_nombre, username: fila.oponente_username,
    postura: fila.postura_oponente, acepto: fila.acepto_oponente,
  };
  const ganoCreador = fila.ganador_id === fila.creador_id;

  return {
    id: fila.id,
    titulo: fila.titulo,
    monto: fila.monto,
    estado: fila.estado,
    mi_rol: fila.mi_rol,
    creador,
    oponente,
    juez: { nombre: fila.juez_nombre, username: fila.juez_username, acepto: fila.acepto_juez },
    rechazada_por: fila.rechazada_por_username,
    ganador: fila.ganador_id ? (ganoCreador ? creador.username : oponente.username) : null,
    perdedor: fila.ganador_id ? (ganoCreador ? oponente.username : creador.username) : null,
    fecha_decision: fila.fecha_decision,
    revision_pedida_por: fila.revision_pedida_por_username,
    deuda: fila.deuda_id
      ? {
          id: fila.deuda_id,
          pagada: fila.deuda_pagada,
          fecha_pago: fila.deuda_fecha_pago,
          abonado: fila.deuda_abonado,
          saldo: Math.round((fila.monto - fila.deuda_abonado) * 100) / 100,
        }
      : null,
    permisos: permisos(fila),
  };
}
