ALTER TABLE players ADD COLUMN campaign_cleared INTEGER NOT NULL DEFAULT 0 CHECK (campaign_cleared BETWEEN 0 AND 20);
ALTER TABLE players ADD COLUMN battle_reward_shards INTEGER NOT NULL DEFAULT 0 CHECK (battle_reward_shards >= 0);
ALTER TABLE players ADD COLUMN starter_team_granted INTEGER NOT NULL DEFAULT 0 CHECK (starter_team_granted IN (0, 1));

-- The old battle_wins count includes repeat encounters, so every archive begins the new story at stage one.
-- Existing cards and team choices stay intact. Missing starter cards have fixed, transparent stats.
INSERT OR IGNORE INTO collection (player_id, hero_id, level, roll_attack, roll_hp, roll_defense, acquired_at)
SELECT p.player_id, starter.hero_id, 1, 0, 0, 0, p.created_at
FROM players p CROSS JOIN (SELECT 'pax' AS hero_id UNION ALL SELECT 'eda') starter;

UPDATE players SET starter_team_granted = 1
WHERE NOT EXISTS (SELECT 1 FROM player_team t WHERE t.player_id = players.player_id);

INSERT OR IGNORE INTO player_team (player_id, slot, hero_id)
SELECT p.player_id, starter.slot, starter.hero_id
FROM players p CROSS JOIN (SELECT 0 AS slot, 'pax' AS hero_id UNION ALL SELECT 1, 'eda') starter
WHERE p.starter_team_granted = 1;

CREATE TABLE IF NOT EXISTS stage_records (
  player_id TEXT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
  stage INTEGER NOT NULL CHECK (stage BETWEEN 1 AND 20),
  best_stars INTEGER NOT NULL CHECK (best_stars BETWEEN 1 AND 3),
  best_rounds INTEGER NOT NULL CHECK (best_rounds BETWEEN 1 AND 8),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, stage)
);
