CREATE TABLE collectors (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 128),
  connection_type TEXT NOT NULL CHECK (connection_type IN ('local', 'remote')),
  token TEXT,
  hostname TEXT,
  version TEXT,
  agents TEXT CHECK (
    agents IS NULL OR
    (json_valid(agents) AND json_type(agents) = 'array')
  ),
  connected_at INTEGER,
  last_seen_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (
    (connection_type = 'local' AND
     token IS NULL) OR
    (connection_type = 'remote' AND
     token IS NOT NULL)
  )
) STRICT;

CREATE UNIQUE INDEX collectors_one_local
  ON collectors (connection_type)
  WHERE connection_type = 'local';

CREATE UNIQUE INDEX collectors_unique_token
  ON collectors (token)
  WHERE token IS NOT NULL;

INSERT INTO collectors (
  id,
  name,
  connection_type,
  created_at,
  updated_at
)
SELECT 'local', 'Server Local', 'local',
  CAST(json_extract(value, '$') AS INTEGER),
  CAST(json_extract(value, '$') AS INTEGER)
FROM settings
WHERE key = 'app.initialized_at';
