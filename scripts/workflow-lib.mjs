/**
 * Utilitare comune pentru gate-urile de workflow (plan-gate, Stop-gate, pre-push, statusline).
 *
 * Regula care guvernează tot fișierul: funcțiile aruncă atunci când mediul e neașteptat
 * (git indisponibil, repo fără commit-uri), iar apelanții — hook-urile — prind și ies cu 0.
 * Fail-open e responsabilitatea gate-ului, nu a bibliotecii: aici vrem eroarea vizibilă.
 *
 * Fără dependențe externe: doar node:crypto, node:fs, node:path, node:child_process.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

/** Fișierele care declanșează gate-urile (A4 din spec). */
const REGEX_FEATURE = /^(services|app|components|hooks|theme|types)\//;
/** Subsetul care cere dovadă vizuală la VERIFY (A5 din spec). */
const REGEX_UI = /^(app|components|theme)\//;

export const FAZE = ['plan', 'verify', 'review'];

/** Rulează git și întoarce stdout-ul. Aruncă dacă git eșuează. */
function git(argumente, cwd) {
  return execFileSync('git', argumente, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function repoRoot(cwd = process.cwd()) {
  return git(['rev-parse', '--show-toplevel'], cwd).trim();
}

export function headSha(cwd = process.cwd()) {
  return git(['rev-parse', 'HEAD'], cwd).trim();
}

export function branchCurent(cwd = process.cwd()) {
  return git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).trim();
}

/**
 * Citește JSON-ul primit de hook pe stdin. Orice problemă (stdin absent, JSON invalid,
 * tip greșit) întoarce `{}` — hook-ul decide apoi să treacă mai departe.
 */
export function readStdinJson() {
  try {
    if (process.stdin.isTTY) return {};
    const brut = readFileSync(0, 'utf8');
    if (!brut.trim()) return {};
    const analizat = JSON.parse(brut);
    return analizat !== null && typeof analizat === 'object' ? analizat : {};
  } catch {
    return {};
  }
}

/**
 * Amprenta stării de lucru: `git status --porcelain` + `\0` + `git diff HEAD`.
 * Orice editare ulterioară schimbă amprenta, deci invalidează chitanțele deja scrise.
 */
export function diffFingerprint(cwd = process.cwd()) {
  const status = git(['status', '--porcelain'], cwd);
  const diff = git(['diff', 'HEAD'], cwd);
  return createHash('sha256').update(status).update('\0').update(diff).digest('hex');
}

function normalizeaza(cale) {
  return cale.split(sep).join('/').replace(/^\.\//, '');
}

export function isFeatureFile(cale) {
  if (typeof cale !== 'string' || cale.trim() === '') return false;
  const normalizata = normalizeaza(cale.trim());
  if (normalizata.startsWith('__tests__/')) return false;
  return REGEX_FEATURE.test(normalizata);
}

export function isUiFile(cale) {
  if (typeof cale !== 'string' || cale.trim() === '') return false;
  const normalizata = normalizeaza(cale.trim());
  if (normalizata.startsWith('__tests__/')) return false;
  return REGEX_UI.test(normalizata);
}

/**
 * Traduce calea primită de la hook (absolută) în cale relativă la rădăcina repo-ului.
 * Fără asta, `isFeatureFile` ar primi `/Users/…/services/x.ts` și n-ar potrivi niciodată.
 */
export function toRepoRelative(cale, cwd = process.cwd()) {
  if (typeof cale !== 'string' || cale.trim() === '') return '';
  const curatata = cale.trim();
  if (!isAbsolute(curatata)) return normalizeaza(curatata);
  const relativa = relative(repoRoot(cwd), curatata);
  return normalizeaza(relativa);
}

/** Toate fișierele atinse față de HEAD: modificări urmărite + tot ce apare în status. */
export function filesInDiff(cwd = process.cwd()) {
  const nume = new Set();

  for (const linie of git(['diff', 'HEAD', '--name-only'], cwd).split('\n')) {
    const curatata = linie.trim();
    if (curatata !== '') nume.add(curatata);
  }

  for (const linie of git(['status', '--porcelain'], cwd).split('\n')) {
    if (linie.trim() === '') continue;
    // Format: XY<spațiu>cale, iar la redenumiri „veche -> nouă".
    const parteCale = linie.slice(3).trim();
    const bucati = parteCale.split(' -> ');
    const finala = bucati[bucati.length - 1].replace(/^"|"$/g, '');
    if (finala !== '') nume.add(finala);
  }

  return [...nume].sort();
}

export function featureFilesInDiff(cwd = process.cwd()) {
  return filesInDiff(cwd).filter(isFeatureFile);
}

export function diffAtingeUi(cwd = process.cwd()) {
  return filesInDiff(cwd).some(isUiFile);
}

export function stateDir(cwd = process.cwd()) {
  const dir = join(repoRoot(cwd), '.claude', 'state');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function receiptPath(faza, cwd = process.cwd()) {
  return join(stateDir(cwd), `phase-${faza}.json`);
}

/** Întoarce chitanța fazei, sau `null` dacă lipsește ori e coruptă. */
export function readReceipt(faza, cwd = process.cwd()) {
  try {
    const cale = receiptPath(faza, cwd);
    if (!existsSync(cale)) return null;
    const analizata = JSON.parse(readFileSync(cale, 'utf8'));
    return analizata !== null && typeof analizata === 'object' ? analizata : null;
  } catch {
    return null;
  }
}

export function writeReceipt(faza, date, cwd = process.cwd()) {
  const cale = receiptPath(faza, cwd);
  writeFileSync(cale, `${JSON.stringify(date, null, 2)}\n`, 'utf8');
  return cale;
}

export function sha256File(cale) {
  return createHash('sha256').update(readFileSync(cale)).digest('hex');
}

function scrieAudit(dir, mesaj) {
  try {
    const linie = `${new Date().toISOString()}\t${mesaj}\n`;
    appendFileSync(join(dir, 'override-log.txt'), linie, 'utf8');
  } catch {
    // Auditul nu are voie să blocheze gate-ul.
  }
}

/**
 * Escape hatch. `workflow-override` e persistent; `workflow-pause` e one-shot și se
 * consumă la prima folosire. Ambele lasă urmă în override-log.txt.
 */
export function isPaused(cwd = process.cwd(), context = '') {
  try {
    const dir = stateDir(cwd);
    const calePause = join(dir, 'workflow-pause');
    const caleOverride = join(dir, 'workflow-override');

    if (existsSync(caleOverride)) {
      scrieAudit(dir, `override persistent activ — ${context}`);
      return true;
    }

    if (existsSync(calePause)) {
      scrieAudit(dir, `pause one-shot consumat — ${context}`);
      try {
        rmSync(calePause, { force: true });
      } catch {
        // Dacă ștergerea eșuează, pause-ul rămâne — deranjant, dar nu blocant.
      }
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * O chitanță e validă dacă e pe amprenta curentă și, la nevoie, dacă screenshot-urile
 * ei încă au hash-ul înregistrat. Întoarce `{ ok, motiv }`.
 */
export function validateReceipt(faza, cwd = process.cwd(), optiuni = {}) {
  const { cereScreenshot = false } = optiuni;
  const chitanta = readReceipt(faza, cwd);

  if (chitanta === null) {
    return { ok: false, motiv: `lipsește chitanța de ${faza}` };
  }

  const amprentaCurenta = diffFingerprint(cwd);
  if (chitanta.diffFingerprint !== amprentaCurenta) {
    return {
      ok: false,
      motiv: `chitanța de ${faza} e învechită (codul s-a schimbat după înregistrare)`,
    };
  }

  if (cereScreenshot) {
    const capturi = Array.isArray(chitanta.screenshots) ? chitanta.screenshots : [];
    if (capturi.length === 0) {
      return {
        ok: false,
        motiv: `chitanța de ${faza} nu are screenshot, dar diff-ul atinge app/, components/ sau theme/`,
      };
    }
    for (const captura of capturi) {
      if (!captura || typeof captura.path !== 'string' || !existsSync(captura.path)) {
        return { ok: false, motiv: `screenshot-ul înregistrat lipsește de pe disc` };
      }
      if (sha256File(captura.path) !== captura.sha256) {
        return {
          ok: false,
          motiv: `screenshot-ul ${captura.path} s-a schimbat după înregistrare`,
        };
      }
    }
  }

  return { ok: true, motiv: '' };
}
