/**
 * plan-gate (PreToolUse pe Edit/Write) — blochează editarea de cod de feature fără plan.
 * Contract: exit 0 = permite, exit 2 = blochează cu motivul pe stderr, orice eroare = exit 0.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const RADACINA_REPO = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(RADACINA_REPO, 'scripts', 'check-plan-pretool.mjs');
const RECORD = path.join(RADACINA_REPO, 'scripts', 'record-phase.mjs');

type Rezultat = { cod: number; stdout: string; stderr: string };

function ruleazaCuStdin(intrare: string, cwd: string): Rezultat {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT], {
      cwd,
      input: intrare,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { cod: 0, stdout, stderr: '' };
  } catch (eroare) {
    const e = eroare as { status?: number; stdout?: string; stderr?: string };
    return { cod: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

function pentruFisier(caleFisier: string, cwd: string): Rezultat {
  return ruleazaCuStdin(
    JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: caleFisier },
      cwd,
    }),
    cwd
  );
}

function git(argumente: string[], cwd: string): void {
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...argumente], { cwd, stdio: 'ignore' });
}

function inregistreazaPlan(cwd: string): void {
  execFileSync(process.execPath, [RECORD, 'plan', 'plan de test'], { cwd, stdio: 'ignore' });
}

let repo: string;

beforeEach(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plan-gate-')));
  git(['init', '-q', '-b', 'main'], repo);
  git(['config', 'user.email', 'test@exemplu.ro'], repo);
  git(['config', 'user.name', 'Test'], repo);
  fs.mkdirSync(path.join(repo, 'services'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(repo, '__tests__', 'unit'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'services', 'a.ts'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(repo, 'docs', 'nota.md'), '# nota\n');
  git(['add', '.'], repo);
  git(['commit', '-q', '-m', 'initial'], repo);
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('check-plan-pretool.mjs', () => {
  it('lasă să treacă un fișier care nu e cod de feature', () => {
    const r = pentruFisier(path.join(repo, 'docs', 'nota.md'), repo);

    expect(r.cod).toBe(0);
  });

  it('lasă să treacă un test, chiar dacă numele sugerează un serviciu', () => {
    const r = pentruFisier(path.join(repo, '__tests__', 'unit', 'services.test.ts'), repo);

    expect(r.cod).toBe(0);
  });

  it('blochează editarea de cod de feature fără plan înregistrat', () => {
    const r = pentruFisier(path.join(repo, 'services', 'a.ts'), repo);

    expect(r.cod).toBe(2);
    expect(r.stderr).toMatch(/Plan-gate/);
    expect(r.stderr).toMatch(/record-phase\.mjs plan/);
    expect(r.stderr).toMatch(/workflow-pause/);
  });

  it('lasă să treacă editarea când există plan pe HEAD-ul curent', () => {
    inregistreazaPlan(repo);

    const r = pentruFisier(path.join(repo, 'services', 'a.ts'), repo);

    expect(r.cod).toBe(0);
  });

  it('blochează dacă planul e înregistrat pe alt HEAD', () => {
    inregistreazaPlan(repo);
    fs.writeFileSync(path.join(repo, 'docs', 'alt.md'), '# alt\n');
    git(['add', '.'], repo);
    git(['commit', '-q', '-m', 'commit nou'], repo);

    const r = pentruFisier(path.join(repo, 'services', 'a.ts'), repo);

    expect(r.cod).toBe(2);
    expect(r.stderr).toMatch(/Plan-gate/);
  });

  it('acceptă și căi relative, nu doar absolute', () => {
    const r = pentruFisier('services/a.ts', repo);

    expect(r.cod).toBe(2);
  });

  it('fail-open pe stdin corupt', () => {
    const r = ruleazaCuStdin('{{{ nu e json', repo);

    expect(r.cod).toBe(0);
  });

  it('fail-open pe stdin gol', () => {
    const r = ruleazaCuStdin('', repo);

    expect(r.cod).toBe(0);
  });

  it('fail-open când tool_input nu are file_path', () => {
    const r = ruleazaCuStdin(JSON.stringify({ tool_name: 'Edit', tool_input: {} }), repo);

    expect(r.cod).toBe(0);
  });

  it('workflow-pause lasă un edit să treacă, se consumă și lasă urmă în audit', () => {
    const stare = path.join(repo, '.claude', 'state');
    fs.mkdirSync(stare, { recursive: true });
    fs.writeFileSync(path.join(stare, 'workflow-pause'), '');

    const primul = pentruFisier(path.join(repo, 'services', 'a.ts'), repo);
    expect(primul.cod).toBe(0);
    expect(fs.existsSync(path.join(stare, 'workflow-pause'))).toBe(false);
    expect(fs.readFileSync(path.join(stare, 'override-log.txt'), 'utf8')).toMatch(/pause/);

    const alDoilea = pentruFisier(path.join(repo, 'services', 'a.ts'), repo);
    expect(alDoilea.cod).toBe(2);
  });

  it('workflow-override e persistent între apeluri', () => {
    const stare = path.join(repo, '.claude', 'state');
    fs.mkdirSync(stare, { recursive: true });
    fs.writeFileSync(path.join(stare, 'workflow-override'), '');

    expect(pentruFisier(path.join(repo, 'services', 'a.ts'), repo).cod).toBe(0);
    expect(pentruFisier(path.join(repo, 'services', 'a.ts'), repo).cod).toBe(0);
    expect(fs.existsSync(path.join(stare, 'workflow-override'))).toBe(true);
  });
});
