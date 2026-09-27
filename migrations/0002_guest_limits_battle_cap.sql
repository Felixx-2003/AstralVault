ALTER TABLE players ADD COLUMN battle_reward_day TEXT;
ALTER TABLE players ADD COLUMN battle_reward_credits INTEGER NOT NULL DEFAULT 0 CHECK (battle_reward_credits >= 0);

CREATE TABLE IF NOT EXISTS guest_bootstrap_limits (
  ip_hash TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  requests INTEGER NOT NULL CHECK (requests >= 0),
  PRIMARY KEY (ip_hash, window_start)
);

CREATE INDEX IF NOT EXISTS guest_bootstrap_limits_window ON guest_bootstrap_limits(window_start);
