ALTER TABLE projects ADD COLUMN group_name TEXT COLLATE NOCASE
  CHECK (
    group_name IS NULL OR length(trim(group_name)) BETWEEN 1 AND 128
  );
