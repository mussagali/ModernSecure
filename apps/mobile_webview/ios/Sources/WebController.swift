import UIKit
import WebKit
import QuickLook
import FirebaseCore
import FirebaseMessaging
import UserNotifications

final class WebController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKDownloadDelegate, QLPreviewControllerDataSource, QLPreviewControllerDelegate {
    private var web: WKWebView!
    private var site: URL!
    private var previewURL: URL?
    private var downloads: [ObjectIdentifier: URL] = [:]
    private var observers: [NSObjectProtocol] = []
    private var pushWaiting = false
    private let progress = UIProgressView(progressViewStyle: .default)
    private var progressObservation: NSKeyValueObservation?
    private let errorScroll = UIScrollView()
    private let errorStack = UIStackView()
    private let errorTitle = UILabel()
    private let errorLabel = UILabel()
    private let retryButton = UIButton(type: .system)

    override func viewDidLoad() {
        super.viewDidLoad()
        overrideUserInterfaceStyle = .light
        view.backgroundColor = NativePalette.canvas
        view.tintColor = NativePalette.accent
        configureErrorView()
        let configured = Bundle.main.object(forInfoDictionaryKey: "SiteURL") as? String ?? ""
        guard let url = URL(string: configured), url.host != nil, url.user == nil,
              url.scheme == "https" || (url.scheme == "http" && url.host == "localhost" && isDebug) else {
            errorTitle.text = "Приложение не настроено"
            retryButton.isHidden = true
            showError("Для приложения не настроен адрес сайта.")
            return
        }
        site = url
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.userContentController.add(WeakScriptHandler(self), name: "ModernSecureNative")
        config.userContentController.addUserScript(WKUserScript(source: "window.ModernSecureNative={postMessage:function(message){window.webkit.messageHandlers.ModernSecureNative.postMessage(message)}};", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self; web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = true
        web.customUserAgent = nil
        web.isOpaque = false
        web.backgroundColor = NativePalette.canvas
        web.scrollView.backgroundColor = NativePalette.canvas
        if #available(iOS 16.4, *) { web.isInspectable = isDebug }
        web.translatesAutoresizingMaskIntoConstraints = false
        view.insertSubview(web, belowSubview: errorScroll)
        NSLayoutConstraint.activate([web.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), web.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor), web.leadingAnchor.constraint(equalTo: view.leadingAnchor), web.trailingAnchor.constraint(equalTo: view.trailingAnchor)])
        progress.progressTintColor = NativePalette.accent
        progress.trackTintColor = NativePalette.line
        progress.isAccessibilityElement = false
        progress.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(progress)
        NSLayoutConstraint.activate([progress.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), progress.leadingAnchor.constraint(equalTo: view.leadingAnchor), progress.trailingAnchor.constraint(equalTo: view.trailingAnchor), progress.heightAnchor.constraint(equalToConstant: 2)])
        progressObservation = web.observe(\.estimatedProgress, options: [.new]) { [weak self] web, _ in
            guard let self else { return }
            self.progress.setProgress(Float(web.estimatedProgress), animated: false)
            self.progress.isHidden = web.estimatedProgress >= 1 || !self.errorScroll.isHidden
        }
        observers.append(NotificationCenter.default.addObserver(forName: .init("ModernSecureNotification"), object: nil, queue: .main) { [weak self] _ in self?.openPendingNotification() })
        observers.append(NotificationCenter.default.addObserver(forName: .init("ModernSecureAPNsReady"), object: nil, queue: .main) { [weak self] _ in self?.sendPushToken() })
        observers.append(NotificationCenter.default.addObserver(forName: .init("ModernSecureAPNsFailed"), object: nil, queue: .main) { [weak self] _ in self?.reply(["configured": true, "error": true]) })
        web.load(URLRequest(url: site.appendingPathComponent("login")))
        openPendingNotification()
    }
    private var isDebug: Bool {
        #if DEBUG
        return true
        #else
        return false
        #endif
    }
    private func ownOrigin(_ url: URL?) -> Bool {
        guard let url, let site else { return false }
        return url.user == nil && url.scheme == site.scheme && url.host == site.host && (url.port ?? (url.scheme == "https" ? 443 : 80)) == (site.port ?? (site.scheme == "https" ? 443 : 80))
    }
    private func configureErrorView() {
        errorScroll.translatesAutoresizingMaskIntoConstraints = false
        errorScroll.backgroundColor = NativePalette.canvas
        errorScroll.alwaysBounceVertical = false
        view.addSubview(errorScroll)
        let content = UIView()
        content.translatesAutoresizingMaskIntoConstraints = false
        errorScroll.addSubview(content)
        errorStack.axis = .vertical
        errorStack.spacing = 12
        errorStack.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(errorStack)
        let preferredWidth = errorStack.widthAnchor.constraint(equalTo: content.widthAnchor, constant: -48)
        preferredWidth.priority = .defaultHigh
        let preferredHeight = content.heightAnchor.constraint(equalTo: errorScroll.frameLayoutGuide.heightAnchor)
        preferredHeight.priority = .defaultLow
        NSLayoutConstraint.activate([
            errorScroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            errorScroll.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            errorScroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            errorScroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            content.topAnchor.constraint(equalTo: errorScroll.contentLayoutGuide.topAnchor),
            content.bottomAnchor.constraint(equalTo: errorScroll.contentLayoutGuide.bottomAnchor),
            content.leadingAnchor.constraint(equalTo: errorScroll.contentLayoutGuide.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: errorScroll.contentLayoutGuide.trailingAnchor),
            content.widthAnchor.constraint(equalTo: errorScroll.frameLayoutGuide.widthAnchor),
            content.heightAnchor.constraint(greaterThanOrEqualTo: errorScroll.frameLayoutGuide.heightAnchor),
            errorStack.centerXAnchor.constraint(equalTo: content.centerXAnchor),
            errorStack.centerYAnchor.constraint(equalTo: content.centerYAnchor),
            errorStack.topAnchor.constraint(greaterThanOrEqualTo: content.topAnchor, constant: 32),
            errorStack.bottomAnchor.constraint(lessThanOrEqualTo: content.bottomAnchor, constant: -32),
            errorStack.leadingAnchor.constraint(greaterThanOrEqualTo: content.leadingAnchor, constant: 24),
            errorStack.trailingAnchor.constraint(lessThanOrEqualTo: content.trailingAnchor, constant: -24),
            errorStack.widthAnchor.constraint(lessThanOrEqualToConstant: 360),
            preferredWidth,
            preferredHeight
        ])
        let mark = UIImageView(image: NativePalette.brandMark())
        mark.contentMode = .center
        mark.isAccessibilityElement = false
        mark.heightAnchor.constraint(equalToConstant: 40).isActive = true
        errorStack.addArrangedSubview(mark)
        errorStack.setCustomSpacing(20, after: mark)
        errorTitle.text = "Не удалось загрузить страницу"
        errorTitle.font = UIFontMetrics(forTextStyle: .title2).scaledFont(for: .systemFont(ofSize: 24, weight: .semibold))
        errorTitle.textColor = NativePalette.ink
        errorTitle.numberOfLines = 0
        errorTitle.textAlignment = .center
        errorTitle.adjustsFontForContentSizeCategory = true
        errorTitle.accessibilityTraits.insert(.header)
        errorStack.addArrangedSubview(errorTitle)
        errorLabel.numberOfLines = 0
        errorLabel.font = .preferredFont(forTextStyle: .body)
        errorLabel.textColor = NativePalette.muted
        errorLabel.textAlignment = .center
        errorLabel.adjustsFontForContentSizeCategory = true
        errorStack.addArrangedSubview(errorLabel)
        errorStack.setCustomSpacing(24, after: errorLabel)
        var retry = UIButton.Configuration.filled()
        retry.title = "Повторить попытку"
        retry.baseForegroundColor = .white
        retry.baseBackgroundColor = NativePalette.accent
        retry.background.cornerRadius = 10
        retry.cornerStyle = .fixed
        retry.contentInsets = NSDirectionalEdgeInsets(top: 14, leading: 24, bottom: 14, trailing: 24)
        retry.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var attributes = incoming
            attributes.font = UIFontMetrics(forTextStyle: .body).scaledFont(for: .systemFont(ofSize: 16, weight: .semibold))
            return attributes
        }
        retryButton.configuration = retry
        retryButton.titleLabel?.adjustsFontForContentSizeCategory = true
        retryButton.titleLabel?.numberOfLines = 0
        retryButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 48).isActive = true
        retryButton.addTarget(self, action: #selector(retryPage), for: .touchUpInside)
        errorStack.addArrangedSubview(retryButton)
        errorScroll.isHidden = true
    }
    @objc private func retryPage() { errorScroll.isHidden = true; web.isHidden = false; web.load(URLRequest(url: web.url ?? site.appendingPathComponent("login"))) }
    private func showError(_ message: String) {
        errorLabel.text = message
        errorScroll.isHidden = false
        web?.isHidden = true
        progress.isHidden = true
        UIAccessibility.post(notification: .screenChanged, argument: errorTitle)
    }
    private func openPendingNotification() {
        guard web != nil, let id = AppDelegate.pendingNotification, UUID(uuidString: id) != nil else { return }
        AppDelegate.pendingNotification = nil
        web.load(URLRequest(url: site.appendingPathComponent("notifications/open/\(id)")))
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard action.targetFrame?.isMainFrame != false else { decisionHandler(.allow); return }
        if ownOrigin(action.request.url) {
            let path = action.request.url?.path ?? ""
            if path.range(of: "^/api/(document-files|contracts|payment-receipts|message-attachments|staff-message-attachments)/[0-9a-fA-F-]{36}$", options: .regularExpression) != nil {
                web.startDownload(using: action.request) { [weak self] download in download.delegate = self }
                decisionHandler(.cancel)
            } else if action.shouldPerformDownload { decisionHandler(.download) }
            else if action.targetFrame == nil { web.load(action.request); decisionHandler(.cancel) }
            else { decisionHandler(.allow) }
        } else {
            if action.navigationType == .linkActivated, let url = action.request.url, ["https", "tel", "mailto"].contains(url.scheme ?? "") { UIApplication.shared.open(url) }
            decisionHandler(.cancel)
        }
    }
    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if let http = response.response as? HTTPURLResponse, http.statusCode >= 500, response.isForMainFrame {
            showError("Сайт временно недоступен. Попробуйте ещё раз позже."); decisionHandler(.cancel); return
        }
        let attachment = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition")?.hasPrefix("attachment") == true
        decisionHandler(!response.canShowMIMEType || attachment ? .download : .allow)
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { if (error as NSError).code != NSURLErrorCancelled { showError("Не удалось открыть сайт. Проверьте подключение и повторите попытку.") } }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { if (error as NSError).code != NSURLErrorCancelled { showError("Загрузка прервалась. Повторите попытку.") } }
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        errorScroll.isHidden = true
        web.isHidden = false
        progress.setProgress(0, animated: false)
        progress.isHidden = false
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { errorScroll.isHidden = true; web.isHidden = false; progress.isHidden = true }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let safeName = URL(fileURLWithPath: suggestedFilename).lastPathComponent
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        do { try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let destination = directory.appendingPathComponent(safeName); downloads[ObjectIdentifier(download)] = destination; completionHandler(destination)
        } catch { completionHandler(nil) }
    }
    func downloadDidFinish(_ download: WKDownload) {
        guard let url = downloads.removeValue(forKey: ObjectIdentifier(download)) else { return }
        previewURL = url; let preview = QLPreviewController(); preview.dataSource = self; preview.delegate = self; present(preview, animated: true)
    }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        if let url = downloads.removeValue(forKey: ObjectIdentifier(download)) { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let alert = UIAlertController(title: "Документ не скачан", message: "Проверьте подключение и доступ к файлу.", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Закрыть", style: .default)); present(alert, animated: true)
    }
    func numberOfPreviewItems(in controller: QLPreviewController) -> Int { previewURL == nil ? 0 : 1 }
    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { previewURL! as NSURL }
    func previewControllerDidDismiss(_ controller: QLPreviewController) {
        if let url = previewURL { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        previewURL = nil
    }
    func download(_ download: WKDownload, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, decisionHandler: @escaping (WKDownload.RedirectPolicy) -> Void) {
        let url = request.url
        let signedStorage = url?.scheme == "https" && url?.user == nil && url?.host?.hasSuffix(".supabase.co") == true && url?.path.hasPrefix("/storage/v1/object/sign/") == true
        decisionHandler(ownOrigin(url) || signedStorage ? .allow : .cancel)
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        let origin = message.frameInfo.securityOrigin
        let port = origin.port == 0 ? (origin.protocol == "https" ? 443 : 80) : origin.port
        guard message.frameInfo.isMainFrame, origin.protocol == site.scheme, origin.host == site.host,
              port == (site.port ?? (site.scheme == "https" ? 443 : 80)), let action = message.body as? String else { return }
        guard FirebaseApp.app() != nil else { reply(["configured": false]); return }
        if action == "enable" {
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { [weak self] granted, _ in
                DispatchQueue.main.async {
                    if granted { UserDefaults.standard.set(true, forKey: "pushEnabled"); self?.pushWaiting = true; UIApplication.shared.registerForRemoteNotifications() }
                    else { self?.reply(["configured": true, "enabled": false, "denied": true]) }
                }
            }
        } else if action == "status" {
            UNUserNotificationCenter.current().getNotificationSettings { [weak self] settings in
                DispatchQueue.main.async {
                    if settings.authorizationStatus == .denied { self?.reply(["configured": true, "enabled": false, "denied": true]) }
                    else if UserDefaults.standard.bool(forKey: "pushEnabled") { self?.pushWaiting = true; UIApplication.shared.registerForRemoteNotifications() }
                    else { self?.reply(["configured": true, "enabled": false]) }
                }
            }
        } else if action == "settings" {
            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
        } else if action == "disable" {
            UserDefaults.standard.set(false, forKey: "pushEnabled")
            pushWaiting = false
            Messaging.messaging().isAutoInitEnabled = false
            Messaging.messaging().deleteToken { [weak self] error in
                DispatchQueue.main.async {
                    self?.reply(["configured": true, "enabled": false, "error": error != nil])
                }
            }
        }
    }
    private func sendPushToken() {
        guard pushWaiting, FirebaseApp.app() != nil, Messaging.messaging().apnsToken != nil else { return }
        pushWaiting = false; Messaging.messaging().isAutoInitEnabled = true
        // The server uses FCM registration tokens. Migrating to Firebase's newer
        // installation-ID API requires a coordinated server transport change.
        Messaging.messaging().token { [weak self] token, error in
            DispatchQueue.main.async {
                guard let token, error == nil else { self?.reply(["configured": true, "error": true]); return }
                let defaults = UserDefaults.standard
                let id = defaults.string(forKey: "installation") ?? UUID().uuidString
                let secret = defaults.string(forKey: "installationSecret") ?? UUID().uuidString
                defaults.set(id, forKey: "installation"); defaults.set(secret, forKey: "installationSecret")
                self?.reply(["configured": true, "enabled": true, "token": token, "installationId": id, "secret": secret, "platform": "ios"])
            }
        }
    }
    private func reply(_ value: [String: Any]) {
        guard ownOrigin(web.url), let data = try? JSONSerialization.data(withJSONObject: value), let json = String(data: data, encoding: .utf8),
              let encoded = try? JSONSerialization.data(withJSONObject: [json]), let array = String(data: encoded, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.ModernSecureNative?.onmessage?.({data:\(array)[0]})")
    }
    deinit { observers.forEach { NotificationCenter.default.removeObserver($0) } }
}

private enum NativePalette {
    static let canvas = UIColor(red: 244 / 255, green: 246 / 255, blue: 248 / 255, alpha: 1)
    static let ink = UIColor(red: 23 / 255, green: 43 / 255, blue: 54 / 255, alpha: 1)
    static let muted = UIColor(red: 92 / 255, green: 109 / 255, blue: 121 / 255, alpha: 1)
    static let line = UIColor(red: 221 / 255, green: 228 / 255, blue: 232 / 255, alpha: 1)
    static let accent = UIColor(red: 23 / 255, green: 107 / 255, blue: 91 / 255, alpha: 1)

    static func brandMark() -> UIImage {
        UIGraphicsImageRenderer(size: CGSize(width: 40, height: 40)).image { context in
            accent.setFill()
            UIBezierPath(roundedRect: CGRect(x: 0, y: 0, width: 40, height: 40), cornerRadius: 10).fill()
            context.cgContext.translateBy(x: 8, y: 6)
            let shield = UIBezierPath()
            shield.move(to: CGPoint(x: 12, y: 2))
            shield.addLine(to: CGPoint(x: 3, y: 6))
            shield.addLine(to: CGPoint(x: 3, y: 14))
            shield.addCurve(to: CGPoint(x: 12, y: 25), controlPoint1: CGPoint(x: 3, y: 20), controlPoint2: CGPoint(x: 12, y: 25))
            shield.addCurve(to: CGPoint(x: 21, y: 14), controlPoint1: CGPoint(x: 12, y: 25), controlPoint2: CGPoint(x: 21, y: 20))
            shield.addLine(to: CGPoint(x: 21, y: 6))
            shield.close()
            shield.move(to: CGPoint(x: 8, y: 13))
            shield.addLine(to: CGPoint(x: 11, y: 16))
            shield.addLine(to: CGPoint(x: 16, y: 10))
            shield.lineWidth = 1.8
            shield.lineCapStyle = .round
            shield.lineJoinStyle = .round
            UIColor.white.setStroke()
            shield.stroke()
        }
    }
}

private final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    weak var delegate: WKScriptMessageHandler?
    init(_ delegate: WKScriptMessageHandler) { self.delegate = delegate }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        delegate?.userContentController(controller, didReceive: message)
    }
}
