#!/usr/bin/env node
/**
 * plan-gate — hook PreToolUse pe Edit|Write|MultiEdit|NotebookEdit.
 *
 * Nu poți edita cod de feature fără un plan înregistrat pe HEAD-ul curent.
 * Planul se leagă de HEAD, nu de amprenta diff-ului: altfel prima editare de după plan
 * și-ar invalida propriul plan.
 *
 * Contract: exit 0 = permite, exit 2 = blochează (motivul pe stderr ajunge la model).
 * Orice eroare internă → exit 0. Un guardrail local nu are voie să blocheze o sesiune.
 */
import { existsSync } from 'node:fs';

import {
  headSha,
  isFeatureFile,
  isPaused,
  readReceipt,
  readStdinJson,
  toRepoRelative,
} from './workflow-lib.mjs';

const MESAJ_BLOCARE = (caleRelativa) =>
  `Plan-gate: editezi cod de feature (${caleRelativa}) fără plan înregistrat.

Înregistrează planul după ce e aprobat:
  node scripts/record-phase.mjs plan "<rezumatul planului>"

Pentru o excepție one-shot:
  touch .claude/state/workflow-pause
`;

try {
  const payload = readStdinJson();

  const caleBruta = payload?.tool_input?.file_path;
  if (typeof caleBruta !== 'string' || caleBruta.trim() === '') {
    process.exit(0);
  }

  const cwd = typeof payload.cwd === 'string' && existsSync(payload.cwd) ? payload.cwd : process.cwd();

  const caleRelativa = toRepoRelative(caleBruta, cwd);
  if (!isFeatureFile(caleRelativa)) {
    process.exit(0);
  }

  const plan = readReceipt('plan', cwd);
  if (plan !== null && plan.head === headSha(cwd)) {
    process.exit(0);
  }

  // Escape hatch-ul se evaluează abia aici, când gate-ul chiar ar bloca. Altfel un edit
  // nevinovat pe docs ar consuma pause-ul one-shot înainte să ajungă la editarea reală.
  if (isPaused(cwd, `plan-gate pe ${caleRelativa}`)) {
    process.exit(0);
  }

  process.stderr.write(MESAJ_BLOCARE(caleRelativa));
  process.exit(2);
} catch {
  process.exit(0);
}
