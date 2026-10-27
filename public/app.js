const app = document.getElementById("app");
const toastEl = document.getElementById("toast");

const TOKENS_KEY = "queue.tokens.v1";
const RECENT_KEY = "queue.recent.v1";
const POLL_MS = 5000;

const ICONS = {
  logo: `<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="currentColor" style="color:var(--accent)"/><text x="16" y="21.5" text-anchor="middle" font-family="Segoe UI, Inter, system-ui, sans-serif" font-size="16" font-weight="800" letter-spacing="-0.5" fill="#fff">zQ</text></svg>`,
  copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`,
  dice: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.2" fill="currentColor"/></svg>`,
  scale: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18M5 21h14M7 7h10M7 7l-3 7a3 3 0 0 0 6 0zM17 7l-3 7a3 3 0 0 0 6 0z"/></svg>`,
  log: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>`,
  key: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3M16 7l3 3M14 9l2 2"/></svg>`,
  more: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="18" height="18"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`,
};

/* ---------- Утилиты ---------- */

const storage = {
  read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* приватный режим — просто не запоминаем */
    }
  },
};

function getToken(code) {
  return storage.read(TOKENS_KEY, {})[code] || null;
}

function setToken(code, token) {
  const all = storage.read(TOKENS_KEY, {});
  if (token) all[code] = token;
  else delete all[code];
  storage.write(TOKENS_KEY, all);
}

function rememberRoom(code, title) {
  const list = storage.read(RECENT_KEY, []).filter((item) => item.code !== code);
  list.unshift({ code, title });
  storage.write(RECENT_KEY, list.slice(0, 8));
}

function forgetRoom(code) {
  storage.write(RECENT_KEY, storage.read(RECENT_KEY, []).filter((item) => item.code !== code));
}

function esc(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeCode(raw) {
  return String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function fmtNum(value) {
  return String(Math.round(Number(value) * 100) / 100).replace(".", ",");
}

function fmtDate(iso, withYear = true) {
  if (!iso) return "дата неизвестна";
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "numeric",
      month: "long",
      ...(withYear ? { year: "numeric" } : {}),
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

let toastTimer = 0;
function toast(message, kind = "") {
  toastEl.textContent = message;
  toastEl.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.className = "toast"), kind === "error" ? 5000 : 2800);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  toast("Скопировано");
}

async function api(path, { method = "GET", body, code } = {}) {
  const headers = {};
  const token = code ? getToken(code) : null;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw Object.assign(new Error("Нет связи с сервером."), { status: 0 });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || "Ошибка сервера."), { status: res.status });
  return data;
}

/* ---------- Диалоги ---------- */

/**
 * Открывает модальное окно. Возвращает значения полей и нажатую кнопку
 * ({ action, ...values }) или null, если окно закрыли.
 */
function dialog({ title, body = "", fields = [], actions = [{ value: "ok", label: "Сохранить" }], column = false }) {
  return new Promise((resolve) => {
    const el = document.createElement("dialog");
    const fieldHtml = fields
      .map(
        (f) => `
        <label class="field">${esc(f.label)}
          <input class="input" name="${f.name}" type="${f.type || "text"}" value="${esc(f.value ?? "")}"
            ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ""} ${f.required ? "required" : ""}
            ${f.step ? `step="${f.step}"` : ""} ${f.min !== undefined ? `min="${f.min}"` : ""} autocomplete="off" />
          ${f.hint ? `<span class="field-hint">${esc(f.hint)}</span>` : ""}
        </label>`,
      )
      .join("");
    el.innerHTML = `
      <form method="dialog">
        <h2>${esc(title)}</h2>
        ${body}
        ${fieldHtml}
        <div class="actions ${column ? "column" : ""}">
          ${actions
            .map((a) => `<button class="btn ${a.kind || ""}" value="${a.value}" ${a.noValidate ? "formnovalidate" : ""}>${esc(a.label)}</button>`)
            .join("")}
          ${column ? "" : `<button class="btn ghost" value="cancel" formnovalidate>Отмена</button>`}
        </div>
      </form>`;
    document.body.append(el);
    el.addEventListener("click", (event) => {
      if (event.target === el) el.close("cancel");
      const copy = event.target.closest("[data-copy]");
      if (copy) {
        event.preventDefault();
        copyText(copy.getAttribute("data-copy"));
      }
    });
    el.addEventListener("close", () => {
      const action = el.returnValue;
      const values = Object.fromEntries(new FormData(el.querySelector("form")));
      el.remove();
      resolve(!action || action === "cancel" ? null : { action, ...values });
    });
    el.showModal();
    el.querySelector("input:not([readonly])")?.focus();
  });
}

function copyFieldHtml(value) {
  return `<div class="copy-field"><input class="input" readonly value="${esc(value)}" onfocus="this.select()" />
    <button class="btn ghost icon" data-copy="${esc(value)}" title="Скопировать" type="button">${ICONS.copy}</button></div>`;
}

/* ---------- Маршрутизация ---------- */

let room = null;
let pollTimer = 0;
let justCreated = null;

function navigate(path) {
  history.pushState(null, "", path);
  route();
}

function route() {
  clearInterval(pollTimer);
  room = null;
  const match = location.pathname.match(/^\/r\/([A-Za-z0-9-]+)\/?$/);
  if (match) openRoom(match[1]);
  else renderHome();
  window.scrollTo(0, 0);
}

window.addEventListener("popstate", route);

document.addEventListener("click", (event) => {
  const link = event.target.closest("a[data-link]");
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return;
  event.preventDefault();
  navigate(link.getAttribute("href"));
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && room) refresh();
});

/* ---------- Стартовая страница ---------- */

function renderHome() {
  document.title = "zQueue — честная очередь на сдачу";
  const recent = storage.read(RECENT_KEY, []);
  app.innerHTML = `
    <header class="topbar">
      <a href="/" data-link class="brand">${ICONS.logo}<span>zQueue</span></a>
    </header>
    <main class="container home">
      <section class="hero">
        <div>
          <h1>Честная очередь <span>на сдачу</span></h1>
          <p class="lead">
            Порядок выбирается случайно, но тот, кто в прошлый раз стоял в конце или не успел,
            в следующий раз чаще окажется впереди. Для каждого предмета — своя комната
            с общей историей сдач.
          </p>
        </div>
        <div class="card join">
          <form id="join-form" class="form-grid">
            <h2>Войти в комнату</h2>
            <input id="code-input" class="input code-input" placeholder="ABC123" maxlength="8"
              autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Код комнаты" required />
            <button class="btn">Открыть комнату</button>
          </form>
          <div class="divider">или</div>
          <button class="btn ghost" id="create-btn" type="button">Создать новую комнату</button>
        </div>
      </section>

      ${
        recent.length
          ? `<section>
              <h2 class="section-title">Недавние комнаты</h2>
              <div class="recent">
                ${recent
                  .map(
                    (r) => `<a class="recent-item" href="/r/${esc(r.code)}" data-link>
                      <span class="name">${esc(r.title || "Без названия")}</span>
                      ${getToken(r.code) ? `<span class="badge editor">можно менять</span>` : ""}
                      <span class="code">${esc(r.code)}</span>
                    </a>`,
                  )
                  .join("")}
              </div>
            </section>`
          : ""
      }

      <section>
        <h2 class="section-title">Как это устроено</h2>
        <div class="features">
          <div class="card feature">
            <div class="ico">${ICONS.dice}</div>
            <h3>Случайно, но с памятью</h3>
            <p>У каждого есть накопленная задержка. Чем она больше, тем выше шанс оказаться в начале очереди.</p>
          </div>
          <div class="card feature">
            <div class="ico">${ICONS.scale}</div>
            <h3>Справедливое начисление</h3>
            <p>Первый получает 0, последний — 1, кто не успел сдать — 1, кто не сдавал — 0,5. Значения можно настроить.</p>
          </div>
          <div class="card feature">
            <div class="ico">${ICONS.log}</div>
            <h3>Прозрачная история</h3>
            <p>Видно, кто и когда составил каждую очередь и кто кому выдал доступ. Эти записи нельзя изменить или удалить.</p>
          </div>
          <div class="card feature">
            <div class="ico">${ICONS.key}</div>
            <h3>Без регистрации</h3>
            <p>Смотреть может любой, у кого есть код. Менять — только создатель и те, кому он выдал ссылку-ключ.</p>
          </div>
        </div>
      </section>
    </main>
    <footer class="footer">zQueue · данные комнат хранятся на сервере, ключи — только в вашем браузере</footer>`;

  const input = document.getElementById("code-input");
  input.addEventListener("input", () => {
    input.value = normalizeCode(input.value).slice(0, 6);
  });
  document.getElementById("join-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const code = normalizeCode(input.value);
    if (code.length !== 6) {
      toast("Код состоит из 6 символов.", "error");
      return;
    }
    navigate(`/r/${code}`);
  });
  document.getElementById("create-btn").addEventListener("click", createRoomDialog);
  if (!matchMedia("(max-width: 640px)").matches) input.focus();
}

async function createRoomDialog() {
  const values = await dialog({
    title: "Новая комната",
    body: `<p class="muted small" style="margin:0">Вы станете создателем: сможете менять очередь и выдавать доступ другим.</p>`,
    fields: [
      { name: "title", label: "Предмет или название", placeholder: "Например, ОС — лабы, гр. 21-1", required: true },
      { name: "name", label: "Ваше имя", placeholder: "Как вас показывать в истории", required: true },
    ],
    actions: [{ value: "ok", label: "Создать" }],
  });
  if (!values) return;
  try {
    const data = await api("/api/rooms", { method: "POST", body: { title: values.title, name: values.name } });
    setToken(data.code, data.token);
    rememberRoom(data.code, data.state.title);
    justCreated = data.code;
    navigate(`/r/${data.code}`);
  } catch (err) {
    toast(err.message, "error");
  }
}

/* ---------- Комната ---------- */

async function openRoom(rawCode) {
  const code = normalizeCode(rawCode);
  let keyAdded = false;
  if (location.hash.startsWith("#key=")) {
    setToken(code, decodeURIComponent(location.hash.slice(5)));
    keyAdded = true;
    history.replaceState(null, "", `/r/${code}`);
  } else if (location.pathname !== `/r/${code}`) {
    history.replaceState(null, "", `/r/${code}`);
  }
  room = {
    code,
    seq: 0,
    state: null,
    me: null,
    tab: "queue",
    busy: false,
    notice: justCreated === code ? "created" : keyAdded ? "key" : null,
  };
  justCreated = null;
  app.innerHTML = `<header class="topbar"><a href="/" data-link class="brand">${ICONS.logo}<span>zQueue</span></a></header>
    <div class="loading">Загрузка комнаты ${esc(code)}…</div>`;
  try {
    await refresh(true);
  } catch (err) {
    if (err.status === 404) {
      forgetRoom(code);
      renderMissing(code);
    } else {
      app.querySelector(".loading").textContent = err.message;
    }
    return;
  }
  if (room?.notice === "key" && !room.me) {
    setToken(code, null);
    room.notice = "bad-key";
    renderRoom();
  }
  const current = room;
  pollTimer = setInterval(() => {
    if (room === current && document.visibilityState === "visible" && !room.busy) refresh().catch(() => {});
  }, POLL_MS);
}

function renderMissing(code) {
  app.innerHTML = `
    <header class="topbar"><a href="/" data-link class="brand">${ICONS.logo}<span>zQueue</span></a></header>
    <main class="container">
      <div class="card" style="max-width:480px;margin:10vh auto;text-align:center">
        <h2 style="margin-bottom:8px">Комната ${esc(code)} не найдена</h2>
        <p class="muted">Проверьте код — он состоит из 6 латинских букв и цифр.</p>
        <a class="btn" href="/" data-link>На главную</a>
      </div>
    </main>`;
}

async function refresh(force = false) {
  if (!room) return;
  const current = room;
  const data = await api(`/api/rooms/${current.code}${force ? "" : `?since=${current.seq}`}`, { code: current.code });
  if (room !== current || data.unchanged) return;
  applyRoomData(data);
}

function applyRoomData(data) {
  room.seq = data.seq;
  room.state = data.state;
  room.me = data.me ?? null;
  rememberRoom(room.code, room.state.title);
  renderRoom();
}

async function command(cmd, success) {
  if (!room || room.busy) return null;
  room.busy = true;
  try {
    const data = await api(`/api/rooms/${room.code}/commands`, { method: "POST", body: cmd, code: room.code });
    applyRoomData(data);
    if (success) toast(success);
    return data;
  } catch (err) {
    toast(err.message, "error");
    if (err.status === 409 || err.status === 403) await refresh(true).catch(() => {});
    return null;
  } finally {
    if (room) room.busy = false;
  }
}

const canEdit = () => Boolean(room.me);
const isOwner = () => room.me?.role === "owner";

/* ----- Расчёты для отображения (те же формулы, что на сервере) ----- */

function studentById(id) {
  return room.state.students.find((s) => s.id === id);
}

function studentName(id) {
  return studentById(id)?.name ?? "удалённый участник";
}

function memberName(id) {
  return room.state.members.find((m) => m.id === id)?.name ?? "неизвестно";
}

function levelOf(id) {
  const s = room.state;
  if (!s.urgentMode || !s.pool.includes(id)) return 1;
  const level = s.priority[id];
  return level === 2 || level === 3 ? level : 1;
}

function levelLabel(level) {
  return level === 3 ? "высокий" : level === 2 ? "средний" : "обычный";
}

function chanceMap() {
  const s = room.state;
  const pool = s.students.filter((st) => s.pool.includes(st.id));
  const result = {};
  for (const level of [3, 2, 1]) {
    const band = pool.filter((st) => levelOf(st.id) === level);
    const total = band.reduce((sum, st) => sum + 1 + st.burden, 0);
    for (const st of band) result[st.id] = { level, chance: total > 0 ? (1 + st.burden) / total : 0 };
  }
  const topLevel = [3, 2, 1].find((level) => pool.some((st) => levelOf(st.id) === level));
  return { result, topLevel };
}

function awaitingSession() {
  return room.state.history.find((s) => s.status === "awaiting");
}

function delayFor(index, count, cutoff) {
  if (cutoff >= 0 && index >= cutoff) return room.state.settings.tailScore;
  return count <= 1 ? 0 : index / (count - 1);
}

/* ----- Отрисовка ----- */

function renderRoom() {
  if (!room?.state) return;
  const s = room.state;
  document.title = `${s.title} · zQueue`;

  // Сохраняем введённый текст и фокус, чтобы фоновое обновление их не сбрасывало.
  const kept = {};
  app.querySelectorAll("input[id]").forEach((input) => {
    if (input.type !== "checkbox" && input.type !== "file") kept[input.id] = input.value;
  });
  const focusedId = document.activeElement?.id;

  const role = room.me?.role;
  const historyCount = s.history.length;
  const tabs = [
    ["queue", "Очередь", ""],
    ["history", "История", historyCount ? `<span class="count">${historyCount}</span>` : ""],
    ["settings", "Настройки", ""],
  ];

  app.innerHTML = `
    <header class="topbar">
      <a href="/" data-link class="brand" title="На главную">${ICONS.logo}<span>zQueue</span></a>
      <div class="room-head">
        <h1 class="room-title">${esc(s.title)}</h1>
        <div class="room-meta">
          <button class="code-chip" data-act="copy-room" title="Скопировать ссылку на комнату">${esc(room.code)} ${ICONS.copy}</button>
          <span class="badge ${role || ""}">${role === "owner" ? "Создатель" : role === "editor" ? "Редактор" : "Просмотр"}</span>
        </div>
      </div>
    </header>
    <main class="container">
      ${renderNotice()}
      <nav class="tabs" role="tablist">
        ${tabs
          .map(([id, label, extra]) => `<button class="tab" role="tab" data-tab="${id}" aria-selected="${room.tab === id}">${label}${extra}</button>`)
          .join("")}
      </nav>
      ${room.tab === "queue" ? renderQueueTab() : ""}
      ${room.tab === "history" ? renderHistoryTab() : ""}
      ${room.tab === "settings" ? renderSettingsTab() : ""}
    </main>`;

  for (const [id, value] of Object.entries(kept)) {
    const input = document.getElementById(id);
    if (input) input.value = value;
  }
  if (focusedId) document.getElementById(focusedId)?.focus();
}

function ownKeyLink() {
  const token = getToken(room.code);
  return token ? `${location.origin}/r/${room.code}#key=${encodeURIComponent(token)}` : "";
}

function renderNotice() {
  if (room.notice === "created") {
    return `<div class="notice">
      <div class="grow">
        <p><b>Комната создана.</b> Поделитесь кодом <b>${esc(room.code)}</b> — по нему очередь смогут смотреть все.</p>
        <p class="small">Ваш доступ создателя хранится в этом браузере. Сохраните личную ссылку-ключ, чтобы войти с другого устройства. Никому её не передавайте.</p>
        ${copyFieldHtml(ownKeyLink())}
      </div>
      <button class="btn ghost sm" data-act="dismiss-notice">Готово</button>
    </div>`;
  }
  if (room.notice === "key") {
    return `<div class="notice"><div class="grow"><p><b>Ключ принят.</b> Теперь вы можете вносить изменения как ${esc(room.me?.name ?? "")}.</p></div>
      <button class="btn ghost sm" data-act="dismiss-notice">Ок</button></div>`;
  }
  if (room.notice === "bad-key") {
    return `<div class="notice plain"><div class="grow"><p><b>Ключ не подошёл</b> — возможно, доступ отозвали. Комната открыта для просмотра.</p></div>
      <button class="btn ghost sm" data-act="dismiss-notice">Ок</button></div>`;
  }
  if (!canEdit()) {
    return `<div class="notice plain"><div class="grow"><p class="small">Вы смотрите комнату. Менять очередь могут только создатель и назначенные им редакторы — для этого нужна ссылка-ключ от создателя.</p></div></div>`;
  }
  return "";
}

function renderQueueTab() {
  const s = room.state;
  const edit = canEdit();
  const { result: chances, topLevel } = chanceMap();
  const poolSize = s.pool.length;
  const bandsUsed = new Set(s.pool.map((id) => levelOf(id))).size;

  const people = [...s.students]
    .sort((a, b) => a.name.localeCompare(b.name, "ru"))
    .map((st) => {
      const selected = s.pool.includes(st.id);
      const level = selected ? levelOf(st.id) : 1;
      const info = chances[st.id];
      let chance = `<span class="chance muted">—</span>`;
      if (info) {
        const pct = `${(info.chance * 100).toFixed(1).replace(".", ",")}%`;
        const prefix = s.urgentMode && bandsUsed > 1 ? (level === topLevel ? "" : `${levelLabel(level)} · `) : "";
        chance = `<span class="chance" title="Шанс быть первым${prefix ? " внутри своего уровня" : ""}">${prefix}${pct}</span>`;
      }
      const levelSwitch =
        s.urgentMode && selected
          ? `<div class="level-switch" role="group" aria-label="Уровень срочности">
              ${[3, 2, 1]
                .map(
                  (l) => `<button class="l${l}" aria-pressed="${level === l}" ${edit ? `data-act="level" data-id="${st.id}" data-level="${l}"` : "disabled"}
                    title="${levelLabel(l)}">${l === 3 ? "выс" : l === 2 ? "сред" : "обыч"}</button>`,
                )
                .join("")}
            </div>`
          : "";
      const rowClass = level === 3 ? "high" : level === 2 ? "mid" : selected ? "in-pool" : "";
      const toggle = edit
        ? `<button class="check" role="checkbox" aria-checked="${selected}" aria-label="В пуле" data-act="pool-toggle" data-id="${st.id}">${selected ? ICONS.check : ""}</button>`
        : `<span class="dot ${selected ? "on" : ""}" title="${selected ? "в пуле" : "не в пуле"}"></span>`;
      return `<div class="person ${rowClass}">
          ${toggle}
          <div>
            <div class="name">${esc(st.name)}</div>
            <div class="meta">задержка ${fmtNum(st.burden)} · вес ${fmtNum(1 + st.burden)}</div>
          </div>
          <div class="side">
            ${levelSwitch}
            ${chance}
            ${edit ? `<button class="btn subtle icon" data-act="student-menu" data-id="${st.id}" title="Действия">${ICONS.more}</button>` : ""}
          </div>
        </div>`;
    })
    .join("");

  return `<div class="grid-2">
    <section class="card">
      <div class="card-head">
        <h2>Участники <span class="muted small">· в пуле ${poolSize} из ${s.students.length}</span></h2>
        ${
          edit
            ? `<div class="btn-row">
                <button class="btn subtle sm" data-act="pool-all" ${s.students.length && poolSize < s.students.length ? "" : "disabled"}>Все в пул</button>
                <button class="btn subtle sm" data-act="pool-clear" ${poolSize ? "" : "disabled"}>Очистить пул</button>
              </div>`
            : ""
        }
      </div>
      ${s.students.length ? `<div class="people">${people}</div>` : `<div class="empty" style="margin-top:12px">Список пуст. ${edit ? "Добавьте участников во вкладке «Настройки»." : ""}</div>`}
      <p class="hint">Отметьте тех, кто сдаёт сегодня. Вес = 1 + накопленная задержка, шанс считается только внутри пула.</p>
    </section>
    <div class="stack sticky">
      ${renderDraw()}
      ${renderScoring()}
    </div>
  </div>`;
}

function renderDraw() {
  const s = room.state;
  const edit = canEdit();
  const awaiting = awaitingSession();
  const last = s.history[0];
  const undoLabel = !last ? "Отменить" : last.status === "awaiting" ? "Отменить очередь" : "Отменить начисление";

  let note;
  if (awaiting) {
    note = "Очередь составлена. Когда станет ясно, кто успел сдать, отметьте это ниже и начислите задержку — после этого можно составлять следующую.";
  } else if (s.pool.length) {
    note = `В очереди будет ${s.pool.length} ${plural(s.pool.length, "человек", "человека", "человек")}. Порядок выбирается сразу и окончательно.`;
  } else {
    note = "Отметьте участников, которые сдают сегодня.";
  }

  return `<section class="card">
    <div class="card-head">
      <h2>Жеребьёвка</h2>
      <label class="switch" title="Горящие сроки: участники с высоким уровнем всегда идут раньше">
        <input type="checkbox" data-act="urgent" ${s.urgentMode ? "checked" : ""} ${edit ? "" : "disabled"} />
        <span class="track"></span><span class="small">Горящие сроки</span>
      </label>
    </div>
    ${
      edit
        ? `<div class="toolbar">
            <button class="btn" data-act="create-queue" ${s.pool.length && !awaiting ? "" : "disabled"}>${ICONS.dice} Составить очередь</button>
            <button class="btn danger" data-act="undo" ${last ? "" : "disabled"}>${undoLabel}</button>
          </div>`
        : ""
    }
    <p class="hint">${esc(note)}</p>
    ${
      s.urgentMode
        ? `<div class="stat-row"><span>Высокий: <b>${s.pool.filter((id) => levelOf(id) === 3).length}</b> · средний: <b>${s.pool.filter((id) => levelOf(id) === 2).length}</b></span></div>`
        : ""
    }
  </section>`;
}

function renderScoring() {
  const session = awaitingSession();
  if (!session) return "";
  const edit = canEdit();
  const cutoff = session.unfinishedFrom ? session.order.indexOf(session.unfinishedFrom) : -1;
  const items = session.order
    .map((id, i) => {
      const tail = cutoff >= 0 && i >= cutoff;
      const atCutoff = i === cutoff;
      return `<li class="${tail ? "tail" : ""}">
        <span class="pos">${i + 1}</span>
        <span class="name">${esc(studentName(id))}</span>
        <span class="delta">+${fmtNum(delayFor(i, session.order.length, cutoff))}</span>
        ${edit ? `<button class="btn ${atCutoff ? "danger" : "subtle"} sm" data-act="tail" data-session="${session.id}" data-id="${atCutoff ? "" : id}">${atCutoff ? "Снять" : "Не успели"}</button>` : ""}
      </li>`;
    })
    .join("");
  return `<section class="card">
    <div class="card-head"><h2>Текущая очередь</h2><span class="badge warn">ожидает начисления</span></div>
    <p class="muted small" style="margin:0">${esc(fmtDate(session.createdAt, false))}${session.createdBy ? ` · составитель: ${esc(memberName(session.createdBy))}` : ""}. ${
      cutoff >= 0
        ? `С ${cutoff + 1}-го места и до конца — не успели, им +${fmtNum(room.state.settings.tailScore)}.`
        : "Отметьте первого, кто не успел сдать. Если успели все — начисляйте сразу."
    } Кто не был в очереди, получит +${fmtNum(session.order.length > 1 ? room.state.settings.absenceScore : 0)}.</p>
    <ol class="order">${items}</ol>
    ${edit ? `<div class="toolbar" style="margin-top:14px"><button class="btn" data-act="score" data-session="${session.id}">Начислить задержку</button></div>` : ""}
  </section>`;
}

function priorityLine(session) {
  const lines = [3, 2]
    .map((level) => {
      const names = Object.entries(session.priority || {})
        .filter(([, v]) => v === level)
        .map(([id]) => studentName(id));
      return names.length ? `${levelLabel(level)}: ${names.join(", ")}` : "";
    })
    .filter(Boolean);
  return lines.length ? `<p class="hint">Горящие сроки. ${esc(lines.join(". "))}.</p>` : "";
}

function sessionCard(session, open) {
  const scored = session.status === "scored";
  const items = session.order
    .map((id, i) => {
      const tail = session.unfinished?.includes(id);
      const inc = session.increments?.[id];
      return `<li class="${tail ? "tail" : ""}"><span class="pos">${i + 1}</span><span class="name">${esc(studentName(id))}</span>
        ${typeof inc === "number" ? `<span class="delta">+${fmtNum(inc)}</span>` : ""}</li>`;
    })
    .join("");
  const absent = (session.absent || []).map(studentName);
  const absentInc = session.absent?.length ? session.increments?.[session.absent[0]] : undefined;
  return `<details class="session" ${open ? "open" : ""}>
    <summary>
      <span class="chev">›</span>
      <span class="when">Очередь · ${esc(fmtDate(session.createdAt))}</span>
      <span class="badge">${session.order.length} чел.</span>
      ${scored ? `<span class="badge editor">начислено</span>` : `<span class="badge warn">ожидает начисления</span>`}
    </summary>
    <div class="body">
      ${session.createdBy ? `<p class="muted small" style="margin:0 0 10px">Составитель: ${esc(memberName(session.createdBy))}</p>` : ""}
      <ol class="order" style="margin-top:0">${items}</ol>
      ${priorityLine(session)}
      ${session.unfinished?.length ? `<p class="hint">Не успели: ${esc(session.unfinished.map(studentName).join(", "))}.</p>` : ""}
      ${absent.length ? `<p class="hint">Не сдавали: ${esc(absent.join(", "))}${typeof absentInc === "number" ? ` (+${fmtNum(absentInc)})` : ""}.</p>` : ""}
    </div>
  </details>`;
}

function accessLine(text, actorId, at) {
  return `<div class="access-line">
    <span class="what">${esc(text)}</span>
    <span class="who">${actorId ? `${esc(memberName(actorId))} · ` : ""}${esc(fmtDate(at))}</span>
  </div>`;
}

function renderHistoryTab() {
  const s = room.state;
  const items = s.history.map((session) => ({ at: session.createdAt || "", session }));
  for (const m of s.members) {
    if (m.role === "owner") {
      items.push({ at: s.createdAt, html: accessLine(`Комната создана, создатель — ${m.name}`, null, s.createdAt) });
      continue;
    }
    items.push({ at: m.addedAt, html: accessLine(`Выдан доступ редактора: ${m.name}`, m.addedBy, m.addedAt) });
    if (!m.active && m.revokedAt) {
      items.push({ at: m.revokedAt, html: accessLine(`Отозван доступ: ${m.name}`, m.revokedBy, m.revokedAt) });
    }
  }
  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const firstSession = items.find((item) => item.session)?.session;
  return `<section class="history">
    <p class="muted small" style="margin:0 0 14px">Здесь видно, кто составлял очереди и кто выдавал доступ. Эти записи хранятся в журнале, который нельзя изменить.</p>
    ${items.map((item) => (item.session ? sessionCard(item.session, item.session === firstSession) : item.html)).join("")}
  </section>`;
}


/* ----- Настройки ----- */

function renderSettingsTab() {
  const s = room.state;
  const edit = canEdit();
  const owner = isOwner();
  const members = s.members
    .map(
      (m) => `<li class="${m.active ? "" : "revoked"}">
        <span class="name">${esc(m.name)}${room.me?.id === m.id ? ` <span class="muted small">(вы)</span>` : ""}</span>
        <span class="badge ${m.active ? m.role : ""}">${m.role === "owner" ? "создатель" : m.active ? "редактор" : "отозван"}</span>
        ${owner && m.role !== "owner" && m.active ? `<button class="btn danger sm" data-act="revoke" data-id="${m.id}">Отозвать</button>` : ""}
      </li>`,
    )
    .join("");

  return `<div class="settings-grid">
    ${
      edit
        ? `<section class="card">
            <h2>Новый участник</h2>
            <p class="muted small">Новичок получает задержку, равную медиане группы, чтобы не оказаться ни в начале, ни в конце. Переименовать или удалить участника можно кнопкой «⋯» во вкладке «Очередь».</p>
            <form class="inline-form" data-form="add-student">
              <input id="new-student" class="input" placeholder="Имя участника" autocomplete="off" maxlength="120" required />
              <button class="btn">Добавить</button>
            </form>
          </section>`
        : ""
    }

    <section class="card">
      <h2>Параметры начисления</h2>
      <p class="muted small">Место в очереди даёт от 0 (первый) до 1 (последний). Остальное настраивается здесь.</p>
      <form class="form-grid" data-form="settings">
        <label class="field">Не был в очереди
          <input id="set-absence" class="input" type="number" step="0.05" min="0" max="100" value="${s.settings.absenceScore}" ${edit ? "" : "disabled"} />
        </label>
        <label class="field">Не успел сдать
          <input id="set-tail" class="input" type="number" step="0.05" min="0" max="100" value="${s.settings.tailScore}" ${edit ? "" : "disabled"} />
        </label>
        ${edit ? `<div><button class="btn">Сохранить</button></div>` : ""}
      </form>
    </section>

    <section class="card">
      <h2>Доступ</h2>
      <p class="muted small">Смотреть комнату может любой по коду <b>${esc(room.code)}</b>. Менять — только люди из этого списка.</p>
      <ul class="members">${members}</ul>
      ${
        owner
          ? `<form class="inline-form" data-form="add-member">
              <input id="new-member" class="input" placeholder="Имя редактора" maxlength="60" autocomplete="off" required />
              <button class="btn">Выдать доступ</button>
            </form>
            <p class="hint">Человек получит личную ссылку-ключ. Отправьте её ему лично — по ней он сможет вносить изменения.</p>`
          : ""
      }
    </section>

    ${
      owner
        ? `<section class="card">
            <h2>Комната</h2>
            <form class="form-grid" data-form="rename" style="margin-top:12px">
              <label class="field">Название
                <input id="room-title" class="input" value="${esc(s.title)}" maxlength="80" required />
              </label>
              <div><button class="btn">Переименовать</button></div>
            </form>
            ${
              s.history.length === 0
                ? `<h3>Перенос из старой версии</h3>
                  <p class="muted small" style="margin-top:0">Загрузите queue-data.json — список группы, задержки и история перенесутся в комнату.</p>
                  <label class="btn ghost">Выбрать файл<input type="file" accept="application/json,.json" data-act="import" hidden /></label>`
                : ""
            }
          </section>`
        : ""
    }

    <section class="card">
      <h2>Это устройство</h2>
      ${
        edit
          ? `<p class="muted small">Вы вошли как <b>${esc(room.me.name)}</b>. Ссылка ниже — ваш личный ключ: откройте её на другом устройстве, чтобы войти там. Не передавайте её никому.</p>
            ${copyFieldHtml(ownKeyLink())}
            <div class="toolbar" style="margin-top:14px"><button class="btn danger sm" data-act="forget-key">Выйти на этом устройстве</button></div>`
          : `<p class="muted small">У вас нет доступа к изменениям. Если создатель выдал вам ссылку-ключ, просто откройте её.</p>`
      }
    </section>
  </div>`;
}

/* ----- Действия ----- */

async function studentMenu(id) {
  const st = studentById(id);
  if (!st) return;
  const pick = await dialog({
    title: st.name,
    body: `<p class="muted small" style="margin:0">Задержка ${fmtNum(st.burden)}.</p>`,
    actions: [
      { value: "rename", label: "Переименовать", kind: "ghost" },
      { value: "burden", label: "Изменить задержку", kind: "ghost" },
      { value: "remove", label: "Удалить из списка", kind: "danger" },
      { value: "cancel", label: "Закрыть", kind: "subtle" },
    ],
    column: true,
  });
  if (!pick) return;
  if (pick.action === "rename") {
    const v = await dialog({
      title: "Переименовать",
      fields: [{ name: "name", label: "Имя", value: st.name, required: true }],
    });
    if (v) command({ type: "student.renamed", id, name: v.name }, "Имя изменено");
  } else if (pick.action === "burden") {
    const v = await dialog({
      title: "Изменить задержку",
      body: `<p class="muted small" style="margin:0">${esc(st.name)} · сейчас ${fmtNum(st.burden)}</p>`,
      fields: [
        { name: "burden", label: "Новое значение", type: "number", step: "0.01", min: 0, value: st.burden, required: true },
      ],
    });
    if (v) command({ type: "student.burdenSet", id, burden: v.burden }, "Задержка изменена");
  } else if (pick.action === "remove") {
    const v = await dialog({
      title: "Удалить участника?",
      body: `<p style="margin:0">${esc(st.name)} пропадёт из списка. В прошлых очередях имя останется.</p>`,
      actions: [{ value: "ok", label: "Удалить", kind: "danger" }],
    });
    if (v) command({ type: "student.removed", id }, "Участник удалён");
  }
}

async function addMember(name) {
  const data = await command({ type: "member.added", name }, null);
  if (!data?.token) return;
  const link = `${location.origin}/r/${room.code}#key=${encodeURIComponent(data.token)}`;
  await dialog({
    title: `Ссылка для ${data.event.payload.name}`,
    body: `<p class="muted small" style="margin:0">Отправьте ссылку этому человеку лично. Она показывается один раз — если потеряется, отзовите доступ и выдайте новый.</p>${copyFieldHtml(link)}`,
    actions: [{ value: "ok", label: "Готово" }],
    column: true,
  });
}

async function importFile(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    toast("Не удалось прочитать файл.", "error");
    return;
  }
  const count = Array.isArray(data?.students) ? data.students.length : 0;
  const ok = await dialog({
    title: "Импортировать данные?",
    body: `<p style="margin:0">Список участников (${count}) и история заменят текущие.</p>`,
    actions: [{ value: "ok", label: "Импортировать" }],
  });
  if (ok) command({ type: "room.imported", data }, "Данные перенесены");
}

app.addEventListener("click", async (event) => {
  if (!room?.state) return;
  const tab = event.target.closest("[data-tab]");
  if (tab) {
    room.tab = tab.getAttribute("data-tab");
    renderRoom();
    return;
  }
  const copy = event.target.closest("[data-copy]");
  if (copy) {
    copyText(copy.getAttribute("data-copy"));
    return;
  }
  const el = event.target.closest("[data-act]");
  if (!el || el.tagName === "INPUT") return;
  const id = el.getAttribute("data-id");
  const s = room.state;
  switch (el.getAttribute("data-act")) {
    case "copy-room":
      copyText(`${location.origin}/r/${room.code}`);
      break;
    case "dismiss-notice":
      room.notice = null;
      renderRoom();
      break;
    case "pool-toggle":
      command(s.pool.includes(id) ? { type: "pool.changed", remove: [id] } : { type: "pool.changed", add: [id] });
      break;
    case "pool-all":
      command({ type: "pool.changed", add: s.students.map((st) => st.id) });
      break;
    case "pool-clear":
      command({ type: "pool.changed", remove: [...s.pool] });
      break;
    case "level":
      if (Number(el.getAttribute("data-level")) !== levelOf(id)) {
        command({ type: "priority.set", id, level: Number(el.getAttribute("data-level")) });
      }
      break;
    case "student-menu":
      studentMenu(id);
      break;
    case "create-queue":
      command({ type: "queue.created", pool: [...s.pool] }, "Очередь составлена");
      break;
    case "undo": {
      const last = s.history[0];
      const ok = await dialog({
        title: last.status === "awaiting" ? "Отменить очередь?" : "Отменить начисление?",
        body: `<p style="margin:0">${
          last.status === "awaiting"
            ? "Участники вернутся в пул, задержка не изменится. Запись о том, кто составлял очередь, останется в журнале."
            : "Начисленная задержка будет вычтена, очередь снова будет ждать начисления."
        }</p>`,
        actions: [{ value: "ok", label: "Отменить", kind: "danger" }],
      });
      if (ok) command({ type: "session.undo" }, "Отменено");
      break;
    }
    case "tail":
      command({ type: "session.tailMarked", sessionId: el.getAttribute("data-session"), from: id || null });
      break;
    case "score":
      command({ type: "session.scored", sessionId: el.getAttribute("data-session") }, "Задержка начислена");
      break;
    case "revoke": {
      const m = s.members.find((x) => x.id === id);
      const ok = await dialog({
        title: "Отозвать доступ?",
        body: `<p style="margin:0">${esc(m?.name)} больше не сможет вносить изменения. Запись о выдаче доступа останется в истории.</p>`,
        actions: [{ value: "ok", label: "Отозвать", kind: "danger" }],
      });
      if (ok) command({ type: "member.revoked", id }, "Доступ отозван");
      break;
    }
    case "forget-key": {
      const ok = await dialog({
        title: "Выйти на этом устройстве?",
        body: `<p style="margin:0">Ключ будет удалён из браузера. ${isOwner() ? "Если у вас нет сохранённой ссылки-ключа, доступ создателя будет потерян навсегда." : "Вернуться можно по ссылке-ключу."}</p>`,
        actions: [{ value: "ok", label: "Выйти", kind: "danger" }],
      });
      if (ok) {
        setToken(room.code, null);
        await refresh(true);
      }
      break;
    }
  }
});

app.addEventListener("change", (event) => {
  if (!room?.state) return;
  const act = event.target.getAttribute("data-act");
  if (act === "urgent") {
    event.target.checked = room.state.urgentMode;
    command({ type: "urgent.toggled" });
  } else if (act === "import") {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) importFile(file);
  }
});

app.addEventListener("submit", async (event) => {
  if (!room?.state) return;
  const form = event.target.closest("[data-form]");
  if (!form) return;
  event.preventDefault();
  const kind = form.getAttribute("data-form");
  if (kind === "add-student") {
    const input = document.getElementById("new-student");
    const res = await command({ type: "student.added", name: input.value });
    if (res) {
      const fresh = document.getElementById("new-student");
      fresh.value = "";
      fresh.focus();
    }
  } else if (kind === "add-member") {
    const input = document.getElementById("new-member");
    const name = input.value;
    input.value = "";
    await addMember(name);
  } else if (kind === "settings") {
    command(
      {
        type: "settings.changed",
        absenceScore: document.getElementById("set-absence").value,
        tailScore: document.getElementById("set-tail").value,
      },
      "Параметры сохранены",
    );
  } else if (kind === "rename") {
    command({ type: "room.renamed", title: document.getElementById("room-title").value }, "Название изменено");
  }
});

route();
