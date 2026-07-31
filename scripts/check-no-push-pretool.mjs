#!/usr/bin/env node
/**
 * no-push — hook PreToolUse pe Bash. Blochează `git push` din sesiunile de agent.
 *
 * Push-ul e ultima acțiune ireversibilă și e treaba omului: îl rulează din terminalul lui,
 * unde `.husky/pre-push` cere `check:workflow`, `npm run check` și un APPROVE tastat la
 * /dev/tty. Un agent nu poate fabrica consimțământul acela.
 *
 * Escape hatch-ul rămâne uniform cu restul gate-urilor (workflow-pause / workflow-override).
 * Nu e o slăbiciune: controlul autoritar nu e aici, ci în APPROVE-ul de la pre-push și, în
 * ultimă instanță, în branch protection.
 *
 * Contract: exit 0 = permite, exit 2 = blochează. Orice eroare internă → exit 0.
 */
import { existsSync } from 'node:fs';

import { isPaused, readStdinJson } from './workflow-lib.mjs';

// Prinde și lanțurile („cd x && git push", "npm run check; git push"), dar nu „git pushX".
const REGEX_PUSH = /\bgit\s+push\b/;

/**
 * Scoate din comandă textul care e date, nu cod executabil: corpuri de heredoc și șiruri
 * ghilimelate. Fără asta, un `git commit -m "... git push ..."` era blocat de propriul lui
 * mesaj — gate-ul trebuie să se uite la ce se execută, nu la ce se scrie.
 *
 * Compromisul asumat: `bash -c 'git push'` scapă. Gate-ul ăsta previne push-ul din reflex,
 * nu unul deliberat ascuns; controlul autoritar rămâne APPROVE-ul de la pre-push.
 */
function textExecutabil(comanda) {
  return comanda
    .replace(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?^\s*\2\s*$/gm, ' ')
    .replace(/'[^']*'/g, ' ')
    .replace(/"(?:[^"\\]|\\.)*"/g, ' ');
}

const MESAJ_BLOCARE = `no-push: push-ul nu se face din sesiunea de agent.

Push-ul îl face omul, din terminalul lui, ca să treacă prin pre-push gate:
check:workflow → npm run check → APPROVE tastat la /dev/tty.

Cere-i userului să ruleze push-ul. Commit-urile locale rămân făcute, nu se pierde nimic.
`;

try {
  const payload = readStdinJson();

  const comanda = payload?.tool_input?.command;
  if (typeof comanda !== 'string' || comanda.trim() === '') {
    process.exit(0);
  }

  if (!REGEX_PUSH.test(textExecutabil(comanda))) {
    process.exit(0);
  }

  const cwd =
    typeof payload.cwd === 'string' && existsSync(payload.cwd) ? payload.cwd : process.cwd();

  if (isPaused(cwd, 'no-push')) {
    process.exit(0);
  }

  process.stderr.write(MESAJ_BLOCARE);
  process.exit(2);
} catch {
  process.exit(0);
}
