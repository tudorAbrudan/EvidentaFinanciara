/**
 * Contoare de cereri, în memorie.
 *
 * Trei găleți pe zi: per device (header-ul anonim trimis de aplicație), per IP
 * și globală. IP-ul e acolo pentru că header-ul de device poate fi schimbat de
 * cine extrage token-ul din bundle — fără el, limita per device e decorativă.
 *
 * ATENȚIE la ce NU garantează asta: Rapids e scale-to-zero, deci containerul
 * moare când nu vine trafic, iar contoarele pleacă cu el. Un atacator răbdător
 * poate aștepta un cold start ca să-și reseteze cota. Contoarele sunt un filtru
 * de abuz obișnuit, nu o plasă etanșă — stopul real rămâne plafonul de
 * cheltuială setat în contul providerului.
 *
 * Dacă ajunge să conteze, mută starea într-un Valkey (Danube, ~6,49€/lună) și
 * păstrează exact aceeași interfață.
 */

/** @typedef {{ device: string, ip: string }} CountingKeys */

/** @type {Map<string, { day: string, count: number }>} */
const perDevice = new Map();
/** @type {Map<string, { day: string, count: number }>} */
const perIp = new Map();
let global = { day: '', count: 0 };

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Curăță intrările din zilele trecute. Rulat la fiecare verificare: Map-urile
 * cresc cu numărul de device-uri active azi, nu la nesfârșit.
 */
function evictStale(map, day) {
  for (const [key, entry] of map) {
    if (entry.day !== day) map.delete(key);
  }
}

/** Trece contoarele în ziua curentă (UTC) la prima cerere de după miezul nopții. */
function rollDay() {
  const day = today();
  if (global.day !== day) {
    global = { day, count: 0 };
    evictStale(perDevice, day);
    evictStale(perIp, day);
  }
  return day;
}

function countOf(map, key, day) {
  const entry = map.get(key);
  return entry && entry.day === day ? entry.count : 0;
}

function bump(map, key, day, delta) {
  map.set(key, { day, count: Math.max(0, countOf(map, key, day) + delta) });
}

/**
 * @param {CountingKeys} keys
 * @param {{ perDeviceDailyLimit: number, perIpDailyLimit: number, globalDailyLimit: number }} limits
 * @returns {{ ok: true } | { ok: false, scope: 'device' | 'ip' | 'global' }}
 */
export function checkAndCount(keys, limits) {
  const day = rollDay();

  if (global.count >= limits.globalDailyLimit) {
    return { ok: false, scope: 'global' };
  }
  if (countOf(perDevice, keys.device, day) >= limits.perDeviceDailyLimit) {
    return { ok: false, scope: 'device' };
  }
  if (countOf(perIp, keys.ip, day) >= limits.perIpDailyLimit) {
    return { ok: false, scope: 'ip' };
  }

  bump(perDevice, keys.device, day, 1);
  bump(perIp, keys.ip, day, 1);
  global = { day, count: global.count + 1 };
  return { ok: true };
}

/**
 * Întoarce cota consumată de o cerere care n-a produs un răspuns AI (eroare sau
 * timeout la provider). Altfel un provider indisponibil ar consuma cota zilnică
 * a userului fără să-i dea nimic.
 *
 * @param {CountingKeys} keys
 */
export function release(keys) {
  const day = rollDay();
  bump(perDevice, keys.device, day, -1);
  bump(perIp, keys.ip, day, -1);
  global = { day, count: Math.max(0, global.count - 1) };
}

/** Doar pentru /health autentificat și teste. Nu expune identificatori. */
export function stats() {
  return { day: global.day, globalCount: global.count, devicesToday: perDevice.size };
}

/** Doar pentru teste. */
export function __reset() {
  perDevice.clear();
  perIp.clear();
  global = { day: '', count: 0 };
}
