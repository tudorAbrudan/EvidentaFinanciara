/**
 * Gate `check:pointers` — CLAUDE.md trebuie să rămână un pointer subțire spre AGENTS.md.
 * Scriptul e rulat ca proces separat, cu fixture-uri în directoare temporare.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const RADACINA_REPO = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(RADACINA_REPO, 'scripts', 'check-pointer-files.mjs');

type Rezultat = { cod: number; stdout: string; stderr: string };

function ruleaza(director: string): Rezultat {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, director], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { cod: 0, stdout, stderr: '' };
  } catch (eroare) {
    const e = eroare as { status?: number; stdout?: string; stderr?: string };
    return { cod: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

let temp: string;

beforeEach(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pointers-'));
});

afterEach(() => {
  fs.rmSync(temp, { recursive: true, force: true });
});

function scrie(nume: string, continut: string): void {
  fs.writeFileSync(path.join(temp, nume), continut, 'utf8');
}

const POINTER_VALID = `# Finanțe Personale

Sursa unică de adevăr pentru convenții și workflow este \`AGENTS.md\` — citește-l integral.

Skills și agenți rămân în \`.claude/\`.
`;

describe('check-pointer-files.mjs', () => {
  it('acceptă un pointer subțire care trimite la AGENTS.md', () => {
    scrie('AGENTS.md', '# Canonic\n\nTot conținutul.\n');
    scrie('CLAUDE.md', POINTER_VALID);

    const r = ruleaza(temp);

    expect(r.cod).toBe(0);
    expect(r.stdout).toContain('OK');
  });

  it('respinge un CLAUDE.md umflat peste limita de linii nevide', () => {
    scrie('AGENTS.md', '# Canonic\n');
    const umflat = ['# Titlu', '', ...Array.from({ length: 20 }, (_, i) => `Linie ${i} AGENTS.md`)];
    scrie('CLAUDE.md', umflat.join('\n'));

    const r = ruleaza(temp);

    expect(r.cod).not.toBe(0);
    expect(r.stderr).toMatch(/linii nevide/);
  });

  it('respinge un CLAUDE.md care își crește propriile secțiuni de reguli', () => {
    scrie('AGENTS.md', '# Canonic\n');
    scrie('CLAUDE.md', `# Titlu\n\nVezi AGENTS.md.\n\n## Convenții cod\n\n- regulă proprie\n`);

    const r = ruleaza(temp);

    expect(r.cod).not.toBe(0);
    expect(r.stderr).toMatch(/heading-uri/);
  });

  it('respinge un pointer care nu trimite la AGENTS.md', () => {
    scrie('AGENTS.md', '# Canonic\n');
    scrie('CLAUDE.md', '# Titlu\n\nNiciun indiciu despre sursa canonică.\n');

    const r = ruleaza(temp);

    expect(r.cod).not.toBe(0);
    expect(r.stderr).toMatch(/nu trimite/);
  });

  it('respinge lipsa AGENTS.md', () => {
    scrie('CLAUDE.md', POINTER_VALID);

    const r = ruleaza(temp);

    expect(r.cod).not.toBe(0);
    expect(r.stderr).toMatch(/AGENTS\.md lipsește/);
  });

  it('respinge lipsa CLAUDE.md', () => {
    scrie('AGENTS.md', '# Canonic\n');

    const r = ruleaza(temp);

    expect(r.cod).not.toBe(0);
    expect(r.stderr).toMatch(/CLAUDE\.md lipsește/);
  });

  it('trece pe repo-ul real (CLAUDE.md e pointer, AGENTS.md e canonic)', () => {
    const r = ruleaza(RADACINA_REPO);

    expect(r.stderr).toBe('');
    expect(r.cod).toBe(0);
  });
});
