import Expo
import React
import ReactAppDependencyProvider

@UIApplicationMain
public class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory
    bindReactNativeFactory(factory)

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // Expo dev-client may occasionally provide `/expo/.virtual-metro-entry`,
    // while Metro serves `/.expo/.virtual-metro-entry`.
    if let bridgeURL = bridge.bundleURL {
      return normalizedDevBundleURL(bridgeURL)
    }
    return bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    let bundleRoot = ".expo/.virtual-metro-entry"
    let provider = RCTBundleURLProvider.sharedSettings()

    if let url = provider.jsBundleURL(forBundleRoot: bundleRoot) {
      return url
    }

    if let ipFileURL = Bundle.main.url(forResource: "ip", withExtension: "txt"),
       let ip = try? String(contentsOf: ipFileURL).trimmingCharacters(in: .whitespacesAndNewlines),
       !ip.isEmpty {
      return URL(string: "http://\(ip):8081/\(bundleRoot).bundle?platform=ios&dev=true&minify=false")
    }

    return URL(string: "http://localhost:8081/\(bundleRoot).bundle?platform=ios&dev=true&minify=false")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }

  private func normalizedDevBundleURL(_ url: URL) -> URL {
#if DEBUG
    let legacyPath = "/expo/.virtual-metro-entry.bundle"
    let expectedPath = "/.expo/.virtual-metro-entry.bundle"
    guard url.path == legacyPath,
      var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
    else {
      return url
    }
    components.path = expectedPath
    return components.url ?? url
#else
    return url
#endif
  }
}
