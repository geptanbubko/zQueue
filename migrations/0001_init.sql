-- Комната хранит снимок состояния, вычисленный из журнала событий.
-- Снимок обновляется только вместе с добавлением события (в одной транзакции).
CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  seq INTEGER NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Ключи доступа. В базе лежит только SHA-256 от ключа.
CREATE TABLE members (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE INDEX members_room ON members(room_id);

-- Журнал событий: только добавление, номера идут подряд.
CREATE TABLE events (
  room_id TEXT NOT NULL REFERENCES rooms(id),
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  actor_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (room_id, seq)
);

CREATE TRIGGER events_no_update BEFORE UPDATE ON events
BEGIN
  SELECT RAISE(ABORT, 'events are append-only');
END;

CREATE TRIGGER events_no_delete BEFORE DELETE ON events
BEGIN
  SELECT RAISE(ABORT, 'events are append-only');
END;

CREATE TRIGGER events_contiguous BEFORE INSERT ON events
WHEN NEW.seq <> (SELECT COALESCE(MAX(seq), 0) + 1 FROM events WHERE room_id = NEW.room_id)
BEGIN
  SELECT RAISE(ABORT, 'events seq gap');
END;

CREATE TRIGGER members_no_delete BEFORE DELETE ON members
BEGIN
  SELECT RAISE(ABORT, 'members are append-only');
END;
