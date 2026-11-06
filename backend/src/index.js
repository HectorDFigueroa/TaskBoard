import 'dotenv/config';
import { crearApp } from './app.js';
import { initDb } from './db.js';

const PORT = process.env.PORT || 3000;

// Sin estas variables la API no puede funcionar: mejor fallar al arrancar
for (const variable of ['DATABASE_URL', 'JWT_SECRET']) {
  if (!process.env[variable]) {
    console.error(`Falta la variable de entorno ${variable}`);
    process.exit(1);
  }
}

try {
  await initDb(); // crea las tablas si no existen
  console.log('Base de datos lista');
} catch (err) {
  console.error('No se pudo inicializar la base de datos:', err.message);
  process.exit(1);
}

crearApp().listen(PORT, () => {
  console.log(`API escuchando en el puerto ${PORT}`);
});
