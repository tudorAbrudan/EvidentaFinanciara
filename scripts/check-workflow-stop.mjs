#!/usr/bin/env node
/**
 * Stop-gate — hook Stop. Un diff care atinge cod de feature nu se închide fără dovezi:
 * chitanță `verify` și chitanță `review`, ambele pe amprenta curentă a diff-ului.
 *
 * LEARN nu se cere aici. O tură intermediară de lucru e legitimă fără LEARNINGS;
 * lecția se cere la push (`npm run check:workflow`).
 *
 * Contract: exit 0 = tura se poate încheia, exit 2 = tura continuă și modelul primește
 * motivul pe stderr. Orice eroare internă → exit 0.
 */
import { existsSync } from 'node:fs';

import {
  diffAtingeUi,
  featureFilesInDiff,
  isPaused,
  readStdinJson,
  validateReceipt,
} from './workflow-lib.mjs';

function mesajBlocare(lipsuri, fisiere, cereScreenshot) {
  const listaFisiere = fisiere.slice(0, 10).join('\n  ');
  const restul = fisiere.length > 10 ? `\n  … și încă ${fisiere.length - 10}` : '';

  return `Stop-gate: diff-ul atinge cod de feature, dar dovezile de fază lipsesc sau sunt învechite.

Ce lipsește:
  - ${lipsuri.join('\n  - ')}

Cod de feature atins:
  ${listaFisiere}${restul}

Cum închizi tura:
  1. VERIFY — rulează npm run check și înregistrează:
     node scripts/record-phase.mjs verify "<ce s-a verificat>"${
       cereScreenshot
         ? '\n     Diff-ul atinge app/, components/ sau theme/, deci adaugă dovada vizuală:\n     --screenshot <cale-screenshot-iOS-Simulator>'
         : ''
     }
  2. REVIEW — cold-read pe diff (de preferat prin sub-agentul "reviewer"), apoi:
     node scripts/record-phase.mjs review "<concluzia review-ului>"

Chitanțele se leagă de amprenta diff-ului: dacă mai editezi ceva după ce le-ai
înregistrat, trebuie reînregistrate.

Excepție one-shot: touch .claude/state/workflow-pause
`;
}

try {
  const payload = readStdinJson();

  // Anti-buclă: dacă tura curentă a fost deja prelungită de acest hook, nu insista.
  if (payload.stop_hook_active === true) {
    process.exit(0);
  }

  const cwd =
    typeof payload.cwd === 'string' && existsSync(payload.cwd) ? payload.cwd : process.cwd();

  const fisiere = featureFilesInDiff(cwd);
  if (fisiere.length === 0) {
    process.exit(0);
  }

  const cereScreenshot = diffAtingeUi(cwd);

  const lipsuri = [];
  const verify = validateReceipt('verify', cwd, { cereScreenshot });
  if (!verify.ok) lipsuri.push(verify.motiv);
  const review = validateReceipt('review', cwd);
  if (!review.ok) lipsuri.push(review.motiv);

  if (lipsuri.length === 0) {
    process.exit(0);
  }

  if (isPaused(cwd, 'stop-gate')) {
    process.exit(0);
  }

  process.stderr.write(mesajBlocare(lipsuri, fisiere, cereScreenshot));
  process.exit(2);
} catch {
  process.exit(0);
}
