ALTER TABLE advisories ADD COLUMN provider TEXT NOT NULL DEFAULT 'deterministic-fallback';
ALTER TABLE advisories ADD COLUMN model TEXT;
ALTER TABLE advisories ADD COLUMN fallback_used INTEGER NOT NULL DEFAULT 1;
ALTER TABLE advisories ADD COLUMN fallback_reason TEXT;
ALTER TABLE advisories ADD COLUMN analysis_json TEXT NOT NULL DEFAULT '{}';
