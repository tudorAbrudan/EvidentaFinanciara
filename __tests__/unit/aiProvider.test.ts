import {
  getAiUsageStats,
  recordAiTokens,
  sendAiRequest,
  validateConfig,
  type AiProviderConfig,
} from '@/services/aiProvider';

// Stub minimal pentru config + usage.
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));

// Cheia proprie a userului (provider `external`). Nu are voie să plece spre proxy.
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue('cheia-proprie-a-userului'),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

const mockFetch = jest.fn();
let inMemoryStore: Record<string, string> = {};
let providerType = 'external';

beforeAll(() => {
  const AsyncStorage = jest.requireMock('@react-native-async-storage/async-storage').default;
  (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
    if (key === 'ai_provider_type') return Promise.resolve(providerType);
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
  providerType = 'external';
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: '{}' } }] }),
  } as unknown as Response);
});

const errorResponse = (status: number, body: string) =>
  ({ ok: false, status, text: async () => body }) as unknown as Response;

function lastRequest(): { url: string; init: RequestInit; headers: Record<string, string> } {
  const [url, init] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1] as [
    string,
    RequestInit,
  ];
  return { url, init, headers: init.headers as Record<string, string> };
}

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

describe('cheie proprie (external)', () => {
  it('merge direct la providerul userului, fără X-App-Device', async () => {
    await sendAiRequest([{ role: 'user', content: 'test' }]);
    const { url, headers } = lastRequest();
    expect(url).toBe('https://api.test/v1/chat/completions');
    expect(headers.Authorization).toBe('Bearer cheia-proprie-a-userului');
    expect(headers['X-App-Device']).toBeUndefined();
  });

  it('păstrează răspunsul brut al providerului la eroare', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(429, 'rate limited by provider'));
    await expect(sendAiRequest([{ role: 'user', content: 'test' }])).rejects.toThrow(
      'Eroare AI (429): rate limited by provider'
    );
  });
});

describe('Finanțe AI prin proxy (builtin)', () => {
  const savedUrl = process.env.EXPO_PUBLIC_FINANTE_AI_URL;
  const savedToken = process.env.EXPO_PUBLIC_FINANTE_AI_TOKEN;

  beforeEach(() => {
    providerType = 'builtin';
    process.env.EXPO_PUBLIC_FINANTE_AI_URL = 'https://proxy.test/v1/';
    process.env.EXPO_PUBLIC_FINANTE_AI_TOKEN = 'token-aplicatie';
  });

  afterEach(() => {
    if (savedUrl === undefined) delete process.env.EXPO_PUBLIC_FINANTE_AI_URL;
    else process.env.EXPO_PUBLIC_FINANTE_AI_URL = savedUrl;
    if (savedToken === undefined) delete process.env.EXPO_PUBLIC_FINANTE_AI_TOKEN;
    else process.env.EXPO_PUBLIC_FINANTE_AI_TOKEN = savedToken;
  });

  it('trimite la proxy, cu token-ul de aplicație și modelul permis', async () => {
    await sendAiRequest([{ role: 'user', content: 'test' }]);
    const { url, init, headers } = lastRequest();
    expect(url).toBe('https://proxy.test/v1/chat/completions');
    expect(headers.Authorization).toBe('Bearer token-aplicatie');
    expect(JSON.parse(init.body as string).model).toBe('mistral-small-latest');
  });

  it('nu trimite cheia proprie a userului către proxy', async () => {
    await sendAiRequest([{ role: 'user', content: 'test' }]);
    const { init } = lastRequest();
    expect(JSON.stringify(init)).not.toContain('cheia-proprie-a-userului');
  });

  it('trimite un X-App-Device anonim, stabil între cereri', async () => {
    await sendAiRequest([{ role: 'user', content: '1' }]);
    const first = lastRequest().headers['X-App-Device'];
    await sendAiRequest([{ role: 'user', content: '2' }]);
    const second = lastRequest().headers['X-App-Device'];
    expect(first.length).toBeGreaterThanOrEqual(8);
    expect(first.length).toBeLessThanOrEqual(128);
    expect(second).toBe(first);
  });

  it.each([
    [
      429,
      '{"error":{"message":"Ai atins limita de 20 interogări pe zi."}}',
      /limita de 20[\s\S]*cheie API/,
    ],
    [
      429,
      '{"error":{"message":"Serviciul a atins plafonul zilnic. Încearcă mâine."}}',
      /plafonul zilnic/,
    ],
    [
      503,
      '{"error":{"message":"Serviciul AI inclus e indisponibil momentan."}}',
      /Finanțe AI e indisponibil/,
    ],
    [401, '{"error":{"message":"Neautorizat."}}', /Actualizează aplicația/],
    [413, '{"error":{"message":"Cerere prea mare."}}', /prea mare pentru Finanțe AI/],
    [502, '{"error":{"message":"Providerul AI nu e disponibil."}}', /nu poate contacta providerul/],
    [504, '', /nu a răspuns la timp/],
  ])('status %i → mesaj pentru user, fără JSON brut', async (status, body, expected) => {
    mockFetch.mockResolvedValueOnce(errorResponse(status, body));
    const error = await sendAiRequest([{ role: 'user', content: 'test' }]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(expected);
    expect((error as Error).message).not.toContain('{"error"');
  });

  it('fără URL de proxy configurat → nu face nicio cerere', async () => {
    delete process.env.EXPO_PUBLIC_FINANTE_AI_URL;
    await expect(sendAiRequest([{ role: 'user', content: 'test' }])).rejects.toThrow(
      /Finanțe AI nu este disponibil/
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('validateConfig pentru builtin', () => {
  const builtin: AiProviderConfig = { type: 'builtin', url: '', apiKey: '', model: '' };

  afterEach(() => {
    delete process.env.EXPO_PUBLIC_FINANTE_AI_URL;
    delete process.env.EXPO_PUBLIC_FINANTE_AI_TOKEN;
  });

  it('cere și URL-ul, și token-ul proxy-ului', () => {
    process.env.EXPO_PUBLIC_FINANTE_AI_TOKEN = 'token';
    expect(validateConfig(builtin)).toMatch(/Finanțe AI nu este disponibil/);

    delete process.env.EXPO_PUBLIC_FINANTE_AI_TOKEN;
    process.env.EXPO_PUBLIC_FINANTE_AI_URL = 'https://proxy.test/v1';
    expect(validateConfig(builtin)).toMatch(/Finanțe AI nu este disponibil/);

    process.env.EXPO_PUBLIC_FINANTE_AI_TOKEN = 'token';
    expect(validateConfig(builtin)).toBeNull();
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
