# finante-ai-proxy

Proxy OpenAI-compatible între aplicația Finanțe Personale și providerul AI (Mistral). Ține cheia
providerului pe server, nu în bundle-ul din App Store.

**De ce există:** orice `EXPO_PUBLIC_*` ajunge compilat în binarul publicat. Cheia Mistral care
stătea acolo era extractibilă. Era aceeași cheie ca în Dosar, unde a fost abuzată (rate limit
permanent, 2026-09-07). Proxy-ul mută cheia pe server, iar aplicația primește doar un URL și un
token de aplicație.

Codul pornește din `documents/app/ai-proxy` (Dosar). Diferențele sunt la „Ce e diferit față de
Dosar".

## Ce face

Un singur endpoint: `POST /v1/chat/completions`, compatibil OpenAI, aceeași formă pe care
`services/aiProvider.ts` o trimitea deja providerului.

| Protecție                             | Unde          | Ce oprește                                                                              |
| ------------------------------------- | ------------- | --------------------------------------------------------------------------------------- |
| Cheia doar în env server              | `config.js`   | extragerea cheii din bundle                                                             |
| Token de aplicație obligatoriu        | `server.js`   | `curl` trivial pe URL-ul găsit; comparat în timp constant                               |
| Whitelist cu un singur model          | `validate.js` | rularea de modele scumpe pe contul nostru                                               |
| Payload reconstruit, nu releat        | `validate.js` | parametri strecurați (`n`, `tools`, `stream`, roluri `tool`)                            |
| Mesaje reconstruite, doar text        | `validate.js` | blocuri `image_url`/`document_url` cu URL-uri arbitrare, `name`, `prefix`, `tool_calls` |
| Plafon `max_tokens`, corp, mesaje     | `validate.js` | cereri uriașe                                                                           |
| Limită/zi per device, per IP, globală | `limits.js`   | abuz repetat, inclusiv cu header de device schimbat                                     |
| Mapare de modele                      | `validate.js` | schimbarea providerului fără release în App Store                                       |
| Timeout + 502/504/503 curate          | `server.js`   | cereri agățate; userul trimis să repare o cheie care nu e a lui                         |

**Nu logăm prompturi, mesaje sau răspunsuri.** Prin serviciu trec extrase bancare (nume, IBAN-uri,
sume). Logurile conțin doar model, status și durată. Un test păzește regula.

**Ce trece prin proxy:** doar text (chat, mapare extrase CSV/text, categorii). Trimiterea PDF-ului
ca imagini (vision) e permisă în aplicație doar cu cheie API proprie, direct la providerul userului.

## Ce e diferit față de Dosar

- **Token-ul se primește doar ca `Authorization: Bearer`.** `X-Dosar-Key` nu mai e acceptat.
  Contorizarea citește `X-App-Device`.
- **Fără `PROXY_APP_TOKEN` serviciul nu pornește.** La Dosar, token gol = verificare oprită.
- **Whitelist implicit:** doar `mistral-small-latest`, singurul model folosit de Finanțe.
- **Roluri permise:** doar `system`, `user`, `assistant`.
- **Depășirea de corp întoarce efectiv 413.** Varianta din Dosar tăia conexiunea, iar clientul
  vedea o eroare de rețea. Tăiem doar peste de 4 ori plafonul.
- **Mesajele se reconstruiesc.** La Dosar, `messages` erau relayate ca atare, deci treceau blocuri
  `image_url` cu URL-uri arbitrare și câmpuri ca `name` / `prefix` / `tool_calls`. Aici fiecare
  mesaj devine `{ role, content }`, iar `content` trebuie să fie text.
- **Limită și per IP**, nu doar per device: header-ul `X-App-Device` poate fi schimbat de cine
  extrage token-ul, deci singur nu limitează nimic.
- **Un 429 de la provider devine 503.** Lăsat ca 429, aplicația i-ar spune userului „ai atins
  limita zilnică", deși limita atinsă e a contului nostru.
- **Căderile providerului nu consumă cota userului** (`release` în `limits.js`): doar 5xx,
  timeout și erori de rețea. Un 4xx e o cerere servită — iertat, ar da cotă nelimitată cui
  trimite constant un payload refuzat.
- **`X-Forwarded-For` e ignorat implicit.** Header-ul e scris de client, iar platformele adaugă
  adresa reală la coadă: cine citește primul element îi lasă clientului dreptul să-și aleagă
  găleata. Verifică ce trimite Rapids și pune `TRUSTED_PROXY_HOPS=1` (sau câți proxy sunt);
  altfel contorizarea merge pe adresa socket-ului.

> **Pe Knative (Rapids), găleata per IP e practic una singură.** Containerul primește conexiuni
> de la queue-proxy, peste loopback (`dial tcp 127.0.0.1:8080` în loguri la pornire), deci
> `req.socket.remoteAddress` e același pentru toți utilizatorii. Consecința: cu
> `PER_IP_DAILY_LIMIT` mic, userii legitimi se blochează reciproc. Până verifici forma reală a
> lui `X-Forwarded-For` (și pui `TRUSTED_PROXY_HOPS`), ține `PER_IP_DAILY_LIMIT` egal cu
> `GLOBAL_DAILY_LIMIT` — adică inert — și bazează-te pe plafonul per device și pe cel global.
>
> Ca să verifici forma: setează temporar `PER_IP_DAILY_LIMIT=1` și trimite două cereri cu
> `X-App-Device` diferite. Dacă a doua primește 429 „din rețeaua ta", toate cererile chiar cad
> în aceeași găleată.

- **`/health` nu expune contoarele** fără token; rămâne doar `{ ok: true }`.
- **Plafoane implicite:** 20 de cereri/zi per device (= `DAILY_AI_LIMIT` din app), 60/zi per IP,
  1.000/zi global, corp maxim 2 MB, maxim 40 de mesaje pe cerere.
- **Test nou:** conținutul cererilor și al răspunsurilor nu apare în log, nici pe căile de eroare.

## Rulare locală

```bash
cd ai-proxy
cp .env.example .env    # completează AI_UPSTREAM_API_KEY și PROXY_APP_TOKEN
npm test                # fără rețea, providerul e mock-uit
node --env-file=.env server.js
```

Din rădăcina repo-ului: `npm run test:proxy` (rulat și de `npm run check`).

Verificare rapidă:

```bash
curl -s localhost:8080/health

curl -s localhost:8080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $PROXY_APP_TOKEN" \
  -H 'X-App-Device: test-device-0001' \
  -d '{"model":"mistral-small-latest","messages":[{"role":"user","content":"salut"}],"max_tokens":20}'
```

## Deploy pe Danube Rapids (free tier)

Serviciu **separat** de `dosar-ai-proxy`, cu cheie Mistral separată.

```bash
# din folderul ai-proxy/
danube rapids create --name finante-ai-proxy \
  --type local --source-type dockerfile \
  --port 8080 --profile free --min-scale 0 --max-scale 3 --wait

# `create` nu are --env: variabilele se pun separat, înainte de deploy
danube rapids update finante-ai-proxy --env \
  AI_UPSTREAM_API_KEY=<cheia Mistral nouă> \
  PROXY_APP_TOKEN=<același token ca EXPO_PUBLIC_FINANTE_AI_TOKEN> \
  GLOBAL_DAILY_LIMIT=1000 PER_IP_DAILY_LIMIT=60

danube rapids deploy finante-ai-proxy --dir .
```

**Variabile de mediu pe container** (`AI_UPSTREAM_API_KEY` și `PROXY_APP_TOKEN` ca _secrete_):

```
AI_UPSTREAM_API_KEY=<cheie Mistral NOUĂ, dedicată Finanțe>
PROXY_APP_TOKEN=<openssl rand -hex 24>
GLOBAL_DAILY_LIMIT=<plafonul de cheltuială Mistral / costul mediu al unei cereri>
PER_IP_DAILY_LIMIT=60
```

> Flag-ul exact pentru env/secrets îl dă `danube rapids create --help` sau dashboard-ul. Verifică
> înainte de deploy că secretele sunt marcate ca secrete.
>
> De verificat în dashboard: free tier-ul e per cont sau per serviciu? Dacă e per cont, proxy-ul
> Finanțe împarte cota cu cel al Dosar.

După deploy primești `https://finante-ai-proxy-<namespace>.danubedata.run` (namespace-ul e cel din
`danube whoami`; HTTP-ul face redirect la HTTPS). Verifică pe el, înainte de a atinge aplicația:
`/health` → `{"ok":true}`, cerere validă → 200, fără token → 401, `mistral-large-latest` → 403.

Verificarea se face cu **GET**, nu `curl -I`: proxy-ul răspunde doar la GET, deci un HEAD întoarce
404 și pare o eroare care nu există.

Utile după deploy: `danube rapids logs finante-ai-proxy` (doar model, status, durată — niciodată
conținut), `danube rapids diagnose finante-ai-proxy` când un revision nu pornește.

## Wiring în aplicație

Deja făcut în `services/aiProvider.ts`. Aplicația citește la build:

```
EXPO_PUBLIC_FINANTE_AI_URL=https://<subdomeniu>.serverless.danubedata.ro/v1
EXPO_PUBLIC_FINANTE_AI_TOKEN=<același PROXY_APP_TOKEN>
```

Fără ele, „Finanțe AI" apare ca indisponibil și userul e îndrumat spre cheie proprie. Gate-ul
`npm run check:secrets` blochează orice alt `EXPO_PUBLIC_*` cu nume de secret.

## Limitele oneste ale acestui design

1. **Token-ul de aplicație e obfuscare, nu securitate.** Ajunge în bundle, deci poate fi extras.
   Ce câștigăm real: contul providerului nu poate fi folosit în altă parte, atacatorul e închis
   pe un model, pe text și pe o cotă, iar token-ul se rotește din env. Închiderea completă cere
   App Attest (iOS) / Play Integrity: proiect separat.
2. **Cota per device se poate ocoli.** `X-App-Device` e un identificator anonim generat de
   aplicație, deci cine are token-ul îl poate schimba la fiecare cerere. De aceea numărăm și per
   IP, dar un atacator cu multe IP-uri ajunge la plafonul global — iar atunci userii legitimi
   primesc 429. Limita reală rămâne plafonul de cheltuială.
3. **Schimbarea providerului schimbă cui trimitem datele.** `AI_UPSTREAM_URL` + `MODEL_MAP` pot
   muta traficul pe alt furnizor fără release, dar `services/privacyPolicy.ts` numește explicit
   Mistral. Schimbi providerul → actualizezi politica și pagina publică
   (`npm run build:privacy`), altfel politica devine falsă.
4. **Contoarele sunt în memorie, iar Rapids e scale-to-zero.** Când containerul doarme,
   contoarele se pierd. Filtrează abuzul obișnuit, nu unul răbdător. Dacă devine o problemă:
   Valkey, cu aceeași interfață în `limits.js`.
5. **Stopul real rămâne plafonul de cheltuială din contul Mistral.** Setează-l înainte de orice.
   Tot restul reduce probabilitatea; doar plafonul mărginește paguba.

## Ordinea de rollout

1. Plafon de cheltuială în contul Mistral.
2. Cheie Mistral nouă → deploy proxy → `curl`-urile de verificare.
3. `EXPO_PUBLIC_FINANTE_AI_URL` + `EXPO_PUBLIC_FINANTE_AI_TOKEN` în `.env`; scoate
   `EXPO_PUBLIC_MISTRAL_API_KEY`. Build → TestFlight → verificare pe device → App Store.
   **Build-ul cu cache curat** (`npx expo start --clear` înainte, sau `npm run prebuild`):
   valorile `EXPO_PUBLIC_*` se inlinează la transform, iar cheia de cache Metro nu le include —
   după o rotire de token, un build pe cache vechi poate împacheta token-ul precedent și primi
   401 în producție. Verifică în bundle: `grep -c "$PROXY_APP_TOKEN" ios/**/main.jsbundle`.
4. Revocă cheia veche imediat ce e confirmat că nicio versiune Dosar în uz nu mai depinde de ea.
