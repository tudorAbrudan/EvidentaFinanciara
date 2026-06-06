/**
 * Test pentru aiCategoryMapper (categorizare batch la re-analiză).
 *
 * Verifică:
 * 1. Răspuns valid → Map id→CategoryKey.
 * 2. Categorie invalidă / id necunoscut → ignorate.
 * 3. Listă goală → fără apel, Map gol.
 * 4. Provider indisponibil (sendAiRequest aruncă) → Map gol, nu propagă eroarea.
 * 5. parseResponse pur.
 */

import {
  categorizeTransactionsWithAi,
  parseResponse,
  type CategorizeItem,
} from '@/services/aiCategoryMapper';
import { sendAiRequest } from '@/services/aiProvider';

jest.mock('@/services/aiProvider', () => {
  const actual = jest.requireActual('@/services/aiProvider');
  return {
    ...actual,
    sendAiRequest: jest.fn(),
  };
});

const mockSend = sendAiRequest as jest.MockedFunction<typeof sendAiRequest>;

beforeEach(() => {
  jest.clearAllMocks();
});

const items: CategorizeItem[] = [
  { id: 't1', merchant: 'BONAS CRISENI', description: 'Plata la POS' },
  { id: 't2', merchant: 'IL CAFFE', description: 'cafea' },
];

describe('categorizeTransactionsWithAi', () => {
  it('întoarce Map id→CategoryKey dintr-un răspuns valid', async () => {
    mockSend.mockResolvedValue(
      JSON.stringify({
        results: [
          { id: 't1', category: 'food' },
          { id: 't2', category: 'food' },
        ],
      })
    );

    const result = await categorizeTransactionsWithAi(items);

    expect(result.get('t1')).toBe('food');
    expect(result.get('t2')).toBe('food');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('ignoră categorii invalide și id-uri necunoscute', async () => {
    mockSend.mockResolvedValue(
      JSON.stringify({
        results: [
          { id: 't1', category: 'inexistent' },
          { id: 'necunoscut', category: 'food' },
          { id: 't2', category: 'FOOD' }, // case-insensitive → acceptat
        ],
      })
    );

    const result = await categorizeTransactionsWithAi(items);

    expect(result.has('t1')).toBe(false);
    expect(result.has('necunoscut')).toBe(false);
    expect(result.get('t2')).toBe('food');
  });

  it('nu apelează AI pentru listă goală', async () => {
    const result = await categorizeTransactionsWithAi([]);
    expect(result.size).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('degradare grațioasă: sendAiRequest aruncă → Map gol', async () => {
    mockSend.mockRejectedValue(new Error('cotă epuizată'));
    const result = await categorizeTransactionsWithAi(items);
    expect(result.size).toBe(0);
  });
});

describe('parseResponse', () => {
  it('păstrează doar id-uri valide și categorii valide', () => {
    const validIds = new Set(['a', 'b']);
    const response = JSON.stringify({
      results: [
        { id: 'a', category: 'transport' },
        { id: 'b', category: 'gibberish' },
        { id: 'c', category: 'food' },
      ],
    });
    const map = parseResponse(response, validIds);
    expect(map.get('a')).toBe('transport');
    expect(map.has('b')).toBe(false);
    expect(map.has('c')).toBe(false);
  });

  it('răspuns malformat → Map gol', () => {
    const map = parseResponse('nu e json', new Set(['a']));
    expect(map.size).toBe(0);
  });
});
