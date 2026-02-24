const { device } = require('detox');

beforeEach(async () => {
  await device.reloadReactNative();
});
