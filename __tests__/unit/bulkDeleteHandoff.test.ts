import { setBulkDeleteIds, consumeBulkDeleteIds } from '@/services/bulkDeleteHandoff';

describe('bulkDeleteHandoff', () => {
  beforeEach(() => {
    consumeBulkDeleteIds();
  });

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
    expect(consumeBulkDeleteIds()).toBeNull();
  });
});
