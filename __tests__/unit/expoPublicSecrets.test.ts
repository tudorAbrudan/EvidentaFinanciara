/**
 * Gate-ul `check:secrets` rulat ca proces separat, pe un repo fictiv temporar.
 * Se asertează exit code-ul și numele variabilei raportate.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const SCRIPT = join(__dirname, '..', '..', 'scripts', 'check-expo-public-secrets.mjs');

function runGate(files: Record<string, string>): { code: number | null; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'check-secrets-'));
  try {
    for (const [path, content] of Object.entries(files)) {
      const abs = join(root, path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
    const result = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
    return { code: result.status, output: `${result.stdout}${result.stderr}` };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('check-expo-public-secrets', () => {
  it('repo fără secrete → trece', () => {
    const { code } = runGate({
      '.env': 'EXPO_PUBLIC_FINANTE_AI_URL=https://proxy.test/v1\n',
      'services/x.ts': 'const url = process.env.EXPO_PUBLIC_FINANTE_AI_URL;\n',
    });
    expect(code).toBe(0);
  });

  it('cheie de provider în .env → pică și numește variabila', () => {
    const { code, output } = runGate({ '.env': 'EXPO_PUBLIC_MISTRAL_API_KEY=abc\n' });
    expect(code).toBe(1);
    expect(output).toContain('.env:1');
    expect(output).toContain('EXPO_PUBLIC_MISTRAL_API_KEY');
  });

  it('nume scris cu litere mici → tot pică (Expo se uită doar la prefix)', () => {
    const { code, output } = runGate({ '.env': 'EXPO_PUBLIC_Mistral_Api_Key=abc\n' });
    expect(code).toBe(1);
    expect(output).toContain('EXPO_PUBLIC_Mistral_Api_Key');
  });

  it('prinde și .env.production.local, încărcat de Expo', () => {
    const { code, output } = runGate({ '.env.production.local': 'EXPO_PUBLIC_OPENAI_KEY=sk\n' });
    expect(code).toBe(1);
    expect(output).toContain('.env.production.local');
  });

  it('.env.example nu e încărcat de Expo → ignorat', () => {
    const { code } = runGate({ '.env.example': 'EXPO_PUBLIC_MISTRAL_API_KEY=\n' });
    expect(code).toBe(0);
  });

  it('linie comentată în .env → trece', () => {
    const { code } = runGate({ '.env': '# EXPO_PUBLIC_MISTRAL_API_KEY=abc\n' });
    expect(code).toBe(0);
  });

  it('token-ul de proxy din allowlist → trece', () => {
    const { code } = runGate({
      '.env': 'EXPO_PUBLIC_FINANTE_AI_TOKEN=tok\n',
      'services/aiProvider.ts': 'process.env.EXPO_PUBLIC_FINANTE_AI_TOKEN;\n',
    });
    expect(code).toBe(0);
  });

  it('secret citit din codul sursă, chiar fără .env → pică', () => {
    const { code, output } = runGate({
      'services/ai.ts': 'const a = 1;\nconst k = process.env.EXPO_PUBLIC_OPENAI_SECRET;\n',
    });
    expect(code).toBe(1);
    expect(output).toContain('services/ai.ts:2');
  });

  it('prinde și foldere din afara listei obișnuite', () => {
    const { code, output } = runGate({
      'utils/keys.ts': 'process.env.EXPO_PUBLIC_STRIPE_SECRET;\n',
    });
    expect(code).toBe(1);
    expect(output).toContain('utils/keys.ts');
  });

  it('secret în app.json → pică', () => {
    const { code, output } = runGate({
      'app.json': '{ "expo": { "extra": { "k": "EXPO_PUBLIC_STRIPE_PRIVATE" } } }',
    });
    expect(code).toBe(1);
    expect(output).toContain('EXPO_PUBLIC_STRIPE_PRIVATE');
  });

  it('node_modules, __tests__ și scripts sunt ignorate', () => {
    const { code } = runGate({
      'services/node_modules/lib/index.js': 'process.env.EXPO_PUBLIC_LIB_API_KEY;\n',
      '__tests__/unit/x.test.ts': "expect('EXPO_PUBLIC_MISTRAL_API_KEY').toBeDefined();\n",
      'scripts/audit.mjs': "const ALLOWED = ['EXPO_PUBLIC_OTHER_TOKEN'];\n",
    });
    expect(code).toBe(0);
  });
});
