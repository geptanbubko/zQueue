// Разбор вставленного списка группы. Принимает то, что обычно копируют из
// таблиц, документов и мессенджеров: имя на строку, нумерованные и маркированные
// списки, строки таблицы (табуляция, «|», «;», «,»), фамилию, имя и отчество в
// отдельных столбцах, перечисление в одну строку. Отбрасывает номера, заголовки
// столбцов, почту, телефоны, номера групп и пометки в скобках.

const HEADER_WORDS = new Set([
  "№", "n", "no", "#", "фио", "ф.и.о", "ф.и.о.", "фамилия", "имя", "отчество", "студент", "студенты",
  "студентка", "участник", "участники", "обучающийся", "обучающиеся", "список", "группы", "группа",
  "п/п", "пп", "почта", "телефон", "тел", "примечание", "комментарий", "подпись", "оценка", "курс",
  "факультет", "кафедра", "email", "e-mail", "mail", "phone", "group", "name", "names", "full", "student",
  "students", "first", "last", "surname", "and", "и",
]);

// Маркеры в начале пункта: «1.», «1)», «10.Иванов», «12 », «№3», «а)», «-», «•», «*».
const LEAD_MARKER = /^(?:№\s*)?(?:\d{1,3}\s*[.)\]:-]\s*|\d{1,3}\s+|[a-zа-яё]\)\s+)|^[-–—•*·▪●◦○►>]+\s*/i;

/** Заголовок столбца или подпись вроде «Список группы». */
function isHeader(words) {
  return words.length > 0 && words.every((w) => HEADER_WORDS.has(w.toLowerCase()));
}

function fixCase(word) {
  const letters = word.replace(/[^a-zа-яё]/gi, "");
  if (letters.length < 2) return word;
  const upper = letters === letters.toUpperCase();
  const lower = letters === letters.toLowerCase();
  if (!upper && !lower) return word;
  // Инициалы вида «И.И.» не трогаем.
  if (upper && /^([a-zа-яё]\.)+$/i.test(word)) return word;
  return word
    .toLowerCase()
    .replace(/(^|[-'’])([a-zа-яё])/gi, (_, sep, ch) => sep + ch.toUpperCase());
}

/** Очищает одну ячейку. Возвращает список слов имени (возможно, пустой). */
function cleanCell(raw) {
  let text = raw
    .replace(/ /g, " ")
    .replace(/[​-‍﻿]/g, "")
    .trim();
  for (let i = 0; i < 3; i++) text = text.replace(LEAD_MARKER, "").trim();
  text = text
    .replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, " ")
    .replace(/\S+@\S+/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[«»"“”„*_`~]/g, " ");
  const words = text
    .split(/\s+/)
    .filter((word) => !/\d/.test(word))
    .map((word) => word.replace(/^[^a-zа-яё№#]+|[^a-zа-яё.]+$/gi, ""))
    .filter((word) => word && /[a-zа-яё№#]/i.test(word));
  if (isHeader(words)) return [];
  return words.filter((word) => /[a-zа-яё]/i.test(word)).map(fixCase);
}

/** Строка таблицы или пункт списка → одно или несколько имён. */
function rowNames(cells) {
  const parts = cells.map(cleanCell).filter((words) => words.length > 0);
  if (parts.length === 0) return [];
  // Фамилия, имя и отчество в отдельных столбцах.
  if (parts.every((words) => words.length === 1) && parts.length <= 4) {
    return [parts.map((words) => words[0]).join(" ")];
  }
  // Полное имя в одном столбце, рядом — пометки из одного слова («староста»).
  const full = parts.filter((words) => words.length > 1);
  return full.map((words) => words.join(" "));
}

/**
 * Возвращает имена в порядке появления. Повторы (без учёта регистра) убираются.
 */
export function parseNames(text) {
  const source = String(text ?? "").replace(/\r\n?/g, "\n");
  let lines = source.split("\n").filter((line) => line.trim() && !/^[\s|:+=_-]+$/.test(line));

  // Нумерованный список в одну строку: «1. Иванов 2. Петров».
  lines = lines.flatMap((line) =>
    (line.match(/(?:^|\s)\d{1,3}[.)]\s/g) || []).length >= 2 ? line.split(/\s(?=\d{1,3}[.)]\s)/) : [line],
  );

  const names = [];
  if (lines.length === 1 && !/\t/.test(lines[0])) {
    // Перечисление в одну строку: каждый элемент — отдельный человек.
    for (const piece of lines[0].split(/[,;|]/)) {
      const words = cleanCell(piece);
      if (words.length) names.push(words.join(" "));
    }
  } else {
    for (const line of lines) {
      const sep = /\t/.test(line) ? /\t/ : /\|/.test(line) ? /\|/ : /;/.test(line) ? /;/ : /,/;
      names.push(...rowNames(line.split(sep)));
    }
  }

  const seen = new Set();
  return names
    .map((name) => name.slice(0, 120))
    .filter((name) => {
      const key = name.toLowerCase().replace(/ё/g, "е");
      if (name.replace(/[^a-zа-яё]/gi, "").length < 2 || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
