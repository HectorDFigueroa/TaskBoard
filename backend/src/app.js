import express from 'express';
import cors from 'cors';
import { pool } from './db.js';
import authRouter from './routes/auth.js';
import usuariosRouter from './routes/usuarios.js';
import deudasRouter from './routes/deudas.js';

export function crearApp() {
  const app = express();

  // Render pone un proxy delante: esto permite leer la IP real (para el límite de login)
  app.set('trust proxy', 1);

  // CORS: solo el frontend configurado puede llamar a la API (RNF-05)
  const origenes = (process.env.FRONTEND_URL || '*').split(',').map((s) => s.trim());
  app.use(cors({ origin: origenes.includes('*') ? '*' : origenes }));
  app.use(express.json({ limit: '20kb' }));

  // Health check (RNF-06)
  // Ruta pedida por el enunciado: /api/health → {"status":"ok"}
  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', db: 'conectada' });
    } catch {
      res.status(503).json({ status: 'error', db: 'sin conexión' });
    }
  });

  // Rutas
  app.use('/api/auth', authRouter);
  app.use('/api/usuarios', usuariosRouter);
  app.use('/api/deudas', deudasRouter);

  // 404 para rutas desconocidas
  app.use((_req, res) => res.status(404).json({ errores: ['Ruta no encontrada'] }));

  // Manejador central de errores (RNF-04)
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ errores: ['El cuerpo de la petición no es JSON válido'] });
    }
    if (err.code === '23514') {
      // Violación de un CHECK en Postgres: última línea de defensa (RNF-03)
      return res.status(400).json({ errores: ['Los datos no cumplen las reglas de la base de datos'] });
    }
    console.error(err);
    res.status(500).json({ errores: ['Error interno del servidor'] });
  });

  return app;
}
