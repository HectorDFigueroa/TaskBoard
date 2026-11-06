// Validación de los datos de una apuesta. Devuelve { datos, errores }.

import { normalizarUsername } from './auth.js';
import { errorMonto } from './deudas.js';

const REGEX_USERNAME = /^[a-z0-9_]{3,20}$/;

function texto(valor) {
  return typeof valor === 'string' ? valor.trim().replace(/\s+/g, ' ') : '';
}

export function validarApuesta(body = {}) {
  const errores = [];
  const datos = {};

  const titulo = texto(body.titulo);
  if (titulo.length < 3 || titulo.length > 120) errores.push('titulo debe tener entre 3 y 120 caracteres');
  else datos.titulo = titulo;

  for (const campo of ['postura_creador', 'postura_oponente']) {
    const postura = texto(body[campo]);
    if (postura.length < 2 || postura.length > 120) errores.push(`${campo} debe tener entre 2 y 120 caracteres`);
    else datos[campo] = postura;
  }

  const monto = typeof body.monto === 'string' ? Number(body.monto) : body.monto;
  const error = errorMonto(monto);
  if (error) errores.push(error);
  else datos.monto = monto;

  // Las dos personas son obligatorias y deben indicarse por @usuario
  for (const campo of ['oponente', 'juez']) {
    const username = normalizarUsername(body[campo]);
    if (!REGEX_USERNAME.test(username)) errores.push(`${campo} debe ser un @usuario válido`);
    else datos[campo] = username;
  }

  return { datos, errores };
}
