CREATE TABLE IF NOT EXISTS memory_deletions (
  memory_id   BIGINT NOT NULL,
  being_id    TEXT NOT NULL,
  deleted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
