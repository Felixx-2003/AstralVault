CREATE TABLE IF NOT EXISTS players (
  player_id TEXT PRIMARY KEY,
  soft_balance INTEGER NOT NULL DEFAULT 0 CHECK (soft_balance >= 0),
  paid_balance INTEGER NOT NULL DEFAULT 0 CHECK (paid_balance >= 0),
  shards INTEGER NOT NULL DEFAULT 0 CHECK (shards >= 0),
  free_pulls INTEGER NOT NULL DEFAULT 3 CHECK (free_pulls >= 0),
  pity5 INTEGER NOT NULL DEFAULT 0 CHECK (pity5 >= 0 AND pity5 < 50),
  pity4 INTEGER NOT NULL DEFAULT 0 CHECK (pity4 >= 0 AND pity4 < 10),
  total_pulls INTEGER NOT NULL DEFAULT 0 CHECK (total_pulls >= 0),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  last_daily TEXT,
  battle_wins INTEGER NOT NULL DEFAULT 0 CHECK (battle_wins >= 0),
  last_battle_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS collection (
  player_id TEXT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
  hero_id TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1 AND level <= 10),
  roll_attack INTEGER NOT NULL,
  roll_hp INTEGER NOT NULL,
  roll_defense INTEGER NOT NULL,
  acquired_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, hero_id)
);

CREATE TABLE IF NOT EXISTS player_team (
  player_id TEXT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
  slot INTEGER NOT NULL CHECK (slot >= 0 AND slot < 4),
  hero_id TEXT NOT NULL,
  PRIMARY KEY (player_id, slot),
  UNIQUE (player_id, hero_id)
);

CREATE TABLE IF NOT EXISTS action_receipts (
  player_id TEXT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  action TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  action_id TEXT NOT NULL UNIQUE,
  response_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS action_receipts_created_at ON action_receipts(created_at);
