/**
 * Validare + construcția payload-ului trimis mai departe.
 *
 * Regula: NU releăm nimic din ce primim. Construim un payload nou, din câmpuri
 * cunoscute, inclusiv **mesajele**: fiecare mesaj se reconstruiește ca
 * `{ role, content }`. Un pass-through pe `messages` ar lăsa clientul să strecoare
 * blocuri `image_url` cu URL-uri arbitrare (vision/OCR pe contul nostru, tokeni
 * nemărginiți de plafonul pe corp), `document_url`, `tool_calls` sau `prefix`.
 */

/** Aplicația trimite doar aceste roluri. `tool` / `function` n-au ce căuta aici. */
const ALLOWED_ROLES = new Set(['system', 'user', 'assistant']);

/** Chatul trimite istoric compactat; mapper-ul de extrase, un system + un user. */
const MAX_MESSAGES = 40;

/** Un extras text lung încape confortabil; peste asta e abuz, nu utilizare. */
const MAX_CONTENT_CHARS = 400_000;

/**
 * @returns {{ ok: true, payload: object } | { ok: false, status: number, message: string }}
 */
export function buildUpstreamPayload(body, config) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, status: 400, message: 'Corp invalid: se aștepta un obiect JSON.' };
  }

  const { model, messages, max_tokens: maxTokens, temperature } = body;

  if (typeof model !== 'string' || !model) {
    return { ok: false, status: 400, message: 'Câmpul „model" lipsește.' };
  }
  if (!config.allowedModels.has(model)) {
    return { ok: false, status: 403, message: `Model nepermis: ${model}` };
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, status: 400, message: 'Câmpul „messages" lipsește sau e gol.' };
  }
  if (messages.length > MAX_MESSAGES) {
    return { ok: false, status: 400, message: 'Prea multe mesaje într-o cerere.' };
  }

  // Mesajele se reconstruiesc, nu se releează: aici cad câmpurile străine.
  const cleanMessages = [];
  for (const m of messages) {
    if (typeof m !== 'object' || m === null || !ALLOWED_ROLES.has(m.role)) {
      return { ok: false, status: 400, message: 'Mesaj invalid în „messages".' };
    }
    if (typeof m.content !== 'string') {
      // Blocurile (`image_url`, `document_url`) sunt refuzate deliberat: prin
      // serviciul ăsta trece doar text. Vision merge doar cu cheia proprie a
      // userului, direct la providerul lui.
      return {
        ok: false,
        status: 400,
        message: 'Conținut invalid: prin acest serviciu trece doar text.',
      };
    }
    if (m.content.length > MAX_CONTENT_CHARS) {
      return { ok: false, status: 400, message: 'Mesaj prea lung.' };
    }
    cleanMessages.push({ role: m.role, content: m.content });
  }

  // Plafonăm în loc să respingem: o cerere legitimă care cere prea mult trebuie
  // să reușească mai mic, nu să pice în fața userului.
  const cappedTokens = Math.min(
    Number.isFinite(maxTokens) && maxTokens > 0 ? Math.floor(maxTokens) : 500,
    config.maxTokensCap
  );

  // Whitelist-ul se aplică pe numele primit de la aplicație; traducerea spre
  // numele providerului se face DUPĂ, ca schimbarea de provider să nu deschidă
  // accidental modele neaprobate.
  const payload = {
    model: config.modelMap[model] ?? model,
    messages: cleanMessages,
    max_tokens: cappedTokens,
    stream: false,
  };
  if (Number.isFinite(temperature) && temperature >= 0 && temperature <= 2) {
    payload.temperature = temperature;
  }
  if (config.reasoningEffort) {
    payload.reasoning_effort = config.reasoningEffort;
  }

  return { ok: true, payload };
}

/**
 * Adresa clientului, pentru contorizare.
 *
 * `X-Forwarded-For` e scris de client; platformele adaugă adresa reală la
 * **coada** listei. Primul element e deci exact valoarea aleasă de atacator —
 * cine îl folosește îi lasă clientului dreptul să-și aleagă găleata. Implicit
 * folosim adresa socket-ului; `TRUSTED_PROXY_HOPS` spune câți proxy de
 * încredere stau în față, ca să luăm al n-lea element numărat de la coadă.
 */
function clientIp(req, config) {
  const hops = config?.trustedProxyHops ?? 0;
  if (hops > 0) {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string') {
      const parts = fwd
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      const index = parts.length - hops;
      if (index >= 0 && parts[index]) return parts[index];
    }
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/**
 * Cheile de contorizare: device-ul declarat de aplicație **și** IP-ul cererii.
 *
 * Header-ul `X-App-Device` e anonim și stabil per instalare, dar poate fi
 * schimbat de cine extrage token-ul din bundle — de aceea numărăm și pe IP, cu
 * un plafon mai larg (pe mobil, mulți useri legitimi împart un IP prin CGNAT).
 */
export function countingKeysFrom(req, config) {
  const header = req.headers['x-app-device'];
  const device =
    typeof header === 'string' && header.length >= 8 && header.length <= 128
      ? `d:${header}`
      : null;
  const ipKey = `ip:${clientIp(req, config)}`;
  // Fără header valid, găleata de device devine IP-ul: altfel cine omite header-ul
  // ar scăpa complet de limita per device.
  return { device: device ?? ipKey, ip: ipKey };
}
