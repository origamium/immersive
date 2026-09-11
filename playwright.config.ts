import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// A quiet deterministic microphone avoids the default fake device's clipping.
const microphoneFile = resolve(".cache/synthetic-microphone.wav");
mkdirSync(resolve(".cache"), { recursive: true });
const frames = 48_000 * 30;
const wave = Buffer.alloc(44 + frames * 2);
wave.write("RIFF", 0);
wave.writeUInt32LE(wave.length - 8, 4);
wave.write("WAVEfmt ", 8);
wave.writeUInt32LE(16, 16);
wave.writeUInt16LE(1, 20);
wave.writeUInt16LE(1, 22);
wave.writeUInt32LE(48_000, 24);
wave.writeUInt32LE(96_000, 28);
wave.writeUInt16LE(2, 32);
wave.writeUInt16LE(16, 34);
wave.write("data", 36);
wave.writeUInt32LE(frames * 2, 40);
for (let frame = 0; frame < frames; frame++) {
  wave.writeInt16LE(
    Math.round(1600 * Math.sin((2 * Math.PI * 440 * frame) / 48_000)),
    44 + frame * 2
  );
}
writeFileSync(microphoneFile, wave);
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  use: { baseURL: "http://127.0.0.1:5173", trace: "retain-on-failure" },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        permissions: ["microphone"],
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            `--use-file-for-fake-audio-capture=${microphoneFile}`,
          ],
        },
      },
    },
    {
      name: "iphone",
      use: { ...devices["iPhone 13"], defaultBrowserType: "webkit" },
    },
  ],
  webServer: {
    command: "pnpm dev --host 127.0.0.1",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
  },
});
