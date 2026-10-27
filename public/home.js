// Разделы стартовой страницы под первым экраном и их анимации.

const EXAMPLE = [
  { name: "Участник А", burden: 0 },
  { name: "Участник Б", burden: 0.5 },
  { name: "Участник В", burden: 1 },
  { name: "Участник Г", burden: 2.5 },
];

const SCORING = [
  { pos: 1, value: 0, note: "первое место" },
  { pos: 2, value: 0.25, note: "" },
  { pos: 3, value: 0.5, note: "" },
  { pos: 4, value: 1, note: "работа не сдана", tail: true },
  { pos: 5, value: 1, note: "работа не сдана", tail: true },
];

function fmt(value, digits = 2) {
  return String(Math.round(value * 10 ** digits) / 10 ** digits).replace(".", ",");
}

function pct(value) {
  return `${(value * 100).toFixed(1).replace(".", ",")} %`;
}

const totalWeight = EXAMPLE.reduce((sum, p) => sum + 1 + p.burden, 0);

export const HOME_SECTIONS = [
  { id: "principle", label: "Принцип работы" },
  { id: "probability", label: "Расчёт вероятности" },
  { id: "scoring", label: "Начисление приоритета" },
  { id: "deadlines", label: "Приоритет по срокам" },
  { id: "trust", label: "Надёжность" },
  { id: "start", label: "Начало работы" },
];

function sectionHead(index, title, lead) {
  return `<div class="sec-head reveal">
    <span class="sec-index">${String(index).padStart(2, "0")}</span>
    <h2>${title}</h2>
    ${lead ? `<p class="sec-lead">${lead}</p>` : ""}
  </div>`;
}

export function homeSectionsHtml() {
  const exampleRows = EXAMPLE.map((p) => {
    const weight = 1 + p.burden;
    const share = weight / totalWeight;
    return `<div class="trow">
      <span>${p.name}</span>
      <span class="num">${fmt(p.burden)}</span>
      <span class="num">${fmt(weight)}</span>
      <span class="bar-cell"><span class="bar"><span class="bar-fill" style="--w:${share}"></span></span><span class="num">${pct(share)}</span></span>
      <span class="num sim" data-sim-index="${EXAMPLE.indexOf(p)}">—</span>
    </div>`;
  }).join("");

  const scoringRows = SCORING.map(
    (row) => `<div class="trow ${row.tail ? "tail" : ""}">
      <span class="num pos">${row.pos}</span>
      <span class="bar-cell"><span class="bar"><span class="bar-fill" style="--w:${row.value}"></span></span></span>
      <span class="num">+${fmt(row.value)}</span>
      <span class="muted small">${row.note}</span>
    </div>`,
  ).join("");

  return `
    <section class="page" id="principle" data-page>
      <div class="page-inner">
        ${sectionHead(1, "Жеребьёвка с учётом прошлых занятий", "Порядок сдачи определяется случайным образом, однако участники, которым ранее приходилось ждать дольше, получают преимущество при следующей жеребьёвке.")}
        <ol class="flow reveal">
          <li>
            <span class="flow-step">Шаг 1</span>
            <h3>Отметка участников</h3>
            <p>Редактор отмечает участников, сдающих работы на текущем занятии. Остальные в жеребьёвке не участвуют.</p>
          </li>
          <li>
            <span class="flow-step">Шаг 2</span>
            <h3>Формирование очереди</h3>
            <p>Сервер определяет порядок с учётом накопленного приоритета каждого участника. Результат фиксируется сразу.</p>
          </li>
          <li>
            <span class="flow-step">Шаг 3</span>
            <h3>Подведение итогов</h3>
            <p>По окончании занятия отмечаются участники, не успевшие сдать работу. Приоритет всех участников обновляется.</p>
          </li>
        </ol>
      </div>
    </section>

    <section class="page" id="probability" data-page>
      <div class="page-inner split">
        <div>
          ${sectionHead(2, "Расчёт вероятности", "У каждого участника есть вес, зависящий от накопленного приоритета. Вероятность оказаться первым пропорциональна весу.")}
          <div class="formula reveal">
            <div><span class="muted">Вес</span><b>w = 1 + p</b></div>
            <div><span class="muted">Вероятность первого места</span><b>P = w / Σw</b></div>
          </div>
          <p class="sec-note reveal">где p — накопленный приоритет участника, Σw — сумма весов всех отмеченных участников. Следующие места определяются тем же способом среди оставшихся участников.</p>
        </div>
        <div class="reveal">
          <div class="table demo-table">
            <div class="trow thead"><span>Пример</span><span class="num">p</span><span class="num">w</span><span>Вероятность</span><span class="num">Модель</span></div>
            ${exampleRows}
          </div>
          <div class="demo-actions">
            <button class="btn ghost sm" type="button" data-simulate>Смоделировать 10 000 жеребьёвок</button>
            <span class="muted small" data-sim-note>Колонка «Модель» покажет фактическую долю первых мест.</span>
          </div>
        </div>
      </div>
    </section>

    <section class="page" id="scoring" data-page>
      <div class="page-inner split">
        <div>
          ${sectionHead(3, "Начисление приоритета", "После подведения итогов каждому участнику группы начисляется значение, зависящее от результата занятия.")}
          <dl class="rules reveal">
            <div><dt>Позиция в очереди</dt><dd>от 0 до 1 — пропорционально месту</dd></div>
            <div><dt>Работа не сдана</dt><dd>1 — как за последнее место</dd></div>
            <div><dt>Отсутствие в очереди</dt><dd>0,5 — среднее значение</dd></div>
            <div><dt>Новый участник</dt><dd>медиана по группе</dd></div>
          </dl>
          <p class="sec-note reveal">Значения для несданных работ и отсутствия настраиваются создателем комнаты. Начисление не зависит от размера группы: очередь из трёх и из пятнадцати участников влияет одинаково.</p>
        </div>
        <div class="reveal">
          <div class="table scoring-table">
            <div class="trow thead"><span class="num">№</span><span>Пример очереди из пяти участников</span><span class="num">Начисление</span><span></span></div>
            ${scoringRows}
          </div>
        </div>
      </div>
    </section>

    <section class="page" id="deadlines" data-page>
      <div class="page-inner split">
        <div>
          ${sectionHead(4, "Приоритет по срокам", "Если у части участников истекают сроки сдачи, их можно поставить в начало очереди, не нарушая общего порядка расчёта.")}
          <p class="sec-note reveal">При включённом режиме участникам назначается один из трёх уровней. Группы располагаются строго по уровню, а внутри каждой группы порядок определяется жеребьёвкой с учётом весов.</p>
        </div>
        <div class="bands reveal">
          <div class="band band-3"><span class="band-label">Высокий уровень</span><span class="band-items"><i></i><i></i></span></div>
          <div class="band band-2"><span class="band-label">Средний уровень</span><span class="band-items"><i></i><i></i><i></i></span></div>
          <div class="band band-1"><span class="band-label">Обычный уровень</span><span class="band-items"><i></i><i></i><i></i><i></i><i></i></span></div>
        </div>
      </div>
    </section>

    <section class="page" id="trust" data-page>
      <div class="page-inner">
        ${sectionHead(5, "Надёжность и прозрачность")}
        <div class="features trust-grid reveal">
          <div class="feature">
            <h3>Жеребьёвка на сервере</h3>
            <p>Порядок определяется на сервере с использованием криптографического генератора случайных чисел. Повлиять на результат из браузера невозможно.</p>
          </div>
          <div class="feature">
            <h3>Неизменяемый журнал</h3>
            <p>Формирование очередей и предоставление доступа фиксируются с указанием автора и времени. Записи журнала не подлежат изменению или удалению.</p>
          </div>
          <div class="feature">
            <h3>Разграничение прав</h3>
            <p>Просмотр доступен по коду комнаты. Изменения вносят создатель и назначенные им редакторы; доступ может быть отозван в любой момент.</p>
          </div>
          <div class="feature">
            <h3>Без регистрации</h3>
            <p>Вход выполняется по персональной ссылке доступа. На сервере хранится только хеш ключа, а не сам ключ.</p>
          </div>
        </div>
      </div>
    </section>

    <section class="page" id="start" data-page>
      <div class="page-inner start-inner">
        ${sectionHead(6, "Начало работы", "Создание комнаты занимает меньше минуты.")}
        <ol class="steps reveal">
          <li><b>Создайте комнату</b><span>Укажите название дисциплины и своё имя.</span></li>
          <li><b>Добавьте участников</b><span>Внесите список группы на вкладке «Настройки» или перенесите данные из файла.</span></li>
          <li><b>Передайте код</b><span>По коду из шести символов участники смогут просматривать очередь.</span></li>
        </ol>
        <div class="toolbar reveal" style="margin-top:28px">
          <button class="btn" type="button" data-home="create">Создать комнату</button>
          <button class="btn ghost" type="button" data-home="to-top">Ввести код комнаты</button>
        </div>
      </div>
      <footer class="footer">zQueue · Данные комнат хранятся на сервере, ключи доступа — только в вашем браузере.</footer>
    </section>`;
}

function simulateFirstPlaces(runs) {
  const counts = new Array(EXAMPLE.length).fill(0);
  for (let r = 0; r < runs; r++) {
    let best = 0;
    let bestKey = Infinity;
    EXAMPLE.forEach((p, i) => {
      const key = -Math.log(Math.max(Math.random(), Number.EPSILON)) / (1 + p.burden);
      if (key < bestKey) {
        bestKey = key;
        best = i;
      }
    });
    counts[best] += 1;
  }
  return counts.map((c) => c / runs);
}

/** Подключает навигацию точками, появление блоков и моделирование. Возвращает функцию очистки. */
export function initHome(root) {
  const pages = [...root.querySelectorAll("[data-page]")];
  const dots = [...root.querySelectorAll("[data-dot]")];

  const setActive = (id) => {
    for (const dot of dots) dot.setAttribute("aria-current", dot.dataset.dot === id ? "true" : "false");
  };

  // Блоки раздела проявляются, как только раздел показался на экране.
  const reveal = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) entry.target.classList.add("in-view");
      }
    },
    { threshold: 0.15 },
  );
  // Активная точка — раздел, который пересекает середину экрана.
  const active = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) setActive(entry.target.id);
      }
    },
    { rootMargin: "-50% 0px -50% 0px" },
  );
  pages.forEach((page) => {
    reveal.observe(page);
    active.observe(page);
  });

  for (const dot of dots) {
    dot.addEventListener("click", () => document.getElementById(dot.dataset.dot)?.scrollIntoView({ behavior: "smooth" }));
  }

  root.querySelector("[data-simulate]")?.addEventListener("click", (event) => {
    const runs = 10000;
    const shares = simulateFirstPlaces(runs);
    root.querySelectorAll("[data-sim-index]").forEach((cell) => {
      cell.textContent = pct(shares[Number(cell.dataset.simIndex)]);
    });
    root.querySelector("[data-sim-note]").textContent =
      "Доли первых мест по результатам моделирования близки к расчётным. Повторный запуск даст немного другие значения.";
    event.currentTarget.textContent = "Повторить моделирование";
  });

  return () => {
    reveal.disconnect();
    active.disconnect();
  };
}
