/**
 * Configurare proxy — totul din env, nimic hardcodat.
 *
 * Secrete: cheia providerului și token-ul de aplicație. Restul sunt plafoane:
 * stau aici ca să le poți strânge fără redeploy de cod și, mai ales, fără
 * release în App Store.
 */

const num = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${name} trebuie să fie un număr pozitiv, am primit: ${raw}`);
  }
  return n;
};

export const config = {
  port: num('PORT', 8080),

  /**
   * Cheia providerului din spate. Numele `MISTRAL_*` rămân alias, ca o
   * redenumire de variabile în timpul unui incident să nu oprească serviciul.
   */
  apiKey: process.env.AI_UPSTREAM_API_KEY ?? process.env.MISTRAL_API_KEY ?? '',
  upstreamUrl: (
    process.env.AI_UPSTREAM_URL ??
    process.env.MISTRAL_URL ??
    'https://api.mistral.ai/v1'
  ).replace(/\/$/, ''),

  /**
   * Traducere nume de model: ce trimite aplicația → ce cere providerul.
   *
   * Aplicația publicată trimite `mistral-small-latest`, compilat în bundle.
   * Maparea permite schimbarea providerului fără release și fără ca userii să
   * actualizeze ceva. Gol = fără traducere.
   */
  modelMap: (() => {
    const raw = process.env.MODEL_MAP;
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('nu e obiect');
      }
      return parsed;
    } catch (e) {
      throw new Error(`MODEL_MAP nu e JSON valid: ${e instanceof Error ? e.message : e}`);
    }
  })(),

  /**
   * Token partajat cu aplicația, trimis ca `Authorization: Bearer`. Obfuscare,
   * NU securitate: ajunge în bundle, deci poate fi extras. Oprește apelul
   * trivial („am găsit URL-ul, dau curl") și se rotește din env, fără release.
   * Obligatoriu: fără el serviciul nu pornește (vezi `assertConfigured`).
   */
  appToken: process.env.PROXY_APP_TOKEN ?? '',

  /**
   * Modele permise, verificate pe numele PRIMIT de la aplicație. Finanțe
   * folosește un singur model, pentru text și vision (`BUILTIN_MODEL` din
   * services/aiProvider.ts). Orice altceva e 403, altfel cine extrage token-ul
   * rulează modele scumpe pe contul nostru.
   */
  allowedModels: new Set(
    (process.env.ALLOWED_MODELS ?? 'mistral-small-latest')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  ),

  /**
   * `reasoning_effort` trimis providerului. Gol = parametrul nu se trimite.
   * Contează doar pe modele care gândesc (ex. Gemini 3.x): raționamentul se
   * consumă din același `max_tokens`, iar JSON-ul de extracție iese trunchiat.
   */
  reasoningEffort: process.env.UPSTREAM_REASONING_EFFORT ?? '',

  /** Plafon dur pe max_tokens, indiferent ce cere clientul. */
  maxTokensCap: num('MAX_TOKENS_CAP', 4000),

  /**
   * Corp maxim acceptat. Prin proxy trece doar text (chat, extrase CSV/text):
   * vision e permis în aplicație doar cu cheie proprie, direct la providerul
   * userului (`mapStatementWithVisionAi`). 2 MB acoperă un extras text lung, cu
   * marjă. Peste plafon răspundem 413, pe care aplicația îl traduce pentru user.
   */
  maxBodyBytes: num('MAX_BODY_BYTES', 2 * 1024 * 1024),

  /** Cereri/zi per device. Oglindește DAILY_AI_LIMIT din services/aiProvider.ts. */
  perDeviceDailyLimit: num('PER_DEVICE_DAILY_LIMIT', 20),

  /**
   * Cereri/zi per IP, indiferent ce `X-App-Device` se declară. Header-ul poate fi
   * schimbat de cine extrage token-ul din bundle, deci fără asta limita per
   * device e decorativă. Plafonul e mai larg: pe mobil, mulți useri legitimi
   * împart un IP prin CGNAT.
   */
  perIpDailyLimit: num('PER_IP_DAILY_LIMIT', 60),

  /**
   * Câți proxy de încredere stau în fața serviciului.
   *
   * `0` (implicit) = folosim adresa socket-ului și **ignorăm** `X-Forwarded-For`.
   * Header-ul e scris de client, iar platformele adaugă adresa reală la coada
   * listei, nu la început: cine citește primul element citește exact valoarea pe
   * care o alege atacatorul, deci găleata per IP s-ar alege singură.
   *
   * Pune `1` (sau câți proxy sunt) **după** ce verifici ce trimite efectiv
   * platforma: luăm al n-lea element numărat de la coadă.
   */
  trustedProxyHops: num('TRUSTED_PROXY_HOPS', 0),

  /**
   * Plafon global de cereri/zi pentru tot serviciul. Se setează din plafonul de
   * cheltuială Mistral împărțit la costul mediu al unei cereri. Vezi limits.js.
   */
  globalDailyLimit: num('GLOBAL_DAILY_LIMIT', 1000),

  /** Timeout către provider. Vision e lent. */
  upstreamTimeoutMs: num('UPSTREAM_TIMEOUT_MS', 120_000),
};

export function assertConfigured() {
  if (!config.apiKey) {
    throw new Error('AI_UPSTREAM_API_KEY lipsește. Setează-l ca secret în Rapids.');
  }
  if (!config.appToken) {
    throw new Error('PROXY_APP_TOKEN lipsește. Generează-l cu `openssl rand -hex 24`.');
  }
}
