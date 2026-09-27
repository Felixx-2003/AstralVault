CREATE TABLE IF NOT EXISTS checkout_orders (
  order_id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
  bundle_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL CHECK (currency = 'usd'),
  paid_credits INTEGER NOT NULL CHECK (paid_credits > 0),
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'expired')),
  stripe_session_id TEXT UNIQUE,
  checkout_url TEXT,
  created_at INTEGER NOT NULL,
  paid_at INTEGER,
  UNIQUE (player_id, request_id)
);

CREATE INDEX IF NOT EXISTS checkout_orders_player_status ON checkout_orders(player_id, status);

CREATE TABLE IF NOT EXISTS stripe_events (
  event_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES checkout_orders(order_id),
  session_id TEXT NOT NULL,
  received_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS paid_credit_ledger (
  order_id TEXT PRIMARY KEY REFERENCES checkout_orders(order_id),
  event_id TEXT NOT NULL UNIQUE REFERENCES stripe_events(event_id),
  player_id TEXT NOT NULL REFERENCES players(player_id),
  credits INTEGER NOT NULL CHECK (credits > 0),
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS paid_credit_ledger_player ON paid_credit_ledger(player_id, created_at);
