import jwt from 'jsonwebtoken';

const EXPIRACION = '7d'; // RNF-10

export function firmarToken(usuario) {
  return jwt.sign(
    { sub: usuario.id, username: usuario.username },
    process.env.JWT_SECRET,
    { expiresIn: EXPIRACION }
  );
}

/**
 * Middleware que protege rutas (RNF-11).
 * Lee "Authorization: Bearer <token>", lo verifica y deja el usuario en req.usuario.
 * Si falta o es inválido responde 401.
 */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [esquema, token] = header.split(' ');

  if (esquema !== 'Bearer' || !token) {
    return res.status(401).json({ errores: ['Debes iniciar sesión'] });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.usuario = { id: payload.sub, username: payload.username };
    next();
  } catch (err) {
    const mensaje = err.name === 'TokenExpiredError'
      ? 'Tu sesión expiró, inicia sesión de nuevo'
      : 'Sesión inválida';
    return res.status(401).json({ errores: [mensaje] });
  }
}
