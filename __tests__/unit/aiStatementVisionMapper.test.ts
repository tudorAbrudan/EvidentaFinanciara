/**
 * Test pentru aiStatementVisionMapper.
 *
 * Verifică:
 * 1. Răspuns valid → ParsedRow[] și warning standard.
 * 2. Răspuns gol → rows=[] și warning explicit.
 * 3. AiContextOverflowError la single-shot → mapper-ul face split chunked.
 * 4. Deduplicare la merge chunks.
 * 5. Provider != external → eroare clară (hard guard).
 */

jest.mock('@/services/aiProvider', () => {
  const actual = jest.requireActual('@/services/aiProvider');
  return {
    ...actual,
    sendAiRequestWithImage: jest.fn(),
    getAiConfig: jest.fn(),
  };
});

jest.mock('@/services/pdfOcr', () => ({
  renderAllPdfPagesAsBase64: jest.fn(),
  extractTextFromPdfViaOcr: jest.fn(),
  renderPdfFirstPageForVision: jest.fn(),
}));

import { sendAiRequestWithImage, getAiConfig, AiContextOverflowError } from '@/services/aiProvider';
import { renderAllPdfPagesAsBase64 } from '@/services/pdfOcr';
import { mapStatementWithVisionAi } from '@/services/aiStatementVisionMapper';

const mockSend = sendAiRequestWithImage as jest.MockedFunction<typeof sendAiRequestWithImage>;
const mockGetConfig = getAiConfig as jest.MockedFunction<typeof getAiConfig>;
const mockRender = renderAllPdfPagesAsBase64 as jest.MockedFunction<
  typeof renderAllPdfPagesAsBase64
>;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetConfig.mockResolvedValue({
    type: 'external',
    url: 'https://api.example.com/v1',
    apiKey: 'test-key',
    model: 'gpt-4o',
  });
});

describe('mapStatementWithVisionAi', () => {
  it('returnează ParsedRow[] dintr-un răspuns valid', async () => {
    mockRender.mockResolvedValue(['base64-page-1', 'base64-page-2']);
    mockSend.mockResolvedValue(
      JSON.stringify({
        rows: [
          {
            date: '2026-03-15',
            amount: -120.5,
            currency: 'RON',
            description: 'Plata POS Kaufland',
            merchant: 'Kaufland',
          },
          {
            date: '2026-03-20',
            amount: 5000,
            currency: 'RON',
            description: 'Salariu',
          },
        ],
      })
    );

    const result = await mapStatementWithVisionAi('file:///test.pdf', 'RON');

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      date: '2026-03-15',
      amount: -120.5,
      currency: 'RON',
      merchant: 'Kaufland',
    });
    expect(result.format).toBe('generic');
    expect(result.warnings[0]).toContain('AI vision');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('returnează rows=[] și warning explicit pentru răspuns gol', async () => {
    mockRender.mockResolvedValue(['base64-page-1']);
    mockSend.mockResolvedValue(JSON.stringify({ rows: [] }));

    const result = await mapStatementWithVisionAi('file:///test.pdf', 'RON');

    expect(result.rows).toHaveLength(0);
    expect(result.format).toBe('unknown');
    expect(result.warnings[0]).toMatch(/nu a returnat tranzacții valide/i);
  });

  it('face fallback chunked la AiContextOverflowError', async () => {
    mockRender.mockResolvedValue([
      'page-1',
      'page-2',
      'page-3',
      'page-4',
      'page-5',
      'page-6',
      'page-7',
    ]);
    mockSend
      .mockRejectedValueOnce(new AiContextOverflowError('context length exceeded'))
      .mockResolvedValueOnce(
        JSON.stringify({
          rows: [{ date: '2026-03-01', amount: -10, currency: 'RON', description: 'Tx 1' }],
        })
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          rows: [{ date: '2026-03-05', amount: -20, currency: 'RON', description: 'Tx 2' }],
        })
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          rows: [{ date: '2026-03-08', amount: -30, currency: 'RON', description: 'Tx 3' }],
        })
      );

    const progressEvents: string[] = [];
    const result = await mapStatementWithVisionAi('file:///test.pdf', 'RON', evt => {
      progressEvents.push(evt.stage);
    });

    expect(mockSend).toHaveBeenCalledTimes(4);
    // primul apel = single-shot (toate paginile)
    expect((mockSend.mock.calls[0][2] as string[]).length).toBe(7);
    // următoarele 3 = chunks de 3 pagini (3+3+1)
    expect((mockSend.mock.calls[1][2] as string[]).length).toBe(3);
    expect((mockSend.mock.calls[2][2] as string[]).length).toBe(3);
    expect((mockSend.mock.calls[3][2] as string[]).length).toBe(1);

    expect(result.rows).toHaveLength(3);
    expect(progressEvents).toContain('sending-chunked');
  });

  it('deduplică tranzacții identice între chunks', async () => {
    mockRender.mockResolvedValue(['p1', 'p2', 'p3', 'p4']);
    mockSend
      .mockRejectedValueOnce(new AiContextOverflowError('overflow'))
      .mockResolvedValueOnce(
        JSON.stringify({
          rows: [
            { date: '2026-03-01', amount: -10, currency: 'RON', description: 'Plata POS Lidl' },
            { date: '2026-03-02', amount: -25, currency: 'RON', description: 'Plata POS OMV' },
          ],
        })
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          rows: [
            // Duplicat — aceeași dată, sumă, descriere
            { date: '2026-03-02', amount: -25, currency: 'RON', description: 'Plata POS OMV' },
            { date: '2026-03-04', amount: -40, currency: 'RON', description: 'Plata POS Mega' },
          ],
        })
      );

    const result = await mapStatementWithVisionAi('file:///test.pdf', 'RON');

    expect(result.rows).toHaveLength(3);
    const keys = result.rows.map(r => `${r.date}|${r.amount}`);
    expect(keys).toEqual(['2026-03-01|-10', '2026-03-02|-25', '2026-03-04|-40']);
  });

  it('aruncă eroare clară pentru provider != external', async () => {
    mockGetConfig.mockResolvedValue({
      type: 'builtin',
      url: 'https://api.mistral.ai/v1',
      apiKey: '',
      model: 'mistral-small-latest',
    });

    await expect(mapStatementWithVisionAi('file:///test.pdf', 'RON')).rejects.toThrow(
      /cheie API proprie/i
    );
    expect(mockRender).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returnează rows=[] dacă renderingul PDF eșuează', async () => {
    mockRender.mockResolvedValue([]);

    const result = await mapStatementWithVisionAi('file:///test.pdf', 'RON');

    expect(result.rows).toHaveLength(0);
    expect(result.format).toBe('unknown');
    expect(result.warnings[0]).toMatch(/nu s-au putut randa/i);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
