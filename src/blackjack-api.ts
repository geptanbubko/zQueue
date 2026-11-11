import { chooseInsurance, leaveSeat, playerForToken, PLAYERS, playTurn, seatPlayer, setBet, tableActive } from "./blackjack";
import { uploadBlackjackAvatar } from "./blackjack-avatars";
import { readTableView, updateTable } from "./blackjack-store";
import { bearerToken, HttpError, json, randomToken, readJson, sha256 } from "./http";

export type BlackjackEnv = Env & {
  BLACKJACK_ENTRY_KEY?: string;
  BLACKJACK_PASSWORDS?: string;
};

const WATCH_GRACE_MS = 5 * 60 * 1000;

export function blackjackConfigured(env: BlackjackEnv): boolean {
  return Boolean(env.BLACKJACK_ENTRY_KEY && env.BLACKJACK_PASSWORDS);
}

export async function blackjackWatchState(env: BlackjackEnv, roomId: string) {
  if (!blackjackConfigured(env)) return { blackjackActive: false, blackjackWatchMs: 0 };
  const table = await updateTable(env.DB, roomId, { watchSince: Date.now() - WATCH_GRACE_MS });
  const blackjackActive = tableActive(table);
  const finishedAt = table.round?.finishedAt;
  const blackjackWatchMs = blackjackActive || finishedAt === undefined
    ? 0 : Math.max(0, finishedAt + WATCH_GRACE_MS - Date.now());
  return { blackjackActive, blackjackWatchMs };
}

function sameHash(left: string, right: string): boolean {
  return crypto.subtle.timingSafeEqual(new TextEncoder().encode(left), new TextEncoder().encode(right));
}

async function verifyEntry(env: BlackjackEnv, key: unknown): Promise<void> {
  const expected = env.BLACKJACK_ENTRY_KEY;
  if (!expected || typeof key !== "string" || key.length > 256 ||
      !sameHash(await sha256(key), await sha256(expected))) {
    throw new HttpError(404, "Страница входа не найдена.");
  }
}

function passwords(config: string | undefined): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(config ?? "");
  } catch {
    throw new HttpError(503, "Вход за стол пока недоступен.");
  }
  if (!parsed || typeof parsed !== "object" || Object.keys(parsed).length !== PLAYERS.length) {
    throw new HttpError(503, "Вход за стол пока недоступен.");
  }
  const values = PLAYERS.map((name) => (parsed as Record<string, unknown>)[name]);
  if (!values.every((value): value is string => typeof value === "string" && value.length > 0 && value.length <= 256) ||
      new Set(values).size !== PLAYERS.length) {
    throw new HttpError(503, "Вход за стол пока недоступен.");
  }
  return values;
}

export async function handleBlackjack(
  env: BlackjackEnv, req: Request, roomId: string, action: string,
): Promise<Response> {
  if (!blackjackConfigured(env)) throw new HttpError(404, "Стол недоступен.");
  const token = bearerToken(req);
  const tokenHash = token ? await sha256(token) : "";
  const respond = async () => json(await readTableView(env.DB, roomId, tokenHash));
  if (req.method === "GET" && action === "") {
    await updateTable(env.DB, roomId);
    return respond();
  }
  if (req.method === "PUT" && action === "avatar") {
    return uploadBlackjackAvatar(env.DB, req, roomId, tokenHash);
  }
  if (req.method !== "POST") throw new HttpError(404, "Не найдено.");
  if (req.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new HttpError(415, "Ожидается JSON.");
  }
  const body = await readJson(req, 4096);
  const source = req.headers.get("CF-Connecting-IP") ?? "local";

  if (action === "access") {
    await verifyEntry(env, body?.key);
    await updateTable(env.DB, roomId);
    return respond();
  }
  if (action === "join") {
    await verifyEntry(env, body?.key);
    if (!(await env.BLACKJACK_LOGIN_LIMIT.limit({ key: source })).success) {
      throw new HttpError(429, "Слишком много попыток. Попробуйте через минуту.");
    }
    const password = body?.password;
    if (typeof password !== "string" || !password || password.length > 256) {
      throw new HttpError(400, "Введите пароль игрока.");
    }
    const candidate = await sha256(password);
    const hashes = await Promise.all(passwords(env.BLACKJACK_PASSWORDS).map(sha256));
    const matches = hashes.map((hash) => sameHash(hash, candidate));
    const player = PLAYERS[matches.indexOf(true)];
    if (!player) throw new HttpError(403, "Неверный пароль игрока.");
    const session = randomToken();
    const sessionHash = await sha256(session);
    await updateTable(env.DB, roomId, {
      change(table, now, wallets) {
        wallets.ensure(player, now);
        seatPlayer(table, player, sessionHash);
      },
    });
    return json({ ...await readTableView(env.DB, roomId, sessionHash), token: session });
  }
  if (action === "chat") {
    const message = typeof body?.text === "string" ? body.text.trim() : "";
    if (!message || message.length > 300) throw new HttpError(400, "Введите сообщение до 300 символов.");
    if (!(await env.BLACKJACK_CHAT_LIMIT.limit({ key: source })).success) {
      throw new HttpError(429, "Сообщения отправляются слишком часто.");
    }
    await updateTable(env.DB, roomId, {
      change(table) {
        table.messages.push({ id: crypto.randomUUID(), author: playerForToken(table, tokenHash) ?? "Зритель", text: message });
        table.messages = table.messages.slice(-50);
      },
    });
    return respond();
  }

  if (action !== "bet" && action !== "insurance" && action !== "hit" && action !== "stand" &&
      action !== "double" && action !== "split" && action !== "leave") {
    throw new HttpError(404, "Не найдено.");
  }
  await updateTable(env.DB, roomId, {
    change(table, now, wallets) {
      const player = playerForToken(table, tokenHash);
      if (!player) throw new HttpError(403, "Войдите за стол.");
      if (action === "bet") setBet(table, player, body?.amount, body?.roundId, body?.bettingId, now, wallets);
      else if (action === "insurance") chooseInsurance(table, player, body?.accept, body?.roundId, now, wallets);
      else if (action === "leave") leaveSeat(table, player, now, wallets);
      else playTurn(table, player, action, body?.roundId, body?.step, now, wallets);
    },
  });
  return respond();
}
