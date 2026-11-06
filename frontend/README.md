# ¿Quién me debe? — Frontend

React + Vite. Consume la API REST del backend con `fetch` y el token JWT.

## Correr en local

1. Tener el backend corriendo en `http://localhost:3000`.
2. Crear el archivo `.env` (copiando `.env.example`):
   ```
   VITE_API_URL=http://localhost:3000
   ```
3. Instalar y arrancar:
   ```bash
   npm install
   npm run dev
   ```
4. Abrir `http://localhost:5173`.

## Estructura

```
src/
├── main.jsx              # Punto de entrada (fuentes + estilos)
├── App.jsx               # Navegación, modales, acciones y mensajes
├── api.js                # fetch con token, errores y aviso de "servidor despertando"
├── auth.jsx              # Sesión: login, registro, token en localStorage
├── utils.js              # Pesos colombianos, fechas e interés (vista previa)
├── styles.css            # Estilos (oscuro + lima/morado, responsivo)
├── components/
│   ├── DeudaCard.jsx     # Tarjeta de deuda (botones según permisos del backend)
│   ├── DeudaForm.jsx     # Crear / editar deuda, con vista previa del interés
│   ├── PagarForm.jsx     # Registrar un pago: todo el saldo o un abono parcial
│   ├── ApuestaCard.jsx   # Tarjeta de apuesta (botones según permisos del backend)
│   ├── ApuestaForm.jsx   # Crear apuesta con oponente y juez registrados
│   ├── DecidirForm.jsx   # El juez declara al ganador o anula
│   ├── UI.jsx            # Modal, cargando, errores, toasts, aviso de Render
│   └── Doodles.jsx       # Garabatos SVG decorativos
└── pages/
    ├── Login.jsx         # Ingresar / crear cuenta
    ├── Inicio.jsx        # Balance neto, totales y balance por persona
    ├── Deudas.jsx        # Lista con filtros y búsqueda
    ├── Solicitudes.jsx   # Deudas que otros me vincularon
    └── Apuestas.jsx      # Apuestas entre dos usuarios con un tercero de juez
```

## Requisitos del taller cubiertos

- **Formulario con validación de campos vacíos** (se valida en el cliente y el backend vuelve a validar).
- **Indicación visual de las completadas**: las deudas pagadas salen tachadas con un sello "PAGADA".
- **Acciones**: crear, editar, registrar pagos y abonos, reabrir, eliminar, aceptar y rechazar.
- **Mensajes de carga y de error**: si una petición tarda más de 2,5 s aparece el aviso
  *"Despertando el servidor…"* (el plan gratis de Render se duerme tras 15 min sin uso).
- **Diseño responsivo**: menú superior en computador y barra inferior en celular.

## Despliegue en Render (Static Site)

| Parámetro | Valor |
|---|---|
| Root Directory | `frontend` |
| Build Command | `npm install && npm run build` |
| Publish Directory | `dist` |
| Variable de entorno | `VITE_API_URL` = URL del backend, **sin `/` al final** |

> Vite incrusta `VITE_API_URL` al compilar. Si la cambias, haz **Manual Deploy → Deploy latest commit**.
