import { askAssistant } from '@/services/aiChat';
import * as repo from '@/services/aiChatRepo';
import * as aiProvider from '@/services/aiProvider';
import * as categories from '@/services/categories';
import { db } from '@/services/db';
import * as accounts from '@/services/financialAccounts';

jest.mock('@/services/aiProvider');
jest.mock('@/services/aiChatRepo');
jest.mock('@/services/financialAccounts');
jest.mock('@/services/categories');

const sendAiRequestMock = aiProvider.sendAiRequest as jest.MockedFunction<
  typeof aiProvider.sendAiRequest
>;
const isAiLimitReachedMock = aiProvider.isAiLimitReached as jest.MockedFunction<
  typeof aiProvider.isAiLimitReached
>;
const recentPairsMock = repo.recentPairs as jest.MockedFunction<typeof repo.recentPairs>;
const appendMessageMock = repo.appendMessage as jest.MockedFunction<typeof repo.appendMessage>;

beforeEach(() => {
  jest.clearAllMocks();
  isAiLimitReachedMock.mockResolvedValue(false);
  recentPairsMock.mockResolvedValue([]);
  appendMessageMock.mockImplementation(async i => ({
    id: 'mock-id',
    createdAt: '2026-04-29T00:00:00Z',
    ...i,
  }));
  (accounts.getFinancialAccounts as jest.Mock).mockResolvedValue([]);
  (categories.getCategories as jest.Mock).mockResolvedValue([]);
});

describe('askAssistant', () => {
  it('happy path: SQL valid → format template → save user+assistant', async () => {
    sendAiRequestMock.mockResolvedValue(
      JSON.stringify({
        sql: 'SELECT * FROM transactions LIMIT 10',
        template: 'raw_list',
        params: {},
        explanation_short: 'lista',
      })
    );
    (db.getAllAsync as jest.Mock).mockResolvedValue([]);

    const r = await askAssistant('listează tranzacții');
    expect(r.assistant.template).toBe('raw_list');
    expect(appendMessageMock).toHaveBeenCalledTimes(2);
  });

  it('cota atinsă: niciun call AI, mesaj system_error salvat', async () => {
    isAiLimitReachedMock.mockResolvedValue(true);
    const r = await askAssistant('ceva');
    expect(sendAiRequestMock).not.toHaveBeenCalled();
    expect(r.assistant.errorKind).toBe('quota_exhausted');
  });

  it('AI întoarce JSON invalid → retry o dată → succes', async () => {
    sendAiRequestMock.mockResolvedValueOnce('NOT JSON AT ALL').mockResolvedValueOnce(
      JSON.stringify({
        sql: 'SELECT * FROM transactions LIMIT 5',
        template: 'raw_list',
        params: {},
        explanation_short: 'ok',
      })
    );
    (db.getAllAsync as jest.Mock).mockResolvedValue([]);
    const r = await askAssistant('Q');
    expect(sendAiRequestMock).toHaveBeenCalledTimes(2);
    expect(r.assistant.template).toBe('raw_list');
  });

  it('AI întoarce SQL respins → retry → succes', async () => {
    sendAiRequestMock
      .mockResolvedValueOnce(
        JSON.stringify({
          sql: 'DROP TABLE transactions',
          template: 'raw_list',
          params: {},
          explanation_short: 'bad',
        })
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          sql: 'SELECT * FROM transactions LIMIT 5',
          template: 'raw_list',
          params: {},
          explanation_short: 'ok',
        })
      );
    (db.getAllAsync as jest.Mock).mockResolvedValue([]);
    const r = await askAssistant('Q');
    expect(sendAiRequestMock).toHaveBeenCalledTimes(2);
    expect(r.assistant.template).toBe('raw_list');
  });

  it('cannot_answer: niciun retry, mesajul cu explanation', async () => {
    sendAiRequestMock.mockResolvedValue(
      JSON.stringify({
        sql: null,
        template: 'cannot_answer',
        params: { explanation_short: 'nu pot' },
        explanation_short: 'nu pot',
      })
    );
    const r = await askAssistant('Q');
    expect(sendAiRequestMock).toHaveBeenCalledTimes(1);
    expect(r.assistant.template).toBe('cannot_answer');
    expect(r.assistant.content).toContain('nu pot');
  });

  it('retry-ul eșuează → mesaj user "reformulează"', async () => {
    sendAiRequestMock.mockResolvedValue('still not json');
    const r = await askAssistant('Q');
    expect(sendAiRequestMock).toHaveBeenCalledTimes(2);
    expect(r.assistant.errorKind).toBe('invalid_sql');
    expect(r.assistant.content.toLowerCase()).toContain('reformulează');
  });
});
