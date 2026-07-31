#!/usr/bin/env node
/**
 * check:workflow — gate de pre-push. Ultima linie înainte ca munca să plece din mașină.
 *
 * Pe range-ul care urmează să fie trimis: dacă vreun commit atinge cod de feature, cere
 * (1) `LEARNINGS.md` atins în același range și (2) chitanțe verify + review valide.
 *
 * Diferența față de Stop-gate: acolo o tură intermediară fără lecție e legitimă. Aici nu —
 * ce pleacă din mașină trebuie să lase în urmă și ce s-a învățat.
 *
 * Rulat ca npm script din `.husky/pre-push`, nu ca hook: eșecul e exit 1, nu exit 2.
 */
import {
  branchCurent,
  diffFingerprint,
  headSha,
  isFeatureFile,
  isPaused,
  isUiFile,
  readReceipt,
  sha256File,
} from './workflow-lib.mjs';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

function git(argumente) {
  return execFileSync('git', argumente, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function refExista(ref) {
  try {
    git(['rev-parse', '--verify', '--quiet', ref]);
    return true;
  } catch {
    return false;
  }
}

/** Baza de comparație: ce urmărește branch-ul, altfel origin/main, altfel main. */
function bazaDeComparatie() {
  for (const candidat of ['@{push}', '@{upstream}', 'origin/main', 'main']) {
    if (refExista(candidat)) {
      try {
        const baza = git(['merge-base', candidat, 'HEAD']).trim();
        if (baza !== '' && baza !== headSha()) return { baza, sursa: candidat };
        if (baza === headSha()) return { baza, sursa: candidat };
      } catch {
        // Candidatul nu are strămoș comun cu HEAD — încearcă următorul.
      }
    }
  }
  return null;
}

function iesiCuEroare(lipsuri, context) {
  process.stderr.write(
    `check:workflow — ce urmează să plece nu e complet dovedit.\n\n` +
      `Ce lipsește:\n  - ${lipsuri.join('\n  - ')}\n\n` +
      `${context}\n` +
      `Cum completezi:\n` +
      `  node scripts/record-phase.mjs verify "<ce s-a verificat>" [--screenshot <cale>]\n` +
      `  node scripts/record-phase.mjs review "<concluzia review-ului>"\n` +
      `  și scrie lecția în LEARNINGS.md, apoi include-o într-un commit din range.\n\n` +
      `Excepție persistentă (auditată): touch .claude/state/workflow-override\n`
  );
  process.exit(1);
}

let referinta;
try {
  referinta = bazaDeComparatie();
} catch {
  referinta = null;
}

if (referinta === null) {
  process.stdout.write(
    'check:workflow — nu pot determina range-ul de trimis (fără upstream, origin/main sau main).\n' +
      '  Gate-ul nu se poate pronunța; APPROVE-ul uman de la pre-push rămâne în picioare.\n'
  );
  process.exit(0);
}

const { baza, sursa } = referinta;

let fisiere = [];
try {
  fisiere = git(['diff', '--name-only', `${baza}..HEAD`])
    .split('\n')
    .map((linie) => linie.trim())
    .filter((linie) => linie !== '');
} catch {
  process.stdout.write('check:workflow — nu pot citi range-ul; gate-ul nu se pronunță.\n');
  process.exit(0);
}

const fisiereFeature = fisiere.filter(isFeatureFile);

if (fisiereFeature.length === 0) {
  process.stdout.write(
    `check:workflow — range-ul ${sursa}..HEAD nu atinge cod de feature. Nimic de dovedit.\n`
  );
  process.exit(0);
}

const cereScreenshot = fisiere.some(isUiFile);
const lipsuri = [];

if (!fisiere.includes('LEARNINGS.md')) {
  lipsuri.push(
    'LEARNINGS.md nu e atins în range — ce pleacă din mașină trebuie să lase și lecția.'
  );
}

const headCurent = headSha();
const amprentaCurenta = diffFingerprint();

for (const faza of ['verify', 'review']) {
  const chitanta = readReceipt(faza);

  if (chitanta === null) {
    lipsuri.push(`lipsește chitanța de ${faza}`);
    continue;
  }

  // Amprenta singură nu ajunge: pe un tree curat e identică la orice commit, deci o
  // chitanță de la commit-ul anterior ar părea validă. HEAD-ul o leagă de ce se trimite.
  if (chitanta.head !== headCurent) {
    lipsuri.push(`chitanța de ${faza} e de la alt commit (învechită față de HEAD)`);
    continue;
  }

  if (chitanta.diffFingerprint !== amprentaCurenta) {
    lipsuri.push(`chitanța de ${faza} e învechită (tree-ul s-a schimbat după înregistrare)`);
    continue;
  }

  if (faza === 'verify' && cereScreenshot) {
    const capturi = Array.isArray(chitanta.screenshots) ? chitanta.screenshots : [];
    if (capturi.length === 0) {
      lipsuri.push(
        'chitanța de verify nu are screenshot, dar range-ul atinge app/, components/ sau theme/'
      );
      continue;
    }
    for (const captura of capturi) {
      if (!captura || typeof captura.path !== 'string' || !existsSync(captura.path)) {
        lipsuri.push('screenshot-ul înregistrat la verify lipsește de pe disc');
        break;
      }
      if (sha256File(captura.path) !== captura.sha256) {
        lipsuri.push(`screenshot-ul ${captura.path} s-a schimbat după înregistrare`);
        break;
      }
    }
  }
}

if (lipsuri.length > 0) {
  if (isPaused(process.cwd(), 'check:workflow')) {
    process.stdout.write('check:workflow — escape hatch activ, gate-ul nu blochează.\n');
    process.exit(0);
  }

  const listaFisiere = fisiereFeature.slice(0, 10).join('\n  ');
  const restul =
    fisiereFeature.length > 10 ? `\n  … și încă ${fisiereFeature.length - 10}` : '';

  iesiCuEroare(
    lipsuri,
    `Range: ${sursa}..HEAD (branch ${branchCurent()})\nCod de feature atins:\n  ${listaFisiere}${restul}\n`
  );
}

process.stdout.write(
  `check:workflow — ${fisiereFeature.length} fișiere de feature în ${sursa}..HEAD, ` +
    'dovezile sunt complete.\n'
);
