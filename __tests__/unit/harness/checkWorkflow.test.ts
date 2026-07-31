/**
 * `check:workflow` — gate-ul de pre-push. Pe range-ul care urmează să plece:
 * dacă s-a atins cod de feature, cere LEARNINGS.md în același range și chitanțe valide.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const RADACINA_REPO = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(RADACINA_REPO, 'scripts', 'check-workflow.mjs');
const RECORD = path.join(RADACINA_REPO, 'scripts', 'record-phase.mjs');

type Rezultat = { cod: number; stdout: string; stderr: string };

function ruleaza(cwd: string): Rezultat {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT], {
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

function git(argumente: string[], cwd: string): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...argumente], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function inregistreaza(cwd: string, argumente: string[]): void {
  execFileSync(process.execPath, [RECORD, ...argumente], { cwd, stdio: 'ignore' });
}

let repo: string;

beforeEach(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'check-workflow-')));
  git(['init', '-q', '-b', 'main'], repo);
  git(['config', 'user.email', 'test@exemplu.ro'], repo);
  git(['config', 'user.name', 'Test'], repo);
  fs.mkdirSync(path.join(repo, 'services'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'services', 'a.ts'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(repo, 'LEARNINGS.md'), '# Learnings\n');
  fs.writeFileSync(path.join(repo, 'docs', 'nota.md'), '# nota\n');
  fs.writeFileSync(path.join(repo, '.gitignore'), '.claude/\n');
  git(['add', '.'], repo);
  git(['commit', '-q', '-m', 'initial'], repo);
  // Baza de comparație: origin/main fără remote real.
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD'], repo);
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

function commit(mesaj: string): void {
  git(['add', '-A'], repo);
  git(['commit', '-q', '-m', mesaj], repo);
}

function inregistreazaDovezile(): void {
  inregistreaza(repo, ['verify', 'npm run check verde']);
  inregistreaza(repo, ['review', 'cold-read ok']);
}

describe('check-workflow.mjs', () => {
  it('trece când range-ul nu atinge cod de feature', () => {
    fs.writeFileSync(path.join(repo, 'docs', 'nota.md'), '# altceva\n');
    commit('docs: nota');

    expect(ruleaza(repo).cod).toBe(0);
  });

  it('trece când nu e nimic de trimis', () => {
    expect(ruleaza(repo).cod).toBe(0);
  });

  it('respinge cod de feature fără LEARNINGS.md în range', () => {
    fs.writeFileSync(path.join(repo, 'services', 'a.ts'), 'export const a = 2;\n');
    commit('feat: schimbare');
    inregistreazaDovezile();

    const r = ruleaza(repo);

    expect(r.cod).not.toBe(0);
    expect(r.stderr).toMatch(/LEARNINGS\.md/);
  });

  it('respinge cod de feature fără chitanțe', () => {
    fs.writeFileSync(path.join(repo, 'services', 'a.ts'), 'export const a = 2;\n');
    fs.appendFileSync(path.join(repo, 'LEARNINGS.md'), '\n- lecție\n');
    commit('feat: schimbare cu lecție');

    const r = ruleaza(repo);

    expect(r.cod).not.toBe(0);
    expect(r.stderr).toMatch(/verify/);
    expect(r.stderr).toMatch(/review/);
  });

  it('trece când range-ul are cod de feature, LEARNINGS și chitanțe valide', () => {
    fs.writeFileSync(path.join(repo, 'services', 'a.ts'), 'export const a = 2;\n');
    fs.appendFileSync(path.join(repo, 'LEARNINGS.md'), '\n- lecție\n');
    commit('feat: schimbare cu lecție');
    inregistreazaDovezile();

    const r = ruleaza(repo);

    expect(r.stderr).toBe('');
    expect(r.cod).toBe(0);
  });

  it('respinge chitanțe rămase de la un commit anterior', () => {
    fs.writeFileSync(path.join(repo, 'services', 'a.ts'), 'export const a = 2;\n');
    fs.appendFileSync(path.join(repo, 'LEARNINGS.md'), '\n- lecție\n');
    commit('feat: prima');
    inregistreazaDovezile();
    expect(ruleaza(repo).cod).toBe(0);

    // Un commit nou lasă tree-ul tot curat — amprenta singură nu l-ar deosebi.
    fs.writeFileSync(path.join(repo, 'services', 'a.ts'), 'export const a = 3;\n');
    commit('feat: a doua, nedovedită');

    const r = ruleaza(repo);

    expect(r.cod).not.toBe(0);
    expect(r.stderr).toMatch(/învechit|alt commit/i);
  });

  it('cere screenshot când range-ul atinge UI', () => {
    fs.mkdirSync(path.join(repo, 'components'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'components', 'Card.tsx'), 'export const C = () => null;\n');
    fs.appendFileSync(path.join(repo, 'LEARNINGS.md'), '\n- lecție\n');
    commit('feat: componentă');
    inregistreazaDovezile();

    const r = ruleaza(repo);

    expect(r.cod).not.toBe(0);
    expect(r.stderr).toMatch(/screenshot/i);
  });

  it('workflow-override lasă push-ul să treacă', () => {
    fs.writeFileSync(path.join(repo, 'services', 'a.ts'), 'export const a = 2;\n');
    commit('feat: fără nimic');
    const stare = path.join(repo, '.claude', 'state');
    fs.mkdirSync(stare, { recursive: true });
    fs.writeFileSync(path.join(stare, 'workflow-override'), '');

    expect(ruleaza(repo).cod).toBe(0);
  });
});
