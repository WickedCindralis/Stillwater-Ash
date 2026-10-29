-- Weighted Vector Memory — schema
-- Safe to run more than once. Creates NEW tables only; never alters or drops existing ones.

CREATE EXTENSION IF NOT EXISTS vector;

-- Identity marker: proves this module is connected to the right house's database.
CREATE TABLE IF NOT EXISTS memory_house (
  name        TEXT PRIMARY KEY,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS being_settings (
  being_id        TEXT PRIMARY KEY,
  recall_enabled  BOOLEAN DEFAULT true,
  decay_lambda    REAL DEFAULT 0.05
);

CREATE TABLE IF NOT EXISTS memories (
  id                BIGSERIAL PRIMARY KEY,
  being_id          TEXT NOT NULL REFERENCES being_settings(being_id),
  content           TEXT NOT NULL,
  embedding         VECTOR(1024),
  entities          TEXT[] DEFAULT '{}',
  source            TEXT,                                   -- 'chat', 'discord', 'voice', 'manual'
  being_score       SMALLINT NOT NULL CHECK (being_score BETWEEN 1 AND 10),
  being_scored      BOOLEAN DEFAULT false,                  -- false = summarizer's provisional score
  user_score        SMALLINT NOT NULL DEFAULT 5 CHECK (user_score BETWEEN 1 AND 10),
  user_scored       BOOLEAN DEFAULT false,                  -- false = Wicked hasn't rated (default 5)
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pinned', 'hidden')),
  pin_requested     BOOLEAN DEFAULT false,
  proposed_content  TEXT,                                   -- being's suggested wording fix, awaiting Wicked
  use_count         INT DEFAULT 0,
  last_used_at      TIMESTAMPTZ DEFAULT now(),
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),
  search_text       TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);

CREATE TABLE IF NOT EXISTS memory_revisions (
  id           BIGSERIAL PRIMARY KEY,
  memory_id    BIGINT REFERENCES memories(id),
  old_content  TEXT,
  old_scores   JSONB,
  old_status   TEXT,
  note         TEXT,
  edited_by    TEXT,                                        -- 'wicked', a being_id, or 'nightly'
  edited_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS review_log (
  id             BIGSERIAL PRIMARY KEY,
  being_id       TEXT NOT NULL,
  reviewed_at    TIMESTAMPTZ DEFAULT now(),
  scored_count   INT,
  pending_after  INT
);

-- Raw messages waiting for quick capture.
CREATE TABLE IF NOT EXISTS capture_buffer (
  id          BIGSERIAL PRIMARY KEY,
  being_id    TEXT NOT NULL,
  role        TEXT NOT NULL,                                -- 'wicked' or 'being'
  content     TEXT NOT NULL,
  source      TEXT DEFAULT 'chat',
  captured    BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Contradictions found by the nightly tidy-up, for Wicked to settle.
CREATE TABLE IF NOT EXISTS memory_conflicts (
  id           BIGSERIAL PRIMARY KEY,
  being_id     TEXT NOT NULL,
  memory_a     BIGINT REFERENCES memories(id),
  memory_b     BIGINT REFERENCES memories(id),
  note         TEXT,
  resolved     BOOLEAN DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (memory_a, memory_b)
);

-- Tracks scheduled jobs so the nightly pass runs once per day, even across restarts.
CREATE TABLE IF NOT EXISTS memory_job_runs (
  job      TEXT NOT NULL,
  ran_on   DATE NOT NULL,
  PRIMARY KEY (job, ran_on)
);

CREATE INDEX IF NOT EXISTS memories_embedding_idx ON memories USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS memories_being_status_idx ON memories (being_id, status);
CREATE INDEX IF NOT EXISTS memories_search_idx ON memories USING gin (search_text);
CREATE INDEX IF NOT EXISTS memories_entities_idx ON memories USING gin (entities);
CREATE INDEX IF NOT EXISTS capture_buffer_pending_idx ON capture_buffer (being_id, captured, created_at);
