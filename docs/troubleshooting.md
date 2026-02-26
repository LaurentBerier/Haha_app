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
cd /Users/laurentbernier/Documents/HAHA_app
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
cd /Users/laurentbernier/Documents/HAHA_app
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
cd /Users/laurentbernier/Documents/HAHA_app
rm -rf ios/build
npm run e2e:build:ios
npm run e2e:ios
```

If still failing:

- Open `ios/build/Build/Products/Release-iphonesimulator/HaHaai.app/Info.plist`
- Confirm `CFBundleIdentifier` is present.


## 8) Detox red screen: `No script URL provided`

Symptom:

- Detox launches app but shows redbox error with `unsanitizedScriptURLString = (null)`.

Cause:

- Detox is running a Debug binary without Metro attached.

Fix used in this project:

- Build Detox app in `Release` so JS bundle is embedded in the app binary.

Verify in `.detoxrc.js`:

- `binaryPath` points to `Release-iphonesimulator/HaHaai.app`
- `xcodebuild` uses `-configuration Release`

Then retry:

```bash
npm run e2e:build:ios
npm run e2e:ios
```

## 9) Chat bubble shows `Erreur pendant la generation`

Symptom:

- User message is sent, artist placeholder appears, then message becomes error.

Common causes:

- `EXPO_PUBLIC_USE_MOCK_LLM=false` but no Anthropic key configured.
- Invalid/expired Anthropic key.
- Device/network issue during API call.
- Mock fallback also failed (rare), so message remains in error.

Fix:

1. Ensure `.env` exists in project root:

```bash
cp .env.example .env
```

2. Verify values:

```bash
EXPO_PUBLIC_USE_MOCK_LLM=false
EXPO_PUBLIC_ANTHROPIC_API_KEY=sk-ant-...
EXPO_PUBLIC_ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
```

3. Restart Expo after changing env:

```bash
npm run start
```

4. If needed, force mock mode for local validation:

```bash
EXPO_PUBLIC_USE_MOCK_LLM=true
```

## 10) Claude mode works in terminal but fails on device

Symptom:

- Direct script tests pass, but simulator/device chat fails.

Notes:

- The app uses a runtime-compatible strategy:
  - React Native runtime: non-stream request path
  - non-RN runtime: SSE stream path

Checklist:

- Confirm app was restarted after env changes.
- Confirm simulator has outbound internet access.
- Check Metro logs for `[Chat] Generation failed:` details.

## 11) AI says user is repeating input (same turn sent twice)

Symptom:

- Replies mention that user repeated themselves even when only one message was sent.

Cause:

- Running an older build where conversation history was captured after appending the current user turn.

Fix:

1. Pull latest `main` and reinstall if needed:

```bash
cd /Users/laurentbernier/Documents/HAHA_app
git pull
npm install
```

2. Restart Metro with clean cache:

```bash
npm run start -- --clear
```

3. Reopen app in simulator/device.

## 12) Mode list does not scroll or shows repeated default icons

Symptom:

- Cannot scroll to lower modes in mode selection.
- New modes all show the same default icon.

Cause:

- Old JS bundle still cached.

Fix:

```bash
cd /Users/laurentbernier/Documents/HAHA_app
npm run start -- --clear
```

Then reload app (`Cmd + R` on iOS simulator).
