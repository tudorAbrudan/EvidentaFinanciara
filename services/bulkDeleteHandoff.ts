/**
 * Store in-memory pentru transmiterea listei de IDs între ecranul Tranzacții
 * (de unde se inițiază bulk delete) și ecranul de confirmare (`sterge-bulk`).
 *
 * Motiv: query string-ul în router e limitat (~2000 chars pe Android), iar
 * re-rezolvarea filtrului în ecranul de confirm ar introduce race condition.
 */

let pendingIds: string[] | null = null;

export function setBulkDeleteIds(ids: string[]): void {
  pendingIds = [...ids];
}

export function consumeBulkDeleteIds(): string[] | null {
  const out = pendingIds;
  pendingIds = null;
  return out;
}
