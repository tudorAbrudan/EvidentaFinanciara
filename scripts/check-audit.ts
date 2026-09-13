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

  // ── Toolchain de build, adăugate 2026-09-12 ───────────────────────────────
  //
  // Cele de mai jos au fost verificate cu aceeași întrebare ca intrarea de sus:
  // ajung în artefactul livrat? Răspuns, măsurat pe `main.jsbundle` din build-ul
  // Release instalat (2026-09-12): `xmldom`, `browserslist`, `fast-uri`,
  // `js-yaml`, `smol-toml` → zero apariții. `image-size` apare de 3 ori, dar
  // doar ca fragment din nume de iconițe Material („image-size-select-small"),
  // iar `nanoid` o dată, ca identificator intern — nu ca module încărcate.
  //
  // `npm audit fix` nu le rezolvă: ar schimba 65 de pachete, ar adăuga 8 și ar
  // scoate 12, lăsând exact aceleași 33 de vulnerabilități. Fix-urile reale cer
  // bump de Expo SDK / React Native, nu o decizie locală.
  //
  // Reevaluare obligatorie la următorul bump de Expo SDK: șterge intrările al
  // căror pachet a primit versiune curată și lasă gate-ul să-ți spună ce rămâne.

  // @xmldom/xmldom — prin `@expo/plist` și `expo-sharing → @expo/config-plugins
  // → xcode → simple-plist → plist`. Rulează la `expo prebuild`, pe mașina de
  // build, ca să scrie fișiere de configurare iOS. Documentele procesate sunt
  // ale noastre, nu input de la utilizatori.
  'GHSA-27p8-2357-5qqv': '@xmldom/xmldom — prebuild Expo, nu ajunge în bundle (2026-09-12)',
  'GHSA-3px3-54cx-rmw9': '@xmldom/xmldom — prebuild Expo, nu ajunge în bundle (2026-09-12)',
  'GHSA-4w3w-2rp5-g8jm': '@xmldom/xmldom — prebuild Expo, nu ajunge în bundle (2026-09-12)',
  'GHSA-6mj3-qw4j-hgrw': '@xmldom/xmldom — prebuild Expo, nu ajunge în bundle (2026-09-12)',
  'GHSA-8344-3jmq-59r6': '@xmldom/xmldom — prebuild Expo, nu ajunge în bundle (2026-09-12)',
  'GHSA-93r5-fhx6-vmg9': '@xmldom/xmldom — prebuild Expo, nu ajunge în bundle (2026-09-12)',
  'GHSA-965w-775f-mr7g': '@xmldom/xmldom — prebuild Expo, nu ajunge în bundle (2026-09-12)',
  'GHSA-c7q8-3ch8-vqpv': '@xmldom/xmldom — prebuild Expo, nu ajunge în bundle (2026-09-12)',
  'GHSA-g53g-w8rj-fmg7': '@xmldom/xmldom — prebuild Expo, nu ajunge în bundle (2026-09-12)',
  'GHSA-vr34-hp96-76pp': '@xmldom/xmldom — prebuild Expo, nu ajunge în bundle (2026-09-12)',
  'GHSA-w2rr-34g9-rvrj': '@xmldom/xmldom — prebuild Expo, nu ajunge în bundle (2026-09-12)',
  'GHSA-x4fp-j954-r2f4': '@xmldom/xmldom — prebuild Expo, nu ajunge în bundle (2026-09-12)',

  // browserslist — toolchain Babel/Metro, citește liste de browsere la build.
  'GHSA-73wf-gq98-2v4g': 'browserslist — toolchain de build, nu ajunge în bundle (2026-09-12)',
  'GHSA-c83g-rgw3-j3cx': 'browserslist — toolchain de build, nu ajunge în bundle (2026-09-12)',

  // fast-uri — prin `dependency-cruiser → ajv`, adică gate-ul nostru de
  // arhitectură. Rulează doar în `npm run check`, pe scheme scrise de noi.
  'GHSA-5jgf-p345-68v8': 'fast-uri — doar dependency-cruiser (dev) (2026-09-12)',
  'GHSA-7p8r-x3mc-p8w7': 'fast-uri — doar dependency-cruiser (dev) (2026-09-12)',
  'GHSA-f65p-4m7j-42xc': 'fast-uri — doar dependency-cruiser (dev) (2026-09-12)',
  'GHSA-fph4-wmhf-6fwf': 'fast-uri — doar dependency-cruiser (dev) (2026-09-12)',
  'GHSA-jqff-g426-hqxp': 'fast-uri — doar dependency-cruiser (dev) (2026-09-12)',

  // image-size — prin Metro, care măsoară asset-urile noastre la împachetare.
  'GHSA-5p2g-fcmc-qvqq': 'image-size — Metro, la build, pe asset-uri proprii (2026-09-12)',
  'GHSA-w3rx-r6r6-pgpr': 'image-size — Metro, la build, pe asset-uri proprii (2026-09-12)',

  // js-yaml — prin `@istanbuljs` (coverage Jest) și toolchain; citește config-uri
  // din repo, nu fișiere venite din exterior.
  'GHSA-2883-xcg3-v3hh': 'js-yaml — coverage/tooling, pe fișiere din repo (2026-09-12)',
  'GHSA-5p4m-2wfm-xmqj': 'js-yaml — coverage/tooling, pe fișiere din repo (2026-09-12)',

  // nanoid — advisory-ul cere un generator custom cu `size = 0`; aplicația nu
  // apelează nanoid direct, iar în bundle nu apare ca modul.
  'GHSA-2v37-7h3g-55p8': 'nanoid — necesită generator custom cu size 0 (2026-09-12)',

  // smol-toml — parser TOML din toolchain-ul de build, pe fișiere din repo.
  'GHSA-7w5x-hrqm-74c2': 'smol-toml — tooling de build, fișiere din repo (2026-09-12)',
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
