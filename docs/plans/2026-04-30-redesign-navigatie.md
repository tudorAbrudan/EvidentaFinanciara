# Plan implementare — redesign navigație

> **Pentru worker agentic:** Sub-skill recomandat pentru execuție: `superpowers:executing-plans` (inline) sau `superpowers:subagent-driven-development`. Pașii folosesc checkbox (`- [ ]`).

**Goal:** Tab bar nou cu 5 sloturi (Sumar, Evoluție, Adaugă, Chat, Setări); ecranele Conturi/Tranzacții/Categorii devin rute root pentru push real cu back button; Setări devine hub cu link-uri către ele; fix scroll formular tranzacție.

**Architecture:** Mutăm `conturi/`, `tranzactii/`, `categorii.tsx` din `(tabs)/` în rădăcină ca să fie Stack push corect din Setări (cu back). Mutăm `setari.tsx` din rădăcină în `(tabs)/`. Rescriem `(tabs)/_layout.tsx` cu noile 5 tab-uri. Tabul „Adaugă" e virtual (listener pe tabPress care face `router.push` către formular tranzacție nouă).

**Tech Stack:** Expo Router v3, React Native, TypeScript strict, Ionicons.

**Spec:** `docs/specs/2026-04-30-redesign-navigatie-design.md`

---

## File Structure (după implementare)

```
app/
├── _layout.tsx                  (root Stack — neschimbat)
├── index.tsx                    (entry — neschimbat)
├── categorii.tsx                ← mutat din (tabs)/
├── conturi/                     ← mutat din (tabs)/
│   ├── _layout.tsx
│   ├── index.tsx
│   ├── add.tsx
│   ├── edit.tsx
│   ├── import.tsx
│   └── [id].tsx
├── tranzactii/                  ← mutat din (tabs)/
│   ├── _layout.tsx
│   ├── index.tsx
│   └── [id].tsx
└── (tabs)/
    ├── _layout.tsx              ← rescris cu 5 sloturi
    ├── index.tsx                (Sumar — paths actualizate)
    ├── evolutie.tsx             (era ascuns, devine tab)
    ├── assistant.tsx            (Chat)
    └── setari.tsx               ← mutat din root + secțiune „Date"
```

Fișiere șterse: `app/setari.tsx`, `app/(tabs)/categorii.tsx`, `app/(tabs)/conturi/*`, `app/(tabs)/tranzactii/*`.

---

## Task 1: Fix scroll formular tranzacție

**Files:**

- Modify: `app/(tabs)/tranzactii/[id].tsx:253-264`

Bug-ul real: `<Pressable onPress={Keyboard.dismiss}>` wrapping ScrollView interferează cu gesture-ul de scroll când utilizatorul atinge zone non-input. `keyboardShouldPersistTaps="handled"` e deja setat. Fix: scoatem Pressable wrapper, adăugăm `keyboardDismissMode="on-drag"` pe ScrollView (utilizatorul închide tastatura prin scroll).

- [ ] **Step 1: Modifică ScrollView wrapper**

În `app/(tabs)/tranzactii/[id].tsx`, înlocuiește blocul de la linia 253 până la `</KeyboardAvoidingView>` corespunzător. Codul curent:

```tsx
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
    >
      <Stack.Screen options={{ title: editingId ? 'Editează tranzacție' : 'Tranzacție nouă' }} />
      <Pressable style={{ flex: 1 }} onPress={Keyboard.dismiss} accessible={false}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.inner}
          keyboardShouldPersistTaps="handled"
        >
```

Devine:

```tsx
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
    >
      <Stack.Screen options={{ title: editingId ? 'Editează tranzacție' : 'Tranzacție nouă' }} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.inner}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
```

Și închiderea: `</Pressable>` corespunzător scos. Caută `</Pressable>` la sfârșit (după `</ScrollView>`).

- [ ] **Step 2: Șterge importul `Pressable` dacă nu mai e folosit**

Verifică în fișier dacă `Pressable` mai e folosit altundeva (există KindButton-uri, deci probabil da). Dacă nu, scoate din import. `Keyboard` din `react-native` poate rămâne dacă se folosește altundeva; dacă nu, scoate.

Comandă verificare:

```bash
grep -n "Pressable\|Keyboard\." app/\(tabs\)/tranzactii/\[id\].tsx
```

- [ ] **Step 3: Type check**

```bash
npm run type-check
```

Expected: `0 errors`.

- [ ] **Step 4: Smoke test pe simulator**

Pornește `npm run ios`, deschide o tranzacție (Sumar → drill-down), verifică:

- Atinge un input → tastatura se deschide.
- Scroll cu degetul în zonă non-input → scrollul funcționează.
- Drag-down cu tastatura deschisă → tastatura se închide.

- [ ] **Step 5: Commit**

```bash
git add app/\(tabs\)/tranzactii/\[id\].tsx
git commit -m "fix(tranzactii): scroll funcționează cu tastatura deschisă

Înlocuiește wrapper-ul Pressable+Keyboard.dismiss cu keyboardDismissMode='on-drag'
pe ScrollView. Pressable-ul intercepta gesture-ul de scroll când user-ul atingea
zone non-input."
```

---

## Task 2: Mută `categorii.tsx` din (tabs) în root

**Files:**

- Move: `app/(tabs)/categorii.tsx` → `app/categorii.tsx`

- [ ] **Step 1: Move file**

```bash
git mv app/\(tabs\)/categorii.tsx app/categorii.tsx
```

- [ ] **Step 2: Verifică Stack.Screen header din ecran**

Deschide `app/categorii.tsx`. Linia 159 ar trebui să conțină:

```tsx
<Stack.Screen options={{ title: 'Categorii cheltuieli' }} />
```

Acesta acum se aplică la root Stack (corect — vom avea header automat la push).

- [ ] **Step 3: Type check**

```bash
npm run type-check
```

Expected: pot apărea erori de path în `(tabs)/_layout.tsx` și unde e referit `/(tabs)/categorii` — le rezolvăm la pașii următori. Notează erorile.

- [ ] **Step 4: Commit (parțial, va fi reparat în task 5)**

```bash
git add app/\(tabs\)/categorii.tsx app/categorii.tsx
git commit -m "refactor(navigatie): mută categorii.tsx din (tabs) în root

Categorii nu mai e tab; e accesat din Setări via push pe root Stack
ca să aibă back button funcțional."
```

---

## Task 3: Mută `conturi/` din (tabs) în root și actualizează path-urile interne

**Files:**

- Move: `app/(tabs)/conturi/` → `app/conturi/`
- Modify: `app/conturi/index.tsx`, `app/conturi/add.tsx`, `app/conturi/[id].tsx`

- [ ] **Step 1: Move folder**

```bash
git mv app/\(tabs\)/conturi app/conturi
```

- [ ] **Step 2: Înlocuiește `/(tabs)/conturi` → `/conturi` și `/(tabs)/tranzactii` → `/tranzactii` în fișierele mutate**

În `app/conturi/index.tsx:132`:

```tsx
onPress={() => router.push('/(tabs)/conturi/add')}
```

Devine:

```tsx
onPress={() => router.push('/conturi/add')}
```

În `app/conturi/index.tsx:152`:

```tsx
onPress={() => router.push(`/(tabs)/conturi/${account.id}` as const)}
```

Devine:

```tsx
onPress={() => router.push(`/conturi/${account.id}` as const)}
```

În `app/conturi/add.tsx:75`:

```tsx
else router.replace('/(tabs)/conturi');
```

Devine:

```tsx
else router.replace('/conturi');
```

În `app/conturi/[id].tsx`, înlocuiește toate ocurențele:

- linia 139: `'/(tabs)/conturi'` → `'/conturi'`
- linia 271: `pathname: '/(tabs)/tranzactii/[id]'` → `pathname: '/tranzactii/[id]'`
- linia 287: `pathname: '/(tabs)/conturi/import'` → `pathname: '/conturi/import'`
- linia 411: `pathname: '/(tabs)/tranzactii/[id]'` → `pathname: '/tranzactii/[id]'`
- linia 423: `pathname: '/(tabs)/conturi/edit'` → `pathname: '/conturi/edit'`
- linia 470: `pathname: '/(tabs)/tranzactii/[id]'` → `pathname: '/tranzactii/[id]'`

Comandă rapidă de verificare după edit:

```bash
grep -rn "/(tabs)/\(conturi\|tranzactii\)" app/conturi/
```

Expected: `0 matches` (toate înlocuite).

- [ ] **Step 3: Type check**

```bash
npm run type-check
```

Expected: erori pot persista în Sumar (nu am ajuns acolo) — rezolvate în Task 5.

- [ ] **Step 4: Commit**

```bash
git add app/\(tabs\)/conturi app/conturi
git commit -m "refactor(navigatie): mută conturi/ din (tabs) în root

Update path-uri interne din /(tabs)/conturi → /conturi și /(tabs)/tranzactii → /tranzactii
în fișierele mutate. Sumar și layout-ul tabs urmează în task-uri separate."
```

---

## Task 4: Mută `tranzactii/` din (tabs) în root și actualizează path-urile interne

**Files:**

- Move: `app/(tabs)/tranzactii/` → `app/tranzactii/`
- Modify: `app/tranzactii/index.tsx`

- [ ] **Step 1: Move folder**

```bash
git mv app/\(tabs\)/tranzactii app/tranzactii
```

- [ ] **Step 2: Înlocuiește `/(tabs)/tranzactii` → `/tranzactii` în fișierele mutate**

În `app/tranzactii/index.tsx:43`:

```tsx
pathname: '/(tabs)/tranzactii/[id]',
```

Devine:

```tsx
pathname: '/tranzactii/[id]',
```

În `app/tranzactii/index.tsx:76`:

```tsx
onPress={() => router.push({ pathname: '/(tabs)/tranzactii/[id]', params: { id: 'new' } })}
```

Devine:

```tsx
onPress={() => router.push({ pathname: '/tranzactii/[id]', params: { id: 'new' } })}
```

`app/tranzactii/[id].tsx` — caută orice `/(tabs)/`:

```bash
grep -n "/(tabs)/" app/tranzactii/\[id\].tsx
```

Dacă apar referințe (probabil nu), înlocuiește-le. Probabil 0.

Verificare finală:

```bash
grep -rn "/(tabs)/tranzactii" app/tranzactii/
```

Expected: 0.

- [ ] **Step 3: Type check**

```bash
npm run type-check
```

- [ ] **Step 4: Commit**

```bash
git add app/\(tabs\)/tranzactii app/tranzactii
git commit -m "refactor(navigatie): mută tranzactii/ din (tabs) în root

Update path-uri interne. Drilldown din Sumar urmează în Task 5."
```

---

## Task 5: Actualizează path-urile în Sumar (`app/(tabs)/index.tsx`)

**Files:**

- Modify: `app/(tabs)/index.tsx` (linii multiple)

- [ ] **Step 1: Înlocuiește toate path-urile**

Înlocuiri exacte (verifică cu grep înainte și după):

| Linia | Vechi                                 | Nou                            |
| ----- | ------------------------------------- | ------------------------------ |
| 156   | `'/(tabs)/conturi/add'`               | `'/conturi/add'`               |
| 165   | `pathname: '/(tabs)/conturi/import'`  | `pathname: '/conturi/import'`  |
| 173   | `pathname: '/(tabs)/conturi/import'`  | `pathname: '/conturi/import'`  |
| 188   | `pathname: '/(tabs)/conturi/import'`  | `pathname: '/conturi/import'`  |
| 196   | `'/(tabs)/conturi'`                   | `'/conturi'`                   |
| 356   | `'/(tabs)/conturi'`                   | `'/conturi'`                   |
| 367   | `'/(tabs)/categorii'`                 | `'/categorii'`                 |
| 467   | `pathname: '/(tabs)/tranzactii/[id]'` | `pathname: '/tranzactii/[id]'` |
| 483   | `pathname: '/(tabs)/tranzactii/[id]'` | `pathname: '/tranzactii/[id]'` |
| 594   | `pathname: '/(tabs)/tranzactii/[id]'` | `pathname: '/tranzactii/[id]'` |

- [ ] **Step 2: Verifică zero ocurențe**

```bash
grep -n "/(tabs)/\(conturi\|tranzactii\|categorii\)" app/\(tabs\)/index.tsx
```

Expected: nimic.

- [ ] **Step 3: Type check + lint**

```bash
npm run type-check && npm run lint
```

Expected: `0 errors`.

- [ ] **Step 4: Commit**

```bash
git add app/\(tabs\)/index.tsx
git commit -m "refactor(sumar): actualizează path-uri către conturi/tranzactii/categorii root"
```

---

## Task 6: Mută `setari.tsx` din root în (tabs)

**Files:**

- Move: `app/setari.tsx` → `app/(tabs)/setari.tsx`

- [ ] **Step 1: Move file**

```bash
git mv app/setari.tsx app/\(tabs\)/setari.tsx
```

- [ ] **Step 2: Verifică Stack.Screen din ecran**

Deschide `app/(tabs)/setari.tsx` linia ~389:

```tsx
<Stack.Screen
  options={{
    headerShown: true,
    title: 'Setări',
    ...
  }}
/>
```

Aceste opțiuni se aplică pe ruta `(tabs)/setari` în Tabs navigator-ul. Va fi suprapusă de configurarea Tabs.Screen din `_layout.tsx` (rescris în Task 7), unde `headerShown: false` la nivel global, header gestionat de tab bar. **Verifică că tabul pentru setări își afișează header-ul** după Task 7.

Notă: dacă Tabs ascunde header-ul, păstrează `<Stack.Screen>` — nu strică, dar e ineficient. Decizie post-test în Task 7.

- [ ] **Step 3: Verifică referințele `/setari` din alte fișiere**

```bash
grep -rn "router.push.*['\\\"]/setari['\\\"]" app/
```

Locații cunoscute: `app/(tabs)/assistant.tsx:122, 195`, `app/(tabs)/index.tsx:212`. Path-ul `/setari` rămâne valid pentru că grupul `(tabs)` e transparent în URL-ul expo-router. **Nu modifica nimic** dacă path-urile sunt deja `'/setari'`.

Verifică cu:

```bash
grep -n "['\\\"]/setari['\\\"]" app/\(tabs\)/assistant.tsx app/\(tabs\)/index.tsx
```

Expected: tot `/setari` (fără modificări necesare).

- [ ] **Step 4: Type check**

```bash
npm run type-check
```

- [ ] **Step 5: Commit**

```bash
git add app/setari.tsx app/\(tabs\)/setari.tsx
git commit -m "refactor(navigatie): mută setari.tsx în (tabs) ca tab dedicat"
```

---

## Task 7: Rescrie `app/(tabs)/_layout.tsx` cu noile 5 tab-uri

**Files:**

- Replace: `app/(tabs)/_layout.tsx`

- [ ] **Step 1: Înlocuiește conținutul fișierului**

```tsx
import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { router } from 'expo-router';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

export default function TabLayout() {
  const scheme = useColorScheme() ?? 'light';
  const palette = Colors[scheme];

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: palette.tint,
        tabBarStyle: { backgroundColor: palette.background, borderTopColor: palette.border },
        headerStyle: { backgroundColor: palette.background },
        headerTitleStyle: { color: palette.text },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Sumar',
          tabBarIcon: ({ color }) => <Ionicons name="pie-chart" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="evolutie"
        options={{
          title: 'Evoluție',
          tabBarIcon: ({ color }) => <Ionicons name="trending-up" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="adauga"
        options={{
          title: 'Adaugă',
          tabBarIcon: ({ color }) => <Ionicons name="add-circle" size={28} color={color} />,
        }}
        listeners={{
          tabPress: e => {
            e.preventDefault();
            router.push({ pathname: '/tranzactii/[id]', params: { id: 'new' } });
          },
        }}
      />
      <Tabs.Screen
        name="assistant"
        options={{
          title: 'Chat',
          tabBarIcon: ({ color }) => <Ionicons name="chatbubbles" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="setari"
        options={{
          title: 'Setări',
          tabBarIcon: ({ color }) => <Ionicons name="settings" size={22} color={color} />,
        }}
      />
    </Tabs>
  );
}
```

Notă: nu mai există declarații pentru `conturi`, `tranzactii`, `categorii` (au fost mutate în root, nu mai sunt copii ai grupului `(tabs)`).

- [ ] **Step 2: Creează ecran placeholder pentru tabul `adauga`**

Tabs.Screen necesită un fișier corespondent. Creează `app/(tabs)/adauga.tsx` cu un component minimalist (nu va fi afișat — listenerul previne navigarea):

```tsx
import { View } from 'react-native';

// Placeholder pentru tabul „Adaugă". Listenerul din _layout.tsx
// previne navigarea efectivă către acest ecran și deschide formularul
// de tranzacție nouă.
export default function AdaugaPlaceholder() {
  return <View />;
}
```

- [ ] **Step 3: Type check + lint**

```bash
npm run type-check && npm run lint
```

Expected: `0 errors`.

- [ ] **Step 4: Smoke test pe simulator**

Pornește `npm run ios`. Verifică:

- Tab bar afișează 5 sloturi: Sumar, Evoluție, Adaugă, Chat, Setări.
- Tap pe Sumar → ecran Sumar.
- Tap pe Evoluție → ecran Evoluție (era ascuns).
- Tap pe Adaugă → deschide formular tranzacție nouă, tabul activ rămâne cel anterior; back închide formularul.
- Tap pe Chat → ecran asistent.
- Tap pe Setări → ecran setări (cu header).
- Din Sumar, drill pe categorie → tranzacție individuală → back funcționează.
- Din Sumar, butonul „Conturi" → ecran conturi cu back button.
- Din Sumar, butonul „Categorii" → ecran categorii cu back button.

- [ ] **Step 5: Commit**

```bash
git add app/\(tabs\)/_layout.tsx app/\(tabs\)/adauga.tsx
git commit -m "feat(navigatie): tab bar cu 5 sloturi + tab Adaugă cu listener

- Sumar | Evoluție | Adaugă | Chat | Setări
- Evoluție iese din 'href: null' și devine vizibil
- Tabul Adaugă deschide formularul tranzacție nouă fără a schimba tabul activ
- assistant rămâne rută; afișat ca 'Chat'"
```

---

## Task 8: Adaugă secțiunea „Date" în `app/(tabs)/setari.tsx`

**Files:**

- Modify: `app/(tabs)/setari.tsx`

- [ ] **Step 1: Adaugă import `router`**

În `app/(tabs)/setari.tsx`, lângă `import { Stack } from 'expo-router';`, asigură import-ul:

```tsx
import { Stack, router } from 'expo-router';
```

- [ ] **Step 2: Inserează secțiunea „Date" la începutul ScrollView-ului**

Caută blocul `<View style={styles.section}>` cu titlul „Backup & restaurare" (linia ~400). **Imediat înainte** de el, inserează:

```tsx
<View style={styles.section}>
  <Text style={[styles.sectionTitle, { color: C.text }]}>Date</Text>

  <Pressable
    onPress={() => router.push('/conturi')}
    style={({ pressed }) => [
      styles.linkRow,
      { backgroundColor: C.card, borderColor: C.border, opacity: pressed ? 0.85 : 1 },
    ]}
  >
    <Ionicons name="wallet" size={20} color={C.tint} />
    <Text style={[styles.linkLabel, { color: C.text }]}>Conturi</Text>
    <Ionicons name="chevron-forward" size={18} color={C.textSecondary} />
  </Pressable>

  <Pressable
    onPress={() => router.push('/categorii')}
    style={({ pressed }) => [
      styles.linkRow,
      { backgroundColor: C.card, borderColor: C.border, opacity: pressed ? 0.85 : 1 },
    ]}
  >
    <Ionicons name="pricetags" size={20} color={C.tint} />
    <Text style={[styles.linkLabel, { color: C.text }]}>Categorii</Text>
    <Ionicons name="chevron-forward" size={18} color={C.textSecondary} />
  </Pressable>

  <Pressable
    onPress={() => router.push('/tranzactii')}
    style={({ pressed }) => [
      styles.linkRow,
      { backgroundColor: C.card, borderColor: C.border, opacity: pressed ? 0.85 : 1 },
    ]}
  >
    <Ionicons name="list" size={20} color={C.tint} />
    <Text style={[styles.linkLabel, { color: C.text }]}>Toate tranzacțiile</Text>
    <Ionicons name="chevron-forward" size={18} color={C.textSecondary} />
  </Pressable>
</View>
```

- [ ] **Step 3: Adaugă stilurile `linkRow` și `linkLabel`**

În obiectul `styles` (la sfârșitul fișierului, după `buttonText: { ... }`), adaugă:

```tsx
linkRow: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 12,
  paddingHorizontal: 14,
  paddingVertical: 14,
  borderRadius: radius.md,
  borderWidth: StyleSheet.hairlineWidth,
  marginBottom: 8,
},
linkLabel: {
  flex: 1,
  fontSize: 15,
  fontWeight: '500',
},
```

`radius.md` și `StyleSheet` sunt deja importate; verifică.

- [ ] **Step 4: Type check + lint**

```bash
npm run type-check && npm run lint
```

Expected: `0 errors`.

- [ ] **Step 5: Smoke test**

În simulator:

- Tap pe Setări → vezi secțiunea „Date" sus, înainte de „Backup & restaurare".
- Tap pe Conturi → push ecran conturi cu back button → back întoarce la Setări.
- Tap pe Categorii → idem.
- Tap pe „Toate tranzacțiile" → idem.

- [ ] **Step 6: Commit**

```bash
git add app/\(tabs\)/setari.tsx
git commit -m "feat(setari): secțiune 'Date' cu link-uri către Conturi, Categorii, Tranzacții

Setări devine hub pentru ecranele de management date care au fost scoase
din tab bar."
```

---

## Task 9: Verificare finală + actualizare docs

**Files:**

- Modify: `docs/IDEAS.md`, eventual `docs/ARCHITECTURE.md`

- [ ] **Step 1: Rulează lanțul complet de verificare**

```bash
npm run check
```

Expected: lint + type-check + type-coverage + test + knip + madge + dep-cruise + audit toate ✅.

Dacă knip raportează export-uri unused din vreun fișier mutat, șterge-le. Dacă madge raportează dependențe circulare, investighează (puțin probabil).

- [ ] **Step 2: Verificare manuală completă pe iOS simulator**

Checklist:

- [ ] App pornește, pe Sumar.
- [ ] Tab bar 5 sloturi: Sumar, Evoluție, Adaugă, Chat, Setări.
- [ ] Sumar → Import extras (din lista accounts) → flow funcționează.
- [ ] Sumar → drill pe categorie → tap pe tranzacție → editor; back funcționează.
- [ ] Sumar → buton Conturi → listă conturi cu back; tap pe cont → detaliu cu back.
- [ ] Sumar → buton Categorii → ecran categorii cu back.
- [ ] Evoluție afișează grafic.
- [ ] Adaugă deschide formular nou; salvare → revine în tabul de unde am pornit; back funcționează.
- [ ] Chat afișează asistent; gear icon din chat → setări (push pe root Stack).
- [ ] Setări → Date → Conturi/Categorii/Toate tranzacțiile, fiecare cu back.
- [ ] Setări → Backup, AI, Onboarding etc. — funcționează ca înainte.
- [ ] Formular tranzacție: tastatura nu blochează scroll; drag închide tastatura.
- [ ] Test dark mode rapid (toggle theme în Setări dacă există).

- [ ] **Step 3: Actualizează `docs/IDEAS.md`**

Adaugă sub roadmap (sau marchează completat dacă e listat) o linie:

```
- [x] Redesign navigație: tab bar cu 5 sloturi orientat pe evoluție; Conturi/Categorii/Tranzacții mutate în Setări (hub) — 2026-04-30.
```

Dacă topicul nu e în IDEAS, adaugă-l în secțiunea cu lucrări finalizate.

- [ ] **Step 4: Verifică `docs/ARCHITECTURE.md`**

Caută secțiunea care descrie structura `app/`. Dacă enumerează ecranele tab, actualizează lista. Dacă nu intră în detalii granulare, lasă neschimbat.

```bash
grep -n "tabs\|Tabs\|conturi\|tranzactii\|categorii" docs/ARCHITECTURE.md
```

Editează după caz.

- [ ] **Step 5: Verifică `landing/`**

```bash
grep -rn "tab\|Conturi\|Categorii" landing/ | head -20
```

Dacă landing menționează tab-uri specifice, ajustează. Dacă vorbește generic („listă tranzacții", „categorii cheltuieli"), nu schimba.

- [ ] **Step 6: Verifică `CLAUDE.md`**

Convențiile de cod nu se schimbă. Dacă există referințe la layout-ul tab vechi, ajustează. Probabil nimic.

- [ ] **Step 7: Commit final docs**

```bash
git add docs/IDEAS.md docs/ARCHITECTURE.md landing/ CLAUDE.md
git commit -m "docs: redesign navigație finalizat — actualizare IDEAS și docs adiacente"
```

(Dacă vreun fișier nu a fost modificat, exclude-l din `git add`.)

---

## Observații finale

- **Sequence-ul e important.** Task 2-6 lasă temporar codul cu erori de path; type-check va trece complet doar după Task 5. E acceptabil între commit-uri parțiale dar branch-ul ar trebui finalizat în aceeași sesiune.
- **Pre-commit hooks:** lint-staged + type-check rulează pe fiecare commit. Dacă Task 3 commit are erori type-check (din Sumar), commit-ul va fi blocat. În acest caz, fă Task 3+5 (sau 4+5) într-un singur commit logic, sau ajustează Sumar mai devreme.
- **Pattern alternativ pentru Task 3-5:** dacă pre-commit blochează parțial, combină Task 3 + Task 4 + Task 5 într-un singur commit „mută conturi/tranzactii/categorii în root + actualizează toate path-urile". Mesajul de commit va fi mai mare dar fluxul mai stabil.
- Nu introducem teste noi: schimbarea e structurală pe UI, nu pe servicii. Convenția proiectului e că UI-ul e validat manual + lint/type-check/knip/dep-cruise.
