-- ¿Quién me debe? — esquema de base de datos
-- Se ejecuta automáticamente al iniciar el backend (es idempotente).

-- ============================================================
-- USUARIOS
-- ============================================================
CREATE TABLE IF NOT EXISTS usuarios (
  id             SERIAL PRIMARY KEY,
  nombre         VARCHAR(80)  NOT NULL CHECK (char_length(trim(nombre)) >= 2),
  username       VARCHAR(20)  NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_]{3,20}$'),  -- RN-12
  email          VARCHAR(254) NOT NULL UNIQUE CHECK (email = lower(email)),           -- RN-08
  password_hash  VARCHAR(100) NOT NULL,                                                -- RNF-09 (bcrypt)
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- DEUDAS
-- ============================================================
CREATE TABLE IF NOT EXISTS deudas (
  id              SERIAL PRIMARY KEY,

  -- Dueño/creador de la deuda (RN-10)
  usuario_id      INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,

  -- Dirección desde el punto de vista del creador
  tipo            VARCHAR(10) NOT NULL CHECK (tipo IN ('me_deben', 'debo')),

  -- Nombre libre de la otra persona (siempre se llena; si está vinculada,
  -- se guarda el nombre del usuario vinculado)
  persona         VARCHAR(80) NOT NULL CHECK (char_length(trim(persona)) >= 2),

  -- Vinculación opcional con otro usuario registrado (RF-20)
  contraparte_id  INT REFERENCES usuarios(id),
  estado_vinculo  VARCHAR(10) NOT NULL DEFAULT 'ninguno'
                  CHECK (estado_vinculo IN ('ninguno', 'pendiente', 'aceptada', 'rechazada')),

  concepto        VARCHAR(150),
  monto           NUMERIC(12, 2) NOT NULL CHECK (monto > 0),                  -- RN-01

  -- Interés (RF-09). tasa_interes = % mensual, ej. 5.0000 = 5 %
  tipo_interes    VARCHAR(10)   NOT NULL DEFAULT 'ninguno'
                  CHECK (tipo_interes IN ('ninguno', 'simple', 'compuesto')),
  tasa_interes    NUMERIC(7, 4) NOT NULL DEFAULT 0 CHECK (tasa_interes >= 0),

  fecha           DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'America/Bogota')::date,  -- RNF-08
  fecha_limite    DATE,                                                        -- RF-11

  -- Pago (RF-06): monto_pagado congela capital + interés al momento de pagar
  pagada          BOOLEAN NOT NULL DEFAULT FALSE,
  fecha_pago      DATE,
  monto_pagado    NUMERIC(14, 2),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- RN-06: sin interés => tasa 0; con interés => tasa > 0
  CONSTRAINT interes_coherente CHECK (
    (tipo_interes = 'ninguno' AND tasa_interes = 0) OR
    (tipo_interes <> 'ninguno' AND tasa_interes > 0)
  ),
  -- Pagada <=> tiene fecha y monto de pago
  CONSTRAINT pago_coherente CHECK (
    (pagada = TRUE  AND fecha_pago IS NOT NULL AND monto_pagado IS NOT NULL) OR
    (pagada = FALSE AND fecha_pago IS NULL     AND monto_pagado IS NULL)
  ),
  -- RN-03: las fechas posteriores no pueden ser antes de la deuda
  CONSTRAINT fecha_limite_valida CHECK (fecha_limite IS NULL OR fecha_limite >= fecha),
  CONSTRAINT fecha_pago_valida   CHECK (fecha_pago   IS NULL OR fecha_pago   >= fecha),
  -- RN-13: no puedes vincularte contigo mismo
  CONSTRAINT sin_autovinculo CHECK (contraparte_id IS NULL OR contraparte_id <> usuario_id),
  -- Con contraparte => estado distinto de 'ninguno', y viceversa
  CONSTRAINT vinculo_coherente CHECK (
    (contraparte_id IS NULL     AND estado_vinculo = 'ninguno') OR
    (contraparte_id IS NOT NULL AND estado_vinculo <> 'ninguno')
  )
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_deudas_usuario     ON deudas (usuario_id);
CREATE INDEX IF NOT EXISTS idx_deudas_contraparte ON deudas (contraparte_id) WHERE contraparte_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deudas_persona     ON deudas (usuario_id, LOWER(persona));
