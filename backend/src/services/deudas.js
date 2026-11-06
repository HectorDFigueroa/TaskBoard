// Lógica compartida de deudas: consulta "desde el punto de vista" de un usuario,
// permisos y formato de respuesta.

import { pool } from '../db.js';
import { calcularInteres } from '../utils/interes.js';
import { hoyISO } from '../utils/fechas.js';

/**
 * Consulta base. $1 = id del usuario que consulta.
 * Una deuda se guarda UNA sola vez, desde el punto de vista del creador.
 * Si quien consulta es la contraparte, se invierte el tipo (RF-22) y se muestra
 * el nombre del creador como "persona".
 *
 * Visibilidad (RN-10, RN-11):
 *  - el creador ve todas sus deudas
 *  - la contraparte solo ve las vinculadas en estado 'pendiente' o 'aceptada'
 */
export const SQL_VISTA = `
  SELECT
    d.*,
    (d.usuario_id = $1) AS es_creador,
    CASE
      WHEN d.usuario_id = $1      THEN d.tipo
      WHEN d.tipo = 'me_deben'    THEN 'debo'
      ELSE 'me_deben'
    END AS tipo_vista,
    CASE WHEN d.usuario_id = $1 THEN d.persona     ELSE creador.nombre   END AS persona_vista,
    CASE WHEN d.usuario_id = $1 THEN contra.username ELSE creador.username END AS username_otro,
    CASE WHEN d.usuario_id = $1 THEN d.contraparte_id ELSE d.usuario_id   END AS otro_id
  FROM deudas d
  JOIN usuarios creador     ON creador.id = d.usuario_id
  LEFT JOIN usuarios contra ON contra.id  = d.contraparte_id
  WHERE (
    d.usuario_id = $1
    OR (d.contraparte_id = $1 AND d.estado_vinculo IN ('pendiente', 'aceptada'))
  )
`;

export async function buscarVisible(id, usuarioId) {
  const { rows } = await pool.query(`${SQL_VISTA} AND d.id = $2`, [usuarioId, id]);
  return rows[0] ?? null;
}

// ¿Quién es el acreedor (a quien le deben)? Solo aplica a deudas vinculadas.
function esAcreedor(fila) {
  return fila.tipo_vista === 'me_deben';
}

/**
 * Permisos del usuario sobre una deuda (RN-04, RN-05, RN-15, RN-16).
 * Se usan en las rutas Y se envían al frontend para mostrar u ocultar botones.
 */
export function permisos(fila) {
  const vinculada = fila.estado_vinculo !== 'ninguno' && fila.estado_vinculo !== 'rechazada';
  const aceptada = fila.estado_vinculo === 'aceptada';
  const pendienteVinculo = fila.estado_vinculo === 'pendiente';

  // Quién controla los pagos: en vinculadas aceptadas, el acreedor; si no, el creador
  const controlaPago = aceptada ? esAcreedor(fila) : fila.es_creador;

  return {
    editar:   fila.es_creador && !fila.pagada && !aceptada,
    editar_concepto: fila.es_creador && !fila.pagada,
    eliminar: fila.es_creador && !aceptada,
    pagar:    controlaPago && !fila.pagada && !pendienteVinculo,
    reabrir:  controlaPago && fila.pagada,
    responder: !fila.es_creador && pendienteVinculo,
    vinculada,
  };
}

/** Convierte una fila de la BD en la respuesta JSON de la API */
export function formatear(fila) {
  const hoy = hoyISO();
  const calculo = calcularInteres(fila, fila.pagada ? fila.fecha_pago : hoy);

  return {
    id: fila.id,
    tipo: fila.tipo_vista,                 // desde el punto de vista de quien consulta
    persona: fila.persona_vista,
    usuario_vinculado: fila.username_otro, // @usuario de la otra persona, o null
    estado_vinculo: fila.estado_vinculo,
    es_creador: fila.es_creador,
    concepto: fila.concepto,
    monto: fila.monto,
    tipo_interes: fila.tipo_interes,
    tasa_interes: fila.tasa_interes,
    fecha: fila.fecha,
    fecha_limite: fila.fecha_limite,
    pagada: fila.pagada,
    fecha_pago: fila.fecha_pago,
    monto_pagado: fila.monto_pagado,
    dias_transcurridos: calculo.dias,
    interes_acumulado: fila.pagada ? Math.round((fila.monto_pagado - fila.monto) * 100) / 100 : calculo.interes,
    total_a_hoy: fila.pagada ? fila.monto_pagado : calculo.total,
    vencida: !fila.pagada && !!fila.fecha_limite && fila.fecha_limite < hoy,   // RF-11
    permisos: permisos(fila),
  };
}
