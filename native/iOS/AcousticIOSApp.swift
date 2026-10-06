import AVFoundation
import SwiftUI
import WebKit

@main
struct AcousticIOSApp: App {
    var body: some Scene {
        WindowGroup {
            SitePickerView()
        }
    }
}

struct SitePickerView: View {
    @AppStorage("siteURL") private var savedSite = ""
    @State private var draftSite = ""
    @State private var errorMessage: String?

    private var siteURL: URL? {
        let value = savedSite.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: value), url.scheme == "https", url.host != nil else {
            return nil
        }
        return url
    }

    var body: some View {
        Group {
            if let siteURL {
                VStack(spacing: 0) {
                    HStack {
                        Text(siteURL.host ?? "")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                        Spacer()
                        Button("接続先") { savedSite = "" }
                            .font(.caption.weight(.medium))
                    }
                    .padding(.horizontal, 14)
                    .frame(height: 38)
                    MeasurementWebView(url: siteURL)
                }
                .ignoresSafeArea(edges: .bottom)
                .id(siteURL.host)
            } else {
                setup
            }
        }
        .preferredColorScheme(.dark)
    }

    private var setup: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("IMMERSIVE / ACOUSTIC LAB")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.mint)
            Text("測定コントローラー")
                .font(.largeTitle.bold())
            Text("Web画面でAVRを操作し、測定結果を確認できます。録音はこのiPhone/iPadのマイク入力を使います。")
                .foregroundStyle(.secondary)
            TextField("https://測定画面のURL", text: $draftSite)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .textFieldStyle(.roundedBorder)
                .onSubmit(saveSite)
            if let errorMessage {
                Text(errorMessage).foregroundStyle(.red)
            }
            Button("測定画面を開く", action: saveSite)
                .buttonStyle(.borderedProminent)
            Text("HTTPSのWeb画面を入力してください。マイク許可は録音を開始した時だけ求めます。")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding(28)
        .frame(maxWidth: 560, maxHeight: .infinity, alignment: .leading)
        .background(Color(red: 0.055, green: 0.075, blue: 0.07))
    }

    private func saveSite() {
        guard let url = URL(string: draftSite.trimmingCharacters(in: .whitespacesAndNewlines)),
              url.scheme == "https", url.host != nil else {
            errorMessage = "HTTPSのURLを入力してください。"
            return
        }
        errorMessage = nil
        savedSite = url.absoluteString
    }
}

struct MeasurementWebView: UIViewRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator {
        Coordinator(allowedHost: url.host ?? "")
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.applicationNameForUserAgent = "AcousticIOS/1"
        configuration.allowsInlineMediaPlayback = true
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.uiDelegate = context.coordinator
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        guard webView.url?.absoluteString != url.absoluteString else { return }
        webView.load(URLRequest(url: url))
    }

    @MainActor
    final class Coordinator: NSObject, WKUIDelegate, WKNavigationDelegate {
        private let allowedHost: String

        init(allowedHost: String) {
            self.allowedHost = allowedHost
        }

        func webView(
            _ webView: WKWebView,
            requestMediaCapturePermissionFor origin: WKSecurityOrigin,
            initiatedByFrame frame: WKFrameInfo,
            type: WKMediaCaptureType,
            decisionHandler: @escaping (WKPermissionDecision) -> Void
        ) {
            guard origin.protocol == "https",
                  origin.host.caseInsensitiveCompare(allowedHost) == .orderedSame,
                  type == .microphone else {
                decisionHandler(.deny)
                return
            }

            switch AVCaptureDevice.authorizationStatus(for: .audio) {
            case .authorized:
                decisionHandler(.grant)
            case .notDetermined:
                AVCaptureDevice.requestAccess(for: .audio) { granted in
                    Task { @MainActor in
                        decisionHandler(granted ? .grant : .deny)
                    }
                }
            default:
                decisionHandler(.deny)
            }
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let target = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }
            if target.scheme == "https",
               target.host?.caseInsensitiveCompare(allowedHost) == .orderedSame {
                decisionHandler(.allow)
            } else {
                decisionHandler(.cancel)
            }
        }
    }
}
