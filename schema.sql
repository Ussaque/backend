-- ============================================================
-- Yango Services — Schema PostgreSQL (Supabase)
-- Colar no Supabase: SQL Editor → New query → Run
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id                   VARCHAR(36)  PRIMARY KEY,
  name                 VARCHAR(255) NOT NULL,
  email                VARCHAR(255) NOT NULL UNIQUE,
  password             VARCHAR(255),
  role                 VARCHAR(20)  NOT NULL DEFAULT 'CLIENT'
                         CHECK (role IN ('CLIENT', 'PROFESSIONAL', 'ADMIN')),
  approval_status      VARCHAR(20)  DEFAULT 'APPROVED'
                         CHECK (approval_status IN ('PENDING_DOCS', 'PENDING_REVIEW', 'APPROVED', 'REJECTED')),
  avatar_url           VARCHAR(500),
  bio                  TEXT,
  rating               DECIMAL(3,2) DEFAULT 0,
  rating_count         INT          DEFAULT 0,
  specialty            VARCHAR(255),
  experience_years     INT          DEFAULT 0,
  province             VARCHAR(100),
  bairro               VARCHAR(100),
  current_lat          DECIMAL(10,8),
  current_lng          DECIMAL(11,8),
  location_updated_at  TIMESTAMP,
  verified_skills      TEXT,
  institution          VARCHAR(255),
  course_name          VARCHAR(255),
  graduation_year      INT,
  is_student           BOOLEAN      DEFAULT FALSE,
  cert_pdf_url         VARCHAR(500),
  recommendation_count INT          DEFAULT 0,
  rejection_reason     TEXT,
  bi                   VARCHAR(20),
  telefone             VARCHAR(20),
  bi_front_url         VARCHAR(500),
  bi_back_url          VARCHAR(500),
  date_of_birth        DATE,
  gender               VARCHAR(1)   CHECK (gender IN ('M', 'F')),
  created_at           TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS jobs (
  id              VARCHAR(36)  PRIMARY KEY,
  client_id       VARCHAR(36)  NOT NULL,
  professional_id VARCHAR(36),
  category        VARCHAR(100) NOT NULL,
  description     TEXT         NOT NULL,
  address         VARCHAR(500),
  latitude        DECIMAL(10,8),
  longitude       DECIMAL(11,8),
  price           DECIMAL(10,2),
  status          VARCHAR(20)  DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  scheduled_date  TIMESTAMP,
  image_url       VARCHAR(500),
  payment_method  VARCHAR(50),
  hired_at        TIMESTAMP,
  started_at      TIMESTAMP,
  completed_at    TIMESTAMP,
  created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
  id         SERIAL       PRIMARY KEY,
  job_id     VARCHAR(36)  NOT NULL,
  sender_id  VARCHAR(36)  NOT NULL,
  text       TEXT         NOT NULL,
  created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS job_applications (
  id              VARCHAR(36)  PRIMARY KEY,
  job_id          VARCHAR(36)  NOT NULL,
  professional_id VARCHAR(36)  NOT NULL,
  message         TEXT,
  proposed_price  DECIMAL(10,2),
  status          VARCHAR(20)  DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
  applied_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (job_id, professional_id)
);

CREATE TABLE IF NOT EXISTS reviews (
  id               VARCHAR(36) PRIMARY KEY,
  job_id           VARCHAR(36) NOT NULL UNIQUE,
  reviewer_id      VARCHAR(36) NOT NULL,
  professional_id  VARCHAR(36) NOT NULL,
  rating           INT         NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment          TEXT,
  before_photo_url VARCHAR(500),
  after_photo_url  VARCHAR(500),
  created_at       TIMESTAMP   DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS portfolio_photos (
  id         VARCHAR(36)  PRIMARY KEY,
  user_id    VARCHAR(36)  NOT NULL,
  photo_url  VARCHAR(500) NOT NULL,
  caption    VARCHAR(255),
  created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recommendations (
  id                   VARCHAR(36) PRIMARY KEY,
  job_id               VARCHAR(36) NOT NULL UNIQUE,
  from_client_id       VARCHAR(36) NOT NULL,
  to_professional_id   VARCHAR(36) NOT NULL,
  created_at           TIMESTAMP   DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- Categorias de Serviço (geridas pelo Admin)
-- ============================================================
CREATE TABLE IF NOT EXISTS categories (
  id            SERIAL       PRIMARY KEY,
  name          VARCHAR(100) NOT NULL UNIQUE,
  icon          VARCHAR(10)  DEFAULT '🔧',
  color         VARCHAR(20)  DEFAULT '#6C63FF',
  subcategories TEXT,
  active        BOOLEAN      DEFAULT TRUE,
  order_index   INT          DEFAULT 0,
  created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO categories (name, icon, color, subcategories, order_index) VALUES
  ('Limpeza',          '🧹', '#00C896', '["Limpeza Doméstica","Limpeza Profunda","Pós-Obra","Limpeza de Estofos/Tapetes","Limpeza de Vidros e Janelas","Limpeza de Cozinha","Limpeza de Casas de Banho","Limpeza de Escritórios","Limpeza de Garagem","Desinfecção/Higienização","Outro"]', 1),
  ('Canalizador',      '🔧', '#4A90D9', '["Desentupimento de Esgotos","Ruptura de Canos","Fuga de Água","Instalação de Loiças","Instalação de Chuveiro/Banheira","Instalação de Esquentador","Reparação de Torneiras","Instalação de Filtro de Água","Limpeza de Fossa","Outro"]', 2),
  ('Eletricista',      '⚡', '#FFA040', '["Curto-Circuito","Instalação de Tomadas/Fichas","Quadro Elétrico","Iluminação Interior","Iluminação Exterior","Instalação de Ventilador de Tecto","Instalação de Câmeras CCTV","Instalação de Portão Eléctrico","Instalação de Painéis Solares","Instalação de Gerador","Reparação de Electrodomésticos","Outro"]', 3),
  ('Mudanças',         '📦', '#8B5CF6', '["Mudança Local","Mudança Interprovincial","Transporte de Carga Pesada","Montagem de Móveis","Desmontagem de Móveis","Embalagem e Desembalagem","Transporte de Electrodomésticos","Armazenamento Temporário","Outro"]', 4),
  ('Personal Trainer', '💪', '#FF5C8D', '["Perda de Peso","Musculação/Hipertrofia","Yoga","Pilates","Crossfit","Cardio/Corrida","Artes Marciais","Treino em Casa","Treino Pós-Natal","Nutrição e Dieta","Reabilitação Física","Outro"]', 5),
  ('Climatização',     '❄️', '#06B6D4', '["Instalação de AC Split","Instalação de AC Central","Manutenção/Limpeza de AC","Recarga de Gás Refrigerante","Reparação de AC","Câmaras de Frio Industrial","Instalação de Ventilação","Instalação de Ventoinha de Tecto","Outro"]', 6),
  ('Jardinagem',       '🌿', '#22C55E', '["Corte de Relva","Poda de Árvores","Poda de Sebes","Paisagismo","Plantação de Flores/Plantas","Sistema de Irrigação/Rega","Controlo de Pragas","Limpeza de Quintal","Tratamento de Plantas","Remoção de Entulho Verde","Outro"]', 7),
  ('Beleza',           '💅', '#EC4899', '["Manicure","Pedicure","Cabelo & Tranças","Maquilhagem","Epilação","Massagem Relaxante","Design de Sobrancelhas","Extensões de Cílios","Corte de Cabelo ao Domicílio","Tratamento Capilar","Coloração de Cabelo","Outro"]', 8),
  ('Mecânica',         '🔩', '#78716C', '["Revisão Geral","Bateria/SOS","Furo de Pneus","Motor","Travões","Pneus e Alinhamento","Suspensão","Ar Condicionado Automóvel","Electricidade Automóvel","Manutenção Periódica","Pintura e Lataria","Outro"]', 9)
ON CONFLICT (name) DO UPDATE SET subcategories = EXCLUDED.subcategories;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE categories;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
