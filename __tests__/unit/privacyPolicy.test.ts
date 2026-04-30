import {
  AI_DISCLOSURE,
  AI_PROVIDER_LEGAL,
  AI_PROVIDER_NAME,
  AI_PROVIDER_TERMS_URL,
  CONTACT_EMAIL,
  POLICY_LAST_UPDATED,
  PRIVACY_POLICY_FULL,
  preflightDescription,
} from '@/services/privacyPolicy';

const flatten = (sections: typeof AI_DISCLOSURE): string =>
  sections
    .map(
      s => s.heading + ' ' + s.paragraphs.join(' ') + ' ' + (s.bullets ? s.bullets.join(' ') : '')
    )
    .join(' ');

describe('AI_DISCLOSURE', () => {
  const text = flatten(AI_DISCLOSURE);

  it('numește explicit furnizorul Mistral și entitatea legală', () => {
    expect(text).toContain(AI_PROVIDER_NAME);
    expect(text).toContain(AI_PROVIDER_LEGAL);
  });

  it('include link la termenii Mistral', () => {
    expect(text).toContain(AI_PROVIDER_TERMS_URL);
  });

  it('enumeră categoriile de date trimise (chat / CSV / PDF vision)', () => {
    expect(text).toMatch(/conversațional|chat|întrebări/i);
    expect(text).toMatch(/CSV|text|extras/i);
    expect(text).toMatch(/PDF|imagini/i);
  });

  it('declară opt-in și revocare', () => {
    expect(text).toMatch(/opt-in|consimțământ/i);
    expect(text).toMatch(/revoc|debif|Setări/i);
  });

  it('clarifică că tranzacțiile NU se trimit la chatbot', () => {
    expect(text).toMatch(/NU se trimite|nu se trimite/);
    expect(text).toMatch(/local pe device|rulează local/);
  });
});

describe('PRIVACY_POLICY_FULL', () => {
  const text = flatten(PRIVACY_POLICY_FULL);

  it('acoperă cele 4 cerințe Apple (date, cum, scopuri, third-party)', () => {
    expect(text).toMatch(/Ce date păstrăm|date.{0,30}device/i);
    expect(text).toMatch(/Asistent AI|terți|third/i);
    expect(text).toMatch(/scop|prelucrare|clasificar/i);
    expect(text).toContain(AI_PROVIDER_NAME);
  });

  it('include data ultimei actualizări și contact', () => {
    expect(text).toContain(POLICY_LAST_UPDATED);
    expect(text).toContain(CONTACT_EMAIL);
  });

  it('explică drepturile de export și ștergere', () => {
    expect(text).toMatch(/export/i);
    expect(text).toMatch(/JSON/i);
    expect(text).toMatch(/dezinstal|ștergere/i);
  });

  it('acoperă numerele 1–8 (cu sub-secțiuni opționale)', () => {
    const topLevels = PRIVACY_POLICY_FULL.map(s => s.heading.match(/^(\d+)\./)?.[1]).filter(
      (v): v is string => Boolean(v)
    );
    const uniqueTops = Array.from(new Set(topLevels));
    expect(uniqueTops).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
  });
});

describe('preflightDescription', () => {
  it('PDF vision menționează imagini și nume titular', () => {
    const text = preflightDescription({
      fileName: 'extras.pdf',
      contentKind: 'pdf-images',
    });
    expect(text).toMatch(/imagini/);
    expect(text).toMatch(/nume titular|IBAN/);
    expect(text).toContain(AI_PROVIDER_NAME);
  });

  it('CSV menționează textul fișierului', () => {
    const text = preflightDescription({
      fileName: 'extras.csv',
      contentKind: 'csv-text',
    });
    expect(text).toMatch(/text/i);
    expect(text).toContain(AI_PROVIDER_NAME);
  });
});
