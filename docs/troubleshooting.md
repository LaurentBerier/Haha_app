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

- `EXPO_PUBLIC_USE_MOCK_LLM=false` but no Claude proxy URL configured.
- Backend proxy is unavailable or rejects the request.
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
EXPO_PUBLIC_CLAUDE_PROXY_URL=https://<your-backend>/api/claude
EXPO_PUBLIC_ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
```

And on the backend host (Vercel env), ensure:

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

3. Restart Expo after changing env:

```bash
npm run start -- --clear
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

## 13) Cathy photo does not appear on home screen

Symptom:

- Artist card shows initials/fallback instead of Cathy image.

Checks:

1. Confirm asset file exists at project root:

```bash
ls -la /Users/laurentbernier/Documents/HAHA_app/CathyGauthier.jpg
```

2. Confirm mapping exists in `src/config/artistAssets.ts`.
3. Clear Metro cache and restart:

```bash
npm run start -- --clear
```

4. Reload simulator (`Cmd + R`).

## 14) Home screen still shows old “Demarrer” button

Symptom:

- UI still shows legacy start button layout.

Cause:

- Stale bundle from before visual refresh.

Fix:

```bash
cd /Users/laurentbernier/Documents/HAHA_app
npm run start -- --clear
```

Then relaunch app in simulator/device.

## 15) Animated glow effects are not visible

Symptom:

- Menus render correctly, but no subtle moving light appears in background.

Fix:

```bash
cd /Users/laurentbernier/Documents/HAHA_app
npm run start -- --clear
```

Then reload app (`Cmd + R` on iOS simulator).

## 16) Glow movement feels abrupt or “ping-pong”

Symptom:

- Background light appears to reverse direction instead of flowing continuously.

Fix:

1. Ensure latest `AmbientGlow.tsx` is present (continuous linear rotation layers).
2. Clear Metro cache and restart:

```bash
cd /Users/laurentbernier/Documents/HAHA_app
npm run start -- --clear
```

3. Reload app (`Cmd + R`).

## 17) Vercel deploy fails: `files should NOT have more than 15000 items`

Symptom:

- `npx vercel --prod` fails with file-count limit.

Cause:

- The app workspace includes large local folders (`node_modules`, `ios/Pods`, artifacts, caches).

Fix:

1. Keep `.vercelignore` minimal for proxy-only deploys:

```bash
*
!api
!api/**
!vercel.json
```

2. Deploy with archive mode:

```bash
npx vercel --prod --yes --archive=tgz
```

## 18) Vercel command treats `EXPO_PUBLIC_CLAUDE_PROXY_URL=...` as a path

Symptom:

- Error: `Could not find ... EXPO_PUBLIC_CLAUDE_PROXY_URL=...`

Cause:

- Environment assignments are not accepted as positional arguments to `vercel`.

Fix:

- Set app runtime env in local `.env` (Expo app), not in `vercel` command args:

```bash
EXPO_PUBLIC_CLAUDE_PROXY_URL=https://<your-project>.vercel.app/api/claude
```

- Keep backend secret in Vercel project env only:

```bash
npx vercel env add ANTHROPIC_API_KEY production
```

## 19) App crashes when tapping `+` image button

Symptom:

- App exits/crashes immediately when pressing `+` in chat composer.

Common causes:

- iOS native binary was built before photo permissions were added.
- `Info.plist` missing `NSPhotoLibraryUsageDescription` (and sometimes `NSCameraUsageDescription`).

Fix:

1. Confirm `app.json` contains photo permission config for `expo-image-picker` and `ios.infoPlist`.
2. Rebuild native app so permissions are embedded:

```bash
cd /Users/laurentbernier/Documents/HAHA_app
npx expo run:ios
```

3. Verify generated plist keys:

```bash
plutil -p ios/HaHaai/Info.plist | rg "NSPhotoLibraryUsageDescription|NSCameraUsageDescription"
```

## 20) Image attaches but AI ignores it

Symptom:

- Image preview appears in chat, but response behaves like text-only.

Common causes:

- App is still in mock mode (`EXPO_PUBLIC_USE_MOCK_LLM=true`).
- Vercel proxy is an older deploy that only accepts string `content` and rejects multimodal blocks.

Fix:

1. Ensure app env is live mode:

```bash
EXPO_PUBLIC_USE_MOCK_LLM=false
EXPO_PUBLIC_CLAUDE_PROXY_URL=https://<your-project>.vercel.app/api/claude
```

2. Redeploy latest proxy API after `api/claude.js` updates:

```bash
cd /Users/laurentbernier/Documents/HAHA_app
npx vercel --prod --yes --archive=tgz
```

3. Restart app/dev server after env or backend changes:

```bash
npm run start -- --clear
npx expo run:ios
```

## 21) `pod install` fails with UTF-8 / `Unicode Normalization not appropriate for ASCII-8BIT`

Symptom:

- `npx expo prebuild --clean` or `pod install` fails with CocoaPods encoding warnings and Ruby `Encoding::CompatibilityError`.

Cause:

- Shell locale is not UTF-8, which CocoaPods requires.

Fix:

1. Add UTF-8 locale to shell config:

```bash
echo 'export LANG=en_US.UTF-8' >> ~/.zshrc
echo 'export LC_ALL=en_US.UTF-8' >> ~/.zshrc
source ~/.zshrc
```

2. Re-run pods:

```bash
cd /Users/laurentbernier/Documents/HAHA_app/ios
pod install --repo-update
```

## 22) Xcode build fails with `*.modulemap not found` (Expo/EXConstants/etc.)

Symptom:

- Repeated errors such as:
  - `EXConstants.modulemap not found`
  - `ExpoSpeechRecognition.modulemap not found`
  - `Unable to find module dependency: ExpoModulesCore`

Cause:

- Stale Xcode DerivedData/module cache and/or partially stale Pods artifacts after native dependency changes.

Fix used in this project:

```bash
cd /Users/laurentbernier/Documents/HAHA_app
rm -rf ~/Library/Developer/Xcode/DerivedData/HaHaai-*
rm -rf ~/Library/Developer/Xcode/DerivedData/ModuleCache.noindex
rm -rf ios/Pods ios/Podfile.lock ios/build
cd ios
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install --repo-update
cd ..
npx expo run:ios
```

Important:

- Open `ios/HaHaai.xcworkspace` (not `.xcodeproj`) when building from Xcode.

## 23) `CommandError: No code signing certificates are available to use`

Symptom:

- Running on a physical iPhone fails before install with no available signing certificate.

Cause:

- No valid iOS development identity exists in macOS keychain for your Apple Team.

Check:

```bash
security find-identity -v -p codesigning
```

If it returns `0 valid identities found`, configure signing:

1. Xcode > Settings > Accounts: sign in with your Apple ID.
2. Manage Certificates... > `+` > `Apple Development`.
3. Open `ios/HaHaai.xcworkspace`.
4. Target `HaHaai` > Signing & Capabilities:
   - enable `Automatically manage signing`
   - select your `Team`
   - set a unique bundle id (e.g. `com.<you>.hahaai`)
5. On iPhone: enable Developer Mode and trust the developer profile.

Then retry:

```bash
cd /Users/laurentbernier/Documents/HAHA_app
npx expo run:ios --device
```

## 24) Device app launches but responses are mock-like / unrelated

Symptom:

- App is installed and runs, but answers are generic and ignore context.

Common cause in Expo production builds:

- `EXPO_PUBLIC_*` values are not being inlined because env vars were read through dynamic objects instead of direct `process.env.EXPO_PUBLIC_*`.
- App then falls back to defaults (`USE_MOCK_LLM=true`) and uses mock replies.

Fix used in this project:

1. Ensure `src/config/env.ts` uses direct reads:
   - `process.env.EXPO_PUBLIC_USE_MOCK_LLM`
   - `process.env.EXPO_PUBLIC_CLAUDE_PROXY_URL`
   - `process.env.EXPO_PUBLIC_ANTHROPIC_MODEL`
2. Rebuild and reinstall app (especially Release builds):

```bash
cd /Users/laurentbernier/Documents/HAHA_app
npx expo run:ios --device --configuration Release
```

3. Verify backend quickly:

```bash
curl -sS -X POST "https://<your-project>.vercel.app/api/claude" \
  -H "Content-Type: application/json" \
  --data '{"model":"claude-sonnet-4-5-20250929","maxTokens":64,"temperature":0.2,"stream":false,"systemPrompt":"Reply in one short sentence.","messages":[{"role":"user","content":"Say hello in French."}]}'
```

## 25) Physical iPhone shows red screen `No script URL provided`

Symptom:

- On device debug builds, redbox shows `unsanitizedScriptURLString = (null)`.

Cause:

- Debug app could not resolve Metro URL at launch.

Fix used in this project:

- `ios/HaHaai/AppDelegate.swift` includes a debug fallback:
  - tries default `RCTBundleURLProvider` URL
  - then tries host from bundled `ip.txt`
  - then falls back to `http://localhost:8081`

Operational guidance:

1. Keep Metro running:

```bash
npm run start -- --clear
```

2. Rebuild/run on device:

```bash
npx expo run:ios --device
```

3. If you want no Metro dependency, install Release build:

```bash
npx expo run:ios --device --configuration Release
```
