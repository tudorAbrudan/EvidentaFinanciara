/**
 * Gate de securitate pe dependențe: `npm audit` cu allowlist explicit.
 *
 * `npm audit --audit-level=high` nu are mecanism de excepții, iar un advisory
 * fără fix compatibil (ex. în toolchain-ul Expo/React Native) ar bloca orice PR
 * la nesfârșit. Scriptul păstrează pragul strict (high + critical = fail), dar
 * permite excepții punctuale, documentate, cu dată — fiecare intrare trebuie
 * revizuită la bump-urile de SDK.
 */
import { spawnSync } from 'node:child_process';

/** Advisories acceptate temporar. Șterge intrarea când upstream publică fix. */
const ALLOWLIST: Record<string, string> = {
  // brace-expansion <=5.0.7, DoS prin expansiune nelimitată (high).
  // Fix-ul (5.0.8) există doar ca major nou: minimatch@3 — folosit de
  // eslint 8, jest 29, glob-urile din react-native/expo — cere API-ul 1.x/2.x,
  // fără backport publicat. Override global pe 5.x rupe eslint (verificat
  // 2026-07-30: „expand is not a function"). Doar tooling de build/dev,
  // nu ajunge în aplicația livrată. Reevaluare la următorul bump Expo SDK.
  'GHSA-mh99-v99m-4gvg': 'brace-expansion — fără fix compatibil (2026-07-30)',
};

const FAIL_SEVERITIES = new Set(['high', 'critical']);

interface AuditAdvisory {
  source: number;
  name: string;
  title: string;
  url: string;
  severity: string;
}

interface AuditVulnerability {
  severity: string;
  via: (AuditAdvisory | string)[];
}

interface AuditReport {
  vulnerabilities: Record<string, AuditVulnerability>;
}

function ghsaId(advisory: AuditAdvisory): string {
  const segment = advisory.url.split('/').at(-1);
  return segment && segment.startsWith('GHSA-') ? segment : `npm-${advisory.source}`;
}

const result = spawnSync('npm', ['audit', '--json'], {
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
});
if (result.error) {
  throw result.error;
}

const report = JSON.parse(result.stdout) as AuditReport;

// Advisories-rădăcină: intrările `via` de tip obiect. Pachetele marcate doar
// pentru că depind de unul vulnerabil au `via` string și moștenesc rădăcina.
const blocking = new Map<string, AuditAdvisory>();
const allowed = new Map<string, AuditAdvisory>();
for (const vuln of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vuln.via) {
    if (typeof via === 'string' || !FAIL_SEVERITIES.has(via.severity)) {
      continue;
    }
    const id = ghsaId(via);
    if (id in ALLOWLIST) {
      allowed.set(id, via);
    } else {
      blocking.set(id, via);
    }
  }
}

for (const [id, advisory] of allowed) {
  console.log(`⚠ permis prin allowlist: ${id} (${advisory.name}) — ${ALLOWLIST[id]}`);
}

if (blocking.size > 0) {
  console.error('\nAdvisories high/critical în afara allowlist-ului:');
  for (const [id, advisory] of blocking) {
    console.error(`  ✖ ${id} [${advisory.severity}] ${advisory.name}: ${advisory.title}`);
    console.error(`    ${advisory.url}`);
  }
  console.error(
    '\nRulează `npm audit` pentru detalii și `npm audit fix` pentru remedieri in-range.'
  );
  process.exit(1);
}

console.log('✓ npm audit: niciun advisory high/critical în afara allowlist-ului.');
