import { HttpError, secureRandom } from "./http";
import { BET_STEP, type ChipWallets } from "./blackjack-chips";

export const PLAYERS = ["ZerG", "Binar", "xekrii", "Acute", "jiumohhbiu"] as const;
export type Player = typeof PLAYERS[number];

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
const SUITS = ["♠", "♥", "♣", "♦"] as const;
const TURN_MS = 20_000;
const DECKS = 6;
const MAX_HANDS_PER_PLAYER = 4;

type Card = { rank: typeof RANKS[number]; suit: typeof SUITS[number] };
type HandStatus = "playing" | "stand" | "bust" | "blackjack";
type Result = "win" | "lose" | "push" | "blackjack";

interface Hand {
  name: Player;
  cards: Card[];
  status: HandStatus;
  bet?: number;
  insuranceBet?: number;
  result?: Result;
}

interface DecisionWindow {
  deadline: number;
  decisions: Partial<Record<Player, number | null>>;
}

interface Round {
  id: string;
  deck: Card[];
  dealer: Card[];
  hands: Hand[];
  turn: { index: number; step: number; deadline: number } | null;
  insurance?: DecisionWindow;
  finishedAt?: number;
  settled?: true;
}

export interface Table {
  seats: { name: Player; tokenHash: string; slot?: number }[];
  betting?: DecisionWindow & { id: string };
  round: Round | null;
  messages: { id: string; author: string; text: string }[];
}

export function playerForToken(table: Table, tokenHash: string): Player | null {
  return table.seats.find((seat) => seat.tokenHash === tokenHash)?.name ?? null;
}

function seatPositions(seats: Table["seats"]): (Player | null)[] {
  const positions = Array<Player | null>(PLAYERS.length).fill(null);
  for (const { name, slot } of seats) {
    if (slot !== undefined) positions[slot] = name;
  }
  // Seats saved before random seating retain their original positions.
  for (const { name, slot } of seats) {
    if (slot !== undefined) continue;
    const original = PLAYERS.indexOf(name);
    positions[positions[original] === null ? original : positions.indexOf(null)] = name;
  }
  return positions;
}

export function seatPlayer(table: Table, player: Player, tokenHash: string): void {
  const seat = table.seats.find(({ name }) => name === player);
  if (seat) {
    seat.tokenHash = tokenHash;
    return;
  }
  const positions = seatPositions(table.seats);
  const free = positions.flatMap((name, slot) => name === null ? [slot] : []);
  for (const occupied of table.seats) occupied.slot = positions.indexOf(occupied.name);
  const slot = free[Math.floor(secureRandom() * free.length)];
  table.seats.push({ name: player, tokenHash, slot });
}

function handValue(cards: Card[]): { score: number; soft: boolean } {
  let total = 0;
  let hasAce = false;
  for (const { rank } of cards) {
    if (rank === "A") hasAce = true;
    total += Math.min(RANKS.indexOf(rank) + 1, 10);
  }
  const soft = hasAce && total + 10 <= 21;
  return { score: soft ? total + 10 : total, soft };
}

function shuffledDeck(): Card[] {
  const deck = Array.from({ length: DECKS }, () =>
    SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit }))),
  ).flat();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(secureRandom() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function draw(deck: Card[]): Card {
  const card = deck.pop();
  if (!card) throw new Error("Blackjack deck exhausted");
  return card;
}

export function roundActive(round: Round | null): boolean {
  return Boolean(round?.turn || round?.insurance);
}

export function tableActive(table: Table): boolean {
  return Boolean(table.betting || roundActive(table.round));
}

export function deadlineFor(table: Table): number | undefined {
  return table.betting?.deadline ?? table.round?.insurance?.deadline ?? table.round?.turn?.deadline;
}

function hasDecisionsLeft(window: DecisionWindow): boolean {
  return Object.values(window.decisions).includes(null);
}

function finishRound(round: Round, at: number): void {
  round.turn = null;
  round.finishedAt = at;
  const dealerBlackjack = round.dealer.length === 2 && handValue(round.dealer).score === 21;
  if (!dealerBlackjack && round.hands.some((hand) => hand.status === "stand")) {
    while (handValue(round.dealer).score < 17) round.dealer.push(draw(round.deck));
  }
  const dealerScore = handValue(round.dealer).score;
  for (const hand of round.hands) {
    const total = handValue(hand.cards).score;
    if (hand.status === "bust") hand.result = "lose";
    else if (hand.status === "blackjack") hand.result = dealerBlackjack ? "push" : "blackjack";
    else if (dealerBlackjack) hand.result = "lose";
    else if (dealerScore > 21 || total > dealerScore) hand.result = "win";
    else hand.result = total === dealerScore ? "push" : "lose";
  }
}

function nextTurn(round: Round, at: number): void {
  const index = round.hands.findIndex((hand) => hand.status === "playing");
  if (index < 0) {
    finishRound(round, at);
  } else {
    round.turn = { index, step: (round.turn?.step ?? 0) + 1, deadline: at + TURN_MS };
  }
}

export function expirePhases(table: Table, now: number, wallets: ChipWallets): void {
  if (table.betting && table.betting.deadline <= now) {
    dealRound(table, table.betting.deadline, wallets, now);
  }
  const round = table.round;
  if (round?.insurance && round.insurance.deadline <= now) {
    beginPlay(round, round.insurance.deadline);
  }
  while (round?.turn && round.turn.deadline <= now) {
    round.hands[round.turn.index].status = "stand";
    nextTurn(round, round.turn.deadline);
  }
}

export function setBet(
  table: Table, player: Player, amount: unknown, expectedRound: unknown, expectedBetting: unknown,
  now: number, wallets: ChipWallets,
): void {
  if (roundActive(table.round) || (table.round?.id ?? null) !== expectedRound ||
      (expectedBetting != null && table.betting?.id !== expectedBetting)) {
    throw new HttpError(409, "Раунд уже изменился.");
  }
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0 || amount % BET_STEP !== 0) {
    throw new HttpError(400, "Ставка должна быть кратна 100 фишкам.");
  }
  if (!table.betting) {
    if (!amount) throw new HttpError(409, "Приём ставок ещё не начался.");
    table.betting = {
      id: crypto.randomUUID(), deadline: now + TURN_MS,
      decisions: Object.fromEntries(table.seats.map(({ name }) => [name, null])),
    };
  }
  if (table.betting.decisions[player] !== null) throw new HttpError(409, "Ваш ответ уже принят или вы подключитесь к следующей раздаче.");
  if (amount) wallets.reserve(player, table.betting.id, amount, now);
  table.betting.decisions[player] = amount;
  if (!hasDecisionsLeft(table.betting)) dealRound(table, now, wallets);
}

function dealRound(table: Table, at: number, wallets: ChipWallets, chargedAt = at): void {
  const betting = table.betting;
  if (!betting) return;
  delete table.betting;
  const hands: Hand[] = [];
  for (const name of seatPositions(table.seats)) {
    if (!name) continue;
    // Bets from windows opened by the old version may have no reservation.
    const bet = wallets.release(name, betting.id) || (betting.decisions[name] ?? 0);
    if (!bet || bet > wallets.balance(name, chargedAt)) continue;
    wallets.spend(name, bet, chargedAt);
    hands.push({ name, bet, cards: [], status: "playing" });
  }
  if (!hands.length) return;
  const deck = shuffledDeck();
  const dealer: Card[] = [];
  for (let i = 0; i < 2; i++) {
    for (const hand of hands) hand.cards.push(draw(deck));
    dealer.push(draw(deck));
  }
  for (const hand of hands) {
    if (handValue(hand.cards).score === 21) hand.status = "blackjack";
  }
  const round: Round = { id: betting.id, deck, dealer, hands, turn: null };
  table.round = round;
  if (dealer[0].rank === "A") {
    round.insurance = {
      deadline: at + TURN_MS, decisions: Object.fromEntries(hands.map(({ name }) => [name, null])),
    };
  } else beginPlay(round, at);
}

function beginPlay(round: Round, at: number): void {
  delete round.insurance;
  if (handValue(round.dealer).score === 21) finishRound(round, at);
  else nextTurn(round, at);
}

export function chooseInsurance(
  table: Table, player: Player, accept: unknown, expectedRound: unknown, now: number, wallets: ChipWallets,
): void {
  const round = table.round;
  if (!round?.insurance || round.id !== expectedRound || round.insurance.decisions[player] !== null) {
    throw new HttpError(409, "Решение по страховке уже принято или окно закрылось.");
  }
  if (typeof accept !== "boolean") throw new HttpError(400, "Выберите, нужна ли страховка.");
  const hand = round.hands.find(({ name }) => name === player)!;
  const amount = accept ? (hand.bet ?? 0) / 2 : 0;
  if (amount) {
    wallets.spend(player, amount, now);
    hand.insuranceBet = amount;
  }
  round.insurance.decisions[player] = amount;
  if (!hasDecisionsLeft(round.insurance)) beginPlay(round, now);
}

export function leaveSeat(table: Table, player: Player, now: number, wallets: ChipWallets): void {
  table.seats = table.seats.filter(({ name }) => name !== player);
  if (table.betting) {
    wallets.release(player, table.betting.id);
    delete table.betting.decisions[player];
    if (!hasDecisionsLeft(table.betting)) dealRound(table, now, wallets);
    return;
  }
  const round = table.round;
  if (!round || !roundActive(round)) return;
  for (const hand of round.hands) {
    if (hand.name === player && hand.status === "playing") hand.status = "stand";
  }
  if (round.insurance) {
    if (round.insurance.decisions[player] === null) round.insurance.decisions[player] = 0;
    if (!hasDecisionsLeft(round.insurance)) beginPlay(round, now);
  } else if (round.turn && round.hands[round.turn.index].name === player) nextTurn(round, now);
}

function extraMoves(round: Round, hand: Hand, balance: number) {
  const bet = hand.bet ?? 0;
  const double = bet > 0 && hand.cards.length === 2 && balance >= bet;
  const split = double && hand.cards[0].rank === hand.cards[1].rank &&
    round.hands.filter(({ name }) => name === hand.name).length < MAX_HANDS_PER_PLAYER;
  return { double, split };
}

export function playTurn(
  table: Table, player: Player, action: "hit" | "stand" | "double" | "split",
  roundId: unknown, step: unknown, now: number, wallets: ChipWallets,
): void {
  const round = table.round;
  const turn = round?.turn;
  if (!turn || round.id !== roundId || turn.step !== step || round.hands[turn.index].name !== player) {
    throw new HttpError(409, "Ход уже изменился.");
  }
  const hand = round.hands[turn.index];
  if (action === "double" || action === "split") {
    const bet = hand.bet ?? 0;
    const balance = wallets.balance(player, now);
    if (bet > balance) throw new HttpError(409, "Недостаточно фишек.");
    if (!extraMoves(round, hand, balance)[action]) {
      throw new HttpError(409, "Этот ход недоступен.");
    }
    wallets.spend(player, bet, now);
    if (action === "split") {
      const [first, second] = hand.cards;
      hand.cards = [first, draw(round.deck)];
      const other: Hand = { name: player, bet, cards: [second, draw(round.deck)], status: "playing" };
      if (first.rank === "A" || handValue(hand.cards).score === 21) hand.status = "stand";
      if (second.rank === "A" || handValue(other.cards).score === 21) other.status = "stand";
      round.hands.splice(turn.index + 1, 0, other);
    } else {
      hand.bet = bet * 2;
      hand.cards.push(draw(round.deck));
      hand.status = handValue(hand.cards).score > 21 ? "bust" : "stand";
    }
  } else if (action === "hit") {
    hand.cards.push(draw(round.deck));
    const total = handValue(hand.cards).score;
    if (total < 21) {
      turn.step++;
      turn.deadline = now + TURN_MS;
      return;
    }
    hand.status = total > 21 ? "bust" : "stand";
  } else {
    hand.status = "stand";
  }
  nextTurn(round, now);
}

export interface ChipResult {
  roundId: string;
  player: Player;
  settledAt: number;
  won: number;
  lost: number;
}

function handPayout(hand: Hand, dealerBlackjack: boolean) {
  const bet = hand.bet ?? 0;
  const payout = hand.result === "blackjack" ? bet * 2.5 :
    hand.result === "win" ? bet * 2 : hand.result === "push" ? bet : 0;
  const insurance = hand.insuranceBet ?? 0;
  return { payout, insurancePayout: dealerBlackjack ? insurance * 3 : 0 };
}

export function settleRound(round: Round, wallets: ChipWallets, now: number, alreadyPaid?: ReadonlySet<Player>): ChipResult[] {
  if (roundActive(round) || round.finishedAt === undefined || round.settled) return [];
  const dealerBlackjack = round.dealer.length === 2 && handValue(round.dealer).score === 21;
  const totals = new Map<Player, ChipResult>();
  for (const hand of round.hands) {
    const bet = hand.bet ?? 0;
    if (!bet || alreadyPaid?.has(hand.name)) continue;
    const { payout, insurancePayout } = handPayout(hand, dealerBlackjack);
    const insurance = hand.insuranceBet ?? 0;
    if (payout || insurancePayout) wallets.credit(hand.name, payout + insurancePayout, now);
    const total = totals.get(hand.name) ?? {
      roundId: round.id, player: hand.name, settledAt: round.finishedAt, won: 0, lost: 0,
    };
    total.won += Math.max(0, payout - bet) + Math.max(0, insurancePayout - insurance);
    total.lost += Math.max(0, bet - payout) + Math.max(0, insurance - insurancePayout);
    totals.set(hand.name, total);
  }
  round.settled = true;
  return [...totals.values()];
}

export function tableView(table: Table, me: Player | null, balance: number, stats: Partial<Record<Player, {
  won: number; lost: number;
}>>, serverTime: number) {
  const round = table.round;
  const seats = table.seats.map(({ name }) => name);
  const insurance = round?.insurance;
  const dealerBlackjack = Boolean(round?.settled && round.dealer.length === 2 && handValue(round.dealer).score === 21);
  const insuranceCost = insurance && me && insurance.decisions[me] === null
    ? (round.hands.find(({ name }) => name === me)?.bet ?? 0) / 2 : null;
  return {
    me,
    serverTime,
    secondsPerAction: TURN_MS / 1000,
    balance: me ? balance : null,
    betStep: BET_STEP,
    betting: table.betting ?? null,
    stats,
    seats,
    positions: seatPositions(table.seats),
    messages: table.messages,
    round: round && {
      id: round.id,
      dealer: roundActive(round) ? [round.dealer[0], null] : round.dealer,
      dealerScore: handValue(roundActive(round) ? round.dealer.slice(0, 1) : round.dealer).score,
      hands: round.hands.map((hand) => ({
        ...hand, ...handValue(hand.cards),
        ...(round.settled ? handPayout(hand, dealerBlackjack) : {}),
      })),
      insurance: insurance ? { ...insurance, cost: insuranceCost } : null,
      turn: round.turn && {
        name: round.hands[round.turn.index].name,
        index: round.turn.index,
        step: round.turn.step,
        deadline: round.turn.deadline,
        ...(round.hands[round.turn.index].name === me ? extraMoves(round, round.hands[round.turn.index], balance) : {}),
      },
    },
  };
}
