import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { normalizarUsername } from '../validators/auth.js';

const router = Router();
const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);

/**
 * GET /api/usuarios/buscar?username=juan — RF-19
 * RN-17: solo coincidencia EXACTA, devuelve un único usuario o 404.
 * No existe ningún endpoint que liste usuarios.
 */
router.get('/buscar', requireAuth, h(async (req, res) => {
  const username = normalizarUsername(req.query.username);
  if (!username) return res.status(400).json({ errores: ['Indica un username'] });

  if (username === req.usuario.username) {
    return res.status(400).json({ errores: ['No puedes vincular una deuda contigo mismo'] }); // RN-13
  }

  const { rows } = await pool.query(
    'SELECT id, nombre, username FROM usuarios WHERE username = $1',
    [username]
  );
  if (!rows[0]) return res.status(404).json({ errores: ['No existe un usuario con ese nombre'] });
  res.json(rows[0]);
}));

export default router;
