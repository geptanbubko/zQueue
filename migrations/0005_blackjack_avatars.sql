CREATE TABLE blackjack_avatars (
  player TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  png BLOB NOT NULL CHECK (length(png) <= 98304)
) STRICT;
