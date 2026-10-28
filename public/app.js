import { HOME_SECTIONS, homeSectionsHtml, initHome } from "./home.js";
import { parseNames } from "./names.js";
import { canvasBlob, placesImage, queueImage } from "./share.js";

const app = document.getElementById("app");
const toastEl = document.getElementById("toast");

const TOKENS_KEY = "queue.tokens.v1";
const RECENT_KEY = "queue.recent.v1";
const POLL_MS = 5000;
/** Гость скрыл плашку «Режим просмотра» — больше не показываем в этом браузере. */
const VIEW_NOTICE_KEY = "queue.viewNoticeHidden.v1";

const ICONS = {
  logo: `<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" style="fill:var(--accent)"/><text x="16" y="21.5" text-anchor="middle" font-family="Segoe UI, Inter, system-ui, sans-serif" font-size="15" font-weight="700" letter-spacing="-0.5" style="fill:var(--accent-text)">zQ</text></svg>`,
  copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`,
  chevron: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="16" height="16"><path d="m9 6 6 6-6 6"/></svg>`,
  share: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="15" height="15"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/></svg>`,
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" width="16" height="16"><path d="M18 6 6 18M6 6l12 12"/></svg>`,
  undo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="15" height="15"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>`,
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

/** Дата без времени: «28 октября». */
function fmtDay(iso) {
  try {
    return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
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
function dialog({ title, body = "", fields = [], after = "", actions = [{ value: "ok", label: "Сохранить" }], column = false }) {
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
        ${after}
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
let homeCleanup = null;

function navigate(path) {
  history.pushState(null, "", path);
  route();
}

function route() {
  clearInterval(pollTimer);
  room = null;
  homeCleanup?.();
  homeCleanup = null;
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

function joinFormHtml(id, variant) {
  return `<form class="join-inline ${variant}" data-join>
    <input id="${id}" class="input code-input" placeholder="Код комнаты" maxlength="8" aria-label="Код комнаты"
      autocomplete="off" autocapitalize="characters" spellcheck="false" required />
    <button class="btn">Войти</button>
  </form>`;
}

function renderHome() {
  document.title = "zQueue — электронная очередь на сдачу работ";
  const recent = storage.read(RECENT_KEY, []).slice(0, 4);
  const pages = [{ id: "hero", label: "Главная" }, ...HOME_SECTIONS];
  app.innerHTML = `
    <header class="topbar home-topbar is-hidden">
      <a href="/" data-link class="brand">${ICONS.logo}<span>zQueue</span></a>
      <div class="topbar-actions">
        ${joinFormHtml("code-input-top", "compact")}
        <span class="v-sep" aria-hidden="true"></span>
        <button class="link-btn" type="button" data-home="create">Создать комнату</button>
      </div>
    </header>
    <button class="to-top is-hidden" type="button" aria-label="В начало страницы" title="В начало страницы">${ICONS.chevron}</button>
    <nav class="page-dots" aria-label="Разделы страницы">
      ${pages.map((p) => `<button type="button" data-dot="${p.id}" aria-label="${p.label}" title="${p.label}"></button>`).join("")}
    </nav>
    <main class="home">
      <section class="page hero-page" id="hero" data-page>
        <div class="page-inner">
          <div class="hero">
            <div class="reveal">
              <h1 class="hero-brand">${ICONS.logo}<span>zQueue</span></h1>
              <p class="lead">
                Сервис для создания справедливой очереди на сдачу лабораторных работ:
                порядок определяется жеребьёвкой, а те, кому пришлось ждать дольше,
                получают преимущество при следующей сдаче.
              </p>
            </div>
            <div class="card join reveal">
              <label class="field" for="code-input">Код комнаты</label>
              <form class="join-row" data-join>
                <input id="code-input" class="input code-input" placeholder="ABC123" maxlength="8"
                  autocomplete="off" autocapitalize="characters" spellcheck="false" required />
                <button class="btn">Войти</button>
              </form>
              <p class="field-hint">Нет кода? <button class="link-btn" type="button" data-home="create">Создать комнату</button></p>
              ${
                recent.length
                  ? `<div class="recent">
                      <span class="recent-title">Недавние комнаты</span>
                      ${recent
                        .map(
                          (r) => `<a class="recent-item" href="/r/${esc(r.code)}" data-link>
                            <span class="name">${esc(r.title || "Без названия")}</span>
                            <span class="code">${esc(r.code)}</span>
                          </a>`,
                        )
                        .join("")}
                    </div>`
                  : ""
              }
            </div>
          </div>
          <section class="features reveal">
            <div class="feature">
              <h3>Учёт ожидания</h3>
              <p>Участники, сдававшие последними, получают приоритет в следующий раз.</p>
            </div>
            <div class="feature">
              <h3>Отдельные комнаты</h3>
              <p>Для каждой дисциплины ведётся своя очередь и история.</p>
            </div>
            <div class="feature">
              <h3>Контроль доступа</h3>
              <p>Изменения вносят только создатель и назначенные им редакторы.</p>
            </div>
          </section>
        </div>
        <button class="scroll-cue" type="button" data-dot="principle" aria-label="Подробнее">
          <span>Подробнее</span>${ICONS.chevron}
        </button>
      </section>
      ${homeSectionsHtml(joinFormHtml("code-input-bottom", "wide"))}
    </main>
    ${siteFooter("home-footer is-hidden")}`;

  app.querySelectorAll("[data-home='create']").forEach((btn) => btn.addEventListener("click", createRoomDialog));
  homeCleanup = initHome(app);

  app.querySelectorAll("[data-join]").forEach((form) => {
    const input = form.querySelector("input");
    input.addEventListener("input", () => {
      input.value = normalizeCode(input.value).slice(0, 6);
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const code = normalizeCode(input.value);
      if (code.length !== 6) {
        toast("Код комнаты состоит из 6 символов.", "error");
        return;
      }
      navigate(`/r/${code}`);
    });
  });
  if (!matchMedia("(max-width: 640px)").matches) document.getElementById("code-input").focus({ preventScroll: true });
}

/** Как DEFAULT_SETTINGS в src/domain.ts. */
const DEFAULT_SETTINGS = { absenceScore: 0.5, tailScore: 1, drawMode: "relative", beta: 2.5, sigma: 0.35 };

async function createRoomDialog() {
  const pending = dialog({
    title: "Создание комнаты",
    body: `<p class="muted small" style="margin:0">Создатель комнаты управляет очередью и предоставляет доступ редакторам.</p>`,
    fields: [
      { name: "title", label: "Дисциплина", placeholder: "Компьютерная графика", required: true },
      { name: "name", label: "Ваше имя", placeholder: "Фамилия Имя", required: true },
    ],
    after: `${bulkFieldHtml("Список группы")}
      <details class="advanced">
        <summary>Дополнительные параметры</summary>
        ${settingsFieldsHtml(DEFAULT_SETTINGS)}
        <p class="field-hint">Параметры можно изменить позже на вкладке «Настройки».</p>
      </details>`,
    actions: [{ value: "ok", label: "Создать" }],
  });
  const submit = document.querySelector('dialog[open] button[value="ok"]');
  watchBulkField([], (count) => {
    submit.textContent = count ? `Создать и добавить ${count}` : "Создать";
  });
  const values = await pending;
  if (!values) return;
  const names = parseNames(values.names);
  let data;
  try {
    data = await api("/api/rooms", {
      method: "POST",
      body: { title: values.title, name: values.name, settings: settingsValues(values) },
    });
  } catch (err) {
    toast(err.message, "error");
    return;
  }
  setToken(data.code, data.token);
  rememberRoom(data.code, data.state.title);
  justCreated = data.code;
  if (names.length) {
    try {
      await api(`/api/rooms/${data.code}/commands`, {
        method: "POST",
        body: { type: "students.added", names },
        code: data.code,
      });
    } catch (err) {
      toast(`Комната создана, но список группы не добавлен: ${err.message} Добавьте его в настройках.`, "error");
    }
  }
  navigate(`/r/${data.code}`);
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
    <div class="loading">Загрузка…</div>`;
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

/** Плашка внизу страниц. На стартовой она закреплена и скрыта на первом слайде. */
function siteFooter(extra = "") {
  return `<footer class="site-footer ${extra}">
    <span class="site-footer-brand">${ICONS.logo}zQueue</span>
    <span class="sep" aria-hidden="true"></span>
    <span class="site-footer-credit">made by <b>zubko</b></span>
  </footer>`;
}

function renderMissing(code) {
  app.innerHTML = `
    <header class="topbar"><a href="/" data-link class="brand">${ICONS.logo}<span>zQueue</span></a></header>
    <main class="container">
      <div class="card" style="max-width:480px;margin:10vh auto;text-align:center">
        <h2 style="margin-bottom:8px">Комната не найдена</h2>
        <p class="muted">Комната с кодом <span class="mono">${esc(code)}</span> не существует. Проверьте правильность кода: 6 латинских букв и цифр.</p>
        <a class="btn" href="/" data-link>На главную</a>
      </div>
    </main>
    ${siteFooter()}`;
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

const DRAW_MODES = [
  {
    value: "relative",
    label: "По разнице приоритетов (рекомендовано)",
    hint: "Жеребьёвка, в которой шансы тем выше, чем дольше участник ждал раньше. Важна только разница приоритетов, поэтому преимущество не ослабевает к концу семестра. Сила компенсации задаёт, насколько велико это преимущество.",
    details: [
      "Вес участника w = e^(β·p), где p — накопленный приоритет, β — сила компенсации.",
      "Порядок тянется как лотерея без возвращения: первым становится участник с вероятностью w / Σw, затем так же среди оставшихся.",
      "Важна только разница приоритетов: при разнице Δp шансы отличаются в e^(β·Δp) раз (при β = 2,5 и Δp = 1 — примерно в 12 раз). Поэтому преимущество не ослабевает со временем.",
    ],
  },
  {
    value: "debt",
    label: "Упорядочивание по приоритету",
    hint: "Участники выстраиваются по убыванию приоритета, а случайный разброс перемешивает тех, у кого он близок. Чем меньше разброс, тем строже порядок.",
    details: [
      "Ключ участника k = p + σ·ε, где p — накопленный приоритет, σ — случайный разброс, ε — случайное число из стандартного нормального распределения.",
      "Очередь — участники по убыванию ключа.",
      "Участник с приоритетом на Δp больше окажется раньше с вероятностью Φ(Δp / (σ·√2)): при σ = 0,35 и Δp = 1 — около 98 %, при Δp = 0,2 — около 66 %.",
    ],
  },
  {
    value: "random",
    label: "Полностью случайно",
    hint: "У всех равные шансы, приоритет на порядок не влияет (но продолжает начисляться).",
    details: [
      "Все порядки равновероятны: каждый участник оказывается на любом месте с вероятностью 1/n.",
      "Приоритет на порядок не влияет, но продолжает начисляться — он пригодится, если позже выбрать другой способ.",
    ],
  },
  {
    value: "legacy",
    label: "Legacy формула",
    hint: "Вероятность пропорциональна 1 + p. Преимущество небольшое и уменьшается по мере накопления приоритета у всех участников.",
    details: [
      "Вес участника w = 1 + p, порядок тянется как лотерея без возвращения: первым — с вероятностью w / Σw, затем так же среди оставшихся.",
      "Важна абсолютная величина приоритета: когда он вырастет у всех, относительная разница весов уменьшится и преимущество ослабнет (веса 1 и 2 отличаются вдвое, а 6 и 7 — лишь на 17 %).",
      "Способ сохранён для комнат, созданных до появления выбора.",
    ],
  },
];

function drawModeLabel(mode) {
  return DRAW_MODES.find((m) => m.value === mode)?.label ?? mode;
}

/** Ключ жеребьёвки, как на сервере (drawKey в src/domain.ts): чем меньше, тем раньше. */
function drawKey(burden, settings, random) {
  const u = Math.max(random(), Number.EPSILON);
  switch (settings.drawMode) {
    case "relative":
      return Math.log(-Math.log(u)) - settings.beta * burden;
    case "debt":
      return -burden + settings.sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
    case "random":
      return u;
    default:
      return -Math.log(u) / (1 + burden);
  }
}

function chanceMap() {
  const s = room.state;
  const { drawMode, beta } = s.settings;
  // Если никто не отмечен — считаем для всей группы, как в таблице вероятностей мест.
  const selected = s.students.filter((st) => s.pool.includes(st.id));
  const pool = selected.length ? selected : s.students;
  const result = {};
  // Для упорядочивания формулы нет — берём долю первых мест из моделирования.
  const simulated = drawMode === "debt" && pool.length ? placeTable().rows : null;
  for (const level of [3, 2, 1]) {
    const band = pool.filter((st) => levelOf(st.id) === level);
    if (simulated) {
      for (const row of simulated) if (row.level === level) result[row.st.id] = { level, chance: row.probs[0] };
      continue;
    }
    // e^(β·p) считаем от максимума в группе, чтобы не было переполнения.
    const top = Math.max(...band.map((st) => st.burden));
    const weight = (st) =>
      drawMode === "relative" ? Math.exp(beta * (st.burden - top)) : drawMode === "random" ? 1 : 1 + st.burden;
    const total = band.reduce((sum, st) => sum + weight(st), 0);
    for (const st of band) result[st.id] = { level, chance: total > 0 ? weight(st) / total : 0 };
  }
  const topLevel = [3, 2, 1].find((level) => pool.some((st) => levelOf(st.id) === level));
  return { result, topLevel };
}

let placeCache = { key: "", value: null };

/**
 * Вероятность каждого места для каждого отмеченного участника (если никто не
 * отмечен — для всех). Повторяет жеребьёвку сервера (выбранным способом внутри
 * уровней 3 → 2 → 1) много раз с фиксированным зерном, чтобы таблица не
 * менялась от перерисовки к перерисовке.
 */
function placeTable() {
  const s = room.state;
  const selected = s.students.filter((st) => s.pool.includes(st.id));
  const pool = selected.length ? selected : s.students;
  const settings = s.settings;
  const key = JSON.stringify([settings, pool.map((st) => [st.id, st.name, st.burden, levelOf(st.id)])]);
  if (placeCache.key === key) return placeCache.value;
  const rows = [];
  let seed = 0x9e3779b9;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let offset = 0;
  for (const level of [3, 2, 1]) {
    const band = pool.filter((st) => levelOf(st.id) === level);
    const n = band.length;
    if (!n) continue;
    const counts = band.map(() => new Float64Array(n));
    const runs = n === 1 ? 1 : Math.max(2000, Math.min(20000, Math.floor(1.5e6 / n)));
    const keys = new Float64Array(n);
    const idx = band.map((_, i) => i);
    for (let r = 0; r < runs; r++) {
      for (let i = 0; i < n; i++) keys[i] = drawKey(band[i].burden, settings, random);
      idx.sort((a, b) => keys[a] - keys[b]);
      for (let place = 0; place < n; place++) counts[idx[place]][place]++;
    }
    band.forEach((st, i) => {
      const probs = Array.from(counts[i], (c) => c / runs);
      const mean = probs.reduce((sum, p, place) => sum + p * (offset + place + 1), 0);
      rows.push({ st, level, offset, probs, mean });
    });
    offset += n;
  }
  rows.sort((a, b) => a.mean - b.mean);
  placeCache = { key, value: { rows, total: pool.length } };
  return placeCache.value;
}

/**
 * Текст клетки таблицы вероятностей. Пустая клетка — место недостижимо (другой
 * уровень срочности); внутри своего уровня любое место возможно, даже если
 * моделирование его не выдало.
 */
function placeText(p, reachable) {
  if (!reachable) return "";
  const v = p * 100;
  return v < 0.5 ? "<1%" : `${Math.round(v)}%`;
}

function shareButton(act) {
  return `<button class="btn ghost sm" data-act="${act}">${ICONS.share}Поделиться</button>`;
}

function renderPlaces() {
  const { rows, total } = placeTable();
  if (!total) return "";
  const head = Array.from({ length: total }, (_, i) => `<th>${i + 1}</th>`).join("");
  const body = rows
    .map(({ st, level, offset, probs, mean }) => {
      const cells = Array.from({ length: total }, (_, place) => {
        const reachable = place >= offset && place < offset + probs.length;
        const p = reachable ? probs[place - offset] : 0;
        const shade = Math.round(Math.min(1, p) * 85);
        const exact = reachable && p < 0.001 ? "<0,1" : (p * 100).toFixed(1).replace(".", ",");
        return `<td style="--p:${shade}%" class="${p >= 0.5 ? "hot" : ""}" title="${esc(st.name)} — ${place + 1} место: ${exact} %">${placeText(p, reachable)}</td>`;
      }).join("");
      const tag = room.state.urgentMode && level > 1 ? ` <span class="muted small">(${levelLabel(level)})</span>` : "";
      return `<tr><th class="name-col">${esc(st.name)}${tag}</th><td class="mean-col">${fmtNum(Math.round(mean * 10) / 10)}</td>${cells}</tr>`;
    })
    .join("");
  return `<section class="card places">
    <div class="card-head"><h2>Вероятности мест</h2>${shareButton("share-places")}</div>
    <div class="place-table-wrap" id="place-table"><table class="place-table">
      <thead><tr><th class="name-col">Участник</th><th class="mean-col">Ср. место</th>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table></div>
  </section>`;
}

function awaitingSession() {
  return room.state.history.find((s) => s.status === "awaiting");
}

function lastActiveSession() {
  return room.state.history.find((s) => s.status !== "cancelled");
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
  const placeScroll = document.getElementById("place-table");
  const scroll = placeScroll ? [placeScroll.scrollLeft, placeScroll.scrollTop] : null;

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
    </main>
    ${siteFooter()}`;

  for (const [id, value] of Object.entries(kept)) {
    const input = document.getElementById(id);
    if (input) input.value = value;
  }
  if (focusedId) document.getElementById(focusedId)?.focus();
  const places = document.getElementById("place-table");
  if (places && scroll) [places.scrollLeft, places.scrollTop] = scroll;
}

function ownKeyLink() {
  const token = getToken(room.code);
  return token ? `${location.origin}/r/${room.code}#key=${encodeURIComponent(token)}` : "";
}

function renderNotice() {
  if (room.notice === "created") {
    return `<div class="notice">
      <div class="grow">
        <p><b>Комната создана.</b> Код комнаты — <b class="mono">${esc(room.code)}</b>. Он необходим участникам для просмотра очереди.</p>
        <p class="small muted">Права создателя сохранены в этом браузере. Для входа с другого устройства используйте персональную ссылку доступа. Не передавайте её другим лицам.</p>
        ${copyFieldHtml(ownKeyLink())}
      </div>
      <button class="btn ghost sm" data-act="dismiss-notice">Закрыть</button>
    </div>`;
  }
  if (room.notice === "key") {
    return `<div class="notice"><div class="grow"><p><b>Ссылка доступа принята.</b> Вы вошли как ${esc(room.me?.name ?? "")}.</p></div>
      <button class="btn ghost sm" data-act="dismiss-notice">Закрыть</button></div>`;
  }
  if (room.notice === "bad-key") {
    return `<div class="notice"><div class="grow"><p><b>Ссылка доступа недействительна.</b> Возможно, доступ был отозван. Комната доступна только для просмотра.</p></div>
      <button class="btn ghost sm" data-act="dismiss-notice">Закрыть</button></div>`;
  }
  if (!canEdit() && !storage.read(VIEW_NOTICE_KEY, false)) {
    return `<div class="notice"><p class="small grow">Режим просмотра. Вносить изменения могут создатель комнаты и назначенные им редакторы.</p>
      <button class="btn ghost icon" data-act="dismiss-view-notice" aria-label="Скрыть" title="Скрыть">${ICONS.close}</button></div>`;
  }
  return "";
}

function levelSwitchHtml(st, level, edit) {
  return `<div class="level-switch" role="group" aria-label="Приоритет по срокам">
    ${[3, 2, 1]
      .map(
        (l) => `<button class="l${l}" aria-pressed="${level === l}" ${edit ? `data-act="level" data-id="${st.id}" data-level="${l}"` : "disabled"}>${levelLabel(l)}</button>`,
      )
      .join("")}
  </div>`;
}

function renderQueueTab() {
  // Новую очередь нельзя сформировать, пока не подведены итоги прошлой, поэтому
  // список участников на это время скрыт.
  if (awaitingSession()) return `${renderScoring()}${renderPlaces()}`;
  const s = room.state;
  const edit = canEdit();
  const { result: chances, topLevel } = chanceMap();
  const poolSize = s.pool.length;
  const bandsUsed = new Set(s.pool.map((id) => levelOf(id))).size;

  const rows = [...s.students]
    .sort((a, b) => a.name.localeCompare(b.name, "ru"))
    .map((st) => {
      const selected = s.pool.includes(st.id);
      const level = selected ? levelOf(st.id) : 1;
      const info = chances[st.id];
      let chance = `<span class="muted">—</span>`;
      if (info) {
        const pct = info.chance > 0 && info.chance < 0.0005 ? "<0,1 %" : `${(info.chance * 100).toFixed(1).replace(".", ",")} %`;
        const note = s.urgentMode && bandsUsed > 1 && level !== topLevel ? `<span class="muted small chance-note" title="Шанс быть первым среди участников с уровнем «${levelLabel(level)}»"> внутри уровня</span>` : "";
        chance = `${pct}${note}`;
      }
      const toggle = edit
        ? `<button class="check" role="checkbox" aria-checked="${selected}" aria-label="Сдаёт" data-act="pool-toggle" data-id="${st.id}">${selected ? ICONS.check : ""}</button>`
        : `<span class="dot ${selected ? "on" : ""}" title="${selected ? "сдаёт" : "не сдаёт"}"></span>`;
      return `<div class="trow ${selected ? "selected" : ""}">
        <span>${toggle}</span>
        <span class="cell-name">
          <span class="name">${esc(st.name)}</span>
          <span class="meta-mobile">Приоритет: ${fmtNum(st.burden)}</span>
          ${s.urgentMode && selected ? levelSwitchHtml(st, level, edit) : ""}
        </span>
        <span class="num col-prio">${fmtNum(st.burden)}</span>
        <span class="num">${chance}</span>
        <span class="act">${edit ? `<button class="btn ghost icon" data-act="student-menu" data-id="${st.id}" aria-label="Действия">${ICONS.more}</button>` : ""}</span>
      </div>`;
    })
    .join("");

  return `<div class="${edit ? "grid-2" : ""}">
    <section class="card">
      <div class="card-head">
        <div>
          <h2>Участники</h2>
          <p class="muted small" style="margin:2px 0 0">Отмечено: ${poolSize} из ${s.students.length}</p>
        </div>
        ${
          edit
            ? `<div class="btn-row">
                <button class="btn ghost sm" data-act="pool-all" ${s.students.length && poolSize < s.students.length ? "" : "disabled"}>Отметить всех</button>
                <button class="btn ghost sm" data-act="pool-clear" ${poolSize ? "" : "disabled"}>Снять отметки</button>
              </div>`
            : ""
        }
      </div>
      ${
        s.students.length
          ? `<div class="table roster">
              <div class="trow thead"><span></span><span>ФИО</span><span class="num col-prio">Приоритет</span><span class="num col-chance">Шанс быть первым</span><span></span></div>
              ${rows}
            </div>`
          : `<div class="empty">Список участников пуст.${edit ? " Добавьте участников на вкладке «Настройки»." : ""}</div>`
      }
      <p class="hint">Отметьте участников, сдающих работы на текущем занятии.</p>
    </section>
    ${edit ? `<div class="stack sticky">${renderDraw()}</div>` : ""}
  </div>
  ${renderPlaces()}`;
}

function renderDraw() {
  const s = room.state;
  const edit = canEdit();
  const last = lastActiveSession();

  let note;
  if (s.pool.length) {
    note = `Будет сформирована очередь из ${s.pool.length} ${plural(s.pool.length, "участника", "участников", "участников")}.`;
  } else {
    note = "Отметьте участников, сдающих работы на текущем занятии.";
  }

  return `<section class="card">
    <div class="card-head">
      <h2>Формирование очереди</h2>
      <label class="switch" title="Участники с более высоким уровнем всегда располагаются раньше">
        <input type="checkbox" data-act="urgent" ${s.urgentMode ? "checked" : ""} ${edit ? "" : "disabled"} />
        <span class="track"></span><span class="small">Приоритет по срокам</span>
      </label>
    </div>
    <p class="muted small" style="margin:0">${esc(note)}</p>
    ${
      s.urgentMode
        ? `<p class="muted small" style="margin:8px 0 0">Высокий уровень: ${s.pool.filter((id) => levelOf(id) === 3).length} · средний: ${s.pool.filter((id) => levelOf(id) === 2).length}</p>`
        : ""
    }
    ${
      edit
        ? `<div class="toolbar" style="margin-top:16px">
            <button class="btn" data-act="create-queue" ${s.pool.length ? "" : "disabled"}>Сформировать очередь</button>
            ${
              last
                ? `<button class="btn ghost" data-act="undo" title="Вычесть начисления и вернуть очередь к подведению итогов">${ICONS.undo}Отменить итоги очереди от ${esc(fmtDay(last.createdAt))}</button>`
                : ""
            }
          </div>`
        : ""
    }
  </section>`;
}

/**
 * Подведение итогов текущей очереди. Очередь идёт по порядку, поэтому отметка
 * «не успел» ставится на первого несдавшего и распространяется на всех после него.
 */
function renderScoring() {
  const session = awaitingSession();
  if (!session) return "";
  const edit = canEdit();
  if (!edit) return renderCurrentQueue(session);
  const settings = room.state.settings;
  const order = session.order;
  const cutoff = session.unfinishedFrom ? order.indexOf(session.unfinishedFrom) : -1;
  const done = cutoff >= 0 ? cutoff : order.length;
  const rows = order
    .map((id, i) => {
      const tail = cutoff >= 0 && i >= cutoff;
      // «Сдал» → с этого участника начинается хвост; «Не успел» → он и все до него сдали.
      const next = tail ? order[i + 1] ?? "" : id;
      const status = tail
        ? `<span class="result-tag is-tail">Не успел</span>`
        : `<span class="result-tag is-done">Сдал</span>`;
      return `<div class="trow ${tail ? "tail" : ""}">
        <span class="num pos">${i + 1}</span>
        <span class="cell-name"><span class="name">${esc(studentName(id))}</span></span>
        <span class="num muted">+${fmtNum(delayFor(i, order.length, cutoff))}</span>
        <span class="act">${
          edit
            ? `<button class="result-toggle" data-act="tail" data-session="${session.id}" data-id="${next}"
                title="${tail ? "Отметить, что сдал" : "Отметить, что не успел (вместе со всеми после)"}">${status}</button>`
            : status
        }</span>
      </div>`;
    })
    .join("");
  const summary =
    cutoff >= 0
      ? `Сдали <b>${done}</b> из ${order.length}, не успели <b>${order.length - done}</b>`
      : `Все ${order.length} ${plural(order.length, "участник", "участника", "участников")} отмечены как сдавшие`;
  return `<section class="card scoring">
    <div class="card-head">
      <div>
        <h2>Подведение итогов</h2>
        <p class="muted small" style="margin:2px 0 0">Очередь от ${esc(fmtDate(session.createdAt, false))}${session.createdBy ? ` · составитель: ${esc(memberName(session.createdBy))}` : ""}</p>
      </div>
      <div class="btn-row">
        <span class="badge">Ожидает подведения итогов</span>
        ${shareButton("share-queue")}
      </div>
    </div>
    ${
      edit
        ? `<ol class="scoring-steps">
            <li>Если кто-то не успел сдать работу, нажмите «Сдал» напротив <b>первого</b> такого участника — все после него тоже отметятся как не успевшие.</li>
            <li>Нажмите «Подвести итоги». Если успели все, сразу нажмите «Сдали все».</li>
          </ol>`
        : ""
    }
    <div class="table order-table result-table">
      <div class="trow thead"><span class="num">№</span><span>Участник</span><span class="num">Начисление</span><span class="act">Результат</span></div>
      ${rows}
    </div>
    <p class="scoring-summary">${summary}.</p>
    <p class="hint" style="margin-top:4px">Не успевшим начисляется +${fmtNum(settings.tailScore)}, участникам, не включённым в очередь, — +${fmtNum(order.length > 1 ? settings.absenceScore : 0)}.</p>
    ${
      edit
        ? `<div class="toolbar scoring-actions">
            ${
              cutoff >= 0
                ? `<button class="btn" data-act="score" data-session="${session.id}">Подвести итоги</button>
                   <button class="btn ghost" data-act="all-done" data-session="${session.id}">Сдали все</button>`
                : `<button class="btn" data-act="all-done" data-session="${session.id}">Сдали все</button>`
            }
            <button class="btn danger" data-act="undo">Отменить очередь</button>
          </div>`
        : ""
    }
  </section>`;
}

/** Текущая очередь для гостей: только порядок, без управления итогами. */
function renderCurrentQueue(session) {
  const rows = session.order
    .map(
      (id, i) => `<div class="trow">
        <span class="num pos">${i + 1}</span>
        <span class="cell-name"><span class="name">${esc(studentName(id))}</span></span>
      </div>`,
    )
    .join("");
  return `<section class="card">
    <div class="card-head">
      <div>
        <h2>Текущая очередь</h2>
        <p class="muted small" style="margin:2px 0 0">${esc(fmtDate(session.createdAt, false))} · ${session.order.length} ${plural(session.order.length, "участник", "участника", "участников")}</p>
      </div>
      ${shareButton("share-queue")}
    </div>
    <div class="table guest-queue">${rows}</div>
  </section>`;
}

function priorityLine(session) {
  const lines = [3, 2]
    .map((level) => {
      const names = Object.entries(session.priority || {})
        .filter(([, v]) => v === level)
        .map(([id]) => studentName(id));
      return names.length ? `${levelLabel(level)} уровень — ${names.join(", ")}` : "";
    })
    .filter(Boolean);
  return lines.length ? `<p class="hint">Приоритет по срокам: ${esc(lines.join("; "))}.</p>` : "";
}

function sessionCard(session, open) {
  const scored = session.status === "scored";
  const cancelled = session.status === "cancelled";
  const badge = cancelled
    ? `<span class="badge cancelled">Отменена</span>`
    : `<span class="badge ${scored ? "" : "strong"}">${scored ? "Итоги подведены" : "Ожидает подведения итогов"}</span>`;
  const rows = session.order
    .map((id, i) => {
      const tail = session.unfinished?.includes(id);
      const inc = session.increments?.[id];
      return `<div class="trow ${tail ? "tail" : ""}">
        <span class="num pos">${i + 1}</span>
        <span class="cell-name"><span class="name">${esc(studentName(id))}</span></span>
        <span class="num">${typeof inc === "number" ? `+${fmtNum(inc)}` : "—"}</span>
      </div>`;
    })
    .join("");
  const absent = (session.absent || []).map(studentName);
  const absentInc = session.absent?.length ? session.increments?.[session.absent[0]] : undefined;
  const count = session.order.length;
  return `<details class="session${cancelled ? " is-cancelled" : ""}" ${open ? "open" : ""}>
    <summary>
      <span class="chev">${ICONS.chevron}</span>
      <span class="when">Очередь от ${esc(fmtDate(session.createdAt))}</span>
      <span class="muted small">${count} ${plural(count, "участник", "участника", "участников")}</span>
      ${badge}
    </summary>
    <div class="body">
      ${session.createdBy ? `<p class="muted small" style="margin:0 0 10px">Составитель: ${esc(memberName(session.createdBy))}</p>` : ""}
      ${
        cancelled
          ? `<p class="cancel-note">Очередь отменена${session.cancelledBy ? `: ${esc(memberName(session.cancelledBy))}` : ""}${session.cancelledAt ? `, ${esc(fmtDate(session.cancelledAt))}` : ""}. Начисления не производились.</p>`
          : ""
      }
      <div class="table history-table">
        <div class="trow thead"><span class="num">№</span><span>Участник</span><span class="num">Начислено</span></div>
        ${rows}
      </div>
      ${priorityLine(session)}
      ${session.unfinished?.length ? `<p class="hint">Не сдали работу: ${esc(session.unfinished.map(studentName).join(", "))}.</p>` : ""}
      ${absent.length ? `<p class="hint">Не участвовали в очереди: ${esc(absent.join(", "))}${typeof absentInc === "number" ? ` (начислено +${fmtNum(absentInc)})` : ""}.</p>` : ""}
    </div>
  </details>`;
}

function logLine(text, actorId, at, important = false) {
  return `<div class="access-line ${important ? "is-important" : ""}">
    <span class="what">${esc(text)}</span>
    <span class="who">${actorId ? `Автор: ${esc(memberName(actorId))} · ` : ""}${esc(fmtDate(at))}</span>
  </div>`;
}

/** Загружает журнал комнаты целиком (он только растёт, страницами по 200). */
async function loadJournal() {
  const current = room;
  const seq = current.seq;
  current.journalLoading = true;
  try {
    const events = [];
    let before = "";
    for (;;) {
      const page = await api(`/api/rooms/${current.code}/events?limit=200${before}`);
      events.push(...page.events);
      if (page.events.length < 200) break;
      before = `&before=${page.events[page.events.length - 1].seq}`;
    }
    current.journal = { seq, events };
  } catch {
    // Покажем историю по снимку; повторим, когда комната изменится.
    current.journalFailed = seq;
  } finally {
    current.journalLoading = false;
  }
  if (room === current && room.tab === "history") renderRoom();
}

function sessionDate(id) {
  const session = room.state.history.find((s) => s.id === id);
  return session ? fmtDate(session.createdAt) : "—";
}

/** Текст записи журнала. null — запись показывается карточкой очереди. */
function eventText(e) {
  const p = e.payload;
  const names = (list) => list.map((x) => x.name).join(", ");
  switch (e.type) {
    case "room.created":
      return `Комната создана. Создатель: ${p.owner?.name ?? ""}`;
    case "room.renamed":
      return p.from ? `Комната переименована: «${p.from}» → «${p.to}»` : `Комната переименована: «${p.to}»`;
    case "room.imported":
      return `Перенесены данные из файла: ${p.students.length} ${plural(p.students.length, "участник", "участника", "участников")}, ${p.history.length} ${plural(p.history.length, "очередь", "очереди", "очередей")}. Прежний список заменён`;
    case "member.added":
      return `Предоставлен доступ редактора: ${p.name}`;
    case "member.revoked":
      return `Доступ отозван: ${p.name}`;
    case "settings.changed": {
      const part = (label, key) =>
        p.from && p.from[key] === p.to[key] ? "" : `${label} ${p.from ? `${fmtNum(p.from[key])} → ` : ""}${fmtNum(p.to[key])}`;
      const scoring = [part("отсутствие в очереди", "absenceScore"), part("работа не сдана", "tailScore")].filter(Boolean);
      // Записи до появления выбора жеребьёвки не содержат её параметров.
      const draw =
        p.to.drawMode === undefined
          ? []
          : [
              p.from?.drawMode === p.to.drawMode ? "" : `способ «${drawModeLabel(p.from?.drawMode ?? "legacy")}» → «${drawModeLabel(p.to.drawMode)}»`,
              part("β", "beta"),
              part("σ", "sigma"),
            ].filter(Boolean);
      return [
        scoring.length ? `Изменены параметры начислений: ${scoring.join("; ")}` : "",
        draw.length ? `Изменены параметры жеребьёвки: ${draw.join("; ")}` : "",
      ]
        .filter(Boolean)
        .join(". ");
    }
    case "student.added":
      return `Добавлен участник: ${p.name} (приоритет ${fmtNum(p.burden)})`;
    case "students.added":
      return `Добавлены участники (${p.students.length}, приоритет ${fmtNum(p.students[0]?.burden ?? 0)}): ${names(p.students)}`;
    case "student.removed":
      return `Удалён участник: ${p.name ?? studentName(p.id)}${typeof p.burden === "number" ? ` (приоритет ${fmtNum(p.burden)})` : ""}`;
    case "student.renamed":
      return `Участник переименован: ${p.from ?? ""} → ${p.to}`;
    case "student.burdenSet":
      return `Приоритет изменён вручную: ${p.name ?? studentName(p.id)}, ${typeof p.from === "number" ? `${fmtNum(p.from)} → ` : ""}${fmtNum(p.to)}`;
    case "session.cancelled":
      return `Отменена очередь от ${sessionDate(p.sessionId)}`;
    case "session.scored":
      return `Подведены итоги очереди от ${sessionDate(p.sessionId)}`;
    case "session.scoreReverted":
      return `Отменено начисление по очереди от ${sessionDate(p.sessionId)}`;
    default:
      return null;
  }
}

/** История по снимку — пока журнал не загружен. */
function snapshotItems() {
  const s = room.state;
  const items = [];
  for (const m of s.members) {
    if (m.role === "owner") {
      items.push({ at: s.createdAt, html: logLine(`Комната создана. Создатель: ${m.name}`, null, s.createdAt) });
      continue;
    }
    items.push({ at: m.addedAt, html: logLine(`Предоставлен доступ редактора: ${m.name}`, m.addedBy, m.addedAt) });
    if (!m.active && m.revokedAt) {
      items.push({ at: m.revokedAt, html: logLine(`Доступ отозван: ${m.name}`, m.revokedBy, m.revokedAt) });
    }
  }
  return items;
}

function renderHistoryTab() {
  const s = room.state;
  if (room.journal?.seq !== room.seq && !room.journalLoading && room.journalFailed !== room.seq) loadJournal();
  const items = s.history.map((session) => ({ at: session.createdAt || "", order: 0, session }));
  if (room.journal) {
    for (const e of room.journal.events) {
      const text = eventText(e);
      const actor = e.type === "room.created" ? null : e.actorId;
      // Ручное изменение приоритета влияет на порядок в обход жеребьёвки — выделяем.
      const important = e.type === "student.burdenSet";
      if (text) items.push({ at: e.createdAt, order: e.seq, html: logLine(text, actor, e.createdAt, important) });
    }
  } else {
    items.push(...snapshotItems());
  }
  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.order - a.order));
  const firstSession = items.find((item) => item.session)?.session;
  return `<div class="history-head">
    <h2>Журнал</h2>
    <p class="muted small">Все действия, влияющие на порядок очереди и начисления: состав группы, ручные изменения приоритета, параметры, очереди и их итоги, доступ. Записи журнала невозможно изменить.</p>
  </div>
  <section class="history">
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
      (m) => `<div class="trow ${m.active ? "" : "revoked"}">
        <span class="cell-name"><span class="name">${esc(m.name)}${room.me?.id === m.id ? ` <span class="muted small">(вы)</span>` : ""}</span></span>
        <span class="muted small">${m.role === "owner" ? "Создатель" : m.active ? "Редактор" : "Доступ отозван"}</span>
        <span class="act">${owner && m.role !== "owner" && m.active ? `<button class="btn ghost sm" data-act="revoke" data-id="${m.id}">Отозвать</button>` : ""}</span>
      </div>`,
    )
    .join("");

  // Две независимые колонки: высокая карточка параметров не растягивает соседние.
  return `<div class="settings-grid">
    <div class="stack">
    <section class="card">
      <h2>Параметры очереди</h2>
      <p class="muted small">Как накопленный приоритет влияет на порядок и сколько начисляется по итогам занятия.</p>
      <form class="form-grid" data-form="settings">
        ${settingsFieldsHtml(s.settings, !edit)}
        ${edit ? `<div><button class="btn">Сохранить</button></div>` : ""}
      </form>
    </section>

    ${
      edit
        ? `<section class="card">
            <h2>Добавление участника</h2>
            <p class="muted small">Новому участнику присваивается приоритет, равный медиане по группе. Изменение и удаление участников доступно в списке на вкладке «Очередь».</p>
            <form class="inline-form" data-form="add-student">
              <input id="new-student" class="input" placeholder="Фамилия Имя Отчество" autocomplete="off" maxlength="120" required />
              <button class="btn">Добавить</button>
            </form>
            <div class="toolbar" style="margin-top:12px">
              <button class="btn ghost sm" data-act="bulk-add">Вставить список группы</button>
            </div>
          </section>`
        : ""
    }
    </div>

    <div class="stack">
    <section class="card">
      <h2>Доступ</h2>
      <p class="muted small">Просмотр комнаты доступен по коду <b class="mono">${esc(room.code)}</b>. Вносить изменения могут только перечисленные ниже лица.</p>
      <div class="table members">${members}</div>
      ${
        owner
          ? `<form class="inline-form" data-form="add-member" style="margin-top:14px">
              <input id="new-member" class="input" placeholder="Имя редактора" maxlength="60" autocomplete="off" required />
              <button class="btn">Предоставить доступ</button>
            </form>
            <p class="hint">Для редактора будет сформирована персональная ссылка доступа. Передайте её лично.</p>`
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
              <div><button class="btn">Сохранить</button></div>
            </form>
            ${
              s.history.length === 0
                ? `<h3>Перенос данных</h3>
                  <p class="muted small" style="margin-top:0">Загрузите файл экспорта комнаты или queue-data.json из предыдущей версии. Список участников, история и параметры начислений будут перенесены в комнату.</p>
                  <label class="btn ghost">Выбрать файл<input type="file" accept="application/json,.json" data-act="import" hidden /></label>`
                : ""
            }
          </section>`
        : ""
    }

    <section class="card">
      <h2>Экспорт</h2>
      <p class="muted small">Файл JSON со списком участников, приоритетами, историей очередей и параметрами начислений. Его можно загрузить в новую комнату через «Перенос данных».</p>
      <div class="toolbar"><button class="btn ghost" data-act="export">Скачать JSON</button></div>
    </section>

    <section class="card">
      <h2>Текущее устройство</h2>
      ${
        edit
          ? `<p class="muted small">Вы вошли как <b>${esc(room.me.name)}</b>. Персональная ссылка доступа позволяет войти с другого устройства. Не передавайте её другим лицам.</p>
            ${copyFieldHtml(ownKeyLink())}
            <div class="toolbar" style="margin-top:14px"><button class="btn ghost sm" data-act="forget-key">Выйти на этом устройстве</button></div>`
          : `<p class="muted small">Доступ к редактированию отсутствует. Для его получения обратитесь к создателю комнаты.</p>`
      }
    </section>
    </div>
  </div>`;
}

/* ----- Действия ----- */

async function studentMenu(id) {
  const st = studentById(id);
  if (!st) return;
  const pick = await dialog({
    title: st.name,
    body: `<p class="muted small" style="margin:0">Приоритет: ${fmtNum(st.burden)}</p>`,
    actions: [
      { value: "rename", label: "Изменить ФИО", kind: "ghost" },
      { value: "burden", label: "Изменить приоритет", kind: "ghost" },
      { value: "remove", label: "Удалить участника", kind: "danger" },
      { value: "cancel", label: "Закрыть", kind: "subtle" },
    ],
    column: true,
  });
  if (!pick) return;
  if (pick.action === "rename") {
    const v = await dialog({
      title: "Изменение ФИО",
      fields: [{ name: "name", label: "ФИО", value: st.name, required: true }],
    });
    if (v) command({ type: "student.renamed", id, name: v.name }, "Изменения сохранены");
  } else if (pick.action === "burden") {
    const v = await dialog({
      title: "Изменение приоритета",
      body: `<p class="muted small" style="margin:0">${esc(st.name)} · текущее значение ${fmtNum(st.burden)}</p>`,
      fields: [
        { name: "burden", label: "Новое значение", type: "number", step: "0.01", min: 0, value: st.burden, required: true },
      ],
    });
    if (v) command({ type: "student.burdenSet", id, burden: v.burden }, "Изменения сохранены");
  } else if (pick.action === "remove") {
    const v = await dialog({
      title: "Удалить участника?",
      body: `<p style="margin:0">${esc(st.name)} будет удалён из списка. В истории прошлых очередей запись сохранится.</p>`,
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
    title: `Ссылка доступа: ${data.change.payload.name}`,
    body: `<p class="muted small" style="margin:0">Передайте ссылку лично. Она отображается однократно; при утере отзовите доступ и предоставьте его повторно.</p>${copyFieldHtml(link)}`,
    actions: [{ value: "ok", label: "Закрыть" }],
    column: true,
  });
}

/* ----- Поделиться картинкой ----- */

function roomLink() {
  return `${location.origin}/r/${room.code}`;
}

function shareQueue() {
  const session = awaitingSession();
  if (!session) return;
  const count = session.order.length;
  const canvas = queueImage({
    title: room.state.title,
    subtitle: `Очередь от ${fmtDate(session.createdAt, false)} · ${count} ${plural(count, "участник", "участника", "участников")}`,
    names: session.order.map(studentName),
  });
  shareDialog(canvas, {
    title: "Поделиться очередью",
    file: `zqueue-${room.code}-ochered.png`,
    text: `Очередь «${room.state.title}»: ${roomLink()}`,
  });
}

function sharePlaces() {
  const { rows, total } = placeTable();
  if (!total) return;
  const selected = room.state.pool.length > 0;
  const canvas = placesImage({
    title: "Вероятности мест",
    subtitle: `${room.state.title} · ${selected ? "среди отмеченных" : "вся группа"}, ${total} ${plural(total, "участник", "участника", "участников")}`,
    rows: rows.map(({ st, level, offset, probs, mean }) => ({
      name: room.state.urgentMode && level > 1 ? `${st.name} (${levelLabel(level)})` : st.name,
      mean: fmtNum(Math.round(mean * 10) / 10),
      cells: Array.from({ length: total }, (_, place) => {
        const reachable = place >= offset && place < offset + probs.length;
        const p = reachable ? probs[place - offset] : 0;
        return { p, text: placeText(p, reachable) };
      }),
    })),
  });
  shareDialog(canvas, {
    title: "Поделиться таблицей",
    file: `zqueue-${room.code}-veroyatnosti.png`,
    text: `Вероятности мест — «${room.state.title}»: ${roomLink()}`,
  });
}

/**
 * Окно с картинкой и способами отправки: системное «Поделиться» (на телефоне —
 * сразу в Telegram), копирование картинки для вставки в чат, скачивание и ссылка.
 */
async function shareDialog(canvas, { title, file, text }) {
  const blob = await canvasBlob(canvas);
  const png = new File([blob], file, { type: "image/png" });
  const url = URL.createObjectURL(blob);
  // На компьютере системное окно «Поделиться» обычно не умеет отправить картинку
  // в Telegram, поэтому кнопку показываем только на сенсорных устройствах.
  const touch = matchMedia("(pointer: coarse)").matches;
  const canShare = touch && Boolean(navigator.canShare?.({ files: [png] }));
  const canCopy = Boolean(window.ClipboardItem && navigator.clipboard?.write);
  const pending = dialog({
    title,
    body: `<img class="share-preview" src="${url}" alt="${esc(title)}" />
      <div class="share-actions">
        ${canShare ? `<button class="btn" type="button" data-share="send">${ICONS.share}Отправить…</button>` : ""}
        ${canCopy ? `<button class="btn ${canShare ? "ghost" : ""}" type="button" data-share="copy">Скопировать картинку</button>` : ""}
        <button class="btn ghost" type="button" data-share="download">Скачать</button>
        <button class="btn ghost" type="button" data-share="link">Скопировать ссылку</button>
      </div>
      ${
        canShare
          ? `<p class="field-hint">«Отправить» откроет список приложений, например Telegram.</p>`
          : canCopy
            ? ""
            : `<p class="field-hint">Скачайте картинку и отправьте её в чат.</p>`
      }`,
    actions: [{ value: "cancel", label: "Закрыть", kind: "ghost" }],
    column: true,
  });
  document.querySelector("dialog[open] .share-actions").addEventListener("click", async (event) => {
    const action = event.target.closest("[data-share]")?.dataset.share;
    try {
      if (action === "send") {
        await navigator.share({ files: [png], text });
      } else if (action === "copy") {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        toast("Картинка скопирована");
      } else if (action === "download") {
        const link = document.createElement("a");
        link.href = url;
        link.download = file;
        link.click();
      } else if (action === "link") {
        await copyText(roomLink());
      }
    } catch (err) {
      // Закрытие системного окна «Поделиться» — не ошибка.
      if (err?.name !== "AbortError") toast("Не получилось. Попробуйте скачать картинку.", "error");
    }
  });
  await pending;
  URL.revokeObjectURL(url);
}

function exportRoom() {
  const s = room.state;
  const data = {
    format: "zqueue",
    version: 1,
    exportedAt: new Date().toISOString(),
    title: s.title,
    settings: s.settings,
    students: s.students,
    pool: s.pool,
    urgentMode: s.urgentMode,
    priority: s.priority,
    history: s.history,
  };
  const blob = new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `zqueue-${room.code}-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/** Делит разобранные имена на новые и уже имеющиеся в списке. */
function splitNew(names, current = []) {
  const taken = new Set(current.map((name) => name.toLowerCase()));
  const fresh = [];
  const existing = [];
  for (const name of names) (taken.has(name.toLowerCase()) ? existing : fresh).push(name);
  return { fresh, existing };
}

/**
 * Все параметры комнаты: способ жеребьёвки с его параметром и начисления.
 * Нужный параметр показывается обработчиком change на документе.
 */
function settingsFieldsHtml(settings, disabled = false) {
  const off = disabled ? "disabled" : "";
  const current = DRAW_MODES.find((m) => m.value === settings.drawMode) ?? DRAW_MODES[0];
  return `<div class="form-grid" data-draw>
    <fieldset class="field draw-modes">
      <legend class="field-label">Способ жеребьёвки</legend>
      ${DRAW_MODES.map(
        (m) => `<label class="draw-mode">
          <input type="radio" name="drawMode" value="${m.value}" data-draw-mode ${m.value === current.value ? "checked" : ""} ${off} />
          <span><b>${esc(m.label)} ${helpHtml(m.details.join("\n\n"))}</b><span>${esc(m.hint)}</span></span>
        </label>`,
      ).join("")}
    </fieldset>
    ${sliderHtml({ ...SLIDERS.beta, mode: "relative", value: settings.beta, hidden: current.value !== "relative", off })}
    ${sliderHtml({ ...SLIDERS.sigma, mode: "debt", value: settings.sigma, hidden: current.value !== "debt", off })}
    ${sliderHtml({ ...SLIDERS.absenceScore, value: settings.absenceScore, off })}
    ${sliderHtml({ ...SLIDERS.tailScore, value: settings.tailScore, off })}
  </div>`;
}

/** Значения формы параметров в виде полей команды settings.changed. */
function settingsValues(values) {
  const { drawMode, beta, sigma, absenceScore, tailScore } = values;
  return { drawMode, beta, sigma, absenceScore, tailScore };
}

/** Значок «?» с подсказкой при наведении или фокусе. */
function helpHtml(text, attr = "") {
  return `<span class="help" tabindex="0" role="img" aria-label="${esc(text)}" data-tip="${esc(text)}" ${attr}>?</span>`;
}

/** Рекомендуемые диапазоны параметров: за их пределами режимы теряют смысл. */
const SLIDERS = {
  beta: {
    name: "beta",
    label: "Сила компенсации",
    help: "Насколько сильнее шансы у тех, кто раньше ждал дольше. При разнице приоритетов в 1 вес отличается в e^β раз (при 2,5 — примерно в 12 раз).",
    min: 1, max: 4, step: 0.5, fallback: 2.5, left: "слабее", right: "сильнее",
  },
  sigma: {
    name: "sigma",
    label: "Случайный разброс",
    help: "Насколько перемешиваются участники с близким приоритетом. Меньше — порядок строже следует приоритету.",
    min: 0.2, max: 0.6, step: 0.05, fallback: 0.35, left: "строже", right: "случайнее",
  },
  absenceScore: {
    name: "absenceScore",
    label: "Отсутствие в очереди",
    help: "Начисляется участникам, которые не сдавали на этом занятии. 0,5 — как средняя позиция: пропуск не меняет положения относительно группы.",
    min: 0, max: 1, step: 0.1, fallback: 0.5, left: "меньше", right: "больше",
  },
  tailScore: {
    name: "tailScore",
    label: "Работа не сдана",
    help: "Начисляется тем, кто не успел сдать работу. За позицию в очереди начисляется от 0 (первое место) до 1 (последнее), поэтому 1 — как за последнее место.",
    min: 0.5, max: 2, step: 0.25, fallback: 1, left: "меньше", right: "больше",
  },
};

function sliderHtml({ name, label, help, min, max, step, fallback, left, right, mode, value, hidden, off }) {
  const clamped = Math.min(max, Math.max(min, Math.round((value - min) / step) * step + min));
  const count = Math.round((max - min) / step);
  const ticks = Array.from({ length: count + 1 }, (_, i) => {
    const v = Math.round((min + i * step) * 100) / 100;
    return `<span class="${v === fallback ? "is-default" : ""}" title="${fmtNum(v)}${v === fallback ? " — по умолчанию" : ""}"></span>`;
  }).join("");
  return `<div class="field" ${mode ? `data-draw-param="${mode}"` : ""} ${hidden ? "hidden" : ""}>
      <span class="slider-head"><span class="field-label">${esc(label)} ${helpHtml(help)}</span><output class="mono" data-slider-value>${fmtNum(clamped)}</output></span>
      <input class="slider" name="${name}" type="range" min="${min}" max="${max}" step="${step}" value="${clamped}" aria-label="${esc(label)}" data-slider ${off} />
      <span class="slider-ticks" aria-hidden="true">${ticks}</span>
      <span class="slider-scale field-hint"><span>${fmtNum(min)} · ${left}</span><span>по умолчанию ${fmtNum(fallback)}</span><span>${right} · ${fmtNum(max)}</span></span>
    </div>`;
}

document.addEventListener("input", (event) => {
  const slider = event.target.closest?.("[data-slider]");
  if (slider) slider.closest(".field").querySelector("[data-slider-value]").textContent = fmtNum(Number(slider.value));
});

// «?» внутри варианта жеребьёвки только показывает подсказку и не выбирает вариант.
document.addEventListener("click", (event) => {
  if (event.target.closest?.(".draw-mode .help")) event.preventDefault();
});

document.addEventListener("change", (event) => {
  const radio = event.target.closest?.("[data-draw-mode]");
  if (!radio) return;
  const box = radio.closest("[data-draw]");
  for (const el of box.querySelectorAll("[data-draw-param]")) el.hidden = el.dataset.drawParam !== radio.value;
});

function bulkFieldHtml(label) {
  return `<label class="field">${esc(label)}
      <textarea id="bulk-names" name="names" class="input textarea" rows="6" spellcheck="false"
        placeholder="Иванов Иван Иванович&#10;Петрова Анна Сергеевна&#10;…"></textarea>
      <span class="field-hint">Подходит любой вид: по одному на строке, нумерованный список, строки таблицы, перечисление через запятую.</span>
    </label>
    <div id="bulk-preview" class="bulk-preview"></div>`;
}

/** Обновляет предпросмотр списка при вводе. onChange получает число новых имён. */
function watchBulkField(current, onChange) {
  const area = document.getElementById("bulk-names");
  const preview = document.getElementById("bulk-preview");
  const update = () => {
    const { fresh, existing } = splitNew(parseNames(area.value), current);
    onChange?.(fresh.length);
    if (!area.value.trim()) {
      preview.innerHTML = "";
      return;
    }
    preview.innerHTML = `
      <p class="small" style="margin:0"><b>${fresh.length ? `Будет добавлено: ${fresh.length}` : "Новых имён не найдено"}</b></p>
      ${fresh.length ? `<ol class="bulk-list">${fresh.map((name) => `<li>${esc(name)}</li>`).join("")}</ol>` : ""}
      ${existing.length ? `<p class="muted small" style="margin:0">Уже есть в списке: ${existing.map(esc).join(", ")}</p>` : ""}`;
  };
  area.addEventListener("input", update);
  update();
  return area;
}

async function bulkAddDialog() {
  const current = room.state.students.map((st) => st.name);
  const pending = dialog({
    title: "Список группы",
    body: bulkFieldHtml("Вставьте список — из таблицы, документа или сообщения"),
    actions: [{ value: "ok", label: "Добавить" }],
  });
  const submit = document.querySelector('dialog[open] button[value="ok"]');
  watchBulkField(current, (count) => {
    submit.disabled = count === 0;
    submit.textContent = count ? `Добавить ${count}` : "Добавить";
  }).focus();
  const res = await pending;
  if (!res) return;
  const { fresh } = splitNew(parseNames(res.names), current);
  if (fresh.length) {
    command({ type: "students.added", names: fresh }, `Добавлено ${fresh.length} ${plural(fresh.length, "участник", "участника", "участников")}`);
  }
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
    title: "Перенести данные?",
    body: `<p style="margin:0">Текущий список участников и история будут заменены данными из файла (участников: ${count}).</p>`,
    actions: [{ value: "ok", label: "Перенести" }],
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
    case "export":
      exportRoom();
      break;
    case "share-queue":
      shareQueue();
      break;
    case "share-places":
      sharePlaces();
      break;
    case "bulk-add":
      bulkAddDialog();
      break;
    case "dismiss-notice":
      room.notice = null;
      renderRoom();
      break;
    case "dismiss-view-notice":
      storage.write(VIEW_NOTICE_KEY, true);
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
      command({ type: "queue.created", pool: [...s.pool] }, "Очередь сформирована");
      break;
    case "undo": {
      const last = lastActiveSession();
      const ok = await dialog({
        title: last.status === "awaiting" ? "Отменить очередь?" : `Отменить итоги очереди от ${fmtDay(last.createdAt)}?`,
        body: `<p style="margin:0">${
          last.status === "awaiting"
            ? "Участники будут возвращены в список сдающих, начисления не изменятся. Очередь останется в истории с отметкой «Отменена»."
            : "Начисления за эту очередь будут вычтены, и она снова будет ждать подведения итогов: можно заново отметить, кто не успел."
        }</p>`,
        actions: [{ value: "ok", label: "Подтвердить отмену", kind: "danger" }],
      });
      if (ok) command({ type: "session.undo" }, "Действие отменено");
      break;
    }
    case "tail":
      command({ type: "session.tailMarked", sessionId: el.getAttribute("data-session"), from: id || null });
      break;
    case "score":
      command({ type: "session.scored", sessionId: el.getAttribute("data-session") }, "Итоги подведены");
      break;
    case "all-done": {
      const sessionId = el.getAttribute("data-session");
      // Сначала снимаем отметку «не успел», если она была.
      if (awaitingSession()?.unfinishedFrom && !(await command({ type: "session.tailMarked", sessionId, from: null }))) break;
      command({ type: "session.scored", sessionId }, "Итоги подведены: сдали все");
      break;
    }
    case "revoke": {
      const m = s.members.find((x) => x.id === id);
      const ok = await dialog({
        title: "Отозвать доступ?",
        body: `<p style="margin:0">${esc(m?.name)} не сможет вносить изменения. Запись о предоставлении доступа сохранится.</p>`,
        actions: [{ value: "ok", label: "Отозвать", kind: "danger" }],
      });
      if (ok) command({ type: "member.revoked", id }, "Доступ отозван");
      break;
    }
    case "forget-key": {
      const ok = await dialog({
        title: "Выйти на этом устройстве?",
        body: `<p style="margin:0">Ссылка доступа будет удалена из браузера. ${isOwner() ? "Без сохранённой ссылки права создателя восстановить невозможно." : "Повторный вход возможен по той же ссылке."}</p>`,
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
    command({ type: "settings.changed", ...settingsValues(Object.fromEntries(new FormData(form))) }, "Параметры сохранены");
  } else if (kind === "rename") {
    command({ type: "room.renamed", title: document.getElementById("room-title").value }, "Изменения сохранены");
  }
});

route();
