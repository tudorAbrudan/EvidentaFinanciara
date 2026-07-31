/**
 * no-push (PreToolUse pe Bash) — `git push` nu se rulează din sesiunile de agent.
 * Push-ul îl face omul, din terminal, prin pre-push gate cu APPROVE.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const RADACINA_REPO = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(RADACINA_REPO, 'scripts', 'check-no-push-pretool.mjs');

type Rezultat = { cod: number; stderr: string };

function ruleazaCuStdin(intrare: string, cwd: string): Rezultat {
  try {
    execFileSync(process.execPath, [SCRIPT], {
      cwd,
      input: intrare,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { cod: 0, stderr: '' };
  } catch (eroare) {
    const e = eroare as { status?: number; stderr?: string };
    return { cod: e.status ?? 1, stderr: e.stderr ?? '' };
  }
}

function pentruComanda(comanda: string, cwd: string): Rezultat {
  return ruleazaCuStdin(
    JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: comanda },
      cwd,
    }),
    cwd
  );
}

let dir: string;

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'no-push-')));
  // Escape hatch-ul își caută starea la rădăcina repo-ului, deci avem nevoie de un repo.
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', 'init', '-q', '-b', 'main'], {
    cwd: dir,
    stdio: 'ignore',
  });
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('check-no-push-pretool.mjs', () => {
  it.each([
    'git push',
    'git push origin main',
    'git push --force-with-lease',
    'cd /tmp/x && git push origin main',
    'npm run check; git push',
    'git   push',
  ])('blochează „%s"', comanda => {
    const r = pentruComanda(comanda, dir);

    expect(r.cod).toBe(2);
    expect(r.stderr).toMatch(/[Pp]ush/);
  });

  it('explică cine face push-ul', () => {
    const r = pentruComanda('git push', dir);

    expect(r.stderr).toMatch(/omul|terminal/i);
  });

  it.each([
    'git pushX',
    'git status',
    'git commit -m "push la docs"',
    'git log --oneline',
    'git fetch origin',
    'npm run check',
  ])('lasă să treacă „%s"', comanda => {
    expect(pentruComanda(comanda, dir).cod).toBe(0);
  });

  it('nu se blochează pe un mesaj de commit care conține „git push"', () => {
    const comanda = 'git commit -m "docs: explică de ce git push e blocat din agent"';

    expect(pentruComanda(comanda, dir).cod).toBe(0);
  });

  it('nu se blochează pe un corp de heredoc care conține „git push"', () => {
    const comanda = [
      "git commit -q -m \"$(cat <<'EOF'",
      'feat(harness): no-push',
      '',
      'Blochează git push din sesiunile de agent.',
      'EOF',
      ')"',
    ].join('\n');

    expect(pentruComanda(comanda, dir).cod).toBe(0);
  });

  it('blochează push-ul real chiar dacă în aceeași comandă există un heredoc', () => {
    const comanda = ["git commit -m \"$(cat <<'EOF'", 'mesaj', 'EOF', ')" && git push'].join('\n');

    expect(pentruComanda(comanda, dir).cod).toBe(2);
  });

  it('fail-open pe stdin corupt', () => {
    expect(ruleazaCuStdin('}{ nu e json', dir).cod).toBe(0);
  });

  it('fail-open pe stdin gol', () => {
    expect(ruleazaCuStdin('', dir).cod).toBe(0);
  });

  it('fail-open când lipsește comanda', () => {
    expect(ruleazaCuStdin(JSON.stringify({ tool_name: 'Bash', tool_input: {} }), dir).cod).toBe(0);
  });

  it('workflow-override lasă push-ul să treacă (escape hatch uniform)', () => {
    const stare = path.join(dir, '.claude', 'state');
    fs.mkdirSync(stare, { recursive: true });
    fs.writeFileSync(path.join(stare, 'workflow-override'), '');

    expect(pentruComanda('git push', dir).cod).toBe(0);
  });
});
