/**
 * Stop-gate — la sfârșit de tură, un diff de feature cere chitanțe verify + review valide.
 * Contract: exit 0 = tura se închide, exit 2 = tura continuă cu motivul pe stderr.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const RADACINA_REPO = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(RADACINA_REPO, 'scripts', 'check-workflow-stop.mjs');
const RECORD = path.join(RADACINA_REPO, 'scripts', 'record-phase.mjs');

type Rezultat = { cod: number; stdout: string; stderr: string };

function ruleaza(payload: Record<string, unknown>, cwd: string): Rezultat {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT], {
      cwd,
      input: JSON.stringify(payload),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { cod: 0, stdout, stderr: '' };
  } catch (eroare) {
    const e = eroare as { status?: number; stdout?: string; stderr?: string };
    return { cod: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

function stop(cwd: string): Rezultat {
  return ruleaza({ hook_event_name: 'Stop', stop_hook_active: false, cwd }, cwd);
}

function git(argumente: string[], cwd: string): void {
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...argumente], { cwd, stdio: 'ignore' });
}

function inregistreaza(cwd: string, argumente: string[]): void {
  execFileSync(process.execPath, [RECORD, ...argumente], { cwd, stdio: 'ignore' });
}

let repo: string;

beforeEach(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'stop-gate-')));
  git(['init', '-q', '-b', 'main'], repo);
  git(['config', 'user.email', 'test@exemplu.ro'], repo);
  git(['config', 'user.name', 'Test'], repo);
  fs.mkdirSync(path.join(repo, 'services'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'components'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'services', 'a.ts'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(repo, 'components', 'Card.tsx'), 'export const Card = () => null;\n');
  fs.writeFileSync(path.join(repo, 'docs', 'nota.md'), '# nota\n');
  git(['add', '.'], repo);
  git(['commit', '-q', '-m', 'initial'], repo);
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

function modificaServiciu(): void {
  fs.writeFileSync(path.join(repo, 'services', 'a.ts'), 'export const a = 99;\n');
}

function modificaComponenta(): void {
  fs.writeFileSync(path.join(repo, 'components', 'Card.tsx'), 'export const Card = () => 1;\n');
}

function screenshotValid(): string {
  const cale = path.join(repo, 'shot.png');
  fs.writeFileSync(cale, 'pixeli');
  return cale;
}

describe('check-workflow-stop.mjs', () => {
  it('respectă stop_hook_active (anti-buclă)', () => {
    modificaServiciu();

    const r = ruleaza({ hook_event_name: 'Stop', stop_hook_active: true, cwd: repo }, repo);

    expect(r.cod).toBe(0);
  });

  it('nu cere nimic pe tree curat', () => {
    expect(stop(repo).cod).toBe(0);
  });

  it('nu cere nimic pentru un diff fără cod de feature', () => {
    fs.writeFileSync(path.join(repo, 'docs', 'nota.md'), '# altceva\n');

    expect(stop(repo).cod).toBe(0);
  });

  it('blochează un diff de feature fără chitanțe', () => {
    modificaServiciu();

    const r = stop(repo);

    expect(r.cod).toBe(2);
    expect(r.stderr).toMatch(/verify/);
    expect(r.stderr).toMatch(/review/);
    expect(r.stderr).toMatch(/record-phase\.mjs/);
  });

  it('lasă tura să se închidă cu verify + review valide pe diff doar de servicii', () => {
    modificaServiciu();
    inregistreaza(repo, ['verify', 'npm test verde']);
    inregistreaza(repo, ['review', 'cold-read ok']);

    expect(stop(repo).cod).toBe(0);
  });

  it('blochează dacă lipsește doar review-ul', () => {
    modificaServiciu();
    inregistreaza(repo, ['verify', 'npm test verde']);

    const r = stop(repo);

    expect(r.cod).toBe(2);
    expect(r.stderr).toMatch(/review/);
  });

  it('cere screenshot când diff-ul atinge components/', () => {
    modificaComponenta();
    inregistreaza(repo, ['verify', 'fără dovadă vizuală']);
    inregistreaza(repo, ['review', 'cold-read ok']);

    const r = stop(repo);

    expect(r.cod).toBe(2);
    expect(r.stderr).toMatch(/screenshot/i);
  });

  it('acceptă diff-ul de UI când verify are screenshot', () => {
    modificaComponenta();
    const shot = screenshotValid();
    inregistreaza(repo, ['verify', 'ecran verificat', '--screenshot', shot]);
    inregistreaza(repo, ['review', 'cold-read ok']);

    expect(stop(repo).cod).toBe(0);
  });

  it('invalidează chitanțele după o editare ulterioară', () => {
    modificaServiciu();
    inregistreaza(repo, ['verify', 'npm test verde']);
    inregistreaza(repo, ['review', 'cold-read ok']);
    expect(stop(repo).cod).toBe(0);

    fs.writeFileSync(path.join(repo, 'services', 'a.ts'), 'export const a = 123;\n');

    const r = stop(repo);

    expect(r.cod).toBe(2);
    expect(r.stderr).toMatch(/învechit/i);
  });

  it('respinge un screenshot înlocuit după înregistrare', () => {
    modificaComponenta();
    const shot = screenshotValid();
    inregistreaza(repo, ['verify', 'ecran verificat', '--screenshot', shot]);
    inregistreaza(repo, ['review', 'cold-read ok']);

    fs.writeFileSync(shot, 'alți pixeli');

    const r = stop(repo);

    expect(r.cod).toBe(2);
    expect(r.stderr).toMatch(/screenshot/i);
  });

  it('workflow-pause deblochează o singură tură', () => {
    modificaServiciu();
    const stare = path.join(repo, '.claude', 'state');
    fs.mkdirSync(stare, { recursive: true });
    fs.writeFileSync(path.join(stare, 'workflow-pause'), '');

    expect(stop(repo).cod).toBe(0);
    expect(stop(repo).cod).toBe(2);
  });

  it('fail-open pe stdin corupt', () => {
    try {
      const stdout = execFileSync(process.execPath, [SCRIPT], {
        cwd: repo,
        input: 'nu e json {{',
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      expect(stdout).toBeDefined();
    } catch (eroare) {
      const e = eroare as { status?: number };
      expect(e.status).toBe(0);
    }
  });

  it('fail-open în afara unui repo git', () => {
    const gol = fs.mkdtempSync(path.join(os.tmpdir(), 'fara-git-'));
    try {
      expect(stop(gol).cod).toBe(0);
    } finally {
      fs.rmSync(gol, { recursive: true, force: true });
    }
  });
});
