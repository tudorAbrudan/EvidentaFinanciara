#!/usr/bin/env node
/**
 * Înregistrează chitanța unei faze din buclă (PLAN / VERIFY / REVIEW).
 *
 * Utilizare:
 *   node scripts/record-phase.mjs plan   "<rezumatul planului aprobat>"
 *   node scripts/record-phase.mjs verify "<ce s-a verificat>" [--screenshot <cale>]...
 *   node scripts/record-phase.mjs review "<concluzia review-ului>"
 *
 * Chitanța se leagă de amprenta diff-ului curent: orice editare ulterioară o invalidează.
 * Spre deosebire de hook-uri, scriptul ăsta NU e fail-open — e chemat explicit de om sau
 * de agent, iar o eroare tăcută aici ar produce dovezi false.
 */
import { existsSync } from 'node:fs';

import {
  FAZE,
  diffFingerprint,
  headSha,
  sha256File,
  writeReceipt,
} from './workflow-lib.mjs';

function iesiCuEroare(mesaj) {
  process.stderr.write(`record-phase: ${mesaj}\n`);
  process.exit(1);
}

const argumente = process.argv.slice(2);
const faza = argumente[0];

if (!faza || !FAZE.includes(faza)) {
  iesiCuEroare(
    `fază necunoscută "${faza ?? ''}". Fazele acceptate: ${FAZE.join(', ')}.\n` +
      '  Exemplu: node scripts/record-phase.mjs verify "npm run check verde"'
  );
}

const capturi = [];
const bucatiDetaliu = [];

for (let i = 1; i < argumente.length; i += 1) {
  if (argumente[i] === '--screenshot') {
    const cale = argumente[i + 1];
    if (!cale) {
      iesiCuEroare('--screenshot cere o cale de fișier.');
    }
    capturi.push(cale);
    i += 1;
  } else {
    bucatiDetaliu.push(argumente[i]);
  }
}

const detaliu = bucatiDetaliu.join(' ').trim();

if (detaliu === '') {
  iesiCuEroare(
    'lipsește detaliul fazei. Scrie pe scurt ce s-a făcut — chitanța fără conținut nu e dovadă.'
  );
}

for (const cale of capturi) {
  if (!existsSync(cale)) {
    iesiCuEroare(`screenshot-ul "${cale}" nu există. Verifică traseul fișierului salvat.`);
  }
}

let amprenta;
let head;

try {
  amprenta = diffFingerprint();
  head = headSha();
} catch (eroare) {
  iesiCuEroare(
    `nu pot calcula starea git (${eroare instanceof Error ? eroare.message.trim() : eroare}).\n` +
      '  Chitanțele au sens doar într-un repo git cu cel puțin un commit.'
  );
}

const chitanta = {
  phase: faza,
  detail: detaliu,
  head,
  diffFingerprint: amprenta,
  screenshots: capturi.map((cale) => ({ path: cale, sha256: sha256File(cale) })),
  recordedAt: new Date().toISOString(),
};

const caleChitanta = writeReceipt(faza, chitanta);

process.stdout.write(
  `Chitanță ${faza} înregistrată — amprentă ${amprenta.slice(0, 12)}…\n` +
    `  ${detaliu}\n` +
    (capturi.length > 0 ? `  screenshot-uri: ${capturi.length}\n` : '') +
    `  ${caleChitanta}\n`
);
