#!/usr/bin/env node
/**
 * Gate: nicio variabilă `EXPO_PUBLIC_*` cu nume de secret.
 *
 * Prefixul `EXPO_PUBLIC_` inlinează valoarea în bundle-ul JS, deci e vizibilă
 * oricui despachetează .ipa/.apk. Așa a scăpat cheia Mistral. Verifică fișierele
 * `.env*` încărcate de Expo, config-ul Expo și tot codul care ajunge în bundle.
 *
 * Portat din Dosar (`scripts/expo-public-secrets-audit.js`), cu scanarea codului
 * adăugată: acolo e riscul real, pentru că doar variabilele citite din cod ajung
 * în bundle.
 *
 * Rulare: node scripts/check-expo-public-secrets.mjs [--root <dir>]
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const TRIGGERS = ['KEY', 'TOKEN', 'SECRET', 'PASSWORD', 'APIKEY', 'PRIVKEY', 'PRIVATE'];
const CONFIG_FILES = ['app.config.ts', 'app.config.js', 'app.json', 'eas.json'];
const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

/**
 * Foldere fără legătură cu bundle-ul. `__tests__` și `scripts` sunt excluse
 * intenționat: acolo numele de variabile apar ca date de test sau în allowlist-ul
 * de mai jos, iar gate-ul s-ar declanșa pe propriile fixture-uri.
 */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.expo',
  '.claude',
  '.worktrees',
  'ios',
  'android',
  'dist',
  'build',
  'coverage',
  'ai-proxy',
  '__tests__',
  'scripts',
]);

/**
 * Allowlist explicit. Orice nume de aici AJUNGE în bundle-ul public. Se adaugă
 * doar cu motivul scris lângă.
 */
const ALLOWED_NAMES = new Map([
  [
    'EXPO_PUBLIC_FINANTE_AI_TOKEN',
    'token de acces la proxy-ul propriu (ai-proxy/), nu cheie de provider: un singur model, doar text, cotă zilnică, rotit din env',
  ],
]);

/** Expo încarcă `.env`, `.env.local`, `.env.<mode>` și `.env.<mode>.local`. */
function envFiles(root) {
  return readdirSync(root).filter(
    name => /^\.env($|\.)/.test(name) && !name.endsWith('.example')
  );
}

function detectTrigger(name) {
  const upper = name.toUpperCase();
  return TRIGGERS.find(t => upper.includes(t)) ?? null;
}

function violationFor(name, file, line) {
  if (ALLOWED_NAMES.has(name)) return null;
  const trigger = detectTrigger(name);
  return trigger ? { file, line, name, trigger } : null;
}

/**
 * Numele variabilei poate fi scris cu litere mici: Expo se uită doar la prefix,
 * deci `EXPO_PUBLIC_openai_key` ajunge la fel de public ca varianta majusculă.
 */
const NAME_RE = /EXPO_PUBLIC_[A-Za-z0-9_]+/g;

function auditEnvFile(source, file) {
  const out = [];
  source.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    const match = line.match(/^(?:export\s+)?(EXPO_PUBLIC_[A-Za-z0-9_]+)\s*=/);
    if (!match) return;
    const v = violationFor(match[1], file, i + 1);
    if (v) out.push(v);
  });
  return out;
}

function auditSource(source, file) {
  const out = [];
  const seen = new Set();
  let m;
  NAME_RE.lastIndex = 0;
  while ((m = NAME_RE.exec(source)) !== null) {
    if (seen.has(m[0])) continue;
    seen.add(m[0]);
    const v = violationFor(m[0], file, source.slice(0, m.index).split('\n').length);
    if (v) out.push(v);
  }
  return out;
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) walk(abs, files);
    else if (SOURCE_EXTENSIONS.test(entry)) files.push(abs);
  }
  return files;
}

function audit(root) {
  const violations = [];

  for (const name of envFiles(root)) {
    violations.push(...auditEnvFile(readFileSync(join(root, name), 'utf8'), name));
  }

  for (const name of CONFIG_FILES) {
    const abs = join(root, name);
    if (existsSync(abs)) violations.push(...auditSource(readFileSync(abs, 'utf8'), name));
  }

  for (const file of walk(root)) {
    violations.push(...auditSource(readFileSync(file, 'utf8'), relative(root, file)));
  }

  return violations;
}

function parseRoot(argv) {
  const i = argv.indexOf('--root');
  return i !== -1 && argv[i + 1] ? argv[i + 1] : process.cwd();
}

const violations = audit(parseRoot(process.argv.slice(2)));

if (violations.length === 0) {
  console.log('✓ Niciun EXPO_PUBLIC_* cu nume de secret.');
  process.exit(0);
}

console.error(
  `✗ ${violations.length} EXPO_PUBLIC_* cu nume de secret (ar ajunge în bundle-ul public):\n`
);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line} — ${v.name} (trigger: ${v.trigger})`);
}
console.error(
  '\nFix: cheile de provider stau pe server (ai-proxy/), nu în aplicație. ' +
    'O variabilă comentată în .env nu mai e citită.'
);
process.exit(1);
