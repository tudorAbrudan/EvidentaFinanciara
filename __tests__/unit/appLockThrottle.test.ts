import {
  afterFailure,
  afterSuccess,
  formatRemaining,
  INITIAL_THROTTLE,
  isLocked,
  remainingLockMs,
} from '@/services/appLockThrottle';

const NOW = 1_000_000;

describe('appLockThrottle', () => {
  it('primele 4 greșeli nu blochează — greșeala de tastare e normală', () => {
    let s = INITIAL_THROTTLE;
    for (let i = 0; i < 4; i++) {
      s = afterFailure(s, NOW);
      expect(isLocked(s, NOW)).toBe(false);
    }
    expect(s.failed).toBe(4);
  });

  it('a 5-a greșeală blochează 30 de secunde', () => {
    let s = INITIAL_THROTTLE;
    for (let i = 0; i < 5; i++) s = afterFailure(s, NOW);
    expect(isLocked(s, NOW)).toBe(true);
    expect(remainingLockMs(s, NOW)).toBe(30_000);
  });

  it('blocările escaladează: 30s, 1m, 5m, 15m, 1h', () => {
    let s = INITIAL_THROTTLE;
    for (let i = 0; i < 4; i++) s = afterFailure(s, NOW);
    const steps = [30_000, 60_000, 300_000, 900_000, 3_600_000];
    for (const expected of steps) {
      s = afterFailure(s, NOW);
      expect(remainingLockMs(s, NOW)).toBe(expected);
    }
  });

  it('peste ultima treaptă rămâne la 1 oră, nu crește la infinit', () => {
    let s = INITIAL_THROTTLE;
    for (let i = 0; i < 20; i++) s = afterFailure(s, NOW);
    expect(remainingLockMs(s, NOW)).toBe(3_600_000);
  });

  it('blocarea expiră odată cu trecerea timpului', () => {
    let s = INITIAL_THROTTLE;
    for (let i = 0; i < 5; i++) s = afterFailure(s, NOW);
    expect(isLocked(s, NOW + 29_000)).toBe(true);
    expect(isLocked(s, NOW + 31_000)).toBe(false);
    expect(remainingLockMs(s, NOW + 31_000)).toBe(0);
  });

  it('succesul resetează contorul complet', () => {
    let s = INITIAL_THROTTLE;
    for (let i = 0; i < 7; i++) s = afterFailure(s, NOW);
    s = afterSuccess();
    expect(s).toEqual(INITIAL_THROTTLE);
    expect(isLocked(s, NOW)).toBe(false);
  });

  it('după reset, escaladarea repornește de la prima treaptă', () => {
    let s = INITIAL_THROTTLE;
    for (let i = 0; i < 7; i++) s = afterFailure(s, NOW);
    s = afterSuccess();
    for (let i = 0; i < 5; i++) s = afterFailure(s, NOW);
    expect(remainingLockMs(s, NOW)).toBe(30_000);
  });

  it('formatRemaining afișează secunde și minute', () => {
    expect(formatRemaining(45_000)).toBe('45 s');
    expect(formatRemaining(125_000)).toBe('2 min 5 s');
    expect(formatRemaining(1)).toBe('1 s');
  });
});
