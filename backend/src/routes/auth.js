import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { pool } from '../db.js';
import { firmarToken, requireAuth } from '../middleware/auth.js';
import { validarRegistro, validarLogin } from '../validators/auth.js';

const router = Router();
const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const COSTO_BCRYPT = 10;
// Hash falso para comparar cuando el correo no existe: así el login tarda lo mismo
// exista o no el usuario, y no se puede averiguar qué correos están registrados.
const HASH_FALSO = bcrypt.hashSync('contraseña-que-no-existe', COSTO_BCRYPT);

// RNF-12: máximo 10 intentos de login cada 15 minutos por IP
const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { errores: ['Demasiados intentos. Espera 15 minutos e inténtalo de nuevo'] },
});

// Lo que se devuelve de un usuario (nunca el password_hash)
const publico = ({ id, nombre, username, email, created_at }) =>
  ({ id, nombre, username, email, created_at });

/** POST /api/auth/register — RF-14 */
router.post('/register', h(async (req, res) => {
  const { datos, errores } = validarRegistro(req.body);
  if (errores.length) return res.status(400).json({ errores });

  const hash = await bcrypt.hash(datos.password, COSTO_BCRYPT);
  try {
    const { rows } = await pool.query(
      `INSERT INTO usuarios (nombre, username, email, password_hash)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [datos.nombre, datos.username, datos.email, hash]
    );
    const usuario = rows[0];
    res.status(201).json({ token: firmarToken(usuario), usuario: publico(usuario) });
  } catch (err) {
    // 23505 = violación de UNIQUE en Postgres (RN-08 y RN-12)
    if (err.code === '23505') {
      const campo = err.constraint === 'usuarios_username_key' ? 'username' : 'email';
      return res.status(409).json({
        errores: [campo === 'username' ? 'Ese nombre de usuario ya está en uso' : 'Ese correo ya está registrado'],
      });
    }
    throw err;
  }
}));

/** POST /api/auth/login — RF-15 */
router.post('/login', limiteLogin, h(async (req, res) => {
  const { datos, errores } = validarLogin(req.body);
  if (errores.length) return res.status(400).json({ errores });

  const { rows } = await pool.query('SELECT * FROM usuarios WHERE email = $1', [datos.email]);
  const usuario = rows[0];
  const coincide = await bcrypt.compare(datos.password, usuario?.password_hash ?? HASH_FALSO);

  // RNF-13: mismo mensaje si falla el correo o la contraseña
  if (!usuario || !coincide) {
    return res.status(401).json({ errores: ['Correo o contraseña incorrectos'] });
  }

  res.json({ token: firmarToken(usuario), usuario: publico(usuario) });
}));

/** GET /api/auth/me — RF-17 */
router.get('/me', requireAuth, h(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM usuarios WHERE id = $1', [req.usuario.id]);
  if (!rows[0]) return res.status(401).json({ errores: ['La cuenta ya no existe'] });
  res.json(publico(rows[0]));
}));

export default router;
