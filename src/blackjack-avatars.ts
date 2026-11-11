import { HttpError, json } from "./http";

const AVATAR_SIZE = 128;
const MAX_BYTES = 96 * 1024;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

async function readAvatarBody(req: Request): Promise<Uint8Array> {
  if (req.headers.get("Content-Type") !== "image/png") throw new HttpError(415, "Ожидается изображение PNG.");
  if (Number(req.headers.get("Content-Length")) > MAX_BYTES) throw new HttpError(413, "Аватар слишком большой.");
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, "Выберите изображение.");
  const buffer = new Uint8Array(MAX_BYTES);
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.length > MAX_BYTES) {
        await reader.cancel();
        throw new HttpError(413, "Аватар слишком большой.");
      }
      buffer.set(value, length);
      length += value.length;
    }
  } finally {
    reader.releaseLock();
  }
  const header = new DataView(buffer.buffer, 0, length);
  if (length < 57 || !PNG_SIGNATURE.every((byte, i) => buffer[i] === byte) ||
      header.getUint32(8) !== 13 || header.getUint32(12) !== 0x49484452 ||
      header.getUint32(16) !== AVATAR_SIZE || header.getUint32(20) !== AVATAR_SIZE || !hasPngImageData(header)) {
    throw new HttpError(400, "Некорректный аватар PNG.");
  }
  return buffer.subarray(0, length);
}

function hasPngImageData(png: DataView): boolean {
  let hasData = false;
  for (let offset = 33; offset + 12 <= png.byteLength;) {
    const length = png.getUint32(offset);
    const type = png.getUint32(offset + 4);
    offset += length + 12;
    if (offset > png.byteLength) return false;
    if (type === 0x49444154 && length > 0) hasData = true; // IDAT
    if (type === 0x49454e44) return hasData && length === 0 && offset === png.byteLength; // IEND
  }
  return false;
}

export async function uploadBlackjackAvatar(db: D1Database, req: Request, roomId: string, tokenHash: string): Promise<Response> {
  if (!tokenHash) throw new HttpError(403, "Войдите за стол.");
  const png = await readAvatarBody(req);
  const version = crypto.randomUUID();
  // Resolve the player and save in the same statement so leaving or rotating a token revokes upload access.
  const result = await db.prepare(
    `INSERT INTO blackjack_avatars (player, version, png)
     SELECT seat.value ->> '$.name', ?, ?
     FROM blackjack_tables AS room, json_each(room.state, '$.seats') AS seat
     WHERE room.room_id = ? AND seat.value ->> '$.tokenHash' = ?
     ON CONFLICT(player) DO UPDATE SET version = excluded.version, png = excluded.png`,
  ).bind(version, png, roomId, tokenHash).run();
  if (result.meta.changes !== 1) throw new HttpError(403, "Войдите за стол.");
  return json({ version });
}

export async function getBlackjackAvatar(db: D1Database, player: string, version: string): Promise<Response> {
  const avatar = await db.prepare(
    "SELECT png FROM blackjack_avatars WHERE player = ? AND version = ?",
  ).bind(player, version).first<{ png: number[] }>();
  if (!avatar) throw new HttpError(404, "Аватар не найден.");
  return new Response(Uint8Array.from(avatar.png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
