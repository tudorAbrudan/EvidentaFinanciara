// Mocks globale pentru module native care nu rulează în Node.js/Jest

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///test/Documents/',
  cacheDirectory: 'file:///test/Cache/',
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
  readAsStringAsync: jest.fn().mockResolvedValue(''),
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  copyAsync: jest.fn().mockResolvedValue(undefined),
  moveAsync: jest.fn().mockResolvedValue(undefined),
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
  getInfoAsync: jest.fn().mockResolvedValue({ exists: false, isDirectory: false }),
  readDirectoryAsync: jest.fn().mockResolvedValue([]),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
    getAllKeys: jest.fn().mockResolvedValue([]),
    multiGet: jest.fn().mockResolvedValue([]),
    multiSet: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn(() => ({
    execSync: jest.fn(),
    runSync: jest.fn(),
    runAsync: jest.fn().mockResolvedValue({ lastInsertRowId: 1, changes: 1 }),
    getAllAsync: jest.fn().mockResolvedValue([]),
    getFirstAsync: jest.fn().mockResolvedValue(null),
    withTransactionAsync: jest.fn(async (cb: () => Promise<void>) => cb()),
  })),
}));

jest.mock('expo-modules-core', () => ({
  requireNativeModule: jest.fn(() => ({})),
  requireOptionalNativeModule: jest.fn(() => null),
  NativeModulesProxy: {},
  EventEmitter: jest.fn().mockImplementation(() => ({
    addListener: jest.fn(),
    removeAllListeners: jest.fn(),
  })),
}));

jest.mock('expo-crypto', () => ({
  digestStringAsync: jest.fn().mockResolvedValue('mock-hash'),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { HEX: 'hex' },
  randomUUID: jest.fn(() => 'mock-uuid'),
  getRandomBytesAsync: jest.fn().mockResolvedValue(new Uint8Array(16)),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(false),
  shareAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@react-native-ml-kit/text-recognition', () => ({
  default: {
    recognize: jest.fn().mockResolvedValue({ blocks: [] }),
  },
}));

jest.mock('expo-notifications', () => ({
  requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: false }),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('mock-id'),
  cancelAllScheduledNotificationsAsync: jest.fn().mockResolvedValue(undefined),
  getAllScheduledNotificationsAsync: jest.fn().mockResolvedValue([]),
  setNotificationHandler: jest.fn(),
  AndroidImportance: { MAX: 5 },
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-local-authentication', () => ({
  authenticateAsync: jest.fn().mockResolvedValue({ success: false }),
  hasHardwareAsync: jest.fn().mockResolvedValue(false),
  isEnrolledAsync: jest.fn().mockResolvedValue(false),
}));
