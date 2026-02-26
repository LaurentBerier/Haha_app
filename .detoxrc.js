/** @type {Detox.DetoxConfig} */
module.exports = {
  testRunner: {
    args: {
      '$0': 'jest',
      config: 'e2e/jest.config.js'
    },
    jest: {
      setupTimeout: 120000
    }
  },
  apps: {
    'ios.debug': {
      type: 'ios.app',
      binaryPath: 'ios/build/Build/Products/Release-iphonesimulator/HaHaai.app',
      build:
        'xcodebuild -workspace ios/HaHaai.xcworkspace -scheme HaHaai -configuration Release -sdk iphonesimulator -destination "platform=iOS Simulator,name=iPhone 17 Pro,OS=26.0.1" ONLY_ACTIVE_ARCH=YES -derivedDataPath ios/build'
    }
  },
  devices: {
    simulator: {
      type: 'ios.simulator',
      device: {
        type: 'iPhone 17 Pro'
      }
    }
  },
  configurations: {
    'ios.sim.debug': {
      device: 'simulator',
      app: 'ios.debug'
    }
  }
};
