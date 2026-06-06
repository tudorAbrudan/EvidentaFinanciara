/**
 * AI Category Mapper
 *
 * Categorizare batch a tranzacțiilor pe baza `merchant` + `description` deja
 * stocate (nu re-citește extrasul). Folosit la re-analiză pentru tranzacțiile
 * pe care regulile merchant + keyword-urile nu le-au putut încadra.
 *
 * Un singur apel AI pentru toată lista (chunk-uri de `MAX_ITEMS_PER_CALL` dacă
 * e mare). Degradare grațioasă: dacă providerul nu e disponibil / cota e
 * epuizată, întoarce un Map gol (caller-ul păstrează rezultatele deterministe).
 *
 * Privacy: trimite doar `merchant` + `description` (fără sume, fără note).
 */

import { sendAiRequest, type AiMessage } from './aiProvider';
import {
  parseAiJsonResponse,
  CategorizeResponseSchema,
  isCategoryKey,
  CATEGORY_KEY_VALUES,
} from './aiSchemas';

import type { CategoryKey } from '@/types';

export interface CategorizeItem {
  id: string;
  merchant?: string;
  description?: string;
}

const MAX_ITEMS_PER_CALL = 100;
const MAX_FIELD_CHARS = 120;
const MAX_TOKENS = 2000;

// ─── Sanitizare ──────────────────────────────────────────────────────────────

function sanitizeField(text: string | undefined): string {
  return (text ?? '')
    .slice(0, MAX_FIELD_CHARS)
    .replace(/"""/g, "'''")
    .replace(/```/g, '~~~')
    .replace(/<\|/g, '< |')
    .replace(/\[INST\]/gi, '[inst]')
    .replace(/\[\/INST\]/gi, '[/inst]')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

// ─── Prompt builder ──────────────────────────────────────────────────────────

export function buildPrompt(items: CategorizeItem[]): AiMessage[] {
  const system = `Ești un asistent care încadrează tranzacții bancare pe categorii (română).
Primești o listă de tranzacții cu id, comerciant și descriere. Pentru fiecare, alegi categoria.
Returnezi DOAR JSON valid, fără text suplimentar, fără markdown, fără explicații.
Schema:
{
  "results": [
    { "id": "<id-ul primit>", "category": "food" }
  ]
}
Reguli:
- "category" e OBLIGATORIU una din lista exactă: ${CATEGORY_KEY_VALUES.join(', ')}.
- Alege pe baza comerciantului/descrierii (ex. LIDL/MEGAIMAGE/restaurant → food, OMV/MOL → vehicle, EON/ELECTRICA/DIGI → utilities, farmacie/clinică → health, Netflix/Apple → subscriptions, eMAG/olx → shopping, CTP/metrou → transport).
- Dacă nu poți încadra cu încredere o tranzacție, folosește "other".
- Întoarce câte un rezultat pentru fiecare id primit, păstrând id-ul exact.`;

  const lines = items
    .map(
      it =>
        `- id=${it.id} | comerciant: ${sanitizeField(it.merchant)} | descriere: ${sanitizeField(it.description)}`
    )
    .join('\n');

  const user = `Tranzacții de încadrat:
---
${lines}
---

Returnează DOAR JSON-ul cu rezultatele.`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ─── Parse răspuns ───────────────────────────────────────────────────────────

/**
 * Parsează răspunsul AI într-un Map id → CategoryKey. Id-uri necunoscute sau
 * categorii invalide sunt ignorate (nu aruncă).
 */
export function parseResponse(
  response: string,
  validIds: ReadonlySet<string>
): Map<string, CategoryKey> {
  const out = new Map<string, CategoryKey>();
  const result = parseAiJsonResponse(response, CategorizeResponseSchema);
  if (!result.ok || !result.data) return out;

  for (const r of result.data.results) {
    if (!validIds.has(r.id)) continue;
    const cat = r.category.trim().toLowerCase();
    if (isCategoryKey(cat)) out.set(r.id, cat);
  }
  return out;
}

// ─── Funcție publică ─────────────────────────────────────────────────────────

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Cere AI-ului categorii pentru lista dată. Întoarce un Map id → CategoryKey
 * cu doar rezultatele valide. Pe orice eroare (provider indisponibil, cotă
 * epuizată, răspuns invalid) întoarce ce a apucat să strângă — nu aruncă.
 */
export async function categorizeTransactionsWithAi(
  items: CategorizeItem[]
): Promise<Map<string, CategoryKey>> {
  const merged = new Map<string, CategoryKey>();
  if (items.length === 0) return merged;

  for (const group of chunk(items, MAX_ITEMS_PER_CALL)) {
    const validIds = new Set(group.map(it => it.id));
    try {
      const response = await sendAiRequest(buildPrompt(group), MAX_TOKENS);
      for (const [id, cat] of parseResponse(response, validIds)) {
        merged.set(id, cat);
      }
    } catch {
      // Provider indisponibil / cotă epuizată / timeout → oprim, păstrăm ce avem.
      break;
    }
  }
  return merged;
}
