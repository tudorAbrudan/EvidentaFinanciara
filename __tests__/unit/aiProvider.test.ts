import { getAiUsageStats, recordAiTokens, sendAiRequest } from '@/services/aiProvider';

// Stub minimal pentru config + usage; testăm doar că temperature 0 e default.
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue('test-key'),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

const mockFetch = jest.fn();
let inMemoryStore: Record<string, string> = {};

beforeAll(() => {
  const AsyncStorage = jest.requireMock('@react-native-async-storage/async-storage').default;
  (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
    if (key === 'ai_provider_type') return Promise.resolve('external');
    if (key === 'ai_provider_url') return Promise.resolve('https://api.test/v1');
    if (key === 'ai_provider_model') return Promise.resolve('test-model');
    return Promise.resolve(inMemoryStore[key] ?? null);
  });
  (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string, value: string) => {
    inMemoryStore[key] = value;
  });
  global.fetch = mockFetch as unknown as typeof fetch;
});

beforeEach(() => {
  inMemoryStore = {};
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: '{}' } }] }),
  } as unknown as Response);
});

describe('sendAiRequest', () => {
  it('temperature default 0 (deterministic pentru output structurat)', async () => {
    await sendAiRequest([{ role: 'user', content: 'test' }]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.temperature).toBe(0);
  });

  it('temperature poate fi override-uit pentru output narativ', async () => {
    await sendAiRequest([{ role: 'user', content: 'test' }], 500, 0.7);
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.temperature).toBe(0.7);
  });

  it('max_tokens default 500', async () => {
    await sendAiRequest([{ role: 'user', content: 'test' }]);
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.max_tokens).toBe(500);
  });

  it('persistă tokens din response.usage', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{}' } }],
        usage: { prompt_tokens: 120, completion_tokens: 45, total_tokens: 165 },
      }),
    } as unknown as Response);
    await sendAiRequest([{ role: 'user', content: 'test' }]);

    const stats = await getAiUsageStats();
    expect(stats.promptTokensToday).toBe(120);
    expect(stats.completionTokensToday).toBe(45);
    expect(stats.totalTokensToday).toBe(165);
    expect(stats.promptTokensCumulative).toBe(120);
    expect(stats.totalTokensCumulative).toBe(165);
  });

  it('agregă tokens între multiple apeluri', async () => {
    const mockResponse = (p: number, c: number) =>
      ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{}' } }],
          usage: { prompt_tokens: p, completion_tokens: c },
        }),
      }) as unknown as Response;
    mockFetch
      .mockResolvedValueOnce(mockResponse(100, 30))
      .mockResolvedValueOnce(mockResponse(50, 20));

    await sendAiRequest([{ role: 'user', content: '1' }]);
    await sendAiRequest([{ role: 'user', content: '2' }]);

    const stats = await getAiUsageStats();
    expect(stats.promptTokensToday).toBe(150);
    expect(stats.completionTokensToday).toBe(50);
    expect(stats.totalTokensToday).toBe(200);
  });

  it('ignoră response fără usage (compat OpenAI variants)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{}' } }] }), // no usage
    } as unknown as Response);
    await sendAiRequest([{ role: 'user', content: 'test' }]);

    const stats = await getAiUsageStats();
    expect(stats.totalTokensToday).toBe(0);
  });
});

describe('recordAiTokens', () => {
  it('ignoră valori nedefinite / NaN', async () => {
    await recordAiTokens(undefined, undefined);
    await recordAiTokens(NaN, NaN);
    const stats = await getAiUsageStats();
    expect(stats.totalTokensToday).toBe(0);
  });

  it('valori negative → ignorate (defensiv)', async () => {
    await recordAiTokens(-50, -10);
    const stats = await getAiUsageStats();
    expect(stats.totalTokensToday).toBe(0);
  });
});
