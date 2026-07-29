CREATE TABLE query_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  query_hash text NOT NULL,
  intent text NOT NULL,
  strategy text NOT NULL,
  plan_json jsonb NOT NULL,
  estimated_rows integer NOT NULL DEFAULT 0,
  actual_rows integer NOT NULL DEFAULT 0,
  planning_ms real NOT NULL DEFAULT 0,
  execution_ms real NOT NULL DEFAULT 0,
  fallback_used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX query_executions_workspace_created_idx ON query_executions(workspace_id, created_at);
CREATE INDEX query_executions_query_hash_idx ON query_executions(query_hash);
