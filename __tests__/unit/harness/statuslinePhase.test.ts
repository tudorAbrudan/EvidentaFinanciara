/**
 * statusline — arată faza curentă a buclei, dedusă din chitanțele valide pe amprenta curentă.
 * Nu are voie să eșueze zgomotos: e o linie de UI, nu un gate.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const RADACINA_REPO = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(RADACINA_REPO, 'scripts', 'statusline-phase.mjs');
const RECORD = path.join(RADACINA_REPO, 'scripts', 'record-phase.mjs');

type Rezultat = { cod: number; stdout: string };

function ruleaza(intrare: string, cwd: string): Rezultat {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT], {
      cwd,
      input: intrare,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { cod: 0, stdout };
  } catch (eroare) {
    const e = eroare as { status?: number; stdout?: string };
    return { cod: e.status ?? 1, stdout: e.stdout ?? '' };
  }
}

function linie(cwd: string): string {
  return ruleaza(JSON.stringify({ cwd, workspace: { current_dir: cwd } }), cwd).stdout.trim();
}

function git(argumente: string[], cwd: string): void {
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...argumente], { cwd, stdio: 'ignore' });
}

function inregistreaza(cwd: string, argumente: string[]): void {
  execFileSync(process.execPath, [RECORD, ...argumente], { cwd, stdio: 'ignore' });
}

let repo: string;

beforeEach(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-')));
  git(['init', '-q', '-b', 'main'], repo);
  git(['config', 'user.email', 'test@exemplu.ro'], repo);
  git(['config', 'user.name', 'Test'], repo);
  fs.mkdirSync(path.join(repo, 'services'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'services', 'a.ts'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(repo, '.gitignore'), '.claude/\n');
  git(['add', '.'], repo);
  git(['commit', '-q', '-m', 'initial'], repo);
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

function modifica(): void {
  fs.writeFileSync(path.join(repo, 'services', 'a.ts'), `export const a = ${Date.now()};\n`);
}

describe('statusline-phase.mjs', () => {
  it('arată branch-ul', () => {
    expect(linie(repo)).toMatch(/main/);
  });

  it('pe tree curat nu pretinde nicio fază', () => {
    expect(linie(repo)).toMatch(/–|-/);
  });

  it('arată IMPLEMENT când există diff de feature fără chitanțe', () => {
    modifica();

    expect(linie(repo)).toMatch(/IMPLEMENT/);
  });

  it('arată VERIFY după înregistrarea chitanței de verify', () => {
    modifica();
    inregistreaza(repo, ['verify', 'teste verzi']);

    expect(linie(repo)).toMatch(/VERIFY/);
  });

  it('arată REVIEW ca fiind cea mai recentă fază validă', () => {
    modifica();
    inregistreaza(repo, ['verify', 'teste verzi']);
    inregistreaza(repo, ['review', 'cold-read ok']);

    expect(linie(repo)).toMatch(/REVIEW/);
  });

  it('revine la IMPLEMENT când chitanțele devin învechite', () => {
    modifica();
    inregistreaza(repo, ['verify', 'teste verzi']);
    inregistreaza(repo, ['review', 'cold-read ok']);
    expect(linie(repo)).toMatch(/REVIEW/);

    modifica();

    expect(linie(repo)).toMatch(/IMPLEMENT/);
  });

  it('iese cu 0 și fără zgomot în afara unui repo git', () => {
    const gol = fs.mkdtempSync(path.join(os.tmpdir(), 'fara-git-'));
    try {
      const r = ruleaza(JSON.stringify({ cwd: gol }), gol);

      expect(r.cod).toBe(0);
    } finally {
      fs.rmSync(gol, { recursive: true, force: true });
    }
  });

  it('iese cu 0 pe stdin corupt', () => {
    expect(ruleaza('nu e json {{', repo).cod).toBe(0);
  });
});
