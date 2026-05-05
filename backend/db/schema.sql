-- Schema database PostgreSQL per Progetto Cloud AWS
-- Tabella utenti per autenticazione
CREATE TABLE IF NOT EXISTS users (
    id           SERIAL PRIMARY KEY,
    username     VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role         VARCHAR(20) NOT NULL DEFAULT 'operator',
    full_name    VARCHAR(100),
    created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Tabella segnalazioni di emergenza
CREATE TABLE IF NOT EXISTS emergencies (
    id           SERIAL PRIMARY KEY,
    type         VARCHAR(50) NOT NULL,
    description  TEXT,
    latitude     NUMERIC(10, 7),
    longitude    NUMERIC(10, 7),
    status       VARCHAR(20) NOT NULL DEFAULT 'aperta',
    priority     VARCHAR(20) DEFAULT 'media',
    created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_by_name VARCHAR(100),
    assigned_to  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    notes        TEXT,
    created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMP NOT NULL DEFAULT NOW(),
    closed_at    TIMESTAMP,
    CONSTRAINT chk_status CHECK (status IN ('aperta', 'in_carico', 'annullata', 'chiusa')),
    CONSTRAINT chk_priority CHECK (priority IN ('bassa', 'media', 'alta', 'critica'))
);

-- Indici per performance
CREATE INDEX IF NOT EXISTS idx_emergencies_status   ON emergencies(status);
CREATE INDEX IF NOT EXISTS idx_emergencies_created  ON emergencies(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_emergencies_type     ON emergencies(type);

-- Trigger per aggiornare updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    -- Se passa a stato chiusa, registra timestamp chiusura
    IF NEW.status = 'chiusa' AND (OLD.status IS NULL OR OLD.status <> 'chiusa') THEN
        NEW.closed_at = NOW();
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_emergencies_updated_at ON emergencies;
CREATE TRIGGER update_emergencies_updated_at
    BEFORE UPDATE ON emergencies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
