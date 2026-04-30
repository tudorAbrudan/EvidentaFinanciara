/**
 * Generează `landing/privacy.html` din `services/privacyPolicy.ts`.
 *
 * Rulare: `npm run build:privacy`
 *
 * Sursa unică de adevăr e `services/privacyPolicy.ts`. La orice modificare
 * a textului, rulează acest script ca să sincronizezi pagina publică.
 */

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  APP_NAME,
  CONTACT_EMAIL,
  POLICY_LAST_UPDATED,
  PRIVACY_POLICY_FULL,
  type DisclosureSection,
} from '../services/privacyPolicy.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, '../landing/privacy.html');

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function linkify(s: string): string {
  return s.replace(
    /(https?:\/\/[^\s]+)/g,
    url => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`
  );
}

function renderSection(section: DisclosureSection): string {
  const heading = `<h2>${escapeHtml(section.heading)}</h2>`;
  const paragraphs = section.paragraphs.map(p => `<p>${linkify(escapeHtml(p))}</p>`).join('\n');
  const bullets = section.bullets?.length
    ? `<ul>\n${section.bullets.map(b => `<li>${linkify(escapeHtml(b))}</li>`).join('\n')}\n</ul>`
    : '';
  return [heading, paragraphs, bullets].filter(Boolean).join('\n');
}

const body = PRIVACY_POLICY_FULL.map(renderSection).join('\n\n');

const html = `<!DOCTYPE html>
<html lang="ro">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(APP_NAME)} — Politica de confidențialitate</title>
  <meta name="description" content="Politica de confidențialitate ${escapeHtml(APP_NAME)} — date pe device, AI opțional, fără tracking." />
  <link rel="icon" href="favicon.png" type="image/png" />
  <link rel="stylesheet" href="style.css" />
</head>
<body class="legal">
  <header class="hero" style="min-height: auto;">
    <nav>
      <div class="logo">
        <span class="logo-mark">₣</span>
        <span class="logo-text">${escapeHtml(APP_NAME)}</span>
      </div>
      <a href="index.html" class="nav-link">Acasă</a>
    </nav>
  </header>

  <main class="container legal-content">
    <h1>Politica de confidențialitate</h1>
    <p class="legal-meta">Versiunea ${escapeHtml(POLICY_LAST_UPDATED)}</p>

${body}

    <hr />
    <p class="legal-footer">
      Dacă ai întrebări sau sesizări, scrie la
      <a href="mailto:${escapeHtml(CONTACT_EMAIL)}">${escapeHtml(CONTACT_EMAIL)}</a>.
    </p>
  </main>

  <footer>
    <div class="container">
      <span>© 2026 ${escapeHtml(APP_NAME)}. Făcut în România.</span>
      <span class="footer-links">
        <a href="index.html">Acasă</a>
      </span>
    </div>
  </footer>
</body>
</html>
`;

writeFileSync(OUT_PATH, html, 'utf8');

const sizeKb = Math.round(html.length / 1024);
console.log(`✓ Scris ${OUT_PATH} (${sizeKb} KB, ${PRIVACY_POLICY_FULL.length} secțiuni)`);
