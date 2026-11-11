import {
  apply,
  createdChange,
  decide,
  DomainError,
  LOGGED,
  normalizeName,
  parseSettings,
  type Change,
  type Member,
  type RoomState,
  upgradeState,
} from "./domain";
import { blackjackActive, blackjackConfigured, handleBlackjack, type BlackjackEnv } from "./blackjack-api";
import { getBlackjackAvatar } from "./blackjack-avatars";
import { bearerToken, HttpError, json, randomToken, readJson, secureRandom, sha256 } from "./http";

interface RoomRow {
  id: string;
  code: string;
  seq: number;
  state: string;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function loadRoom(env: Env, code: string): Promise<RoomRow> {
  const row = await env.DB.prepare("SELECT id, code, seq, state FROM rooms WHERE code = ?")
    .bind(normalizeCode(code))
    .first<RoomRow>();
  if (!row) throw new HttpError(404, "Комната не найдена.");
  return row;
}

async function currentMember(env: Env, req: Request, room: RoomRow, state: RoomState): Promise<Member | null> {
  const token = bearerToken(req);
  if (!token) return null;
  const row = await env.DB.prepare("SELECT id FROM members WHERE token_hash = ? AND room_id = ?")
    .bind(await sha256(token), room.id)
    .first<{ id: string }>();
  if (!row) return null;
  return state.members.find((m) => m.id === row.id && m.active) ?? null;
}

// Запись в журнал выполняется, только если предыдущий запрос пакета что-то
// изменил (changes() = 1), то есть если снимок комнаты действительно обновился.
function logInsert(env: Env, roomId: string, change: Change, actorId: string | null, at: string) {
  return env.DB.prepare(
    `INSERT INTO events (room_id, seq, type, payload, actor_id, created_at)
     SELECT ?1, (SELECT COALESCE(MAX(seq), 0) + 1 FROM events WHERE room_id = ?1), ?2, ?3, ?4, ?5
     WHERE changes() = 1`,
  ).bind(roomId, change.type, JSON.stringify(change.payload), actorId, at);
}

function memberInsert(env: Env, id: string, roomId: string, tokenHash: string, at: string) {
  return env.DB.prepare(
    "INSERT INTO members (id, room_id, token_hash, created_at) SELECT ?, ?, ?, ? WHERE changes() = 1",
  ).bind(id, roomId, tokenHash, at);
}

async function createRoom(env: Env, req: Request): Promise<Response> {
  const body = await readJson(req);
  const title = normalizeName(body?.title, 80);
  const name = normalizeName(body?.name, 60);
  if (!title) throw new HttpError(400, "Введите название комнаты.");
  if (!name) throw new HttpError(400, "Введите своё имя.");

  const roomId = crypto.randomUUID();
  const owner = { id: crypto.randomUUID(), name };
  const token = randomToken();
  const tokenHash = await sha256(token);
  const change = createdChange(title, owner, parseSettings(body?.settings));
  const now = new Date().toISOString();
  const state = apply(null, change, { createdAt: now, actorId: owner.id });

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const exists = await env.DB.prepare("SELECT 1 FROM rooms WHERE code = ?").bind(code).first();
    if (exists) continue;
    try {
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO rooms (id, code, seq, state, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)",
        ).bind(roomId, code, JSON.stringify(state), now, now),
        logInsert(env, roomId, change, owner.id, now),
        memberInsert(env, owner.id, roomId, tokenHash, now),
      ]);
      return json({ code, token, seq: 1, state, me: state.members[0] }, 201);
    } catch (err) {
      if (!String((err as Error)?.message).includes("UNIQUE constraint failed")) throw err;
    }
  }
  throw new HttpError(503, "Не удалось подобрать код комнаты, попробуйте ещё раз.");
}

async function getRoom(env: BlackjackEnv, req: Request, code: string, url: URL): Promise<Response> {
  const room = await loadRoom(env, code);
  const since = Number(url.searchParams.get("since"));
  const active = await blackjackActive(env, room.id);
  if (since === room.seq) return json({ code: room.code, seq: room.seq, unchanged: true, blackjackActive: active });
  const state = upgradeState(JSON.parse(room.state));
  const me = await currentMember(env, req, room, state);
  return json({ code: room.code, seq: room.seq, state, me, blackjackActive: active });
}

async function runCommand(env: Env, req: Request, code: string): Promise<Response> {
  const cmd = await readJson(req);
  for (let attempt = 0; attempt < 5; attempt++) {
    const room = await loadRoom(env, code);
    const state = upgradeState(JSON.parse(room.state));
    const me = await currentMember(env, req, room, state);
    if (!me) throw new HttpError(403, "Только создатель комнаты и назначенные им люди могут вносить изменения.");

    const change = decide(state, cmd, me, { newId: () => crypto.randomUUID(), random: secureRandom });
    const seq = room.seq + 1;
    const now = new Date().toISOString();
    const next = apply(state, change, { createdAt: now, actorId: me.id });
    const statements = [
      env.DB.prepare("UPDATE rooms SET seq = ?, state = ?, updated_at = ? WHERE id = ? AND seq = ?").bind(
        seq,
        JSON.stringify(next),
        now,
        room.id,
        room.seq,
      ),
    ];
    if (LOGGED.has(change.type)) statements.push(logInsert(env, room.id, change, me.id, now));
    let token: string | undefined;
    if (change.type === "member.added") {
      token = randomToken();
      statements.push(memberInsert(env, change.payload.id, room.id, await sha256(token), now));
    }
    const results = await env.DB.batch(statements);
    // Снимок успели изменить параллельно — пересчитываем на свежих данных.
    if (results[0].meta.changes !== 1) continue;
    const me2 = next.members.find((m) => m.id === me.id && m.active) ?? null;
    return json({ code: room.code, seq, state: next, me: me2, change, token });
  }
  throw new HttpError(409, "Комнату одновременно меняют другие, попробуйте ещё раз.");
}

async function listEvents(env: Env, code: string, url: URL): Promise<Response> {
  const room = await loadRoom(env, code);
  const before = Number(url.searchParams.get("before")) || Number.MAX_SAFE_INTEGER;
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
  const { results } = await env.DB.prepare(
    "SELECT seq, type, payload, actor_id, created_at FROM events WHERE room_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?",
  )
    .bind(room.id, before, limit)
    .all<{ seq: number; type: string; payload: string; actor_id: string | null; created_at: string }>();
  return json({
    events: results.map((r) => ({
      seq: r.seq,
      type: r.type,
      payload: JSON.parse(r.payload),
      actorId: r.actor_id,
      createdAt: r.created_at,
    })),
  });
}

async function route(req: Request, env: BlackjackEnv, url: URL): Promise<Response> {
  const parts = url.pathname.split("/").filter(Boolean); // ["api", "rooms", code?, action?]
  if (parts[1] === "blackjack" && parts[2] === "avatars" && parts.length === 5 &&
      req.method === "GET" && blackjackConfigured(env)) {
    return getBlackjackAvatar(env.DB, parts[3], parts[4]);
  }
  if (parts[1] !== "rooms") throw new HttpError(404, "Не найдено.");
  if (parts.length === 2 && req.method === "POST") return createRoom(env, req);
  const code = parts[2];
  if (!code) throw new HttpError(404, "Не найдено.");
  const action = parts[3] ?? "";
  if (action === "blackjack" && parts.length <= 5) {
    const room = await loadRoom(env, code);
    return handleBlackjack(env, req, room.id, parts[4] ?? "");
  }
  if (action === "" && req.method === "GET") return getRoom(env, req, code, url);
  if (action === "commands" && req.method === "POST") return runCommand(env, req, code);
  if (action === "events" && req.method === "GET") return listEvents(env, code, url);
  throw new HttpError(404, "Не найдено.");
}

export default {
  async fetch(req, env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    try {
      return await route(req, env, url);
    } catch (err) {
      if (err instanceof HttpError || err instanceof DomainError) {
        return json({ error: err.message }, err.status);
      }
      console.error(err);
      return json({ error: "Ошибка сервера." }, 500);
    }
  },
} satisfies ExportedHandler<BlackjackEnv>;
