CREATE TABLE sessions (
  collector_id TEXT NOT NULL,
  agent TEXT NOT NULL CHECK (length(trim(agent)) > 0),
  source_id TEXT NOT NULL CHECK (length(source_id) > 0),
  title TEXT NOT NULL,
  directory TEXT NOT NULL,
  source_created_at INTEGER NOT NULL,
  source_updated_at INTEGER NOT NULL,
  source_archived_at INTEGER,
  deleted_at INTEGER,
  first_seen_at INTEGER NOT NULL,
  last_synced_at INTEGER NOT NULL,
  last_reconcile_id TEXT,
  PRIMARY KEY (collector_id, agent, source_id),
  FOREIGN KEY (collector_id) REFERENCES collectors (id) ON DELETE CASCADE
) STRICT;

CREATE INDEX sessions_list_order
  ON sessions (source_updated_at DESC, collector_id ASC, agent ASC, source_id ASC);

CREATE INDEX sessions_scope_list_order
  ON sessions (
    collector_id ASC,
    agent ASC,
    source_updated_at DESC,
    source_id ASC
  );

CREATE INDEX sessions_collector_list_order
  ON sessions (
    collector_id ASC,
    source_updated_at DESC,
    agent ASC,
    source_id ASC
  );

CREATE INDEX sessions_agent_list_order
  ON sessions (
    agent ASC,
    source_updated_at DESC,
    collector_id ASC,
    source_id ASC
  );

CREATE TABLE session_sync_states (
  collector_id TEXT NOT NULL,
  agent TEXT NOT NULL CHECK (length(trim(agent)) > 0),
  checkpoint_format TEXT,
  checkpoint TEXT,
  active_run_id TEXT,
  active_mode TEXT CHECK (active_mode IN ('incremental', 'reconcile')),
  next_sequence INTEGER NOT NULL DEFAULT 0 CHECK (next_sequence >= 0),
  started_at INTEGER,
  last_synced_at INTEGER,
  last_reconciled_at INTEGER,
  PRIMARY KEY (collector_id, agent),
  FOREIGN KEY (collector_id) REFERENCES collectors (id) ON DELETE CASCADE,
  CHECK (
    (checkpoint_format IS NULL AND checkpoint IS NULL) OR
    (checkpoint_format IS NOT NULL AND checkpoint IS NOT NULL)
  ),
  CHECK (
    (active_run_id IS NULL AND active_mode IS NULL AND started_at IS NULL) OR
    (active_run_id IS NOT NULL AND active_mode IS NOT NULL AND started_at IS NOT NULL)
  )
) STRICT;

CREATE TABLE session_sync_batches (
  collector_id TEXT NOT NULL,
  agent TEXT NOT NULL,
  run_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  upserted_count INTEGER NOT NULL CHECK (upserted_count >= 0),
  deleted_count INTEGER NOT NULL CHECK (deleted_count >= 0),
  complete INTEGER NOT NULL CHECK (complete IN (0, 1)),
  committed_at INTEGER NOT NULL,
  PRIMARY KEY (collector_id, agent, run_id, sequence),
  FOREIGN KEY (collector_id, agent)
    REFERENCES session_sync_states (collector_id, agent) ON DELETE CASCADE
) STRICT;
