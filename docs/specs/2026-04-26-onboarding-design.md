# Design — Onboarding wizard

**Data:** 2026-04-26
**Scope:** primul flow după instalare; setup minim necesar pentru ca user-ul să poată folosi app-ul.
**Status:** aprobat (brainstorm), gata de implementare.

## Problema

App-ul Finanțe se instalează, user-ul intră direct în tab Sumar — gol, fără context, fără cont. Nu știe de unde să înceapă, nu știe ce poate, nu e configurat AI-ul, nu e setat app lock-ul.

## Cerință

Pas cu pas: explicăm app-ul, alegem aspectul, propunem app lock, creăm primul cont, opțional adăugăm date demo, alegem provider AI, explicăm backup, recapitulăm. Atomic la final.

## Flow (8 pași)

| # | Pas | Conținut principal |
|---|---|---|
| 1 | WELCOME | 4 bullets: local-first, AI opțional, backup manual, niciun cont online obligatoriu. |
| 2 | APPEARANCE | Chip-uri Auto/Clar/Întunecat. Preview vizual. |
| 3 | SECURITY | Bullets + buton „Activează app lock" → `AppLockPinModal`. Skip cu „Nu acum". |
| 4 | ACCOUNT | Form: nume + tip (chips: bank/cash/card/savings/investment/altul) + sold inițial + monedă (default RON). Required. |
| 5 | DEMO_DATA | Toggle „Adaugă cont demo cu ~30 tranzacții fictive". Default OFF. |
| 6 | AI_STEP | 3 opțiuni provider (built-in pre-selectat / external / niciunul). Consimțământ obligatoriu pentru built-in/external. Note: notificări apar contextual (la primul buget). |
| 7 | BACKUP | Bullets explicative (ZIP, iCloud/Drive/Fișiere, restore din Setări). Fără CTA „exportă acum". |
| 8 | SUMMARY | Recap. Buton primary „Începe" cu commit atomic. |

## Strategy de commit

**Atomic la „Începe".** Toate mutațiile (theme, account, demo, AI config, consent, onboarding done flag) se fac la pasul SUMMARY. Excepții care persistă imediat:

- **Theme:** state local în wizard pentru preview vizual; `setThemePreference` se cheamă la commit. Dacă user-ul închide app mid-wizard, tema revine la default.
- **PIN:** `AppLockPinModal` salvează PIN-ul în SecureStore imediat (e atomar și criptat), dar `setAppLockEnabled(true)` se cheamă la commit. PIN-ul rămâne neutru cât timp lock-ul nu e activat.

Eroare la commit (ex. `createFinancialAccount` eșuează) → Alert + user rămâne la SUMMARY. `setOnboardingDone()` e ultimul, deci la retry totul re-rulează.

Demo data e best-effort: dacă generarea eșuează, nu blochează commit-ul. Warning afișat post-commit.

## State management

State local în `OnboardingWizard.tsx`:

```ts
const [step, setStep] = useState(WELCOME);
const [committing, setCommitting] = useState(false);

// APPEARANCE
const [themePref, setThemePref] = useState<ThemePreference>('auto');

// SECURITY
const [pinModalVisible, setPinModalVisible] = useState(false);
const [pinSetUp, setPinSetUp] = useState(false); // true după ce AppLockPinModal salvează cu succes
const [biometricAvailable, setBiometricAvailable] = useState(false);

// ACCOUNT
const [accountName, setAccountName] = useState('');
const [accountType, setAccountType] = useState<FinancialAccountType>('bank');
const [accountInitialBalance, setAccountInitialBalance] = useState(''); // string pentru input
const [accountCurrency, setAccountCurrency] = useState('RON');

// DEMO_DATA
const [demoEnabled, setDemoEnabled] = useState(false);

// AI
const [aiProviderChoice, setAiProviderChoice] = useState<AiProviderType>('builtin');
const [aiExternalUrl, setAiExternalUrl] = useState('');
const [aiExternalApiKey, setAiExternalApiKey] = useState('');
const [aiExternalModel, setAiExternalModel] = useState('');
const [aiConsentChecked, setAiConsentChecked] = useState(false);
```

Override pe ThemePreference: în wizard creez un context local (sau bypass simplu — folosesc `themePref` direct pentru `palette = Colors[effective]`). La commit, scriu în settings + actualizez context-ul global.

## Componenta

**`components/OnboardingWizard.tsx`** (~700 linii):

- Layout fix: header (step indicator + titlu + subtitlu), progress bar, ScrollView pentru conținut, footer cu Înapoi/Continuă.
- Sub-helperi inline (ne-exportați): `BulletList`, `ChipRow`, `StepHeader`, `StepFooter`.
- Refolosit: `AppLockPinModal`.

**Validare „Continuă":**

| Pas | Condiție |
|---|---|
| WELCOME, APPEARANCE, SECURITY, DEMO_DATA, BACKUP, SUMMARY | Mereu activ |
| ACCOUNT | `accountName.trim().length > 0` |
| AI_STEP | Dacă built-in/external → `aiConsentChecked === true`. Dacă external → URL+key+model toate ne-goale. |

## Demo data

**Helper nou: `services/demoData.ts`**

```ts
export async function createDemoData(): Promise<{ accountId: string; transactionCount: number }>;
export async function deleteDemoData(): Promise<void>;
export async function hasDemoData(): Promise<boolean>;
```

Tracking demo via AsyncStorage cheie `settings_demo_account_id`. Fără modificări de schema.

**Cont demo:** nume `Cont demo`, tip `bank`, sold inițial 3500 RON, color `#9F9F9F`, icon `flask`.

**Tranzacții (~30 pe ultimele 60 zile):**

| Categorie | Count | Exemple |
|---|---|---|
| income | 2 | Salariu +5000 |
| home | 2 | Chirie −1500 |
| food | 6 | Lidl/Kaufland/Carrefour, −50…−300 |
| entertainment | 4 | Starbucks/„La Mama"/cinema, −25…−200 |
| subscriptions | 4 | Netflix/Spotify (lunar) |
| vehicle | 1 | OMV/Mol −200 |
| health | 2 | Sensiblu/Catena, −40…−80 |
| transport | 2 | Bolt/STB, −15…−25 |
| utilities | 2 | Enel/Digi, −120…−250 |
| **necategorizate** | **3-4** | Cinema City/Decathlon/Ikea — `category_id NULL` intenționat |

`source = 'demo'` (extindere `TransactionSource`).

## Modificări fișiere

| Fișier | Tip | Notă |
|---|---|---|
| `components/OnboardingWizard.tsx` | nou | wizard principal |
| `services/demoData.ts` | nou | helper-i demo |
| `app/_layout.tsx` | modificare mică | gate pe `isOnboardingDone`, render wizard |
| `app/(tabs)/setari.tsx` | modificare | secțiuni „Cont demo" + „Reia onboarding" |
| `types/index.ts` | modificare mică | `TransactionSource` += `'demo'` |
| `__tests__/unit/demoData.test.ts` | nou | unit tests pentru demo helpers |

Refolosit fără edit: `services/settings.ts`, `services/financialAccounts.ts`, `services/transactions.ts`, `services/aiProvider.ts`, `components/AppLockPinModal.tsx`, `hooks/useAppLock.ts`, `hooks/useThemeScheme.ts`.

## Edge cases

| Caz | Comportament |
|---|---|
| App killed mid-wizard | Restart de la WELCOME. Tema/state pierdut. PIN rămâne în SecureStore (neutru cât timp lock disabled). |
| Back-forward între pași | State păstrat. |
| Sold non-numeric | `normalizeAmount` → null → tratez ca 0. |
| Sold cu virgulă RO | Parser-ul existent gestionează. |
| Nume cont gol | „Continuă" disabled. |
| Face ID refuzat de device | `AppLockPinModal` are deja fallback la PIN. |
| AI extern parțial completat | „Continuă" disabled până când URL+key+model sunt toate. |
| Deja există demo (reset onboarding) | Toggle dezactivat în pasul DEMO_DATA + badge informativ. |
| Tap dublu „Începe" | `committing=true` blochează retap. |
| Eroare la commit cont real | Alert + retry posibil (rămâne la SUMMARY). |
| Eroare la generare demo | Warning post-commit, nu blochează. |

## Localizare

Toate stringurile RO hardcodate inline. Extragerea în `i18n/ro.ts` se face în spec-ul „Localizare structurală" (#7 din `docs/IDEAS.md`).

## Out of scope

- Pas notificări (info contextuală la primul buget — nu aici).
- CTA „exportă acum" în BACKUP (banner-ul „nu ai făcut backup de X zile" e în Setări, separat).
- Flow „resetare onboarding" complet — doar buton „Reia onboarding" în Setări care apelează `resetOnboarding()` + reload.
