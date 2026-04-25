CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID,
  name TEXT NOT NULL,
  webhook_url TEXT NOT NULL,
  webhook_method TEXT NOT NULL DEFAULT 'POST',
  webhook_auth_token TEXT,
  webhook_message_field TEXT NOT NULL DEFAULT 'message',
  webhook_session_field TEXT NOT NULL DEFAULT 'sessionId',
  webhook_metadata_field TEXT NOT NULL DEFAULT 'metadata',
  response_message_field TEXT NOT NULL DEFAULT 'reply',
  webhook_request_json TEXT,
  client_context TEXT NOT NULL,
  test_instructions TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  goal TEXT NOT NULL,
  success_criteria TEXT NOT NULL,
  max_messages_default INTEGER NOT NULL DEFAULT 8 CHECK (max_messages_default > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS test_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scenario_id UUID NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  max_messages INTEGER NOT NULL CHECK (max_messages > 0),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  average_score NUMERIC(5,2),
  passed BOOLEAN,
  error_count INTEGER NOT NULL DEFAULT 0,
  advice_count INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  failure_reason TEXT,
  evaluation_brief TEXT,
  qa_insight TEXT,
  kpi_snapshot JSONB,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS run_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  tester_message TEXT NOT NULL,
  agent_reply TEXT NOT NULL DEFAULT '',
  response_ms INTEGER,
  score INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  passed BOOLEAN NOT NULL DEFAULT FALSE,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  advice JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_client_id ON projects(client_id);
CREATE INDEX IF NOT EXISTS idx_scenarios_project_id ON scenarios(project_id);
CREATE INDEX IF NOT EXISTS idx_test_runs_project_id ON test_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_test_runs_scenario_id ON test_runs(scenario_id);
CREATE INDEX IF NOT EXISTS idx_run_messages_run_id ON run_messages(run_id);

-- Panel web: registro / login (misma API que escucha en PORT, p. ej. 8000)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  full_name TEXT,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Panel: clientes por usuario (GET /api/clients)
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  contact_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clients_owner_id ON clients(owner_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'projects_client_id_fkey'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_client_id_fkey
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;
  END IF;
END $$;
