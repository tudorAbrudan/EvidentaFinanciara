const documentDirectory = 'file:///test/Documents/';

module.exports = {
  documentDirectory,
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
  readAsStringAsync: jest.fn().mockResolvedValue(''),
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  copyAsync: jest.fn().mockResolvedValue(undefined),
  moveAsync: jest.fn().mockResolvedValue(undefined),
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
  getInfoAsync: jest.fn().mockResolvedValue({ exists: false, isDirectory: false }),
  readDirectoryAsync: jest.fn().mockResolvedValue([]),
  cacheDirectory: 'file:///test/Cache/',
  createDownloadResumable: jest.fn(() => ({
    downloadAsync: jest.fn().mockResolvedValue({ uri: 'file:///test/Documents/models/test.gguf' }),
    pauseAsync: jest.fn().mockResolvedValue(undefined),
  })),
};
