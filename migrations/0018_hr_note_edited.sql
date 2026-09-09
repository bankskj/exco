-- Track edits to file entries: NULL = never edited, otherwise the last edit time.
ALTER TABLE hr_notes ADD COLUMN updated_at TEXT;
UPDATE app_meta SET value = '18' WHERE key = 'schema_version';
