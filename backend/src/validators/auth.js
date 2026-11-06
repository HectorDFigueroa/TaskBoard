// Validación de los datos de registro y login.
// Cada función devuelve { datos, errores } — si errores tiene algo, se responde 400.

const REGEX_USERNAME = /^[a-z0-9_]{3,20}$/;                 // RN-12
const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizarUsername(valor) {
  return typeof valor === 'string' ? valor.trim().replace(/^@/, '').toLowerCase() : '';
}

export function validarRegistro(body = {}) {
  const errores = [];
  const datos = {};

  // nombre
  const nombre = typeof body.nombre === 'string' ? body.nombre.trim().replace(/\s+/g, ' ') : '';
  if (nombre.length < 2 || nombre.length > 80) {
    errores.push('nombre debe tener entre 2 y 80 caracteres');
  } else {
    datos.nombre = nombre;
  }

  // username (se acepta con o sin @ y se pasa a minúsculas)
  const username = normalizarUsername(body.username);
  if (!REGEX_USERNAME.test(username)) {
    errores.push('username debe tener entre 3 y 20 caracteres: solo minúsculas, números y _');
  } else {
    datos.username = username;
  }

  // email (RN-08: se guarda en minúsculas)
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!REGEX_EMAIL.test(email) || email.length > 254) {
    errores.push('email no es válido');
  } else {
    datos.email = email;
  }

  // password (RN-09). bcrypt solo usa los primeros 72 bytes, por eso el máximo
  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length < 8) {
    errores.push('password debe tener al menos 8 caracteres');
  } else if (Buffer.byteLength(password, 'utf8') > 72) {
    errores.push('password es demasiado larga (máximo 72 caracteres)');
  } else {
    datos.password = password;
  }

  return { datos, errores };
}

export function validarLogin(body = {}) {
  const errores = [];
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email) errores.push('email es obligatorio');
  if (!password) errores.push('password es obligatoria');
  return { datos: { email, password }, errores };
}
