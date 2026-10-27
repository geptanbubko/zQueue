import {
  apply,
  createdEvent,
  decide,
  DomainError,
  normalizeName,
  type DomainEvent,
  type Member,
  type RoomState,
} from "./domain";

interface RoomRow {
  id: string;
  code: string;
  seq: number;
  state: string;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function secureRandom(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function readJson(req: Request): Promise<any> {
  const text = await req.text();
  if (text.length > 512 * 1024) throw new HttpError(413, "Слишком большой запрос.");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Неверный JSON.");
  }
}

async function loadRoom(env: Env, code: string): Promise<RoomRow> {
  const row = await env.DB.prepare("SELECT id, code, seq, state FROM rooms WHERE code = ?")
    .bind(normalizeCode(code))
    .first<RoomRow>();
  if (!row) throw new HttpError(404, "Комната не найдена.");
  return row;
}

async function currentMember(env: Env, req: Request, room: RoomRow, state: RoomState): Promise<Member | null> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  const row = await env.DB.prepare("SELECT id FROM members WHERE token_hash = ? AND room_id = ?")
    .bind(await sha256(token), room.id)
    .first<{ id: string }>();
  if (!row) return null;
  return state.members.find((m) => m.id === row.id && m.active) ?? null;
}

function eventInsert(env: Env, roomId: string, seq: number, event: DomainEvent, actorId: string | null, at: string) {
  return env.DB.prepare(
    "INSERT INTO events (room_id, seq, type, payload, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(roomId, seq, event.type, JSON.stringify(event.payload), actorId, at);
}

function isConflict(err: unknown): boolean {
  const message = String((err as Error)?.message ?? err);
  return message.includes("UNIQUE constraint failed") || message.includes("seq gap");
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
  const event = createdEvent(title, owner);
  const now = new Date().toISOString();
  const state = apply(null, event, { seq: 1, createdAt: now, actorId: owner.id });

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    try {
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO rooms (id, code, seq, state, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)",
        ).bind(roomId, code, JSON.stringify(state), now, now),
        eventInsert(env, roomId, 1, event, owner.id, now),
        env.DB.prepare("INSERT INTO members (id, room_id, token_hash, created_at) VALUES (?, ?, ?, ?)").bind(
          owner.id,
          roomId,
          tokenHash,
          now,
        ),
      ]);
      return json({ code, token, seq: 1, state, me: state.members[0] }, 201);
    } catch (err) {
      if (!isConflict(err)) throw err;
    }
  }
  throw new HttpError(503, "Не удалось подобрать код комнаты, попробуйте ещё раз.");
}

async function getRoom(env: Env, req: Request, code: string, url: URL): Promise<Response> {
  const room = await loadRoom(env, code);
  const since = Number(url.searchParams.get("since"));
  if (since === room.seq) return json({ code: room.code, seq: room.seq, unchanged: true });
  const state = JSON.parse(room.state) as RoomState;
  const me = await currentMember(env, req, room, state);
  return json({ code: room.code, seq: room.seq, state, me });
}

async function runCommand(env: Env, req: Request, code: string): Promise<Response> {
  const cmd = await readJson(req);
  for (let attempt = 0; attempt < 5; attempt++) {
    const room = await loadRoom(env, code);
    const state = JSON.parse(room.state) as RoomState;
    const me = await currentMember(env, req, room, state);
    if (!me) throw new HttpError(403, "Только создатель комнаты и назначенные им люди могут вносить изменения.");

    const event = decide(state, cmd, me, { newId: () => crypto.randomUUID(), random: secureRandom });
    const seq = room.seq + 1;
    const now = new Date().toISOString();
    const next = apply(state, event, { seq, createdAt: now, actorId: me.id });
    const statements = [
      eventInsert(env, room.id, seq, event, me.id, now),
      env.DB.prepare("UPDATE rooms SET seq = ?, state = ?, updated_at = ? WHERE id = ? AND seq = ?").bind(
        seq,
        JSON.stringify(next),
        now,
        room.id,
        room.seq,
      ),
    ];
    let token: string | undefined;
    if (event.type === "member.added") {
      token = randomToken();
      statements.push(
        env.DB.prepare("INSERT INTO members (id, room_id, token_hash, created_at) VALUES (?, ?, ?, ?)").bind(
          event.payload.id,
          room.id,
          await sha256(token),
          now,
        ),
      );
    }
    try {
      await env.DB.batch(statements);
    } catch (err) {
      if (isConflict(err)) continue;
      throw err;
    }
    const me2 = next.members.find((m) => m.id === me.id && m.active) ?? null;
    return json({ code: room.code, seq, state: next, me: me2, event: { seq, ...event }, token });
  }
  throw new HttpError(409, "Комнату одновременно меняют другие, попробуйте ещё раз.");
}

async function listEvents(env: Env, code: string, url: URL): Promise<Response> {
  const room = await loadRoom(env, code);
  const before = Number(url.searchParams.get("before")) || room.seq + 1;
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
  const { results } = await env.DB.prepare(
    "SELECT seq, type, payload, actor_id, created_at FROM events WHERE room_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?",
  )
    .bind(room.id, before, limit)
    .all<{ seq: number; type: string; payload: string; actor_id: string | null; created_at: string }>();
  return json({
    seq: room.seq,
    events: results.map((r) => ({
      seq: r.seq,
      type: r.type,
      payload: JSON.parse(r.payload),
      actorId: r.actor_id,
      createdAt: r.created_at,
    })),
  });
}

/** Пересчитывает состояние из журнала и сравнивает со снимком. */
async function verifyRoom(env: Env, code: string): Promise<Response> {
  const room = await loadRoom(env, code);
  const { results } = await env.DB.prepare(
    "SELECT seq, type, payload, actor_id, created_at FROM events WHERE room_id = ? ORDER BY seq",
  )
    .bind(room.id)
    .all<{ seq: number; type: string; payload: string; actor_id: string | null; created_at: string }>();
  let state: RoomState | null = null;
  let expected = 1;
  for (const row of results) {
    if (row.seq !== expected) return json({ ok: false, reason: `пропуск в журнале на №${expected}` });
    state = apply(state, { type: row.type, payload: JSON.parse(row.payload) }, {
      seq: row.seq,
      createdAt: row.created_at,
      actorId: row.actor_id,
    });
    expected += 1;
  }
  const ok = results.length === room.seq && JSON.stringify(state) === room.state;
  return json({ ok, events: results.length, reason: ok ? null : "снимок не совпадает с журналом" });
}

async function route(req: Request, env: Env, url: URL): Promise<Response> {
  const parts = url.pathname.split("/").filter(Boolean); // ["api", "rooms", code?, action?]
  if (parts[1] !== "rooms") throw new HttpError(404, "Не найдено.");
  if (parts.length === 2 && req.method === "POST") return createRoom(env, req);
  const code = parts[2];
  if (!code) throw new HttpError(404, "Не найдено.");
  const action = parts[3] ?? "";
  if (action === "" && req.method === "GET") return getRoom(env, req, code, url);
  if (action === "commands" && req.method === "POST") return runCommand(env, req, code);
  if (action === "events" && req.method === "GET") return listEvents(env, code, url);
  if (action === "verify" && req.method === "GET") return verifyRoom(env, code);
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
} satisfies ExportedHandler<Env>;
