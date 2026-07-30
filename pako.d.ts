/**
 * Tipuri minimale pentru `pako` (pachetul nu livrează declarații proprii și nu
 * există `@types/pako` în proiect). Expunem doar ce folosim: `inflate`.
 */
declare module 'pako' {
  export function inflate(data: Uint8Array): Uint8Array;
  const pako: { inflate: typeof inflate };
  export default pako;
}
