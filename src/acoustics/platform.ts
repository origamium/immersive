/** True only inside the signed Acoustic Lab iOS WKWebView host. */
export function isIOSCaptureHost() {
  return (
    typeof navigator !== "undefined" &&
    navigator.userAgent.includes("AcousticIOS/1")
  );
}
