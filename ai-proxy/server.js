import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { config, assertConfigured } from './config.js';
import { checkAndCount, release, stats } from './limits.js';
import { buildUpstreamPayload, countingKeysFrom } from './validate.js';

/**
 * Proxy AI pentru Finanțe Personale.
 *
 * Expune un singur endpoint compatibil OpenAI, ca aplicația să-l poată folosi
 * schimbând doar URL-ul de bază: POST /v1/chat/completions.
 *
 * PRINCIPIU DE CONFIDENȚIALITATE: nu logăm NICIODATĂ prompturi, mesaje sau
 * răspunsuri. Prin serviciul ăsta trec extrase bancare: nume, IBAN-uri, sume.
 * Logurile conțin doar status, model și durată. Testul „conținutul mesajelor
 * nu apare niciodată în log" păzește regula.
 */

function send(res, status, obj, extraHeaders = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

/** Format de eroare compatibil OpenAI — aplicația citește response.text(). */
const errorBody = message => ({ error: { message, type: 'proxy_error' } });

/**
 * Citește corpul cu plafon. La depășire NU tăiem conexiunea imediat: aplicația
 * trebuie să primească efectiv 413, ca să-i poată spune userului că extrasul e
 * prea mare. O conexiune tăiată ar apărea ca eroare de rețea, fără explicație.
 * Peste de 4 ori plafonul e abuz evident: acolo tăiem.
 */
function readBody(req, limitBytes) {
  const hardCap = limitBytes * 4;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    // `aborted` = conexiunea e deja închisă, nu mai avem cui răspunde. Nu ne
    // bazăm pe `req.destroyed`: Node distruge automat cererea după `end`, deci
    // ar fi `true` și pe calea normală, iar 413 n-ar mai pleca niciodată.
    const aborted = message => Object.assign(new Error(message), { aborted: true });
    req.on('data', chunk => {
      size += chunk.length;
      if (size > hardCap) {
        req.destroy();
        reject(aborted('Corp peste plafonul dur.'));
        return;
      }
      if (size <= limitBytes) chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > limitBytes) {
        reject(Object.assign(new Error('Cerere prea mare.'), { status: 413 }));
      } else {
        resolve(Buffer.concat(chunks));
      }
    });
    req.on('error', () => reject(aborted('Eroare la citirea cererii.')));
    req.on('close', () => {
      if (!req.complete) reject(aborted('Conexiune întreruptă.'));
    });
  });
}

/** Comparație în timp constant, ca token-ul să nu poată fi ghicit caracter cu caracter. */
function tokenMatches(supplied, expected) {
  if (!expected) return false;
  const a = Buffer.from(supplied, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function bearerFrom(req) {
  const auth = req.headers.authorization;
  return typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : '';
}

function isAuthorized(req) {
  return tokenMatches(bearerFrom(req), config.appToken);
}

async function handleCompletions(req, res) {
  if (!isAuthorized(req)) {
    // Doar NUMELE header-elor primite — niciodată valorile. Ajută la
    // diagnosticarea cazului în care platforma filtrează un header.
    console.log(`[auth] respins; headere primite: ${Object.keys(req.headers).join(',')}`);
    return send(res, 401, errorBody('Neautorizat.'));
  }

  let raw;
  try {
    raw = await readBody(req, config.maxBodyBytes);
  } catch (e) {
    if (e && e.aborted) return;
    const status = e && e.status === 413 ? 413 : 400;
    return send(res, status, errorBody(status === 413 ? 'Cerere prea mare.' : 'Corp invalid.'), {
      Connection: 'close',
    });
  }

  let body;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    return send(res, 400, errorBody('JSON invalid.'));
  }

  const built = buildUpstreamPayload(body, config);
  if (!built.ok) return send(res, built.status, errorBody(built.message));

  // Rolul cerut de aplicație (numele din bundle) vs modelul chemat efectiv.
  // Când sunt diferite, logăm ambele — altfel maparea e invizibilă la debug.
  const modelLabel =
    built.payload.model === body.model
      ? built.payload.model
      : `${body.model}->${built.payload.model}`;

  const keys = countingKeysFrom(req, config);
  const gate = checkAndCount(keys, config);
  if (!gate.ok) {
    // Aplicația traduce 429 în mesajul de limită zilnică + hint pentru cheie proprie.
    return send(
      res,
      429,
      errorBody(
        gate.scope === 'device'
          ? `Ai atins limita de ${config.perDeviceDailyLimit} interogări pe zi.`
          : gate.scope === 'ip'
            ? 'Prea multe cereri din rețeaua ta. Încearcă mai târziu.'
            : 'Serviciul a atins plafonul zilnic. Încearcă mâine.'
      )
    );
  }

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.upstreamTimeoutMs);

  try {
    const upstream = await fetch(`${config.upstreamUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(built.payload),
      signal: controller.signal,
    });

    const text = await upstream.text();
    console.log(`[ai] model=${modelLabel} status=${upstream.status} ms=${Date.now() - started}`);

    // Doar căderile providerului întorc cota (5xx aici, timeout/rețea în `catch`).
    // Un 4xx e o cerere servită: dacă l-am ierta, cine trimite constant un payload
    // pe care providerul îl refuză (422) sau nimerește un `MODEL_MAP` greșit (404)
    // ar avea cotă nelimitată — inclusiv pe plafonul global. Consecința asumată:
    // dacă *cheia noastră* e invalidă (401/403 → 503), cererile consumă cota
    // userului până reparăm cheia; e vizibil în loguri și nu poate fi provocat
    // de client.
    if (upstream.status >= 500) release(keys);

    // Un 401/403 de la provider înseamnă că NOI avem o problemă de cont: cheia
    // de pe container e ștearsă, expirată sau fără drepturi. Transmis ca atare,
    // userul ar fi trimis să repare o cheie care nu e a lui și pe care n-o vede.
    // Îl raportăm ca 503 (indisponibilitate temporară). Statusul real rămâne în
    // loguri, mai sus.
    if (upstream.status === 401 || upstream.status === 403) {
      return send(res, 503, errorBody('Serviciul AI inclus e indisponibil momentan.'));
    }

    // Un 429 de la provider e limita CONTULUI NOSTRU, nu a userului. Lăsat ca
    // 429, aplicația i-ar spune userului „ai atins limita zilnică" — exact
    // mesajul greșit, fiindcă cota lui e neatinsă. 503 spune adevărul.
    if (upstream.status === 429) {
      return send(
        res,
        503,
        errorBody('Serviciul AI inclus e indisponibil momentan: providerul a limitat cererile.')
      );
    }

    res.writeHead(upstream.status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(text);
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    console.log(`[ai] model=${modelLabel} status=err ms=${Date.now() - started}`);
    release(keys);
    send(
      res,
      aborted ? 504 : 502,
      errorBody(aborted ? 'Providerul AI nu a răspuns la timp.' : 'Providerul AI nu e disponibil.')
    );
  } finally {
    clearTimeout(timer);
  }
}

export const server = http.createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0].replace(/\/+$/, '') || '/';

  if (req.method === 'GET' && (url === '/health' || url === '/')) {
    // Fără token: doar „serviciul răspunde". Contoarele (câte device-uri au
    // cerut azi) sunt informație despre utilizare, nu despre sănătate.
    return send(res, 200, isAuthorized(req) ? { ok: true, ...stats() } : { ok: true });
  }
  if (req.method === 'POST' && (url === '/v1/chat/completions' || url === '/chat/completions')) {
    return void handleCompletions(req, res);
  }
  send(res, 404, errorBody('Endpoint inexistent.'));
});

if (process.env.NODE_ENV !== 'test') {
  assertConfigured();
  server.listen(config.port, () => {
    console.log(`[ai] proxy pornit pe :${config.port}`);
  });
}
