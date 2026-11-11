ALTER TABLE blackjack_tables ADD COLUMN write_id TEXT;

CREATE TABLE blackjack_wallets (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL,
  state TEXT NOT NULL
);

INSERT INTO blackjack_wallets (id, revision, state) VALUES (1, 0, '{}');

CREATE TABLE blackjack_results (
  round_id TEXT NOT NULL,
  player TEXT NOT NULL,
  settled_at INTEGER NOT NULL,
  won INTEGER NOT NULL CHECK (won >= 0),
  lost INTEGER NOT NULL CHECK (lost >= 0),
  PRIMARY KEY (round_id, player)
);

CREATE INDEX blackjack_results_time ON blackjack_results(settled_at);
