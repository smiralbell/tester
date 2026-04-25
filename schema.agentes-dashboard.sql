-- Panel agentes: índices y vista opcional para listados y agregados rápidos.
-- Ejecuta en la misma base que el microservicio (después de schema.microservice.sql).

-- Búsqueda de proyectos por agente (client_id)
CREATE INDEX IF NOT EXISTS idx_projects_client_id ON projects(client_id);

-- Ya existen en el esquema base; se repiten por si aplicaste un SQL antiguo sin ellos:
CREATE INDEX IF NOT EXISTS idx_test_runs_project_id ON test_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_run_messages_run_id ON run_messages(run_id);
CREATE INDEX IF NOT EXISTS idx_clients_owner_id ON clients(owner_id);

-- Vista de apoyo (solo lectura). El API usa SQL equivalente; puedes usar esta vista en Metabase/Grafana.
CREATE OR REPLACE VIEW v_agent_test_summary AS
SELECT
  c.id AS agent_id,
  c.owner_id,
  c.name AS agent_name,
  c.created_at AS agent_created_at,
  (
    SELECT p.id FROM projects p WHERE p.client_id = c.id ORDER BY p.created_at DESC NULLS LAST LIMIT 1
  ) AS primary_project_id,
  COALESCE(
    (SELECT array_agg(p.id ORDER BY p.created_at DESC) FROM projects p WHERE p.client_id = c.id),
    ARRAY[]::uuid[]
  ) AS project_ids,
  (
    SELECT COUNT(rm.id)
    FROM projects p
    JOIN test_runs tr ON tr.project_id = p.id
    JOIN run_messages rm ON rm.run_id = tr.id
    WHERE p.client_id = c.id
  )::bigint AS total_test_messages,
  (
    SELECT AVG(tr.average_score)
    FROM projects p
    JOIN test_runs tr ON tr.project_id = p.id
    WHERE p.client_id = c.id AND tr.status = 'completed' AND tr.average_score IS NOT NULL
  ) AS avg_score,
  (
    SELECT COUNT(tr.id)
    FROM projects p
    JOIN test_runs tr ON tr.project_id = p.id
    WHERE p.client_id = c.id
  )::bigint AS total_runs,
  (
    SELECT COUNT(tr.id)
    FROM projects p
    JOIN test_runs tr ON tr.project_id = p.id
    WHERE p.client_id = c.id AND tr.status = 'completed'
  )::bigint AS completed_runs
FROM clients c;

COMMENT ON VIEW v_agent_test_summary IS 'Métricas agregadas por agente (cliente panel) para dashboard QA.';
