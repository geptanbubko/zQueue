CREATE TABLE blackjack_tables (
  room_id TEXT PRIMARY KEY REFERENCES rooms(id),
  revision INTEGER NOT NULL,
  playing INTEGER NOT NULL CHECK (playing IN (0, 1)),
  state TEXT NOT NULL
);
