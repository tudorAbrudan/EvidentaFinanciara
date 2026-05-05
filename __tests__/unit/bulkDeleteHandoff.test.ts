import { setBulkDeleteIds, consumeBulkDeleteIds } from '@/services/bulkDeleteHandoff';

describe('bulkDeleteHandoff', () => {
  it('set + consume returnează lista', () => {
    setBulkDeleteIds(['a', 'b', 'c']);
    expect(consumeBulkDeleteIds()).toEqual(['a', 'b', 'c']);
  });

  it('al doilea consume returnează null (one-shot)', () => {
    setBulkDeleteIds(['a']);
    consumeBulkDeleteIds();
    expect(consumeBulkDeleteIds()).toBeNull();
  });

  it('consume fără set anterior returnează null', () => {
    // Cleanup pentru izolare între teste — re-import resetează modul.
    consumeBulkDeleteIds(); // golește din testul anterior dacă a rămas
    expect(consumeBulkDeleteIds()).toBeNull();
  });
});
