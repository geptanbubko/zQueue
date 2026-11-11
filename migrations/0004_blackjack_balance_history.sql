ALTER TABLE blackjack_wallets ADD COLUMN tracked_since INTEGER NOT NULL DEFAULT 0;
UPDATE blackjack_wallets SET tracked_since = unixepoch() * 1000;

CREATE TABLE blackjack_balance_activity (
  player TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  delta INTEGER NOT NULL
);

CREATE INDEX blackjack_balance_activity_time ON blackjack_balance_activity (occurred_at);
