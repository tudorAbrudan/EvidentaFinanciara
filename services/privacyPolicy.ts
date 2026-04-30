/**
 * Sursa unică de adevăr pentru textele de confidențialitate.
 *
 * Folosit de:
 *  - `components/AiDisclosureExpandable` (consent în onboarding & setări)
 *  - `components/AiPreflightDialog` (pre-flight la upload PDF/CSV)
 *  - `components/PrivacyPolicyView` (ecran „Confidențialitate")
 *  - `scripts/build-privacy-html.ts` → `landing/privacy.html`
 *
 * Cerințe Apple (5.1.1(i) / 5.1.2(i)) acoperite:
 *  1. Disclose what data will be sent.
 *  2. Specify who the data is sent to.
 *  3. Obtain the user's permission before sending data.
 *  4. Identify in the privacy policy what data is collected, how, all uses,
 *     and confirm any third party provides the same or equal protection.
 */

export const POLICY_LAST_UPDATED = '2026-04-30';
export const APP_NAME = 'Finanțe Personale';
export const CONTACT_EMAIL = 'apps.tudor@gmail.com';
export const AI_PROVIDER_NAME = 'Mistral AI';
export const AI_PROVIDER_LEGAL = 'Mistral SAS, Franța';
export const AI_PROVIDER_TERMS_URL = 'https://mistral.ai/terms';

export interface DisclosureSection {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
}

/**
 * Versiunea scurtă (consent surface) — ce date, cui, scop, control.
 * Apare lângă checkbox-ul de consimțământ în onboarding și setări,
 * și ca text de bază în pre-flight dialog.
 */
export const AI_DISCLOSURE: DisclosureSection[] = [
  {
    heading: 'Cu cine procesează AI-ul aplicația',
    paragraphs: [
      `Asistentul AI folosește ${AI_PROVIDER_NAME} (operat de ${AI_PROVIDER_LEGAL}) ca furnizor de inferență. Cererile sunt trimise direct către API-ul Mistral.`,
      `Dacă alegi „Cheia mea API" în loc de „Finanțe AI", datele merg la furnizorul tău (OpenAI, Mistral self-hosted, etc.) — guvernate de termenii lui.`,
    ],
  },
  {
    heading: 'Ce date trimit la Mistral',
    paragraphs: ['Datele trimise diferă în funcție de funcționalitate:'],
    bullets: [
      'Asistent conversațional: textul întrebărilor tale + un sumar al ultimelor 4 schimburi din conversație. Conținutul tranzacțiilor NU se trimite — AI primește doar schema bazei de date și generează interogarea, care rulează local pe device.',
      'Mapare extras CSV/text: textul integral al fișierului bancar (descrieri tranzacții, sume, date, eventual nume titular sau IBAN dacă apar în fișier).',
      'Mapare extras PDF (vision): paginile PDF ca imagini base64. Conține tot ce e vizibil — inclusiv nume titular, IBAN, adresă, sume, descrieri tranzacții.',
    ],
  },
  {
    heading: 'Scopul prelucrării',
    paragraphs: [
      'Datele sunt trimise pentru clasificarea automată a tranzacțiilor și răspunsuri la întrebări despre finanțele tale. Nu sunt folosite pentru reclame, profilare sau vânzare către terți.',
    ],
  },
  {
    heading: 'Politica Mistral & reținere',
    paragraphs: [
      `Cererile sunt procesate conform termenilor ${AI_PROVIDER_NAME} (${AI_PROVIDER_TERMS_URL}). Mistral declară că nu folosește input-urile API pentru antrenarea implicită a modelelor; cererile pot fi reținute temporar în scopuri de abuz și securitate, conform politicii lor curente.`,
    ],
  },
  {
    heading: 'Controlul tău',
    paragraphs: ['Ai control total asupra trimiterii:'],
    bullets: [
      'Opt-in: nimic nu se trimite dacă nu ai bifat consimțământul.',
      'Revocare oricând: Setări → Asistent AI → debifezi consimțământul sau alegi „Fără AI".',
      'Pre-flight la upload: pentru import PDF/CSV apare un dialog separat cu numele fișierului înainte de fiecare trimitere.',
      'Local-first: tranzacțiile, conturile, categoriile, backup-ul rămân pe device. Nu există server propriu, niciun cont, niciun tracking, niciun analytics.',
    ],
  },
];

/**
 * Politica completă — ecran „Confidențialitate" + `landing/privacy.html`.
 */
export const PRIVACY_POLICY_FULL: DisclosureSection[] = [
  {
    heading: '1. Cine suntem',
    paragraphs: [
      `${APP_NAME} este o aplicație mobilă pentru gestiunea finanțelor personale. Aplicația este local-first: toate datele rămân pe device-ul tău, în afară de cazurile descrise în secțiunea 3 (Asistent AI opțional) și secțiunea 4 (Backup iCloud opțional).`,
      `Nu avem servere proprii. Nu folosim analytics. Nu vindem date.`,
    ],
  },
  {
    heading: '2. Ce date păstrăm pe device',
    paragraphs: ['Aplicația stochează local, într-o bază SQLite criptată de iOS:'],
    bullets: [
      'Conturi financiare (nume, tip, valută, sold inițial).',
      'Categorii de cheltuieli (nume, iconiță, limită lunară opțională).',
      'Tranzacții (sumă, dată, descriere, merchant, categorie, notițe).',
      'Fișiere extras bancar importate (PDF/CSV) — doar până le procesezi, apoi șterse.',
      'Setări locale: aspect (light/dark), preferințe AI, configurare blocare app (PIN/biometric).',
    ],
  },
  {
    heading: '3. Asistent AI (opțional) — date trimise terților',
    paragraphs: [
      `Aplicația include un asistent AI opțional. Dacă îl activezi și accepți consimțământul, anumite date sunt trimise către ${AI_PROVIDER_NAME} (operat de ${AI_PROVIDER_LEGAL}) sau către furnizorul propriu ales de tine.`,
      `Datele trimise diferă în funcție de funcționalitate:`,
    ],
    bullets: [
      'Asistent conversațional: textul întrebărilor tale + sumar al ultimelor 4 schimburi din conversație. Conținutul tranzacțiilor NU se trimite — AI primește doar schema bazei de date și generează interogarea, care rulează local pe device.',
      'Mapare extras CSV/text: textul integral al fișierului bancar (descrieri tranzacții, sume, date, eventual nume titular sau IBAN dacă apar).',
      'Mapare extras PDF (vision): paginile PDF ca imagini base64. Conține tot ce e vizibil — nume titular, IBAN, adresă, sume, descrieri tranzacții.',
    ],
  },
  {
    heading: '3.1. Scopul prelucrării',
    paragraphs: [
      `Datele sunt trimise pentru clasificarea automată a tranzacțiilor și răspunsuri la întrebări despre finanțele tale. Nu sunt folosite pentru reclame, profilare sau vânzare către terți.`,
    ],
  },
  {
    heading: `3.2. Politica ${AI_PROVIDER_NAME} & reținere`,
    paragraphs: [
      `Cererile sunt procesate conform termenilor ${AI_PROVIDER_NAME} (${AI_PROVIDER_TERMS_URL}). Mistral declară că nu folosește input-urile API pentru antrenarea implicită a modelelor; cererile pot fi reținute temporar în scopuri de abuz și securitate, conform politicii lor curente.`,
      `Dacă folosești „Cheia mea API" în loc de varianta inclusă, datele merg direct la furnizorul tău (OpenAI, Mistral self-hosted etc.) — guvernate de termenii lui.`,
    ],
  },
  {
    heading: '3.3. Controlul tău',
    paragraphs: ['Ai control total asupra trimiterii:'],
    bullets: [
      'Opt-in: nimic nu se trimite dacă nu ai bifat consimțământul în onboarding sau Setări → Asistent AI.',
      'Revocare oricând: Setări → Asistent AI → debifezi consimțământul sau alegi „Fără AI".',
      'Pre-flight la upload: pentru import PDF/CSV apare un dialog separat cu numele fișierului înainte de fiecare trimitere.',
    ],
  },
  {
    heading: '4. Backup iCloud (opțional)',
    paragraphs: [
      `Dacă activezi sincronizarea iCloud din Setări, aplicația încarcă în iCloud Drive un fișier ZIP cu backup-ul tău (conturi, tranzacții, categorii). Fișierul rămâne în spațiul tău iCloud personal — nu trecem prin niciun server propriu.`,
      `Frecvența și retenția snapshot-urilor sunt configurabile. Apple guvernează stocarea iCloud conform termenilor lor.`,
    ],
  },
  {
    heading: '5. Securitate device',
    paragraphs: [
      'Cheile API (dacă folosești cheie proprie pentru AI) sunt stocate în iOS Keychain prin `expo-secure-store`.',
      'Poți activa blocarea aplicației cu PIN sau Face ID / Touch ID (Setări → Blocare app). PIN-ul e stocat în Keychain, nu în baza de date.',
    ],
  },
  {
    heading: '6. Drepturile tale',
    paragraphs: [
      'Export: poți exporta toate datele într-un fișier JSON oricând (Setări → Export). Fișierul e al tău, îl poți lua cu tine.',
      'Ștergere: dezinstalarea aplicației șterge complet baza de date locală. Backup-urile iCloud (dacă există) se șterg din contul tău Apple în Setări → Apple ID → iCloud → Gestionează spațiu.',
      'Revocare consimțământ AI: oricând, din Setări → Asistent AI.',
    ],
  },
  {
    heading: '7. Modificări ale politicii',
    paragraphs: [
      `Versiunea curentă: ${POLICY_LAST_UPDATED}.`,
      'Modificările sunt versionate public în repository-ul aplicației. La modificări semnificative ale fluxului AI sau backup, vom cere consimțământ nou la următoarea pornire.',
    ],
  },
  {
    heading: '8. Contact',
    paragraphs: [`Întrebări sau sesizări: ${CONTACT_EMAIL}.`],
  },
];

/**
 * Helper pentru pre-flight dialog la upload.
 */
export interface PreflightInfo {
  fileName: string;
  /** Mărime KB rotunjit. */
  sizeKb?: number;
  /** Pagini PDF, dacă e cazul. */
  pages?: number;
  /** Ce conține efectiv (text vs imagini). */
  contentKind: 'pdf-images' | 'csv-text' | 'pdf-text';
}

export function preflightDescription(info: PreflightInfo): string {
  const what =
    info.contentKind === 'pdf-images'
      ? 'paginile PDF ca imagini'
      : info.contentKind === 'csv-text'
        ? 'textul integral al fișierului CSV'
        : 'textul extras din PDF';
  const contains =
    info.contentKind === 'pdf-images'
      ? 'Conținutul vizibil al PDF-ului — inclusiv nume titular, IBAN, descrieri tranzacții, sume.'
      : 'Textul fișierului — descrieri tranzacții, sume, date, eventual nume sau IBAN.';
  return `Vor fi trimise ${what} către ${AI_PROVIDER_NAME} (${AI_PROVIDER_LEGAL}), care va extrage tranzacțiile.\n\n${contains}`;
}
