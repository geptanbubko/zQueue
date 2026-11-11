import { deadlineFor, expirePhases, playerForToken, PLAYERS, roundActive, settleRound, tableActive, tableView, type ChipResult, type Player, type Table } from "./blackjack";
import { ChipWallets, STATS_WINDOW_MS, type WalletState } from "./blackjack-chips";
import { HttpError } from "./http";

interface StateRow {
  revision: number;
  state: string;
}

type Change = (table: Table, now: number, wallets: ChipWallets) => void;

async function loadWallets(db: D1Database) {
  const row = await db.prepare("SELECT revision, state FROM blackjack_wallets WHERE id = 1").first<StateRow>();
  if (!row) throw new Error("Blackjack wallets row is missing");
  return { revision: row.revision, wallets: new ChipWallets(JSON.parse(row.state) as WalletState) };
}

async function saveTable(
  db: D1Database, roomId: string, revision: number | undefined, table: Table,
  economy: Awaited<ReturnType<typeof loadWallets>>, results: ChipResult[], now: number,
): Promise<boolean> {
  const writeId = crypto.randomUUID();
  const playing = Number(tableActive(table));
  const state = JSON.stringify(table);
  const movements = economy.wallets.movements;
  const walletRevision = economy.wallets.changed ? economy.revision : null;
  const walletMatches = "(?5 IS NULL OR (SELECT revision FROM blackjack_wallets WHERE id = 1) = ?5)";
  const save = revision === undefined
    ? db.prepare(
        `INSERT INTO blackjack_tables (room_id, revision, playing, state, write_id)
         SELECT ?4, 1, ?1, ?2, ?3 WHERE ${walletMatches}
         ON CONFLICT(room_id) DO NOTHING`,
      ).bind(playing, state, writeId, roomId, walletRevision)
    : db.prepare(
        `UPDATE blackjack_tables SET revision = revision + 1, playing = ?1, state = ?2, write_id = ?3
         WHERE room_id = ?4 AND revision = ?6 AND ${walletMatches}`,
      ).bind(playing, state, writeId, roomId, walletRevision, revision);

  // Every subsequent write is conditional on this transaction winning the table update.
  const tableWritten = "EXISTS (SELECT 1 FROM blackjack_tables WHERE room_id = ? AND write_id = ?)";
  const statements = [save];
  if (economy.wallets.changed) {
    statements.push(db.prepare(
      `UPDATE blackjack_wallets SET revision = revision + 1, state = ? WHERE id = 1 AND ${tableWritten}`,
    ).bind(JSON.stringify(economy.wallets.state), roomId, writeId));
  }
  if (movements.length) {
    statements.push(db.prepare(
      `INSERT INTO blackjack_balance_activity (player, occurred_at, delta)
       SELECT value ->> '$.player', value ->> '$.at', value ->> '$.delta' FROM json_each(?)
       WHERE ${tableWritten}`,
    ).bind(JSON.stringify(movements), roomId, writeId));
    statements.push(db.prepare(
      `DELETE FROM blackjack_balance_activity WHERE occurred_at <= ? AND ${tableWritten}`,
    ).bind(now - STATS_WINDOW_MS, roomId, writeId));
  }
  for (const result of results) {
    statements.push(db.prepare(
      `INSERT INTO blackjack_results (round_id, player, settled_at, won, lost)
       SELECT ?, ?, ?, ?, ? WHERE ${tableWritten}`,
    ).bind(result.roundId, result.player, result.settledAt, result.won, result.lost, roomId, writeId));
  }
  if (results.length) {
    statements.push(db.prepare(
      `DELETE FROM blackjack_results WHERE settled_at <= ? AND ${tableWritten}`,
    ).bind(now - STATS_WINDOW_MS, roomId, writeId));
  }
  const result = statements.length === 1 ? await save.run() : (await db.batch(statements))[0];
  return result.meta.changes === 1;
}

function parseTable(state: string | null | undefined): Table {
  return state ? JSON.parse(state) : { seats: [], round: null, messages: [] };
}

export async function updateTable(
  db: D1Database, roomId: string, { change, watchSince }: { change?: Change; watchSince?: number } = {},
): Promise<Table> {
  const query = db.prepare(
    "SELECT revision, state FROM blackjack_tables WHERE room_id = ?" +
    (watchSince === undefined ? "" : " AND (playing = 1 OR json_extract(state, '$.round.finishedAt') > ?)"),
  ).bind(...(watchSince === undefined ? [roomId] : [roomId, watchSince]));
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await query.first<StateRow>();
    const table = parseTable(row?.state);
    const now = Date.now();
    const previousId = table.round?.id;
    const wasPlaying = roundActive(table.round);
    const deadline = deadlineFor(table);
    const expired = deadline !== undefined && deadline <= now;
    const lastRound = table.round;
    // The old ledger retains 24 hours. Older rounds cannot be verified safely.
    const recover = watchSince === undefined && lastRound && !wasPlaying && !lastRound.settled &&
      lastRound.finishedAt !== undefined && lastRound.finishedAt > now - STATS_WINDOW_MS;
    if (!change && !expired && !recover) return table;
    const economy = await loadWallets(db);
    const results: ChipResult[] = [];
    if (recover) {
      const paid = await db.prepare("SELECT player FROM blackjack_results WHERE round_id = ?")
        .bind(lastRound.id).all<{ player: Player }>();
      results.push(...settleRound(lastRound, economy.wallets, now, new Set(paid.results.map(({ player }) => player))));
    }
    // Persist a timeout before evaluating a submitted move against the next phase.
    if (expired) expirePhases(table, now, economy.wallets);
    else change?.(table, now, economy.wallets);
    const round = table.round;
    if (round && !roundActive(round) && (wasPlaying || round.id !== previousId)) {
      results.push(...settleRound(round, economy.wallets, now));
    }
    if (await saveTable(db, roomId, row?.revision, table, economy, results, now)) {
      if (!expired || !change) return table;
    }
  }
  throw new HttpError(409, "Стол обновился. Попробуйте ещё раз.");
}

export async function readTableView(db: D1Database, roomId: string, tokenHash: string) {
  const now = Date.now();
  const cutoff = now - STATS_WINDOW_MS;
  // Keep the cards, result, and credited balance in the same SQLite read snapshot.
  const snapshot = await db.prepare(
    `SELECT table_row.state AS tableState, COALESCE(table_row.revision, 0) AS tableRevision,
            wallets.state AS walletState, wallets.revision AS walletRevision, wallets.tracked_since AS trackedSince,
            (SELECT json_group_object(player, change) FROM (
              SELECT player, SUM(delta) AS change FROM blackjack_balance_activity
              WHERE occurred_at > MAX(?1, wallets.tracked_since) GROUP BY player
            )) AS changes,
            (SELECT json_group_object(player, version) FROM blackjack_avatars) AS avatars,
            (SELECT json_group_object(player, json_object('won', won, 'lost', lost)) FROM (
              SELECT player, SUM(won) AS won, SUM(lost) AS lost FROM blackjack_results
              WHERE settled_at > ?1 GROUP BY player
            )) AS stats
     FROM blackjack_wallets AS wallets
     LEFT JOIN blackjack_tables AS table_row ON table_row.room_id = ?2
     WHERE wallets.id = 1`,
  ).bind(cutoff, roomId).first<{
    tableState: string | null; tableRevision: number; walletState: string; walletRevision: number;
    trackedSince: number; changes: string; avatars: string; stats: string;
  }>();
  if (!snapshot) throw new Error("Blackjack wallets row is missing");
  const table = parseTable(snapshot.tableState);
  const me = playerForToken(table, tokenHash);
  const wallets = new ChipWallets(JSON.parse(snapshot.walletState) as WalletState);
  const changes: Partial<Record<Player, number>> = JSON.parse(snapshot.changes);
  const from = Math.max(cutoff, snapshot.trackedSince);
  const balance = me ? wallets.balance(me, now) : 0;
  const names = new Set([
    ...table.seats.map(({ name }) => name),
    ...(table.round?.hands.map(({ name }) => name) ?? []),
  ]);
  const statsByPlayer = Object.fromEntries(
    Object.entries(JSON.parse(snapshot.stats)).filter(([player]) => names.has(player as Player)),
  ) as Partial<Record<Player, { won: number; lost: number }>>;
  return {
    ...tableView(table, me, balance, statsByPlayer, now),
    tableRevision: snapshot.tableRevision,
    walletRevision: snapshot.walletRevision,
    reserved: me ? wallets.reservedTotal(me) : 0,
    avatars: JSON.parse(snapshot.avatars) as Partial<Record<Player, string>>,
    balanceHistoryComplete: snapshot.trackedSince <= cutoff,
    balanceStats: PLAYERS.map((name) => {
      const { balance, pendingDelta } = wallets.snapshot(name, from, now);
      return { name, balance, change: (changes[name] ?? 0) + pendingDelta };
    }),
  };
}
