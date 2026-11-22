import SwiftUI
import WebKit
import Security
import UniformTypeIdentifiers
import OSLog

private let log = Logger(subsystem: "privatebooks.readingpartner.apple", category: "reader")
private struct Connection: Decodable {
    let hosts: [String]
    let port: Int
}
private let connection: Connection = {
    guard let url = Bundle.main.url(forResource: "connection", withExtension: "json"),
          let data = try? Data(contentsOf: url),
          let value = try? JSONDecoder().decode(Connection.self, from: data), !value.hosts.isEmpty
    else { preconditionFailure("Missing build-time connection configuration") }
    return value
}()
private let port = connection.port
#if os(macOS) || targetEnvironment(simulator)
private let hosts = ["127.0.0.1"] + connection.hosts.filter { $0 != "127.0.0.1" }
#else
private let hosts = connection.hosts
#endif

struct MarkFile: FileDocument {
    static let readableContentTypes = [UTType.json]
    var data: Data
    init(_ data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws { data = configuration.file.regularFileContents ?? Data() }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}

@MainActor
final class Reader: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    @Published var setup = false
    @Published var notice = ""
    @Published var export = false
    var marks = MarkFile(Data())
    var host = UserDefaults.standard.string(forKey: "serverHost").flatMap { hosts.contains($0) ? $0 : nil } ?? hosts[0]
    private(set) lazy var web: WKWebView = {
        let config = WKWebViewConfiguration()
        let controller = config.userContentController
        controller.addUserScript(WKUserScript(source: "window.ReadingExports={saveMarks:text=>window.webkit.messageHandlers.saveMarks.postMessage(text)}", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        controller.add(self, name: "saveMarks")
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = self
        view.uiDelegate = self
        return view
    }()
    private var origin: URL { URL(string: "https://\(host):\(port)")! }
    private func sameOrigin(_ url: URL?) -> Bool { url?.scheme == "https" && url?.host == host && url?.port == port }
    func connect(host: String, code: String = "") {
        guard hosts.contains(host) else { return }
        var token = code.trimmingCharacters(in: .whitespacesAndNewlines)
        #if os(macOS)
        if token.isEmpty { token = (try? String(contentsOf: FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("ReadingPartner/data/apple-mac.pair"), encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "" }
        #elseif targetEnvironment(simulator)
        let seed = FileManager.default.temporaryDirectory.appendingPathComponent("simulator.pair")
        if token.isEmpty, let value = try? String(contentsOf: seed, encoding: .utf8) {
            token = value.trimmingCharacters(in: .whitespacesAndNewlines)
            try? FileManager.default.removeItem(at: seed)
        }
        #endif
        guard token.isEmpty || token.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil else { notice = "请输入完整的 64 位配对码"; return }
        self.host = host
        UserDefaults.standard.set(host, forKey: "serverHost")
        setup = false
        notice = ""
        let request = URLRequest(url: origin, timeoutInterval: 12)
        guard !token.isEmpty else { web.load(request); return }
        let header = "__Host-rp=\(token); Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=31536000"
        guard let cookie = HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": header], for: origin).first else {
            setup = true; notice = "无法保存配对信息"; return
        }
        web.configuration.websiteDataStore.httpCookieStore.setCookie(cookie) { [weak self] in
            self?.web.load(request)
        }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(sameOrigin(navigationAction.request.url) && navigationAction.targetFrame != nil ? .allow : .cancel)
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if navigationResponse.isForMainFrame, let response = navigationResponse.response as? HTTPURLResponse, response.statusCode >= 400 {
            notice = response.statusCode == 401 ? "请输入此设备的配对码" : "服务器返回 HTTP \(response.statusCode)"
            setup = true
            decisionHandler(.cancel)
        } else { decisionHandler(.allow) }
    }
    func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        let space = challenge.protectionSpace
        guard space.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              space.host == host, space.port == port, let trust = space.serverTrust,
              let url = Bundle.main.url(forResource: "library-ca", withExtension: "der"),
              let bytes = try? Data(contentsOf: url), let ca = SecCertificateCreateWithData(nil, bytes as CFData),
              SecTrustSetPolicies(trust, SecPolicyCreateSSL(true, host as CFString)) == errSecSuccess,
              SecTrustSetAnchorCertificates(trust, [ca] as CFArray) == errSecSuccess,
              SecTrustSetAnchorCertificatesOnly(trust, true) == errSecSuccess,
              SecTrustEvaluateWithError(trust, nil) else { completionHandler(.cancelAuthenticationChallenge,nil); return }
        completionHandler(.useCredential, URLCredential(trust: trust))
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        log.notice("Loaded library page: \(webView.title ?? "", privacy: .public)")
    }
    private func failure(_ error: Error) {
        if (error as NSError).code == NSURLErrorCancelled || (error as NSError).domain == "WebKitErrorDomain" && (error as NSError).code == 102 { return }
        notice = error.localizedDescription
        setup = true
        log.error("Library load failed: \(error.localizedDescription, privacy: .public)")
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failure(error) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failure(error) }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, sameOrigin(message.frameInfo.request.url), let text = message.body as? String else { return }
        marks = MarkFile(Data(text.utf8)); export = true
    }
    #if os(macOS)
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.begin { result in completionHandler(result == .OK ? panel.urls : nil) }
    }
    #endif
}

#if os(macOS)
struct WebSurface: NSViewRepresentable {
    let reader: Reader
    func makeNSView(context: Context) -> WKWebView { reader.web }
    func updateNSView(_ view: WKWebView, context: Context) {}
}
#else
struct WebSurface: UIViewRepresentable {
    let reader: Reader
    func makeUIView(context: Context) -> WKWebView { reader.web }
    func updateUIView(_ view: WKWebView, context: Context) {}
}
#endif

struct LibraryView: View {
    @StateObject private var reader = Reader()
    @State private var host = hosts[0]
    @State private var code = ""
    var body: some View {
        ZStack {
            WebSurface(reader: reader)
            if reader.setup {
                Rectangle().fill(.background).ignoresSafeArea()
                VStack(alignment: .leading, spacing: 16) {
                    Text("连接私人书库").font(.title2.bold())
                    Text(reader.notice).font(.callout)
                    Picker("服务器", selection: $host) { ForEach(hosts, id: \.self) { Text($0).tag($0) } }
                    SecureField("设备配对码", text: $code).textFieldStyle(.roundedBorder)
                    Button("连接") { reader.connect(host: host, code: code); code = "" }.buttonStyle(.borderedProminent)
                }.padding(24).frame(maxWidth: 420)
            }
        }
        .onAppear { host = reader.host; if reader.web.url == nil { reader.connect(host: host) } }
        .fileExporter(isPresented: $reader.export, document: reader.marks, contentType: .json, defaultFilename: "reading-marks") { _ in }
    }
}

@main
struct ReadingPartnerApp: App {
    var body: some Scene {
        WindowGroup("Reading Partner") { LibraryView() }
        #if os(macOS)
        .defaultSize(width: 1400, height: 900)
        #endif
    }
}
