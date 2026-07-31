#!/usr/bin/env node
/**
 * check:pointers — impune ca `CLAUDE.md` să rămână un pointer subțire către `AGENTS.md`.
 *
 * AGENTS.md e sursa canonică (vendor-neutral). CLAUDE.md există doar ca să trimită acolo;
 * dacă începe să crească reguli proprii, cele două documente divergează în tăcere.
 *
 * Utilizare: node scripts/check-pointer-files.mjs [radacina]
 * Exit 0 = pointer valid. Exit 1 = pointer umflat sau fișiere lipsă (motivele pe stderr).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MAX_LINII_NEVIDE = 15;

const radacina = process.argv[2] ?? process.cwd();
const caleAgents = join(radacina, 'AGENTS.md');
const caleClaude = join(radacina, 'CLAUDE.md');

const erori = [];

if (!existsSync(caleAgents)) {
  erori.push('AGENTS.md lipsește — sursa canonică trebuie să existe la rădăcina repo-ului.');
}

if (!existsSync(caleClaude)) {
  erori.push('CLAUDE.md lipsește — pointerul către AGENTS.md trebuie să existe la rădăcină.');
} else {
  const continut = readFileSync(caleClaude, 'utf8');
  const linii = continut.split('\n');

  const nevide = linii.filter((linie) => linie.trim() !== '');
  if (nevide.length > MAX_LINII_NEVIDE) {
    erori.push(
      `CLAUDE.md are ${nevide.length} linii nevide (maxim ${MAX_LINII_NEVIDE}). ` +
        'Mută conținutul în AGENTS.md și lasă doar pointerul.'
    );
  }

  const headinguri = linii.filter((linie) => /^#{2,}\s/.test(linie));
  if (headinguri.length > 0) {
    erori.push(
      `CLAUDE.md conține heading-uri de reguli (${headinguri.length}): ` +
        headinguri.map((h) => `"${h.trim()}"`).join(', ') +
        '. Un pointer nu are secțiuni proprii — mută-le în AGENTS.md.'
    );
  }

  if (!continut.includes('AGENTS.md')) {
    erori.push('CLAUDE.md nu trimite la AGENTS.md — pointerul trebuie să indice sursa canonică.');
  }
}

if (erori.length > 0) {
  process.stderr.write('check:pointers — CLAUDE.md nu mai e un pointer subțire:\n\n');
  for (const eroare of erori) {
    process.stderr.write(`  • ${eroare}\n`);
  }
  process.stderr.write('\n');
  process.exit(1);
}

process.stdout.write('check:pointers — CLAUDE.md e pointer subțire către AGENTS.md. OK.\n');
