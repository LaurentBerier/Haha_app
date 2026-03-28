/* global jest */

const asyncStorageMock = {
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
  clear: jest.fn(() => Promise.resolve())
};

jest.mock('@react-native-async-storage/async-storage', () => asyncStorageMock);
