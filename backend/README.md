# ¿Quién me debe? — Backend (API REST)

Node.js + Express + PostgreSQL. Autenticación con JWT y contraseñas con bcrypt.

## Estructura

```
backend/
├── db/schema.sql            # Tablas usuarios y deudas (se ejecuta al arrancar)
├── src/
│   ├── index.js             # Arranque: valida variables, crea tablas, levanta el servidor
│   ├── app.js               # Express: CORS, JSON, rutas, manejo de errores
│   ├── db.js                # Conexión a PostgreSQL
│   ├── middleware/auth.js   # Firma y verificación del token JWT
│   ├── validators/          # Validación de entrada (auth y deudas)
│   ├── services/deudas.js   # Vista desde cada usuario, permisos y formato de respuesta
│   ├── utils/               # Fechas (hora Colombia) e intereses
│   └── routes/              # auth, usuarios, deudas
└── test/api.test.js         # 19 pruebas de punta a punta
```

## Correr en local

1. Tener PostgreSQL instalado y crear la base: `CREATE DATABASE quien_me_debe;`
2. Copiar `.env.example` como `.env` y ajustar los valores.
3. Instalar y arrancar:
   ```bash
   npm install
   npm run dev
   ```
4. Probar: abrir `http://localhost:3000/api/health` → `{"status":"ok","db":"conectada"}`

### Pruebas automáticas

Usan una base de datos **aparte**, porque la borran completa:

```bash
# crear una vez:  CREATE DATABASE quien_me_debe_test;
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/quien_me_debe_test npm test
```

En Windows (PowerShell):
```powershell
$env:TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5432/quien_me_debe_test"; npm test
```

## Variables de entorno

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | URL de PostgreSQL. En Render: la **Internal Database URL** |
| `DB_SSL` | `true` solo si se conectan a Render desde su PC con la External URL |
| `JWT_SECRET` | Secreto largo y aleatorio para firmar los tokens |
| `FRONTEND_URL` | URL del frontend permitida por CORS |
| `TASA_USURA_EA` | Tasa de usura vigente (% efectivo anual). Vacía = no se valida |
| `PORT` | Puerto (Render lo pone solo) |

## Endpoints

Todas las rutas excepto `/api/health`, `register` y `login` requieren el encabezado
`Authorization: Bearer <token>`. Los errores siempre vienen como `{ "errores": ["..."] }`.

### Autenticación
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/auth/register` | `{ nombre, username, email, password }` → `{ token, usuario }` |
| POST | `/api/auth/login` | `{ email, password }` → `{ token, usuario }` (máx. 10 intentos / 15 min) |
| GET | `/api/auth/me` | Datos del usuario de la sesión |

### Usuarios
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/usuarios/buscar?username=juan` | Busca un usuario por `@usuario` exacto |

### Deudas
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/deudas` | Lista. Filtros: `tipo=me_deben\|debo`, `estado=pendiente\|pagada`, `q=texto` |
| GET | `/api/deudas/balance` | Totales y balance neto por persona (con intereses a hoy) |
| GET | `/api/deudas/solicitudes` | Deudas que otros me vincularon y debo responder |
| GET | `/api/deudas/:id` | Detalle |
| POST | `/api/deudas` | Crear (ver cuerpo abajo) |
| PUT | `/api/deudas/:id` | Editar (solo campos enviados) |
| DELETE | `/api/deudas/:id` | Eliminar |
| PATCH | `/api/deudas/:id/pagar` | Marcar pagada. Opcional `{ fecha_pago }` |
| PATCH | `/api/deudas/:id/reabrir` | Deshacer el pago |
| PATCH | `/api/deudas/:id/aceptar` | Aceptar una deuda vinculada (la contraparte) |
| PATCH | `/api/deudas/:id/rechazar` | Rechazar una deuda vinculada (la contraparte) |

**Cuerpo para crear una deuda:**
```json
{
  "tipo": "me_deben",
  "persona": "Pedro",
  "contraparte": "@juan",
  "monto": 500000,
  "concepto": "Préstamo para el carro",
  "tipo_interes": "simple",
  "tasa_interes": 1.5,
  "fecha": "2026-11-01",
  "fecha_limite": "2027-02-01"
}
```
- `tipo` y `monto` son obligatorios.
- Hay que enviar `persona` (nombre libre) **o** `contraparte` (@usuario registrado).
- `tipo_interes`: `ninguno` (por defecto), `simple` o `compuesto`. `tasa_interes` es % **mensual**.
- Para editar el interés con `PUT` hay que enviar `tipo_interes` y `tasa_interes` juntos.

**Cada deuda se devuelve desde el punto de vista de quien consulta**, con campos calculados:
`interes_acumulado`, `total_a_hoy`, `dias_transcurridos`, `vencida` y `permisos`
(`editar`, `eliminar`, `pagar`, `reabrir`, `responder`), para que el frontend sepa qué botones mostrar.

## Códigos HTTP

| Código | Cuándo |
|---|---|
| 200 / 201 / 204 | OK / creado / eliminado |
| 400 | Datos inválidos |
| 401 | Sin sesión, sesión vencida o login incorrecto |
| 403 | La deuda es visible pero no tienes permiso para esa acción |
| 404 | No existe o no es tuya |
| 409 | Conflicto con una regla de negocio (ya pagada, ya aceptada, usuario repetido…) |
| 429 | Demasiados intentos de login |
