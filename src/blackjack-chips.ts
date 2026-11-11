import type { Player } from "./blackjack";
import { HttpError } from "./http";

const HOUR = 60 * 60 * 1000;
const HOURLY_CHIPS = 10_000;
const MAX_GRANTS_WITHOUT_SPENDING = 3;
export const BET_STEP = 100;
export const STATS_WINDOW_MS = 24 * HOUR;

interface Wallet {
  balance: number;
  grantsSinceSpend: number;
  nextGrantAt: number | null;
}

export type WalletState = Partial<Record<Player, Wallet>>;

function earnedGrants(saved: Wallet, now: number): number {
  if (saved.nextGrantAt === null || saved.nextGrantAt > now) return 0;
  return Math.min(1 + Math.floor((now - saved.nextGrantAt) / HOUR), MAX_GRANTS_WITHOUT_SPENDING - saved.grantsSinceSpend);
}

function walletAt(saved: Wallet | undefined, now: number): Wallet {
  if (!saved) return { balance: HOURLY_CHIPS, grantsSinceSpend: 1, nextGrantAt: now + HOUR };
  const grants = earnedGrants(saved, now);
  if (!grants || saved.nextGrantAt === null) return saved;
  const grantsSinceSpend = saved.grantsSinceSpend + grants;
  return {
    balance: saved.balance + HOURLY_CHIPS * grants,
    grantsSinceSpend,
    nextGrantAt: grantsSinceSpend === MAX_GRANTS_WITHOUT_SPENDING ? null : saved.nextGrantAt + grants * HOUR,
  };
}

export class ChipWallets {
  readonly movements: { player: Player; at: number; delta: number }[] = [];

  constructor(readonly state: WalletState) {}

  ensure(player: Player, now: number): void {
    if (this.state[player]) return;
    this.state[player] = this.advance(player, now);
  }

  balance(player: Player, now: number): number {
    return walletAt(this.state[player], now).balance;
  }

  snapshot(player: Player, from: number, now: number): { balance: number; pendingDelta: number } {
    const saved = this.state[player];
    if (!saved) return { balance: 0, pendingDelta: 0 };
    const balance = walletAt(saved, now).balance;
    const before = walletAt(saved, from).balance;
    return { balance, pendingDelta: balance - before };
  }

  private advance(player: Player, now: number): Wallet {
    const saved = this.state[player];
    if (!saved) this.movements.push({ player, at: now, delta: HOURLY_CHIPS });
    else if (saved.nextGrantAt !== null) {
      const grants = earnedGrants(saved, now);
      for (let i = 0; i < grants; i++) {
        this.movements.push({ player, at: saved.nextGrantAt + i * HOUR, delta: HOURLY_CHIPS });
      }
    }
    return walletAt(saved, now);
  }

  spend(player: Player, amount: number, now: number): void {
    if (this.balance(player, now) < amount) throw new HttpError(409, "Недостаточно фишек.");
    const wallet = this.advance(player, now);
    this.state[player] = {
      balance: wallet.balance - amount,
      grantsSinceSpend: 0,
      nextGrantAt: wallet.nextGrantAt ?? now + HOUR,
    };
    this.movements.push({ player, at: now, delta: -amount });
  }

  credit(player: Player, amount: number, now: number): void {
    const wallet = this.advance(player, now);
    this.state[player] = { ...wallet, balance: wallet.balance + amount };
    this.movements.push({ player, at: now, delta: amount });
  }
}
