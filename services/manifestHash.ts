import * as Crypto from 'expo-crypto';

interface HasId {
  id: string;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    const sorted = value.map(canonicalize);
    if (sorted.length > 0 && sorted.every(item => isObject(item) && typeof item.id === 'string')) {
      sorted.sort((a, b) => {
        const ai = (a as unknown as HasId).id;
        const bi = (b as unknown as HasId).id;
        return ai < bi ? -1 : ai > bi ? 1 : 0;
      });
    }
    return sorted;
  }
  if (isObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = value[key];
      out[key] = v === undefined ? null : canonicalize(v);
    }
    return out;
  }
  return value === undefined ? null : value;
}

export function buildCanonicalManifest(data: Record<string, unknown>): string {
  return JSON.stringify(canonicalize(data));
}

export async function hashManifestAsync(canonical: string): Promise<string> {
  return await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, canonical);
}
