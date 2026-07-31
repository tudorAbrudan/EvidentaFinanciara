#!/usr/bin/env node
/**
 * Statusline: `◉ <fază> · <branch>`.
 *
 * Faza nu e declarată de nimeni — e dedusă din chitanțele care sunt încă valide pe amprenta
 * curentă a diff-ului. Dacă editezi ceva, chitanțele mor și linia revine la IMPLEMENT.
 * Asta e și rostul ei: arată starea reală, nu intenția.
 *
 * E o linie de UI, nu un gate: orice eroare se termină în exit 0 cu output minim.
 */
import { existsSync } from 'node:fs';

import {
  branchCurent,
  diffFingerprint,
  featureFilesInDiff,
  headSha,
  readReceipt,
  readStdinJson,
} from './workflow-lib.mjs';

// La egalitate de timp, faza mai avansată câștigă.
const PRIORITATE = { plan: 1, verify: 2, review: 3 };

function fazaCurenta(cwd) {
  const amprenta = diffFingerprint(cwd);
  let castigator = null;

  for (const faza of ['plan', 'verify', 'review']) {
    const chitanta = readReceipt(faza, cwd);
    if (chitanta === null) continue;

    // Planul se leagă de HEAD, restul de amprentă — la fel ca în gate-uri.
    const valida =
      faza === 'plan'
        ? chitanta.head === headSha(cwd)
        : chitanta.diffFingerprint === amprenta;
    if (!valida) continue;

    const moment = Date.parse(chitanta.recordedAt ?? '') || 0;
    if (
      castigator === null ||
      moment > castigator.moment ||
      (moment === castigator.moment && PRIORITATE[faza] > PRIORITATE[castigator.faza])
    ) {
      castigator = { faza, moment };
    }
  }

  if (castigator !== null) return castigator.faza.toUpperCase();
  return featureFilesInDiff(cwd).length > 0 ? 'IMPLEMENT' : '–';
}

try {
  const payload = readStdinJson();

  const dinPayload = payload?.workspace?.current_dir ?? payload?.cwd;
  const cwd = typeof dinPayload === 'string' && existsSync(dinPayload) ? dinPayload : process.cwd();

  const branch = branchCurent(cwd);

  let faza = '–';
  try {
    faza = fazaCurenta(cwd);
  } catch {
    // Fără chitanțe lizibile rămâne doar branch-ul — util oricum.
  }

  process.stdout.write(`◉ ${faza} · ${branch}\n`);
} catch {
  process.exit(0);
}
