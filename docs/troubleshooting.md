# Troubleshooting

## 1) `Unknown prop type for "onSearchFocus": "undefined"`

Symptom:

- Red screen referencing `react-native-screens/src/fabric/SearchBarNativeComponent.ts`.

Cause:

- Incompatible `react-native-screens` version for Expo SDK 53.

Fix used in this project:

- Pin `react-native-screens` to `~4.11.1` in `package.json`.
- Reinstall dependencies.
- Rebuild iOS app.

Commands:

```bash
cd /Users/laurentbernier/Documents/HAHA
npm install
npm run ios
```

## 2) `Cannot find native module 'ExpoAsset'`

Symptom:

- Runtime Hermes error: native module `ExpoAsset` missing.

Cause:

- JS dependency expects native `expo-asset`, but binary was built without it.

Fix used in this project:

- Add `expo-asset` (`~11.1.7`) dependency.
- Reinstall and rebuild iOS app.

Commands:

```bash
cd /Users/laurentbernier/Documents/HAHA
npm install
npm run ios
```

## 3) `xcodebuild error 70` with missing iOS platform/runtime

Symptom:

- Build fails with destination ineligible, e.g. `iOS 26.2 is not installed`.

Fix options:

- Install from Xcode UI: `Xcode > Settings > Components`.
- Or CLI: `xcodebuild -downloadPlatform iOS`.

Then retry:

```bash
npm run ios
```

## 4) CocoaPods missing

Symptom:

- Expo iOS run cannot find `pod`.

Fix:

```bash
brew install cocoapods
pod --version
```

## 5) Stale bundle after fixes

If app still shows old errors after dependency changes:

```bash
# stop running Metro first
npm run start -- --clear
npm run ios
```

Then in Simulator:

- Press `Cmd + R` to reload.

## 6) Detox fails: `applesimutils: command not found`

Symptom:

- Detox exits before test execution with missing `applesimutils`.

Fix:

```bash
brew tap wix/brew
brew install applesimutils
```

Verify:

```bash
applesimutils --version
```

## 7) Detox fails with `CFBundleIdentifier not found inside Info.plist`

Symptom:

- Detox build/test reports missing bundle identifier from built `.app`.

Causes:

- Stale or partial iOS build output.
- Build for a different simulator destination than Detox config.

Fix:

```bash
cd /Users/laurentbernier/Documents/HAHA
rm -rf ios/build
npm run e2e:build:ios
npm run e2e:ios
```

If still failing:

- Open `ios/build/Build/Products/Debug-iphonesimulator/HaHaai.app/Info.plist`
- Confirm `CFBundleIdentifier` is present.
