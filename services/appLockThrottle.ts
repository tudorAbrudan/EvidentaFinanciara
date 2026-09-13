/**
 * Limitarea încercărilor de PIN.
 *
 * Fără ea, `unlockWithPin` doar compara și returna: un PIN de 4 cifre (10.000 de
 * combinații) putea fi ghicit prin UI fără nicio rezistență. Logica e pură și
 * separată de stocare ca să poată fi testată fără SecureStore.
 *
 * Domeniul de aplicare, explicit: asta îngreunează ghicirea prin interfață. NU
 * protejează baza SQLite, care rămâne necriptată pe disc — cine are acces la
 * filesystem citește direct, fără PIN.
 */

export interface ThrottleState {
  /** Eșecuri consecutive; se resetează la deblocare reușită. */
  failed: number;
  /** Epoch ms până când introducerea PIN-ului e blocată; 0 = deloc. */
  lockedUntil: number;
}

export const INITIAL_THROTTLE: ThrottleState = { failed: 0, lockedUntil: 0 };

/** Primele încercări sunt gratuite — greșeala de tastare e normală. */
const FREE_ATTEMPTS = 4;

/** Blocări escaladate, aplicate de la eșecul FREE_ATTEMPTS + 1 încolo. */
const LOCK_STEPS_MS = [30_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

export function remainingLockMs(state: ThrottleState, now: number): number {
  const left = state.lockedUntil - now;
  return left > 0 ? left : 0;
}

export function isLocked(state: ThrottleState, now: number): boolean {
  return remainingLockMs(state, now) > 0;
}

/** Eșec: incrementează contorul și, peste prag, aplică următoarea blocare. */
export function afterFailure(state: ThrottleState, now: number): ThrottleState {
  const failed = state.failed + 1;
  if (failed <= FREE_ATTEMPTS) return { failed, lockedUntil: 0 };
  const idx = Math.min(failed - FREE_ATTEMPTS - 1, LOCK_STEPS_MS.length - 1);
  return { failed, lockedUntil: now + LOCK_STEPS_MS[idx] };
}

/** Succes: contorul repornește de la zero. */
export function afterSuccess(): ThrottleState {
  return { ...INITIAL_THROTTLE };
}

/** Text pentru UI: „2 min 5 s" / „45 s". */
export function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  if (min === 0) return `${sec} s`;
  return `${min} min ${sec} s`;
}
