CREATE TABLE projects (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(name)) BETWEEN 1 AND 128),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX projects_unique_name ON projects (name);

CREATE TABLE project_directories (
  project_id TEXT NOT NULL,
  collector_id TEXT NOT NULL,
  directory TEXT NOT NULL CHECK (length(directory) BETWEEN 1 AND 8192),
  PRIMARY KEY (project_id, collector_id, directory),
  UNIQUE (collector_id, directory),
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  FOREIGN KEY (collector_id) REFERENCES collectors (id) ON DELETE CASCADE
) STRICT;

CREATE INDEX project_directories_project
  ON project_directories (project_id, collector_id, directory);
