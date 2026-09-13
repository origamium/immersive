# HAP compatibility patch

Source: Bouke/HAP tag **0.7.0**, https://github.com/Bouke/HAP/tree/0.7.0 . The upstream MIT license is retained.

Changes:
- Swift tools 5.1 and an explicit macOS 10.15 platform declaration.
- Pin SRP **3.1.0**. Upstream's `from: 3.1.0` selects 3.2.1, whose generic hash API is incompatible with HAP 0.7.0. No cryptographic implementation is changed.
- Omit upstream tests from this vendored manifest; the application has its own integration tests.
- Release the allocated QR bitmap buffer with `defer`.

All transitive dependency versions are recorded in the root Package.resolved. HAP is linked only to the Mac executable. libsodium must be available for building and must be packaged for distributing the Mac app; a Homebrew library built for macOS 26 cannot support older macOS deployment targets.
