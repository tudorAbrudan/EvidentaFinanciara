/**
 * `record-phase.mjs` — scrie chitanțele de fază legate de fingerprint-ul diff-ului.
 * Testat ca proces separat, într-un repo git temporar.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const RADACINA_REPO = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(RADACINA_REPO, 'scripts', 'record-phase.mjs');

type Rezultat = { cod: number; stdout: string; stderr: string };

type Chitanta = {
  phase: string;
  detail: string;
  head: string;
  diffFingerprint: string;
  screenshots: { path: string; sha256: string }[];
  recordedAt: string;
};

function ruleaza(argumente: string[], cwd: string): Rezultat {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...argumente], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { cod: 0, stdout, stderr: '' };
  } catch (eroare) {
    const e = eroare as { status?: number; stdout?: string; stderr?: string };
    return { cod: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

function git(argumente: string[], cwd: string): void {
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...argumente], {
    cwd,
    stdio: 'ignore',
  });
}

let repo: string;

beforeEach(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'record-phase-')));
  git(['init', '-q', '-b', 'main'], repo);
  git(['config', 'user.email', 'test@exemplu.ro'], repo);
  git(['config', 'user.name', 'Test'], repo);
  fs.mkdirSync(path.join(repo, 'services'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'services', 'a.ts'), 'export const a = 1;\n');
  git(['add', '.'], repo);
  git(['commit', '-q', '-m', 'initial'], repo);
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

function citesteChitanta(faza: string): Chitanta {
  const cale = path.join(repo, '.claude', 'state', `phase-${faza}.json`);
  return JSON.parse(fs.readFileSync(cale, 'utf8')) as Chitanta;
}

function headCurent(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
}

describe('record-phase.mjs', () => {
  it('scrie chitanța de plan legată de HEAD-ul curent', () => {
    const r = ruleaza(['plan', 'plan de test'], repo);

    expect(r.cod).toBe(0);
    const chitanta = citesteChitanta('plan');
    expect(chitanta.phase).toBe('plan');
    expect(chitanta.detail).toBe('plan de test');
    expect(chitanta.head).toBe(headCurent());
    expect(chitanta.diffFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(chitanta.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.stdout).toContain('plan');
  });

  it('schimbă fingerprint-ul după o editare de cod', () => {
    ruleaza(['verify', 'înainte'], repo);
    const inainte = citesteChitanta('verify').diffFingerprint;

    fs.writeFileSync(path.join(repo, 'services', 'a.ts'), 'export const a = 2;\n');
    ruleaza(['verify', 'după'], repo);
    const dupa = citesteChitanta('verify').diffFingerprint;

    expect(dupa).not.toBe(inainte);
  });

  it('salvează hash-ul screenshot-ului furnizat', () => {
    const caleShot = path.join(repo, 'shot.png');
    fs.writeFileSync(caleShot, 'continut-imagine');
    const asteptat = createHash('sha256').update('continut-imagine').digest('hex');

    const r = ruleaza(['verify', 'ecran verificat', '--screenshot', caleShot], repo);

    expect(r.cod).toBe(0);
    const chitanta = citesteChitanta('verify');
    expect(chitanta.screenshots).toHaveLength(1);
    expect(chitanta.screenshots[0].sha256).toBe(asteptat);
  });

  it('respinge un screenshot inexistent, cu mesaj clar', () => {
    const r = ruleaza(['verify', 'x', '--screenshot', path.join(repo, 'lipsa.png')], repo);

    expect(r.cod).not.toBe(0);
    expect(r.stderr).toMatch(/lipsa\.png/);
    expect(r.stderr).toMatch(/nu există/i);
    expect(fs.existsSync(path.join(repo, '.claude', 'state', 'phase-verify.json'))).toBe(false);
  });

  it('respinge o fază necunoscută', () => {
    const r = ruleaza(['deploy', 'x'], repo);

    expect(r.cod).not.toBe(0);
    expect(r.stderr).toMatch(/plan\|verify\|review|plan, verify, review/);
  });

  it('respinge lipsa detaliului', () => {
    const r = ruleaza(['review'], repo);

    expect(r.cod).not.toBe(0);
    expect(r.stderr).toMatch(/detali/i);
  });

  it('suprascrie chitanța anterioară a aceleiași faze', () => {
    ruleaza(['review', 'prima'], repo);
    ruleaza(['review', 'a doua'], repo);

    expect(citesteChitanta('review').detail).toBe('a doua');
  });
});
