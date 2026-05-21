import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

// ─── Limită zilnică ────────────────────────────────────────────────────────────

export const DAILY_AI_LIMIT = 20;
export const AI_CONSENT_KEY = 'ai_assistant_consent_accepted';
const KEY_DAILY_USAGE_PREFIX = 'ai_daily_usage_';
const KEY_DAILY_TOKENS_PROMPT = 'ai_daily_tokens_prompt_';
const KEY_DAILY_TOKENS_COMPLETION = 'ai_daily_tokens_completion_';
const KEY_CUMULATIVE_TOKENS_PROMPT = 'ai_cumulative_tokens_prompt';
const KEY_CUMULATIVE_TOKENS_COMPLETION = 'ai_cumulative_tokens_completion';

function todayDateKey(): string {
  return KEY_DAILY_USAGE_PREFIX + new Date().toISOString().slice(0, 10);
}

function todayTokenKey(prefix: string): string {
  return prefix + new Date().toISOString().slice(0, 10);
}

export async function getAiUsageToday(): Promise<number> {
  const v = await AsyncStorage.getItem(todayDateKey());
  return v ? parseInt(v, 10) : 0;
}

export async function incrementAiUsage(): Promise<void> {
  const key = todayDateKey();
  const current = await getAiUsageToday();
  await AsyncStorage.setItem(key, String(current + 1));
}

// ─── Token tracking (informativ, nu blochează cereri) ────────────────────────

export interface AiUsageStats {
  requestsToday: number;
  promptTokensToday: number;
  completionTokensToday: number;
  totalTokensToday: number;
  promptTokensCumulative: number;
  completionTokensCumulative: number;
  totalTokensCumulative: number;
}

async function readNumber(key: string): Promise<number> {
  const v = await AsyncStorage.getItem(key);
  const n = v ? parseInt(v, 10) : 0;
  return Number.isFinite(n) ? n : 0;
}

async function addToCounter(key: string, delta: number): Promise<void> {
  if (delta <= 0) return;
  const current = await readNumber(key);
  await AsyncStorage.setItem(key, String(current + delta));
}

/**
 * Persistă tokeni consumați. Apelat după fiecare response AI care raportează
 * `usage` (Mistral / OpenAI-compatible). Defensiv: dacă valorile lipsesc sau
 * sunt invalide, ignorăm (nu vrem să spargem fluxul real).
 */
export async function recordAiTokens(
  promptTokens: number | undefined,
  completionTokens: number | undefined
): Promise<void> {
  const pt = Number.isFinite(promptTokens) ? Math.max(0, promptTokens ?? 0) : 0;
  const ct = Number.isFinite(completionTokens) ? Math.max(0, completionTokens ?? 0) : 0;
  if (pt === 0 && ct === 0) return;
  await addToCounter(todayTokenKey(KEY_DAILY_TOKENS_PROMPT), pt);
  await addToCounter(todayTokenKey(KEY_DAILY_TOKENS_COMPLETION), ct);
  await addToCounter(KEY_CUMULATIVE_TOKENS_PROMPT, pt);
  await addToCounter(KEY_CUMULATIVE_TOKENS_COMPLETION, ct);
}

export async function getAiUsageStats(): Promise<AiUsageStats> {
  const [requestsToday, ptToday, ctToday, ptCum, ctCum] = await Promise.all([
    getAiUsageToday(),
    readNumber(todayTokenKey(KEY_DAILY_TOKENS_PROMPT)),
    readNumber(todayTokenKey(KEY_DAILY_TOKENS_COMPLETION)),
    readNumber(KEY_CUMULATIVE_TOKENS_PROMPT),
    readNumber(KEY_CUMULATIVE_TOKENS_COMPLETION),
  ]);
  return {
    requestsToday,
    promptTokensToday: ptToday,
    completionTokensToday: ctToday,
    totalTokensToday: ptToday + ctToday,
    promptTokensCumulative: ptCum,
    completionTokensCumulative: ctCum,
    totalTokensCumulative: ptCum + ctCum,
  };
}

export async function isAiLimitReached(): Promise<boolean> {
  const config = await getAiConfig();
  if (config.type !== 'builtin') return false;
  const used = await getAiUsageToday();
  return used >= DAILY_AI_LIMIT;
}

// ─── Tipuri ────────────────────────────────────────────────────────────────────

export type AiProviderType = 'none' | 'builtin' | 'external';

export interface AiProviderConfig {
  type: AiProviderType;
  url: string;
  apiKey: string;
  model: string;
}

// ─── Cheie inclusă în aplicație ───────────────────────────────────────────────

const BUILTIN_API_KEY = process.env.EXPO_PUBLIC_MISTRAL_API_KEY ?? '';
const BUILTIN_URL = 'https://api.mistral.ai/v1';
const BUILTIN_MODEL = 'mistral-small-latest';

// ─── Default-uri per provider ─────────────────────────────────────────────────

export const PROVIDER_DEFAULTS: Record<
  AiProviderType,
  { url: string; model: string; label: string }
> = {
  builtin: {
    url: BUILTIN_URL,
    model: BUILTIN_MODEL,
    label: 'Finanțe AI',
  },
  external: {
    url: '',
    model: '',
    label: 'Cheie API proprie',
  },
  none: {
    url: '',
    model: '',
    label: 'Fără AI',
  },
};

const VALID_PROVIDER_TYPES = new Set<string>(Object.keys(PROVIDER_DEFAULTS));

// ─── Chei stocare ─────────────────────────────────────────────────────────────

const KEY_PROVIDER_TYPE = 'ai_provider_type';
const KEY_PROVIDER_URL = 'ai_provider_url';
const KEY_PROVIDER_MODEL = 'ai_provider_model';
const SECURE_KEY_API_KEY = 'ai_provider_api_key';

// ─── Citire / scriere config ──────────────────────────────────────────────────

export async function getAiConfig(): Promise<AiProviderConfig> {
  const [typeRaw, urlRaw, modelRaw, apiKey] = await Promise.all([
    AsyncStorage.getItem(KEY_PROVIDER_TYPE),
    AsyncStorage.getItem(KEY_PROVIDER_URL),
    AsyncStorage.getItem(KEY_PROVIDER_MODEL),
    getAiApiKey(),
  ]);

  // Migrare valori vechi → external
  const legacyMap: Record<string, AiProviderType> = {
    mistral: 'external',
    openai: 'external',
    custom: 'external',
  };
  const rawType = typeRaw ?? 'builtin';
  const type: AiProviderType =
    legacyMap[rawType] ??
    (VALID_PROVIDER_TYPES.has(rawType) ? (rawType as AiProviderType) : 'builtin');

  // Persistă migrarea — scrie valoarea nouă în storage dacă era o valoare veche
  if (legacyMap[rawType]) {
    void AsyncStorage.setItem(KEY_PROVIDER_TYPE, type);
  }

  const defaults = PROVIDER_DEFAULTS[type];

  return {
    type,
    url: urlRaw ?? defaults.url,
    model: modelRaw ?? defaults.model,
    apiKey,
  };
}

export async function saveAiConfig(
  config: Pick<AiProviderConfig, 'type' | 'url' | 'model'>
): Promise<void> {
  await AsyncStorage.multiSet([
    [KEY_PROVIDER_TYPE, config.type],
    [KEY_PROVIDER_URL, config.url],
    [KEY_PROVIDER_MODEL, config.model],
  ]);
}

export async function getAiApiKey(): Promise<string> {
  const key = await SecureStore.getItemAsync(SECURE_KEY_API_KEY);
  return key ?? '';
}

export async function saveAiApiKey(key: string): Promise<void> {
  if (key) {
    await SecureStore.setItemAsync(SECURE_KEY_API_KEY, key);
  } else {
    await SecureStore.deleteItemAsync(SECURE_KEY_API_KEY);
  }
}

// ─── Validare config ──────────────────────────────────────────────────────────

/**
 * Validează configurația AI. Returnează un mesaj de eroare în română dacă ceva lipsește,
 * sau null dacă totul e ok pentru a face un request.
 */
export function validateConfig(config: AiProviderConfig): string | null {
  if (config.type === 'none') {
    return 'Asistentul AI este dezactivat. Activează-l din Setări → Asistent AI.';
  }
  if (config.type === 'external') {
    if (!config.url.trim()) {
      return 'URL-ul API lipsește. Verifică Setări → Asistent AI.';
    }
    if (!config.apiKey.trim()) {
      return 'Cheia API lipsește (probabil pierdută la reinstalarea aplicației). Re-introdu cheia din Setări → Asistent AI.';
    }
    if (!config.model.trim()) {
      return 'Modelul AI nu este setat. Verifică Setări → Asistent AI.';
    }
  }
  if (config.type === 'builtin' && !BUILTIN_API_KEY) {
    return 'Cheia Finanțe AI nu este disponibilă în această versiune. Setează propria cheie API din Setări → Asistent AI.';
  }
  return null;
}

/**
 * Verifică rapid dacă AI-ul e disponibil pentru a fi folosit.
 * Folosit din ecranul Chat pentru afișarea unui banner de avertizare.
 */
export async function isAiAvailable(): Promise<{ ok: boolean; reason?: string }> {
  const config = await getAiConfig();
  const err = validateConfig(config);
  return err ? { ok: false, reason: err } : { ok: true };
}

// ─── Helper fetch cu timeout ──────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 30_000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(
        `Cererea AI a expirat (>${Math.round(timeoutMs / 1000)}s). Verifică conexiunea și încearcă din nou.`
      );
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Tipuri mesaje OpenAI-compatible ─────────────────────────────────────────

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAiResponse {
  choices: { message: { content: string } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

// ─── Eroare specială: depășire context (folosită de mappers pentru fallback chunked) ─

export class AiContextOverflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiContextOverflowError';
  }
}

const OVERFLOW_PATTERNS = [
  /context.{0,20}length/i,
  /max.{0,5}tokens?/i,
  /token.{0,10}limit/i,
  /payload.{0,10}too.{0,5}large/i,
  /request.{0,10}too.{0,5}large/i,
  /too many tokens/i,
];

function isOverflowResponse(status: number, errText: string): boolean {
  if (status === 413) return true;
  if (status === 400 || status === 422) {
    return OVERFLOW_PATTERNS.some(rx => rx.test(errText));
  }
  return false;
}

// ─── Trimitere cerere AI cu imagine (vision) ──────────────────────────────────

/**
 * Trimite o cerere AI cu una sau mai multe imagini (Mistral vision / OpenAI-compatible).
 * Aruncă `AiContextOverflowError` dacă serverul răspunde cu „context length exceeded"
 * sau payload prea mare — apelantul poate decide să spargă în chunks.
 */
export async function sendAiRequestWithImage(
  systemPrompt: string,
  userText: string,
  imageBase64: string | string[],
  imageMimeType: 'image/jpeg' | 'image/png' = 'image/jpeg',
  maxTokens = 600
): Promise<string> {
  const config = await getAiConfig();

  const validationError = validateConfig(config);
  if (validationError) throw new Error(validationError);

  const apiKey = config.type === 'builtin' ? BUILTIN_API_KEY : config.apiKey;

  if (config.type === 'builtin') {
    const used = await getAiUsageToday();
    if (used >= DAILY_AI_LIMIT) {
      throw new Error(
        `Ai atins limita de ${DAILY_AI_LIMIT} interogări AI/zi cu cheia Finanțe AI.\n\nPoți folosi nelimitat configurând propria cheie API din Setări → Asistent AI.`
      );
    }
  }

  const baseUrl = (config.type === 'builtin' ? BUILTIN_URL : config.url).replace(/\/$/, '');
  const model = config.type === 'builtin' ? BUILTIN_MODEL : config.model;
  const endpoint = `${baseUrl}/chat/completions`;

  const images = Array.isArray(imageBase64) ? imageBase64 : [imageBase64];
  const imageBlocks = images.map(b64 => ({
    type: 'image_url' as const,
    image_url: { url: `data:${imageMimeType};base64,${b64}` },
  }));

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [...imageBlocks, { type: 'text', text: userText }],
        },
      ],
      max_tokens: maxTokens,
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    if (isOverflowResponse(response.status, errText)) {
      throw new AiContextOverflowError(
        `Cererea AI depășește contextul (${response.status}): ${errText.slice(0, 200) || 'context length exceeded'}`
      );
    }
    throw new Error(`Eroare AI (${response.status}): ${errText || 'Răspuns invalid de la server'}`);
  }

  const data = (await response.json()) as OpenAiResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Răspuns gol de la asistentul AI.');

  if (config.type === 'builtin') await incrementAiUsage();
  await recordAiTokens(data.usage?.prompt_tokens, data.usage?.completion_tokens);

  return content;
}

// ─── Trimitere cerere AI (OpenAI-compatible) ──────────────────────────────────

/**
 * `temperature` default 0 — toate apelantele actuale (chat SQL gen, statement
 * mapper JSON) vor răspunsuri deterministe. Pentru output narativ creativ,
 * pasează explicit `temperature: 0.3+`.
 */
export async function sendAiRequest(
  messages: AiMessage[],
  maxTokens = 500,
  temperature = 0
): Promise<string> {
  const config = await getAiConfig();

  const validationError = validateConfig(config);
  if (validationError) throw new Error(validationError);

  const apiKey = config.type === 'builtin' ? BUILTIN_API_KEY : config.apiKey;

  // Verifică limita zilnică doar pentru cheia built-in
  if (config.type === 'builtin') {
    const used = await getAiUsageToday();
    if (used >= DAILY_AI_LIMIT) {
      throw new Error(
        `Ai atins limita de ${DAILY_AI_LIMIT} interogări AI/zi cu cheia Finanțe AI.\n\nPoți folosi nelimitat configurând propria cheie API din Setări → Asistent AI.`
      );
    }
  }

  const baseUrl = (config.type === 'builtin' ? BUILTIN_URL : config.url).replace(/\/$/, '');
  const model = config.type === 'builtin' ? BUILTIN_MODEL : config.model;
  const endpoint = `${baseUrl}/chat/completions`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Eroare AI (${response.status}): ${errText || 'Răspuns invalid de la server'}`);
  }

  const data = (await response.json()) as OpenAiResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Răspuns gol de la asistentul AI.');
  }

  // Incrementează contorul zilnic (doar pentru builtin)
  if (config.type === 'builtin') {
    await incrementAiUsage();
  }
  // Token tracking — pentru toți providerii (informativ pentru external; gate
  // rămâne strict pe count requests pentru builtin).
  await recordAiTokens(data.usage?.prompt_tokens, data.usage?.completion_tokens);

  return content;
}
