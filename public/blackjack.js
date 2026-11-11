const UPDATE_MS = 1000;
const chips = new Intl.NumberFormat("ru-RU");
const balanceChange = new Intl.NumberFormat("ru-RU", { signDisplay: "exceptZero" });
const avatarTypes = ["image/png", "image/jpeg", "image/webp"];

const HAND_LABELS = {
  playing: "В игре",
  stand: "Пас",
  bust: "Перебор",
  blackjack: "Блэкджек",
};

const RESULT_LABELS = {
  win: "Победа",
  lose: "Проигрыш",
  push: "Ничья",
  blackjack: "Блэкджек · победа",
};

function cardsHtml(cards, esc) {
  return cards.map((card) => {
    if (!card) return '<span class="blackjack-card blackjack-card-back" aria-label="Закрытая карта"></span>';
    const red = card.suit === "♥" || card.suit === "♦";
    return `<span class="blackjack-card${red ? " red" : ""}"><b>${esc(card.rank)}</b><span>${esc(card.suit)}</span></span>`;
  }).join("");
}

function avatarHtml(name, version, esc) {
  const src = version ? `/api/blackjack/avatars/${encodeURIComponent(name)}/${encodeURIComponent(version)}` : "";
  return `<span class="blackjack-avatar" aria-hidden="true">
    ${esc(name[0].toUpperCase())}${src ? `<img src="${src}" alt="" />` : ""}
  </span>`;
}

async function avatarPng(file) {
  if (!avatarTypes.includes(file.type) || file.size > 10 * 1024 * 1024) {
    throw new Error("Choose a PNG, JPEG or WebP image up to 10 MB.");
  }
  const image = await createImageBitmap(file).catch(() => { throw new Error("Could not open this image."); });
  const size = Math.min(image.width, image.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  try {
    canvas.getContext("2d").drawImage(image, (image.width - size) / 2, (image.height - size) / 2, size, size, 0, 0, 128, 128);
  } finally {
    image.close();
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((png) => png ? resolve(png) : reject(new Error("Could not prepare this image.")), "image/png");
  });
}

function tableHtml({ round, betting, positions, avatars }, esc) {
  if (betting) round = null;
  const turn = round?.turn;
  const insurance = round?.insurance;
  const phase = betting ?? insurance;
  const decisions = Object.values(phase?.decisions ?? {});
  const status = betting ? "Приём ставок" : insurance ? "Страховка" :
    turn ? `Ходит ${esc(turn.name)}` : round ? "Раунд завершён" : "Ожидание первой ставки";
  const hideDealerCard = Boolean(turn || insurance);
  const dealerBlackjack = round && !hideDealerCard && round.dealer.length === 2 && round.dealerScore === 21;
  const handsByPlayer = new Map();
  for (const [index, hand] of (round?.hands ?? []).entries()) {
    if (!handsByPlayer.has(hand.name)) handsByPlayer.set(hand.name, []);
    handsByPlayer.get(hand.name).push({ hand, index });
  }
  const departed = [...handsByPlayer].filter(([name]) => !positions.includes(name));
  function renderHands(hands) {
    return hands.map(({ hand, index }, number) => `
      <div class="blackjack-hand${turn?.index === index ? " current-hand" : ""}">
        <div class="blackjack-hand-score">
          ${hands.length > 1 ? `Рука ${number + 1} · ` : ""}
          <abbr title="${hand.soft ? "Мягкая рука" : "Жёсткая рука"}">${hand.score}${hand.soft ? "s" : "h"}</abbr>
          ${hands.length > 1 && hand.bet ? ` · ${chips.format(hand.bet)}` : ""}
        </div>
        <div class="blackjack-cards">${cardsHtml(hand.cards, esc)}</div>
        <p>${RESULT_LABELS[hand.result] ?? HAND_LABELS[hand.status]}</p>
        ${hand.insuranceBet ? `<p>${insurance ? "Застраховано" : dealerBlackjack ? "Страховка сыграла" : "Страховка проиграла"}</p>` : ""}
        ${hand.payout || hand.insurancePayout
          ? `<p class="blackjack-hand-payout">Зачислено +${chips.format(hand.payout + hand.insurancePayout)}</p>` : ""}
      </div>`).join("");
  }

  return `
    <div class="blackjack-table-status">
      <div role="status"><strong>${status}</strong>
        ${phase ? `<span>${decisions.filter((decision) => decision !== null).length} из ${decisions.length} ответили</span>` : ""}
      </div>
      ${phase || turn ? '<span class="blackjack-timer" data-clock></span>' : ""}
    </div>
    <div class="blackjack-dealer">
      <div class="blackjack-shoe" aria-hidden="true"></div>
      <div class="blackjack-dealer-heading">
        <img class="blackjack-dealer-avatar" src="/blackjack-dealer.png" alt="" />
        <h2>Дилер${round ? ` <span>· ${round.dealerScore}${hideDealerCard ? " + ?" : ""}</span>` : ""}</h2>
      </div>
      <div class="blackjack-cards">${round ? cardsHtml(round.dealer, esc) :
        '<span class="blackjack-card-slot"></span><span class="blackjack-card-slot"></span>'}</div>
    </div>
    <div class="blackjack-seats" aria-label="Места за столом">
      ${positions.map((name) => {
        if (!name) return '<div class="blackjack-seat empty-seat">Свободное место</div>';
        const playerHands = handsByPlayer.get(name) ?? [];
        const bet = betting?.decisions[name];
        const totalBet = bet || playerHands.reduce((total, { hand }) => total + (hand.bet ?? 0), 0);
        const decision = bet === null ? "Выбирает ставку" : bet === 0 ? "Пропуск" :
          betting || hideDealerCard ? "Со следующей раздачи" : "За столом";
        return `
          <section class="blackjack-seat${turn?.name === name || bet === null || insurance?.decisions[name] === null ? " current" : ""}">
            <div class="blackjack-seat-heading">
              ${avatarHtml(name, avatars[name], esc)}
              <h3 title="${esc(name)}">${esc(name)}</h3>
              ${totalBet ? `<span class="blackjack-seat-bet" title="Ставка ${chips.format(totalBet)}">${chips.format(totalBet)}</span>` : ""}
            </div>
            ${renderHands(playerHands)}
            ${!playerHands.length && !bet ? `<p>${decision}</p>` : ""}
          </section>`;
      }).join("")}
    </div>
    ${departed.length ? `
      <section class="blackjack-departed" aria-labelledby="blackjack-departed-title">
        <h2 id="blackjack-departed-title">Руки вышедших игроков</h2>
        <div class="blackjack-departed-grid">
          ${departed.map(([name, playerHands]) => `
            <section class="blackjack-departed-player">
              <h3>${esc(name)}</h3>
              ${renderHands(playerHands)}
            </section>`).join("")}
        </div>
      </section>` : ""}`;
}

function animateCards(container, cards, previous, delay = 0) {
  cards.forEach((card, index) => {
    const node = container.children[index];
    const old = previous[index];
    if (old === null && card) node.classList.add("card-reveal");
    else if (old === undefined || old?.rank !== card?.rank || old?.suit !== card?.suit) {
      node.classList.add("card-deal");
      if (!previous.length) node.style.setProperty("--deal-delay", `${delay + index * 75}ms`);
    }
  });
}

function animateTable(table, previous, data) {
  const round = data.betting ? null : data.round;
  const oldRound = !previous?.betting && previous?.round?.id === round?.id ? previous?.round : null;
  if (round) animateCards(table.querySelector(".blackjack-dealer .blackjack-cards"), round.dealer, oldRound?.dealer ?? [], 65);
  const seats = table.querySelector(".blackjack-seats").children;
  data.positions.forEach((name, index) => {
    const seat = seats[index];
    const oldName = previous?.positions[index];
    if (previous && oldName !== name) seat.classList.add(name ? "seat-joined" : "seat-freed");
    if (!name) return;
    if (data.betting?.decisions[name] > 0 && !(previous?.betting?.decisions[name] > 0)) {
      seat.querySelector(".blackjack-seat-bet").classList.add("chip-placed");
    }
    const hands = round?.hands.filter((hand) => hand.name === name) ?? [];
    const oldHands = oldRound?.hands.filter((hand) => hand.name === name) ?? [];
    const groups = seat.querySelectorAll(".blackjack-hand .blackjack-cards");
    hands.forEach((hand, number) => animateCards(groups[number], hand.cards, oldHands[number]?.cards ?? [], index * 26));
  });
}

function balanceStatsHtml(data, esc) {
  return `<h2>Балансы игроков</h2>
    <table>
      <thead><tr><th scope="col">Игрок</th><th scope="col">Баланс</th><th scope="col">Изменение за 24 ч</th></tr></thead>
      <tbody>${data.balanceStats.map(({ name, balance, change }) => `<tr>
        <th scope="row">${esc(name)}</th>
        <td>${chips.format(balance)}</td>
        <td class="${change > 0 ? "positive" : change < 0 ? "negative" : ""}">${balanceChange.format(change)}</td>
      </tr>`).join("")}</tbody>
    </table>
    ${data.balanceHistoryComplete ? "" : '<p class="muted small">Пока показано изменение с момента включения учёта балансов.</p>'}`;
}

function playerControls(data, esc, uploadingAvatar) {
  const { me, balance, betting, round, betStep } = data;
  const turn = round?.turn;
  const insurance = round?.insurance;
  const canBet = !turn && !insurance && (!betting || betting.decisions[me] === null);
  const maxBet = balance - balance % betStep;
  const insuranceCost = insurance?.cost;
  return `<div class="card blackjack-controls" lang="en">
    <div class="blackjack-actions">
      <div class="blackjack-player-profile">
        ${avatarHtml(me, data.avatars[me], esc)}
        <strong>${esc(me)}</strong><span>Chips ${chips.format(balance)}</span>
        ${data.reserved ? `<span>Reserved ${chips.format(data.reserved)}</span>` : ""}
        <button type="button" class="btn ghost blackjack-avatar-upload" data-avatar-upload ${uploadingAvatar ? "disabled" : ""}>
          ${uploadingAvatar ? "Uploading…" : "Upload avatar"}
        </button>
      </div>
      <div>
        ${turn?.name === me ? `
          <button class="btn" data-move="hit">Hit</button>
          <button class="btn" data-move="stand">Stand</button>
          ${turn.double ? '<button class="btn" data-move="double">Double</button>' : ""}
          ${turn.split ? '<button class="btn" data-move="split">Split</button>' : ""}` : ""}
        <button class="btn" data-move="leave">Leave table</button>
      </div>
    </div>
    ${canBet ? `
      <form class="blackjack-bet">
        <div class="blackjack-bet-picker">
          <div><label for="blackjack-amount">Bet amount</label><output for="blackjack-amount"></output></div>
          <div>
            <button type="button" class="btn ghost" data-bet-step="-1" aria-label="Decrease bet">−</button>
            <input id="blackjack-amount" type="range" name="amount" min="${Math.min(betStep, maxBet)}"
              max="${maxBet}" step="${betStep}" value="${Math.min(betStep, maxBet)}" ${maxBet ? "" : "disabled"} />
            <button type="button" class="btn ghost" data-bet-step="1" aria-label="Increase bet">+</button>
          </div>
        </div>
        <div class="blackjack-bet-buttons">
          <button type="button" class="btn ghost" data-bet-max>All-in</button>
          <button class="btn blackjack-place-bet" ${maxBet ? "" : "disabled"}>Place bet</button>
          ${betting ? '<button type="button" class="btn ghost" data-move="skip-bet">Skip bet</button>' : ""}
        </div>
      </form>` : ""}
    ${insuranceCost ? `
      <div class="blackjack-insurance">
        <span>Insurance ${chips.format(insuranceCost)} chips · pays 2:1</span>
        <button class="btn" data-move="accept-insurance" ${balance < insuranceCost ? "disabled" : ""}>Take insurance</button>
        <button class="btn" data-move="decline-insurance">Decline</button>
      </div>` : ""}
  </div>`;
}

function updateBet(form, amount = form.elements.amount.valueAsNumber) {
  const input = form.elements.amount;
  const min = Number(input.min);
  const max = Number(input.max);
  input.valueAsNumber = Math.max(min, Math.min(max, amount));
  const value = input.valueAsNumber;
  const label = chips.format(value);
  form.querySelector("output").textContent = label;
  input.setAttribute("aria-valuetext", `${label} chips`);
  form.querySelector('[data-bet-step="-1"]').disabled = value <= min;
  form.querySelector('[data-bet-step="1"]').disabled = value >= max;
  form.querySelector("[data-bet-max]").disabled = value >= max;
}

export function openBlackjack({ app, api, esc, toast, logo, code, joining }) {
  const key = joining ? new URLSearchParams(location.hash.slice(1)).get("key") : null;
  const endpoint = `/api/rooms/${code}/blackjack`;
  const sessionKey = `queue.blackjack.v1.${code}`;
  let token = null;
  try {
    token = sessionStorage.getItem(sessionKey);
  } catch {
    // Сессия будет доступна до перехода на другую страницу.
  }

  let active = true;
  let syncing = false;
  let busy = false;
  let sendingMessage = false;
  let uploadingAvatar = false;
  let requests = 0;
  let timer;
  let state;
  let receivedAt;
  let previousTable = "";
  let previousControls = "";
  let previousMessage;
  let previousStats = "";

  document.title = "Блэкджек · zQueue";
  app.innerHTML = `
    <header class="topbar">
      <a href="/" data-link class="brand">${logo}<span>zQueue</span></a>
      <a href="/r/${code}" data-link class="btn ghost sm">В комнату ${code}</a>
    </header>
    <main class="container blackjack-page">
      <h1>Блэкджек</h1>
      <p class="muted" data-blackjack-status role="status">Загрузка…</p>
      <input type="file" data-avatar-file accept="${avatarTypes.join(",")}" hidden />
      <div class="blackjack-layout" hidden>
        <div class="blackjack-game">
          <section class="blackjack-table" aria-label="Игровой стол"></section>
          <div data-blackjack-controls></div>
        </div>
        <aside class="card blackjack-chat">
          <h2>Чат</h2>
          <div class="blackjack-messages" role="log" aria-label="Сообщения" tabindex="0"></div>
          <form class="blackjack-chat-form">
            <input class="input" name="text" aria-label="Сообщение" placeholder="Сообщение" maxlength="300" required />
            <button class="btn">Отправить</button>
          </form>
        </aside>
      </div>
      <section class="card blackjack-balance-stats" hidden></section>
    </main>`;

  const layout = app.querySelector(".blackjack-layout");
  const status = app.querySelector("[data-blackjack-status]");
  const table = app.querySelector(".blackjack-table");
  const controls = app.querySelector("[data-blackjack-controls]");
  const messages = app.querySelector(".blackjack-messages");
  const chatForm = app.querySelector(".blackjack-chat-form");
  const balanceStats = app.querySelector(".blackjack-balance-stats");
  const avatarFile = app.querySelector("[data-avatar-file]");

  function showAvatarFallback(event) {
    if (event.target instanceof HTMLImageElement && event.target.matches(".blackjack-avatar img")) {
      event.target.hidden = true;
    }
  }
  app.addEventListener("error", showAvatarFallback, true);

  function setSession(value) {
    token = value;
    try {
      if (token) sessionStorage.setItem(sessionKey, token);
      else sessionStorage.removeItem(sessionKey);
    } catch {
      // Сессия остаётся в памяти вкладки.
    }
  }

  function updateClock() {
    const clock = table.querySelector("[data-clock]");
    if (!clock) return;
    const deadline = state.betting?.deadline ?? state.round?.insurance?.deadline ?? state.round?.turn?.deadline;
    const left = Math.max(0, deadline - state.serverTime - (performance.now() - receivedAt));
    clock.textContent = `${Math.ceil(left / 1000)} с`;
    clock.style.setProperty("--remaining", `${Math.min(100, left / (state.secondsPerAction * 10))}%`);
    clock.classList.toggle("low", left <= 5000);
  }

  function render(data) {
    if (state && (data.tableRevision < state.tableRevision || data.walletRevision < state.walletRevision)) return;
    const previous = state;
    state = data;
    receivedAt = performance.now();
    if (token && !data.me) setSession(null);
    status.hidden = true;
    layout.hidden = false;
    const tableMarkup = tableHtml(data, esc);
    if (tableMarkup !== previousTable) {
      table.innerHTML = tableMarkup;
      animateTable(table, previous, data);
      previousTable = tableMarkup;
    }
    updateClock();
    const statsMarkup = balanceStatsHtml(data, esc);
    if (statsMarkup !== previousStats) {
      balanceStats.innerHTML = statsMarkup;
      balanceStats.hidden = false;
      previousStats = statsMarkup;
    }

    let controlsMarkup = "";
    if (joining && !data.me) {
      controlsMarkup = `<form class="card blackjack-login" lang="en">
        <label class="field">Player password
          <input class="input" name="password" type="password" autocomplete="current-password" maxlength="256" required />
        </label>
        <button class="btn">Join table</button>
      </form>`;
    } else if (joining) {
      controlsMarkup = playerControls(data, esc, uploadingAvatar);
    }
    if (controlsMarkup !== previousControls) {
      const input = controls.querySelector(".blackjack-bet input");
      const keepDraft = input && previous?.me === data.me && previous?.round?.id === data.round?.id;
      const focused = input && document.activeElement === input;
      controls.innerHTML = controlsMarkup;
      const betForm = controls.querySelector(".blackjack-bet");
      if (betForm) {
        updateBet(betForm, keepDraft ? input.valueAsNumber : undefined);
        if (keepDraft && focused) betForm.elements.amount.focus({ preventScroll: true });
      }
      previousControls = controlsMarkup;
    }

    const atEnd = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 24;
    const lastIndex = data.messages.findIndex(({ id }) => id === previousMessage);
    if (lastIndex < 0) messages.replaceChildren();
    for (const message of data.messages.slice(lastIndex + 1)) {
      const entry = document.createElement("div");
      entry.innerHTML = `<b>${esc(message.author)}</b><p>${esc(message.text)}</p>`;
      messages.append(entry);
    }
    while (messages.children.length > data.messages.length) messages.firstElementChild.remove();
    previousMessage = data.messages.at(-1)?.id;
    if (atEnd) messages.scrollTop = messages.scrollHeight;
  }

  async function sync() {
    if (busy || syncing) return;
    syncing = true;
    const request = requests;
    try {
      const data = await api(endpoint, { token });
      if (active && request === requests) render(data);
    } catch {
      // Следующий опрос повторит запрос.
    } finally {
      syncing = false;
    }
  }

  async function send(action, body) {
    if (busy) return false;
    busy = true;
    requests++;
    let refresh = false;
    try {
      const data = await api(`${endpoint}/${action}`, { method: "POST", body, token });
      if (!active) return false;
      if (action === "join") setSession(data.token);
      render(data);
      return true;
    } catch (error) {
      if (active) toast(error.message, "error");
      refresh = error.status === 409 || error.status === 403;
      return false;
    } finally {
      busy = false;
      if (refresh && active) sync();
    }
  }

  controls.addEventListener("submit", (event) => {
    event.preventDefault();
    if (event.target.matches(".blackjack-bet")) {
      send("bet", {
        amount: event.target.elements.amount.valueAsNumber,
        roundId: state.round?.id ?? null,
        bettingId: state.betting?.id,
      });
    } else {
      send("join", { key, password: event.target.elements.password.value });
    }
  });
  controls.addEventListener("click", (event) => {
    if (event.target.closest("[data-avatar-upload]")) {
      if (!uploadingAvatar) avatarFile.click();
      return;
    }
    const betButton = event.target.closest("[data-bet-step], [data-bet-max]");
    if (betButton) {
      const input = betButton.form.elements.amount;
      const amount = betButton.hasAttribute("data-bet-max") ? Number(input.max)
        : input.valueAsNumber + Number(betButton.dataset.betStep) * Number(input.step);
      updateBet(betButton.form, amount);
      return;
    }
    const action = event.target.closest("[data-move]")?.dataset.move;
    if (!action) return;
    const roundId = state.round?.id ?? null;
    if (action === "skip-bet") send("bet", { amount: 0, roundId, bettingId: state.betting?.id });
    else if (action === "accept-insurance" || action === "decline-insurance") {
      send("insurance", { roundId, accept: action === "accept-insurance" });
    }
    else send(action, { roundId, step: state.round?.turn?.step });
  });
  controls.addEventListener("input", (event) => {
    if (event.target.id === "blackjack-amount") updateBet(event.target.form);
  });
  function setAvatarUploading(uploading) {
    uploadingAvatar = uploading;
    const button = controls.querySelector("[data-avatar-upload]");
    if (button) {
      button.disabled = uploading;
      button.textContent = uploading ? "Uploading…" : "Upload avatar";
    }
  }
  avatarFile.addEventListener("change", async () => {
    const file = avatarFile.files?.[0];
    avatarFile.value = "";
    if (!file || !token || uploadingAvatar) return;
    const session = token;
    setAvatarUploading(true);
    try {
      const png = await avatarPng(file);
      if (!active || token !== session) return;
      await api(`${endpoint}/avatar`, { method: "PUT", body: png, token: session });
      if (active) {
        toast("Avatar updated.");
        sync();
      }
    } catch (error) {
      if (active) toast(error.message, "error");
    } finally {
      setAvatarUploading(false);
    }
  });
  chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (sendingMessage) return;
    const input = chatForm.elements.text;
    const text = input.value;
    sendingMessage = true;
    try {
      await api(`${endpoint}/chat`, { method: "POST", body: { text }, token });
      if (active) {
        if (input.value === text) input.value = "";
        sync();
      }
    } catch (error) {
      if (active) toast(error.message, "error");
    } finally {
      sendingMessage = false;
    }
  });

  async function load() {
    try {
      if (joining && !key) throw new Error("Страница входа не найдена.");
      const data = joining
        ? await api(`${endpoint}/access`, { method: "POST", body: { key }, token })
        : await api(endpoint, { token });
      if (!active) return;
      render(data);
      timer = setInterval(() => {
        updateClock();
        if (document.visibilityState === "visible") sync();
      }, UPDATE_MS);
      document.addEventListener("visibilitychange", refreshVisible);
    } catch (error) {
      if (active) status.textContent = error.message;
    }
  }

  function refreshVisible() {
    if (document.visibilityState === "visible") sync();
  }

  load();
  return () => {
    active = false;
    clearInterval(timer);
    document.removeEventListener("visibilitychange", refreshVisible);
    app.removeEventListener("error", showAvatarFallback, true);
  };
}
