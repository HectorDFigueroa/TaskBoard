# ¿Quién me debe? — Backend (API REST)

Node.js + Express + PostgreSQL. Autenticación con JWT y contraseñas con bcrypt.

## Estructura

```
backend/
├── db/schema.sql            # Tablas usuarios, deudas y apuestas (se ejecuta al arrancar)
├── src/
│   ├── index.js             # Arranque: valida variables, crea tablas, levanta el servidor
│   ├── app.js               # Express: CORS, JSON, rutas, manejo de errores
│   ├── db.js                # Conexión a PostgreSQL
│   ├── middleware/auth.js   # Firma y verificación del token JWT
│   ├── validators/          # Validación de entrada (auth, deudas y apuestas)
│   ├── services/            # Vista desde cada usuario, permisos y formato de respuesta
│   ├── utils/               # Fechas (hora Colombia) e intereses
│   └── routes/              # auth, usuarios, deudas, apuestas
└── test/api.test.js         # Pruebas de punta a punta
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
| PATCH | `/api/deudas/:id/pagar` | Pagar todo el saldo. Opcional `{ fecha_pago }` |
| POST | `/api/deudas/:id/pagos` | Abono parcial: `{ monto, fecha }` (`fecha` es opcional) |
| DELETE | `/api/deudas/:id/pagos/:pagoId` | Deshacer el último abono |
| PATCH | `/api/deudas/:id/reabrir` | Deshacer el pago que saldó la deuda (conserva los abonos anteriores) |
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
`interes_acumulado`, `total_a_hoy`, `pagos`, `abonado`, `dias_transcurridos`, `vencida` y `permisos`
(`editar`, `eliminar`, `pagar`, `deshacer_abono`, `reabrir`, `responder`), para que el frontend sepa qué botones mostrar.

**Pagos parciales:**
- `total_a_hoy` es el saldo que falta. `interes_acumulado` es todo el interés generado, incluido el ya pagado.
- Cada abono cubre primero el interés acumulado y luego el capital; desde ahí, el interés corre sobre lo que quedó.
- Un abono no puede superar el saldo. Si lo cubre exacto, la deuda queda pagada.
- Los pagos van en orden: la fecha no puede ser anterior a la del último abono.
- Con abonos, de la deuda solo se puede editar el concepto.
- Solo quien prestó el dinero registra o deshace pagos.

### Apuestas

Son siempre entre **usuarios registrados**: dos apostadores y un juez, tres personas distintas.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/apuestas` | Apuestas en las que participo (como apostador o juez) |
| GET | `/api/apuestas/:id` | Detalle |
| POST | `/api/apuestas` | Crear (ver cuerpo abajo) |
| DELETE | `/api/apuestas/:id` | Eliminar (el creador, si está pendiente o rechazada) |
| PATCH | `/api/apuestas/:id/aceptar` | Aceptar la invitación (oponente o juez) |
| PATCH | `/api/apuestas/:id/rechazar` | Rechazar la invitación (oponente o juez) |
| PATCH | `/api/apuestas/:id/decidir` | Declarar ganador (el juez): `{ "ganador": "@usuario" }` |
| PATCH | `/api/apuestas/:id/anular` | Anular por empate o porque no se pudo definir (el juez) |
| PATCH | `/api/apuestas/:id/revision/pedir` | Pedir cambiar la decisión (un apostador) |
| PATCH | `/api/apuestas/:id/revision/aceptar` | Aceptar el cambio (el otro apostador) |
| PATCH | `/api/apuestas/:id/revision/rechazar` | Rechazar el cambio, o retirar la solicitud propia |

**Cuerpo para crear una apuesta (todos los campos son obligatorios):**
```json
{
  "titulo": "Quién gana el clásico",
  "postura_creador": "Gana Nacional",
  "postura_oponente": "Gana Millonarios",
  "monto": 20000,
  "oponente": "@juan",
  "juez": "@ana"
}
```

**Estados:** `pendiente` (falta que acepten) → `activa` (aceptaron oponente y juez) → `resuelta` o `anulada`.
Si un invitado rechaza, queda `rechazada`.

- Los términos no se editan. Para cambiarlos, el creador elimina la apuesta y crea otra.
- Una apuesta activa no la puede eliminar nadie: solo el juez puede cerrarla.
- La decisión del juez crea una deuda ya aceptada del perdedor al ganador, que entra al balance de ambos.
  Se paga como cualquier deuda, también con abonos: el ganador registra los pagos, y los tres ven el estado.
- La decisión solo cambia si **los dos apostadores están de acuerdo**: uno lo pide y el otro acepta. Entonces
  se borra la deuda, la apuesta vuelve a estar activa y el juez decide de nuevo.
- No se puede cambiar si hay pagos registrados: el ganador debe deshacerlos primero.

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
