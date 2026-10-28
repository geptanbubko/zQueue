// Картинки очереди и таблицы вероятностей для пересылки (например, в Telegram).
// Рисуются на canvas, чтобы не зависеть от сторонних библиотек, в цветах тёмной
// темы сайта; внизу — логотип zQueue.

const FONT = '"Inter", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif';
const SCALE = 2;
const PAD = 32;
const FOOTER = 64;

/** Цвета тёмной темы из styles.css. */
const C = {
  bg: "#0a0a0a",
  text: "#ededed",
  text2: "#c4c4c4",
  muted: "#8f8f8f",
  border: "#262626",
  zebra: "#111111",
  accent: "#ededed",
  accentText: "#0a0a0a",
};

function createCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * SCALE);
  canvas.height = Math.ceil(height * SCALE);
  const ctx = canvas.getContext("2d");
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = "middle";
  return { canvas, ctx };
}

function font(size, weight = 400) {
  return `${weight} ${size}px ${FONT}`;
}

/** Обрезает текст с многоточием, чтобы он поместился в max пикселей. */
function fit(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  let cut = text;
  while (cut && ctx.measureText(`${cut}…`).width > max) cut = cut.slice(0, -1);
  return `${cut}…`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawHeader(ctx, width, title, subtitle) {
  ctx.fillStyle = C.text;
  ctx.font = font(22, 700);
  ctx.fillText(fit(ctx, title, width - PAD * 2), PAD, PAD + 12);
  ctx.fillStyle = C.muted;
  ctx.font = font(14);
  ctx.fillText(fit(ctx, subtitle, width - PAD * 2), PAD, PAD + 40);
  return PAD + 64;
}

function drawFooter(ctx, width, height) {
  const y = height - FOOTER / 2;
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, height - FOOTER + 0.5);
  ctx.lineTo(width - PAD, height - FOOTER + 0.5);
  ctx.stroke();

  ctx.fillStyle = C.accent;
  roundRect(ctx, PAD, y - 13, 26, 26, 6);
  ctx.fill();
  ctx.fillStyle = C.accentText;
  ctx.font = font(12, 700);
  ctx.textAlign = "center";
  ctx.fillText("zQ", PAD + 13, y + 1);
  ctx.textAlign = "left";
  ctx.fillStyle = C.text;
  ctx.font = font(15, 700);
  ctx.fillText("zQueue", PAD + 36, y + 1);
}

/**
 * Картинка очереди: заголовок, нумерованный список и подвал с логотипом.
 * names — имена в порядке очереди.
 */
export function queueImage({ title, subtitle, names }) {
  const width = 560;
  const rowH = 40;
  const top = PAD + 64;
  const height = top + names.length * rowH + 20 + FOOTER;
  const { canvas, ctx } = createCanvas(width, height);

  drawHeader(ctx, width, title, subtitle);
  ctx.strokeStyle = C.border;
  roundRect(ctx, PAD - 0.5, top - 0.5, width - PAD * 2 + 1, names.length * rowH + 1, 10);
  ctx.stroke();
  ctx.save();
  roundRect(ctx, PAD, top, width - PAD * 2, names.length * rowH, 10);
  ctx.clip();
  names.forEach((name, i) => {
    const y = top + i * rowH;
    if (i % 2 === 1) {
      ctx.fillStyle = C.zebra;
      ctx.fillRect(PAD, y, width - PAD * 2, rowH);
    }
    ctx.fillStyle = C.muted;
    ctx.font = font(15, 500);
    ctx.textAlign = "right";
    ctx.fillText(String(i + 1), PAD + 32, y + rowH / 2);
    ctx.textAlign = "left";
    ctx.fillStyle = C.text;
    ctx.font = font(17, 500);
    ctx.fillText(fit(ctx, name, width - PAD * 2 - 64), PAD + 48, y + rowH / 2);
  });
  ctx.restore();

  drawFooter(ctx, width, height);
  return canvas;
}

/**
 * Картинка таблицы вероятностей мест. rows: [{ name, mean, cells: [{ text, p }] }],
 * где text пустой для недостижимых мест, p — вероятность от 0 до 1.
 */
export function placesImage({ title, subtitle, rows }) {
  const places = rows[0]?.cells.length ?? 0;
  const nameW = 220;
  const meanW = 76;
  const cellW = 52;
  const rowH = 34;
  const tableW = nameW + meanW + places * cellW;
  const width = Math.max(560, tableW + PAD * 2);
  const top = PAD + 64;
  const height = top + (rows.length + 1) * rowH + 20 + FOOTER;
  const { canvas, ctx } = createCanvas(width, height);

  drawHeader(ctx, width, title, subtitle);
  const x0 = PAD;
  ctx.font = font(12, 600);
  ctx.fillStyle = C.muted;
  ctx.fillText("Участник", x0 + 10, top + rowH / 2);
  ctx.textAlign = "right";
  ctx.fillText("Ср. место", x0 + nameW + meanW - 10, top + rowH / 2);
  ctx.textAlign = "center";
  for (let i = 0; i < places; i++) ctx.fillText(String(i + 1), x0 + nameW + meanW + i * cellW + cellW / 2, top + rowH / 2);
  ctx.textAlign = "left";

  rows.forEach((row, r) => {
    const y = top + (r + 1) * rowH;
    if (r % 2 === 0) {
      ctx.fillStyle = C.zebra;
      ctx.fillRect(x0, y, tableW, rowH);
    }
    ctx.fillStyle = C.text;
    ctx.font = font(14, 500);
    ctx.fillText(fit(ctx, row.name, nameW - 16), x0 + 10, y + rowH / 2);
    ctx.fillStyle = C.text2;
    ctx.font = font(13);
    ctx.textAlign = "right";
    ctx.fillText(row.mean, x0 + nameW + meanW - 10, y + rowH / 2);
    ctx.textAlign = "center";
    row.cells.forEach((cell, i) => {
      const cx = x0 + nameW + meanW + i * cellW;
      if (cell.p > 0) {
        // Как на сайте: доля акцентного цвета растёт с вероятностью.
        ctx.fillStyle = `rgba(237, 237, 237, ${Math.min(1, cell.p) * 0.85})`;
        ctx.fillRect(cx + 1, y + 1, cellW - 2, rowH - 2);
      }
      if (!cell.text) return;
      ctx.fillStyle = cell.p >= 0.5 ? C.accentText : C.text2;
      ctx.font = font(12, cell.p >= 0.5 ? 600 : 400);
      ctx.fillText(cell.text, cx + cellW / 2, y + rowH / 2);
    });
    ctx.textAlign = "left";
  });
  ctx.strokeStyle = C.border;
  ctx.strokeRect(x0 + 0.5, top + rowH + 0.5, tableW - 1, rows.length * rowH - 1);

  drawFooter(ctx, width, height);
  return canvas;
}

export function canvasBlob(canvas) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Не удалось создать изображение."))), "image/png"),
  );
}
