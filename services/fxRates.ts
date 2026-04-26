import { db } from './db';

const BNR_YEAR_URL = (year: number) =>
  `https://www.bnr.ro/files/xml/years/nbrfxrates${year}.xml`;
const BNR_CURRENT_URL = 'https://www.bnr.ro/nbrfxrates.xml';

const STALE_DAYS = 7;
const yearsFetchedThisSession = new Set<number>();
const yearsRefreshedThisSession = new Set<number>();

interface RateRow {
  date: string;
  currency: string;
  rate: number;
}

function parseBnrXml(xml: string): RateRow[] {
  const out: RateRow[] = [];
  const cubeRe = /<Cube\s+date="(\d{4}-\d{2}-\d{2})"[^>]*>([\s\S]*?)<\/Cube>/g;
  const rateRe = /<Rate\s+currency="([A-Z]{3})"(?:\s+multiplier="(\d+)")?\s*>([0-9.]+)<\/Rate>/g;
  let cubeMatch: RegExpExecArray | null;
  while ((cubeMatch = cubeRe.exec(xml)) !== null) {
    const date = cubeMatch[1];
    const inner = cubeMatch[2];
    let rateMatch: RegExpExecArray | null;
    rateRe.lastIndex = 0;
    while ((rateMatch = rateRe.exec(inner)) !== null) {
      const currency = rateMatch[1];
      const multiplier = rateMatch[2] ? parseInt(rateMatch[2], 10) : 1;
      const value = parseFloat(rateMatch[3]);
      if (!Number.isFinite(value) || value <= 0 || multiplier <= 0) continue;
      out.push({ date, currency, rate: value / multiplier });
    }
  }
  return out;
}

async function getMostRecentCachedDate(year: number): Promise<string | null> {
  const row = await db.getFirstAsync<{ max_date: string | null }>(
    "SELECT MAX(date) AS max_date FROM fx_rates WHERE substr(date, 1, 4) = ?",
    [String(year)]
  );
  return row?.max_date ?? null;
}

async function persistRates(rates: RateRow[]): Promise<void> {
  if (rates.length === 0) return;
  const fetchedAt = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    for (const r of rates) {
      await db.runAsync(
        'INSERT OR REPLACE INTO fx_rates (date, currency, rate, fetched_at) VALUES (?, ?, ?, ?)',
        [r.date, r.currency, r.rate, fetchedAt]
      );
    }
  });
}

async function fetchYear(year: number): Promise<void> {
  const isCurrentYear = year === new Date().getFullYear();
  const url = isCurrentYear ? BNR_CURRENT_URL : BNR_YEAR_URL(year);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`BNR ${res.status}`);
  const xml = await res.text();
  const rates = parseBnrXml(xml);
  if (rates.length === 0) throw new Error('XML BNR fără cursuri valide');
  await persistRates(rates);
}

/**
 * Asigură că anul `year` are cursuri în cache. Pentru anul curent, re-fetch
 * dacă cea mai recentă dată cache < azi - STALE_DAYS. Pentru ani trecuți,
 * fetch o singură dată.
 */
async function ensureYearCached(year: number): Promise<void> {
  const isCurrentYear = year === new Date().getFullYear();

  if (yearsFetchedThisSession.has(year)) {
    if (!isCurrentYear) return;
    if (yearsRefreshedThisSession.has(year)) return;
  }

  const mostRecent = await getMostRecentCachedDate(year);

  if (!mostRecent) {
    await fetchYear(year);
    yearsFetchedThisSession.add(year);
    if (isCurrentYear) yearsRefreshedThisSession.add(year);
    return;
  }

  if (isCurrentYear) {
    const ageMs = Date.now() - new Date(mostRecent).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays >= STALE_DAYS) {
      await fetchYear(year);
      yearsRefreshedThisSession.add(year);
    }
    yearsFetchedThisSession.add(year);
    return;
  }

  yearsFetchedThisSession.add(year);
}

/**
 * Caută cursul RON pentru o (data, valută). Strategie:
 * 1. Match exact pe dată
 * 2. Cea mai recentă dată ≤ cerută (acoperă weekend/sărbători)
 */
async function lookupRate(date: string, currency: string): Promise<number | null> {
  const row = await db.getFirstAsync<{ rate: number }>(
    'SELECT rate FROM fx_rates WHERE currency = ? AND date <= ? ORDER BY date DESC LIMIT 1',
    [currency, date]
  );
  return row?.rate ?? null;
}

/**
 * Returnează cursul RON pentru 1 unitate din `currency` la `date`.
 * Dacă cache-ul e gol pentru anul respectiv, încearcă fetch BNR.
 * Aruncă eroare dacă nu reușește (offline + cache gol pentru anul ăla).
 */
export async function getRateRon(date: string, currency: string): Promise<number> {
  const cur = currency.toUpperCase();
  if (cur === 'RON') return 1;

  const cached = await lookupRate(date, cur);
  if (cached !== null) {
    const year = parseInt(date.slice(0, 4), 10);
    if (year === new Date().getFullYear()) {
      try {
        await ensureYearCached(year);
      } catch {
        // best-effort: avem deja un curs valid în cache, continuăm
      }
    }
    const fresh = await lookupRate(date, cur);
    return fresh ?? cached;
  }

  const year = parseInt(date.slice(0, 4), 10);
  if (!Number.isFinite(year)) throw new Error(`Dată invalidă: ${date}`);
  await ensureYearCached(year);

  const afterFetch = await lookupRate(date, cur);
  if (afterFetch !== null) return afterFetch;

  throw new Error(`Cursul ${cur} nu este disponibil pentru ${date} în BNR.`);
}

/**
 * Convertește o sumă într-o valută la RON folosind cursul BNR pentru data dată.
 * Returnează `amount * rate` (păstrează semnul).
 */
export async function convertToRon(
  amount: number,
  currency: string,
  date: string
): Promise<number> {
  const rate = await getRateRon(date, currency);
  return amount * rate;
}
