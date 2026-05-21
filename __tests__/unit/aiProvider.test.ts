import { sendAiRequest } from '@/services/aiProvider';

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

beforeAll(() => {
  // Setăm builtin provider activ folosind defaultul (apiKey vine din proces.env în prod;
  // în jest e gol — folosim 'external' cu cheie explicită)
  const AsyncStorage = jest.requireMock('@react-native-async-storage/async-storage').default;
  (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
    if (key === 'ai_provider_type') return Promise.resolve('external');
    if (key === 'ai_provider_url') return Promise.resolve('https://api.test/v1');
    if (key === 'ai_provider_model') return Promise.resolve('test-model');
    return Promise.resolve(null);
  });
  global.fetch = mockFetch as unknown as typeof fetch;
});

beforeEach(() => {
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
});
