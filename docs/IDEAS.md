# Idei și roadmap — Finanțe

> Aplicație publică, local-first, posibil monetizată. Principii:
> 1. Datele rămân pe device. Niciun backend obligatoriu.
> 2. AI-ul e opțional și transparent (consent explicit, fără dark patterns).
> 3. Nu adăugăm complexitate inutilă — fiecare idee răspunde la: *câți utilizatori beneficiază real, merită complexitatea?*

**Status:** roadmap inițial, înainte de primul spec implementat.
**Ultima actualizare:** 2026-04-26.

---

## Pre-lansare (toate trebuie făcute înainte de App Store)

Lista e ordonată după priority. Fiecare punct devine propriul spec → plan → implementare.

### Fundație produs

1. **Onboarding wizard** — welcome, aspect (light/dark/auto), securitate (PIN/biometric), primul cont, AI consent, sumar. Adaptat din `documents/app/components/OnboardingWizard.tsx`, simplificat la specificul finanțelor (fără entități/documente — pașii relevanți: aspect, securitate, primul cont, notificări, AI, backup, sumar).
2. **Quick-add tranzacție** — FAB („+") pe Sumar și Tranzacții. Modal rapid: sumă, categorie, opțional cont/notă/data. One-tap. Cea mai folosită acțiune trebuie să fie cea mai accesibilă.
3. **Empty states** — pe fiecare ecran (Sumar, Conturi, Tranzacții, Categorii) când nu există date. Mesaj prietenos + acțiune sugerată.
4. **Backup/restore vizibil** — în onboarding (pas dedicat) și în Setări. Alertă „nu ai făcut backup de X zile" cu CTA. Folosește implementarea existentă din `services/backup.ts`.
5. **Date demo opționale** — la onboarding, toggle „adaugă tranzacții demo ca să vezi cum arată". Deletable cu un tap din Setări (un singur buton: „Șterge datele demo").
6. **Pagini legale** — `docs/privacy.html` + `docs/terms.html`, link-uri din Setări. Local-first e selling point — exploatăm asta.
7. **Localizare structurală** — separi string-urile în `i18n/ro.ts` (sau echivalent) chiar dacă lansezi RO-only. Pregătire EN fără refactor.

### Diferențiator (de ce ar alege cineva app-ul tău)

8. **Sugerare AI categorii pe import (mapare)** — după parser determinist + `suggestCategory` (regex), AI propune categorie pentru tranzacțiile încă necategorizate. **User confirmă, AI nu auto-aplică.** UI: badge „AI sugerează: Mâncare ✓ ✗" pe tranzacție. Free: cota built-in actuală (20/zi). Premium: nelimitat.
9. **Detectare automată tranzacții recurente** — Netflix, Spotify, chirie, abonamente. Listă „Abonamente active" în Sumar. Alertă „factura X de luna trecută nu a apărut, e ok?".
10. **Insights lunari** — narativ scurt pe Sumar: „luna asta ai cheltuit cu 30% mai mult la Mâncare decât media ultimelor 3 luni". Local, fără AI. Calculat din `getMonthlySpending` istoric.
11. **Învățare locală auto-categorizare** — dacă marchezi „Lidl" ca Mâncare o dată, viitoarele tranzacții cu același merchant primesc auto-categorie cu badge „învățat din istoric". Override-abil. Persistent în SQLite (tabel nou `merchant_category_rules` sau extensie pe transactions).
12. **Bugete pe categorii cu progress bar** — schema are deja `monthly_limit`. Lipsește UI: ecran „Bugete" cu listă categorii + bar progres + edit limit. Status colors la 80% / 100%.
13. **Notificări locale pe bugete** — la 80% și 100% din `monthly_limit` pe categorie, notificare locală. Folosește `expo-notifications` (deja în deps). Configurabil din Setări (on/off, threshold).

### Funcții avansate

14. **Descoperire categorii noi (AI)** — dacă AI vede pattern-uri pe „necategorizate" (ex. 10% din cheltuieli la veterinar/petshop) și nu există categorie potrivită, propune să adauge una nouă cu icon + nume sugerat. User confirmă. WOW factor.
15. **Statistici YoY** — compară aprilie 2026 vs aprilie 2025 pe categorii. Grafic linie pe 12 luni rulante.
16. **Tag-uri pe tranzacții** — ortogonale categoriilor (ex. „concediu", „cadou", „business", „rambursabil"). Schema: tabel `tags` + `transaction_tags`. Filtrare în Tranzacții.
17. **Tracking datorii** — bidirecțional: am împrumutat / mi s-a împrumutat. Fără cont separat — câmp `debt_party` și `debt_status` pe tranzacție. Listă „Datorii deschise".
18. **Tranzacții programate** — rate cunoscute (leasing, rate cumpărări), plăți viitoare prevăzute. Apar în calendar și pre-populate la data lor.
19. **Export CSV/Excel/PDF** — export perioadă sau tot. CSV + PDF e suficient pentru MVP, Excel poate fi „PDF cu tabel" inițial.
20. **Split transaction** — 1 tranzacție pe mai multe categorii (ex. Lidl 200 RON: 150 mâncare + 50 igienă). Schema: tabel nou `transaction_splits`. Edit modal cu „adaugă split".
21. **Scan bon de casă** — poză bon → OCR (`@react-native-ml-kit/text-recognition` deja prezent) → tranzacție cash cu sumă + dată + best-effort merchant. Util pentru cash, frecvent în RO.
22. **Mini-recap lunar** — la prima deschidere de lună nouă, ecran modal „Aprilie pe scurt": total, top 3 categorii, schimbare vs luna trecută. Pop-up o singură dată/lună, dismiss-abil.
23. **Obiective de economisire** — „vreau 5000 RON până decembrie". Calcul automat ce trebuie pus deoparte/lună. Tracking progres pe baza tranzacțiilor pe un cont marcat „economii".

---

## Premium (post-lansare, monetizare)

24. **AI vision nelimitat** — free: cota built-in actuală (20 cereri/zi). Premium: nelimitat sau cheie proprie acceptată (ce e deja implementat ca `external` provider).
25. **Backup automat în iCloud / Google Drive** — free: export manual ZIP. Premium: programat săptămânal/lunar fără intervenție.
26. **Rapoarte PDF brandate** — pentru oameni care vor să trimită cuiva (contabil, partener) un raport oficial pe perioadă. Template + logo + formate predefinite.
27. **Multi-device sync E2E** — *decis ulterior.* Costă infrastructură; poate să nu apară niciodată dacă local-first e poziționarea.

---

## Respinse / amânate

| Idee | Motiv |
|---|---|
| Conectare directă API bănci (PSD2/Plaid) | RO acoperit slab, costă, fragil. PDF/CSV import e suficient pentru MVP. |
| Sync cloud proprietar | Împotriva poziționării local-first. Backup ZIP e suficient. |
| Login/cont online obligatoriu | Împotriva poziționării. App lock-ul biometric/PIN e tot ce trebuie. |
| Vânzare date | Niciodată — e selling point invers. |
| Notificări push de pe server | Nu există backend; notificările locale sunt suficiente. |
| Widget homescreen iOS/Android | Amânat — costă timp de implementare per platformă. Poate intra după monetizare. |
| Wear OS / Apple Watch | Out of scope pentru produs financiar. |
| Family sharing / household partajat | Decis după monetizare; necesită infrastructură. |

---

## Cum folosim acest fișier

- **Idee nouă** → adaug în secțiunea potrivită cu context scurt.
- **Idee validată** → mut în spec proper (`docs/specs/YYYY-MM-DD-<topic>-design.md`) înainte de implementare.
- **Idee respinsă** → mut în tabelul de mai sus cu motivul.
