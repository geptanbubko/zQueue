// Логика очереди. Команды пользователей проверяются в decide и превращаются в
// изменения, которые apply применяет к снимку состояния комнаты. В неизменяемый
// журнал попадают только изменения из LOGGED: создание комнаты, выдача и отзыв
// доступа, создание и отмена очередей.

export type Role = "owner" | "editor";
export type Level = 1 | 2 | 3;

export interface Member {
  id: string;
  name: string;
  role: Role;
  active: boolean;
  addedBy: string | null;
  addedAt: string;
  revokedBy?: string;
  revokedAt?: string;
}

export interface Student {
  id: string;
  name: string;
  burden: number;
}

export interface Settings {
  absenceScore: number;
  tailScore: number;
}

export interface Session {
  id: string;
  createdAt: string;
  createdBy: string | null;
  order: string[];
  priority: Record<string, number>;
  unfinishedFrom: string | null;
  status: "awaiting" | "scored" | "cancelled";
  cancelledAt?: string;
  cancelledBy?: string | null;
  increments?: Record<string, number>;
  absent?: string[];
  unfinished?: string[];
}

export interface RoomState {
  title: string;
  createdAt: string;
  settings: Settings;
  members: Member[];
  students: Student[];
  pool: string[];
  urgentMode: boolean;
  priority: Record<string, number>;
  history: Session[];
}

export interface Change {
  type: string;
  payload: any;
}

export interface ChangeMeta {
  createdAt: string;
  actorId: string | null;
}

export interface DecideContext {
  newId(): string;
  random(): number;
}

export class DomainError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function fail(message: string, status = 400): never {
  throw new DomainError(message, status);
}

/** Изменения, которые записываются в журнал. */
export const LOGGED = new Set(["room.created", "member.added", "member.revoked", "queue.created", "session.cancelled"]);

export const DEFAULT_SETTINGS: Settings = { absenceScore: 0.5, tailScore: 1 };
export const MAX_STUDENTS = 300;

export function normalizeName(value: unknown, max = 120): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, max);
}

function positionScore(index: number, count: number): number {
  if (count <= 1) return 0;
  return index / (count - 1);
}

export function absenceScore(count: number, settings: Settings): number {
  if (count <= 1) return 0;
  return settings.absenceScore;
}

export function delayFor(index: number, count: number, cutoff: number, settings: Settings): number {
  if (cutoff >= 0 && index >= cutoff) return settings.tailScore;
  return positionScore(index, count);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function findStudent(state: RoomState, id: unknown): Student | undefined {
  return state.students.find((s) => s.id === id);
}

function poolStudents(state: RoomState): Student[] {
  const ids = new Set(state.pool);
  return state.students.filter((s) => ids.has(s.id));
}

export function priorityLevel(state: RoomState, id: string): Level {
  if (!state.urgentMode || !state.pool.includes(id)) return 1;
  const level = state.priority[id];
  return level === 2 || level === 3 ? level : 1;
}

function prioritySnapshot(state: RoomState): Record<string, number> {
  const snapshot: Record<string, number> = {};
  for (const student of poolStudents(state)) {
    const level = priorityLevel(state, student.id);
    if (level > 1) snapshot[student.id] = level;
  }
  return snapshot;
}

function weightedShuffle(students: Student[], random: () => number): string[] {
  return students
    .map((student) => {
      const u = Math.max(random(), Number.EPSILON);
      return { id: student.id, key: -Math.log(u) / (1 + student.burden) };
    })
    .sort((a, b) => a.key - b.key)
    .map((item) => item.id);
}

function sameMembers(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const ids = new Set(right);
  return left.every((id) => ids.has(id));
}

function parseScore(value: unknown, label: string): number {
  const num = typeof value === "string" ? Number(value.replace(",", ".")) : value;
  if (typeof num !== "number" || !Number.isFinite(num) || num < 0 || num > 100) {
    fail(`${label}: нужно число от 0 до 100.`);
  }
  return Math.round(num * 1000) / 1000;
}

function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === "string");
}

const OWNER_ONLY = new Set(["room.renamed", "member.added", "member.revoked", "room.imported"]);

/** Проверяет команду и возвращает изменение, которое нужно применить. */
export function decide(state: RoomState, cmd: any, actor: Member, ctx: DecideContext): Change {
  if (!cmd || typeof cmd.type !== "string") fail("Неизвестная команда.");
  if (!actor.active) fail("Доступ отозван.", 403);
  if (OWNER_ONLY.has(cmd.type) && actor.role !== "owner") {
    fail("Это может сделать только создатель комнаты.", 403);
  }

  switch (cmd.type) {
    case "room.renamed": {
      const to = normalizeName(cmd.title, 80);
      if (!to) fail("Введите название.");
      if (to === state.title) fail("Название не изменилось.");
      return { type: cmd.type, payload: { to } };
    }

    case "member.added": {
      const name = normalizeName(cmd.name, 60);
      if (!name) fail("Введите имя.");
      if (state.members.filter((m) => m.active).length >= 30) fail("Слишком много редакторов.");
      return { type: cmd.type, payload: { id: ctx.newId(), name } };
    }

    case "member.revoked": {
      const member = state.members.find((m) => m.id === cmd.id);
      if (!member || !member.active) fail("Редактор не найден.");
      if (member.role === "owner") fail("Доступ создателя не может быть отозван.");
      return { type: cmd.type, payload: { id: member.id, name: member.name } };
    }

    case "settings.changed": {
      const to: Settings = {
        absenceScore: parseScore(cmd.absenceScore, "Отсутствие в очереди"),
        tailScore: parseScore(cmd.tailScore, "Работа не сдана"),
      };
      const from = state.settings;
      if (from.absenceScore === to.absenceScore && from.tailScore === to.tailScore) {
        fail("Параметры не изменились.");
      }
      return { type: cmd.type, payload: { to } };
    }

    case "student.added": {
      const name = normalizeName(cmd.name);
      if (!name) fail("Введите имя.");
      if (state.students.length >= MAX_STUDENTS) fail("Слишком большой список.");
      if (state.students.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
        fail("Такое имя уже есть в списке.");
      }
      const burden = median(state.students.map((s) => s.burden));
      return { type: cmd.type, payload: { id: ctx.newId(), name, burden } };
    }

    case "student.removed": {
      const student = findStudent(state, cmd.id) ?? fail("Участник не найден.");
      return { type: cmd.type, payload: { id: student.id } };
    }

    case "student.renamed": {
      const student = findStudent(state, cmd.id) ?? fail("Участник не найден.");
      const to = normalizeName(cmd.name);
      if (!to) fail("Введите имя.");
      if (to === student.name) fail("Имя не изменилось.");
      if (state.students.some((s) => s.id !== student.id && s.name.toLowerCase() === to.toLowerCase())) {
        fail("Такое имя уже есть в списке.");
      }
      return { type: cmd.type, payload: { id: student.id, to } };
    }

    case "student.burdenSet": {
      const student = findStudent(state, cmd.id) ?? fail("Участник не найден.");
      const to = parseScore(cmd.burden, "Приоритет");
      if (to === student.burden) fail("Значение не изменилось.");
      return { type: cmd.type, payload: { id: student.id, to } };
    }

    case "pool.changed": {
      const known = new Set(state.students.map((s) => s.id));
      const inPool = new Set(state.pool);
      const added = [...new Set(idList(cmd.add))].filter((id) => known.has(id) && !inPool.has(id));
      const removed = [...new Set(idList(cmd.remove))].filter((id) => inPool.has(id));
      if (added.length === 0 && removed.length === 0) fail("Список сдающих не изменился.");
      return { type: cmd.type, payload: { added, removed } };
    }

    case "urgent.toggled":
      return { type: cmd.type, payload: { on: !state.urgentMode } };

    case "priority.set": {
      if (!state.urgentMode) fail("Включите приоритет по срокам.");
      if (!state.pool.includes(cmd.id)) fail("Участник не отмечен как сдающий.");
      const to = cmd.level;
      if (to !== 1 && to !== 2 && to !== 3) fail("Неверный уровень.");
      if (priorityLevel(state, cmd.id) === to) fail("Уровень не изменился.");
      return { type: cmd.type, payload: { id: cmd.id, to } };
    }

    case "queue.created": {
      const participants = poolStudents(state);
      if (participants.length === 0) fail("Отметьте участников, сдающих работы.");
      if (state.history.some((s) => s.status === "awaiting")) {
        fail("Подведите итоги предыдущей очереди.");
      }
      if (!sameMembers(idList(cmd.pool), state.pool)) {
        fail("Список сдающих был изменён. Проверьте его и повторите действие.", 409);
      }
      const order = ([3, 2, 1] as const)
        .map((level) => participants.filter((s) => priorityLevel(state, s.id) === level))
        .filter((group) => group.length > 0)
        .flatMap((group) => weightedShuffle(group, ctx.random));
      return { type: cmd.type, payload: { sessionId: ctx.newId(), order, priority: prioritySnapshot(state) } };
    }

    case "session.tailMarked": {
      const session = state.history.find((s) => s.id === cmd.sessionId);
      if (!session || session.status !== "awaiting") fail("Итоги этой очереди уже подведены.");
      const from = cmd.from ?? null;
      if (from !== null && !session.order.includes(from)) fail("Участник не из этой очереди.");
      if (from === session.unfinishedFrom) fail("Отметка не изменилась.");
      return { type: cmd.type, payload: { sessionId: session.id, from } };
    }

    case "session.scored": {
      const session = state.history.find((s) => s.id === cmd.sessionId);
      if (!session || session.status !== "awaiting") fail("Итоги этой очереди уже подведены.");
      const order = session.order;
      const cutoff = session.unfinishedFrom ? order.indexOf(session.unfinishedFrom) : -1;
      const increments: Record<string, number> = {};
      const inOrder = new Set(order);
      const absent: string[] = [];
      order.forEach((id, index) => {
        if (findStudent(state, id)) increments[id] = delayFor(index, order.length, cutoff, state.settings);
      });
      const skip = absenceScore(order.length, state.settings);
      for (const student of state.students) {
        if (inOrder.has(student.id)) continue;
        increments[student.id] = skip;
        absent.push(student.id);
      }
      return {
        type: cmd.type,
        payload: { sessionId: session.id, increments, absent, unfinished: cutoff >= 0 ? order.slice(cutoff) : [] },
      };
    }

    case "session.undo": {
      // Отменённые очереди остаются в истории, но отменять их повторно нельзя.
      const last = state.history.find((s) => s.status !== "cancelled") ?? fail("Нет действий для отмены.");
      if (last.status === "awaiting") {
        return { type: "session.cancelled", payload: { sessionId: last.id } };
      }
      if (!last.increments) fail("Эту запись отменить невозможно.");
      return { type: "session.scoreReverted", payload: { sessionId: last.id } };
    }

    case "room.imported":
      return { type: cmd.type, payload: parseImport(state, cmd.data) };

    default:
      fail("Неизвестная команда.");
  }
}

function cleanPriority(raw: any, known: Set<string>): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [id, level] of Object.entries(raw)) {
    if (known.has(id) && (level === 2 || level === 3)) out[id] = level;
  }
  return out;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64;
}

/** Перенос данных из queue-data.json старой версии. */
function parseImport(state: RoomState, data: any) {
  if (state.history.length > 0) fail("Импорт возможен только в комнату без сдач.");
  if (!data || !Array.isArray(data.students) || !Array.isArray(data.history)) {
    fail("В файле нет списка группы и истории.");
  }
  if (data.students.length > MAX_STUDENTS) fail("Слишком большой список.");
  const students: Student[] = data.students.map((s: any) => {
    const name = normalizeName(s?.name);
    const burden = Number(s?.burden);
    if (!validId(s?.id) || !name || !Number.isFinite(burden) || burden < 0) {
      fail("В файле есть некорректная запись о студенте.");
    }
    return { id: s.id, name, burden };
  });
  const known = new Set(students.map((s) => s.id));
  const history: Session[] = data.history.slice(0, 500).map((h: any) => {
    if (!validId(h?.id) || !Array.isArray(h.order)) fail("В файле есть некорректная запись истории.");
    const priority = cleanPriority(h.priority, new Set(idList(h.order)));
    if (Object.keys(priority).length === 0) {
      for (const id of idList(h.urgent)) priority[id] = 3;
    }
    const session: Session = {
      id: h.id,
      createdAt: typeof h.createdAt === "string" ? h.createdAt : "",
      createdBy: null,
      order: idList(h.order),
      priority,
      unfinishedFrom: typeof h.unfinishedFrom === "string" ? h.unfinishedFrom : null,
      status: h.awaitingScore ? "awaiting" : "scored",
    };
    if (session.status === "scored") {
      if (h.increments && typeof h.increments === "object") {
        session.increments = Object.fromEntries(
          Object.entries(h.increments).filter(([, v]) => typeof v === "number"),
        ) as Record<string, number>;
      }
      session.absent = idList(h.absent);
      session.unfinished = idList(h.unfinished);
    }
    return session;
  });
  const pool = idList(data.pool).filter((id) => known.has(id));
  return {
    students,
    history,
    pool,
    urgentMode: Boolean(data.urgentMode),
    priority: cleanPriority(data.priority, new Set(pool)),
  };
}

/** Приводит снимок, сохранённый прошлой версией, к текущему формату. */
export function upgradeState(raw: any): RoomState {
  const { draft: _draft, shuffles: _shuffles, ...state } = raw;
  for (const m of state.members) {
    m.addedBy ??= null;
    m.addedAt ??= state.createdAt;
  }
  for (const s of state.history) {
    s.createdBy ??= null;
    delete s.shuffles;
  }
  return state as RoomState;
}

export function createdChange(title: string, owner: { id: string; name: string }): Change {
  return { type: "room.created", payload: { title, owner } };
}

/** Применяет изменение к состоянию. Не меняет исходный объект. */
export function apply(prev: RoomState | null, change: Change, meta: ChangeMeta): RoomState {
  const p = change.payload;
  if (change.type === "room.created") {
    return {
      title: p.title,
      createdAt: meta.createdAt,
      settings: { ...DEFAULT_SETTINGS },
      members: [
        { id: p.owner.id, name: p.owner.name, role: "owner", active: true, addedBy: null, addedAt: meta.createdAt },
      ],
      students: [],
      pool: [],
      urgentMode: false,
      priority: {},
      history: [],
    };
  }
  if (!prev) throw new Error(`change ${change.type} before room.created`);
  const s: RoomState = structuredClone(prev);
  const student = (id: string) => s.students.find((x) => x.id === id);
  const session = (id: string) => s.history.find((x) => x.id === id);

  switch (change.type) {
    case "room.renamed":
      s.title = p.to;
      break;
    case "member.added":
      s.members.push({
        id: p.id,
        name: p.name,
        role: "editor",
        active: true,
        addedBy: meta.actorId,
        addedAt: meta.createdAt,
      });
      break;
    case "member.revoked": {
      const member = s.members.find((m) => m.id === p.id);
      if (member) {
        member.active = false;
        member.revokedBy = meta.actorId ?? undefined;
        member.revokedAt = meta.createdAt;
      }
      break;
    }
    case "settings.changed":
      s.settings = { ...p.to };
      break;
    case "student.added":
      s.students.push({ id: p.id, name: p.name, burden: p.burden });
      break;
    case "student.removed": {
      s.students = s.students.filter((x) => x.id !== p.id);
      s.pool = s.pool.filter((id) => id !== p.id);
      delete s.priority[p.id];
      for (const item of s.history) {
        if (item.status !== "awaiting" || item.unfinishedFrom !== p.id) continue;
        item.unfinishedFrom = item.order[item.order.indexOf(p.id) + 1] ?? null;
      }
      break;
    }
    case "student.renamed": {
      const target = student(p.id);
      if (target) target.name = p.to;
      break;
    }
    case "student.burdenSet": {
      const target = student(p.id);
      if (target) target.burden = p.to;
      break;
    }
    case "pool.changed": {
      const removed = new Set<string>(p.removed);
      s.pool = s.pool.filter((id) => !removed.has(id)).concat(p.added);
      for (const id of removed) delete s.priority[id];
      break;
    }
    case "urgent.toggled":
      s.urgentMode = p.on;
      if (!p.on) s.priority = {};
      break;
    case "priority.set":
      if (p.to > 1) s.priority[p.id] = p.to;
      else delete s.priority[p.id];
      break;
    case "queue.created":
      s.history.unshift({
        id: p.sessionId,
        createdAt: meta.createdAt,
        createdBy: meta.actorId,
        order: [...p.order],
        priority: { ...p.priority },
        unfinishedFrom: null,
        status: "awaiting",
      });
      s.pool = [];
      s.priority = {};
      s.urgentMode = false;
      break;
    case "session.tailMarked": {
      const target = session(p.sessionId);
      if (target) target.unfinishedFrom = p.from;
      break;
    }
    case "session.scored": {
      const target = session(p.sessionId);
      if (!target) break;
      for (const [id, delta] of Object.entries(p.increments as Record<string, number>)) {
        const st = student(id);
        if (st) st.burden += delta;
      }
      target.increments = { ...p.increments };
      target.absent = [...p.absent];
      target.unfinished = [...p.unfinished];
      target.status = "scored";
      break;
    }
    case "session.scoreReverted": {
      const target = session(p.sessionId);
      if (!target) break;
      for (const [id, delta] of Object.entries(target.increments ?? {})) {
        const st = student(id);
        if (st) st.burden = Math.max(0, st.burden - delta);
      }
      delete target.increments;
      delete target.absent;
      delete target.unfinished;
      target.status = "awaiting";
      break;
    }
    case "session.cancelled": {
      const target = session(p.sessionId);
      if (!target) break;
      target.status = "cancelled";
      target.cancelledAt = meta.createdAt;
      target.cancelledBy = meta.actorId;
      target.unfinishedFrom = null;
      s.pool = target.order.filter((id) => student(id));
      s.priority = cleanPriority(target.priority, new Set(s.pool));
      s.urgentMode = Object.keys(s.priority).length > 0;
      break;
    }
    case "room.imported":
      s.students = p.students.map((x: Student) => ({ ...x }));
      s.history = structuredClone(p.history);
      s.pool = [...p.pool];
      s.urgentMode = p.urgentMode;
      s.priority = { ...p.priority };
      break;
    default:
      throw new Error(`unknown change ${change.type}`);
  }
  return s;
}
