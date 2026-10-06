import { expect, type Page, test } from "@playwright/test";

// Two synthetic inputs feed only a MediaStreamDestination, never loudspeakers.
// Channel 1 is 110 Hz and channel 2 is 440 Hz, so unintended downmix is visible.
async function installMicrophone(
  page: Page,
  delaySecondRequest = false,
  acousticLoop = false
) {
  await page.addInitScript(
    ({ delayed, loop }) => {
      type TestWindow = Window & {
        audioTestStreams: MediaStream[];
        audioTestPending: boolean;
        audioTestRelease?: () => void;
        audioTestPlaybackConnections: number;
      };
      const state = window as unknown as TestWindow;
      state.audioTestStreams = [];
      state.audioTestPending = false;
      state.audioTestPlaybackConnections = 0;
      const OriginalAudioContext = window.AudioContext;
      const loopDestinations = new WeakMap<
        AudioContext,
        MediaStreamAudioDestinationNode
      >();
      let playbackContext: AudioContext | undefined;
      if (loop) {
        window.AudioContext = class extends OriginalAudioContext {
          constructor(options?: AudioContextOptions) {
            super(options);
            playbackContext = this;
          }
          createBufferSource() {
            const source = super.createBufferSource();
            const connect = source.connect.bind(source);
            source.connect = ((
              destination: AudioNode,
              output = 0,
              input = 0
            ) => {
              if (destination !== this.destination)
                return connect(destination, output, input);
              const microphone = loopDestinations.get(this);
              if (!microphone)
                throw new Error(
                  "Virtual microphone is not ready; refusing hardware playback"
                );
              const attenuation = this.createGain();
              attenuation.gain.value = 0.4;
              const delay = this.createDelay();
              delay.delayTime.value = 0.02;
              connect(attenuation, output, 0);
              attenuation.connect(delay).connect(microphone);
              state.audioTestPlaybackConnections++;
              return destination;
            }) as typeof source.connect;
            return source;
          }
        };
      }
      let calls = 0;
      const generate = async () => {
        const shared =
          loop && playbackContext?.state !== "closed"
            ? playbackContext
            : undefined;
        const context =
          shared ?? new OriginalAudioContext({ sampleRate: 48000 });
        const destination = context.createMediaStreamDestination();
        destination.channelCount = 2;
        destination.channelCountMode = "explicit";
        destination.channelInterpretation = "discrete";
        if (loop) loopDestinations.set(context, destination);
        else {
          const merger = context.createChannelMerger(2);
          merger.connect(destination);
          for (const [index, hz] of [110, 440].entries()) {
            const oscillator = context.createOscillator();
            const gain = context.createGain();
            oscillator.frequency.value = hz;
            gain.gain.value = 0.03;
            oscillator.connect(gain).connect(merger, 0, index);
            oscillator.start();
          }
        }
        await context.resume();
        const stream = destination.stream;
        const track = stream.getAudioTracks()[0];
        const stop = track.stop.bind(track);
        track.stop = () => {
          stop();
          if (!shared) void context.close();
        };
        track.getSettings = () => ({
          deviceId: "synthetic-ur12",
          channelCount: 2,
          sampleRate: 48000,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        });
        state.audioTestStreams.push(stream);
        return stream;
      };
      navigator.mediaDevices.getUserMedia = async () => {
        calls++;
        if (delayed && calls === 2) {
          state.audioTestPending = true;
          await new Promise<void>((resolve) => {
            state.audioTestRelease = resolve;
          });
        }
        return generate();
      };
      navigator.mediaDevices.enumerateDevices = async () => [
        {
          deviceId: "synthetic-ur12",
          groupId: "synthetic",
          kind: "audioinput",
          label: "Synthetic Steinberg UR12",
          toJSON() {
            return {};
          },
        } as MediaDeviceInfo,
      ];
    },
    { delayed: delaySecondRequest, loop: acousticLoop }
  );
}

async function localRecords(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{
        captures: {
          id: string;
          chunkCount: number;
          purpose?: string;
          analysisOwner?: string;
          status: string;
          frames: number;
          context: {
            microphone: string;
            input?: { channel: number; channelCount: number };
          };
        }[];
        observations: {
          spectrumUnit: string;
          rmsDBFS: number;
          durationSeconds: number;
          spectrum: { hz: number; db: number }[];
        }[];
        results: {
          source: string;
          version: string;
          localCaptureId?: string;
          rawArtifactId: string | null;
          context: {
            speakerId: string;
            profile: { repeats: number };
            acquisition?: { outputChannel?: number };
          };
          quality: { level: string; clippedSamples: number };
          response: { hz: number; db: number }[];
        }[];
      }>((resolve, reject) => {
        const request = indexedDB.open("immersive-acoustics-v1");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(["captures", "observations", "results"]);
          const captures = tx.objectStore("captures").getAll();
          const observations = tx.objectStore("observations").getAll();
          const results = tx.objectStore("results").getAll();
          tx.oncomplete = () => {
            resolve({
              captures: captures.result,
              observations: observations.result,
              results: results.result,
            });
            db.close();
          };
          tx.onerror = () => reject(tx.error);
        };
      })
  );
}

async function configureInput(page: Page) {
  await page
    .getByRole("button", { name: "入出力機器を更新", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "USB録音入力", exact: true })
  ).toHaveValue("synthetic-ur12");
}

test.beforeEach(async ({ page }, info) => {
  test.skip(
    info.project.name !== "desktop",
    "Synthetic audio browser coverage runs in Chromium"
  );
  await installMicrophone(
    page,
    info.title.startsWith("stops during pending"),
    info.title.startsWith("measures an ESS")
  );
});

test("measures an ESS through a silent virtual acoustic loop and saves the browser result", async ({
  page,
}) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await configureInput(page);
  await page
    .getByRole("combobox", { name: "録音チャンネル", exact: true })
    .selectOption("2");
  await page
    .getByRole("combobox", { name: "ローカル測定スピーカー", exact: true })
    .selectOption("FR");
  await page
    .getByRole("combobox", { name: "スイープ時間 [秒]", exact: true })
    .selectOption("5");
  await page
    .getByRole("combobox", { name: "繰り返し回数", exact: true })
    .selectOption("1");
  await page
    .getByRole("textbox", { name: "出力経路の記録", exact: true })
    .fill("Virtual loop: gain 0.4, delay 20 ms");
  await page
    .getByRole("checkbox", {
      name: "接続先とアンプ音量を確認した",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "スイープ測定を開始", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "音響を解析", exact: true })
  ).toBeVisible({ timeout: 45000 });
  await expect(page.getByText("相対評価", { exact: true })).toBeVisible();
  const records = await localRecords(page);
  expect(records.captures).toHaveLength(1);
  expect(records.results).toHaveLength(1);
  expect(records.observations).toHaveLength(0);
  const capture = records.captures[0];
  expect(capture).toMatchObject({
    purpose: "sweep",
    analysisOwner: "browser",
    status: "complete",
    context: { input: { channel: 2, channelCount: 2 } },
  });
  expect(capture.frames).toBeGreaterThan(5 * 48000);
  expect(capture.chunkCount).toBeGreaterThan(1);
  const result = records.results[0];
  expect(result).toMatchObject({
    source: "sweep",
    localCaptureId: capture.id,
    rawArtifactId: null,
    quality: { level: "relative", clippedSamples: 0 },
    context: {
      speakerId: "FR",
      profile: { repeats: 1 },
      acquisition: { outputChannel: 2 },
    },
  });
  expect(result.version).toContain("browser");
  const midband = result.response
    .filter((point) => point.hz >= 200 && point.hz <= 4000)
    .map((point) => point.db)
    .sort((a, b) => a - b);
  expect(midband.length).toBeGreaterThan(10);
  expect(midband[Math.floor(midband.length / 2)]).toBeGreaterThan(-12);
  expect(midband[Math.floor(midband.length / 2)]).toBeLessThan(-4);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { audioTestPlaybackConnections: number })
          .audioTestPlaybackConnections
    )
  ).toBe(1);
  const rawBytes = await page.evaluate(
    (id) =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open("immersive-acoustics-v1");
        request.onsuccess = () => {
          const db = request.result;
          const read = db
            .transaction("chunks")
            .objectStore("chunks")
            .get(`${id}:0`);
          read.onsuccess = () => {
            resolve(read.result?.byteLength ?? 0);
            db.close();
          };
          read.onerror = () => {
            reject(read.error);
            db.close();
          };
        };
        request.onerror = () => reject(request.error);
      }),
    capture.id
  );
  expect(rawBytes).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("requires an input and output confirmation before starting local measurements", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "入力・スペクトルを確認", exact: true })
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "暗騒音を10秒測定", exact: true })
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "スイープ測定を開始", exact: true })
  ).toBeDisabled();
  await configureInput(page);
  await expect(
    page.getByRole("button", { name: "暗騒音を10秒測定", exact: true })
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "スイープ測定を開始", exact: true })
  ).toBeDisabled();
  await page
    .getByRole("textbox", { name: "出力経路の記録", exact: true })
    .fill("Synthetic silent output");
  await page
    .getByRole("checkbox", {
      name: "接続先とアンプ音量を確認した",
      exact: true,
    })
    .check();
  await expect(
    page.getByRole("button", { name: "スイープ測定を開始", exact: true })
  ).toBeEnabled();
  await page
    .getByRole("textbox", { name: "出力経路の記録", exact: true })
    .fill("Different output");
  await expect(
    page.getByRole("button", { name: "スイープ測定を開始", exact: true })
  ).toBeDisabled();
});

test("previews a discrete input channel without saving a capture", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await configureInput(page);
  await page
    .getByRole("combobox", { name: "録音チャンネル", exact: true })
    .selectOption("2");
  await page
    .getByRole("button", { name: "入力・スペクトルを確認", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "リアルタイム入力スペクトル",
      exact: true,
    })
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByRole("meter", { name: "ローカル入力ピーク dBFS" })
        .getAttribute("value")
    )
    .not.toBe("-80");
  await page
    .getByRole("button", { name: "■ 入力確認を停止", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "入力・スペクトルを確認", exact: true })
  ).toBeEnabled();
  expect(await localRecords(page)).toEqual({
    captures: [],
    observations: [],
    results: [],
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { audioTestStreams: MediaStream[] }
        ).audioTestStreams.every((stream) =>
          stream.getTracks().every((track) => track.readyState === "ended")
        )
      )
    )
    .toBe(true);
  expect(errors).toEqual([]);
});

test("records ten seconds of channel 2 ambient sound locally without cloud or response data", async ({
  page,
}) => {
  test.setTimeout(45000);
  const remoteRequests: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      ["http:", "https:"].includes(url.protocol) &&
      url.hostname !== "127.0.0.1"
    )
      remoteRequests.push(request.url());
  });
  await page.goto("/");
  await configureInput(page);
  await page
    .getByRole("combobox", { name: "録音チャンネル", exact: true })
    .selectOption("2");
  await page
    .getByRole("button", { name: "暗騒音を10秒測定", exact: true })
    .click();
  await expect(
    page.getByText("暗騒音を保存しました。", { exact: false })
  ).toBeVisible({ timeout: 25000 });
  const records = await localRecords(page);
  expect(records.captures).toHaveLength(1);
  expect(records.captures[0]).toMatchObject({
    purpose: "ambient",
    analysisOwner: "browser",
    status: "complete",
    context: { input: { channel: 2, channelCount: 2 } },
  });
  expect(records.captures[0].context.microphone).not.toContain("Synthetic");
  expect(records.observations).toHaveLength(1);
  expect(records.results).toHaveLength(0);
  const observation = records.observations[0];
  expect(observation.spectrumUnit).toBe("dBFS/Hz");
  expect(observation.durationSeconds).toBeGreaterThan(9);
  expect(observation.durationSeconds).toBeLessThan(12);
  expect(observation.rmsDBFS).toBeLessThan(-25);
  const strongest = observation.spectrum.reduce((a, b) =>
    a.db > b.db ? a : b
  );
  expect(strongest.hz).toBeGreaterThan(400);
  expect(strongest.hz).toBeLessThan(480);
  const lowTone = observation.spectrum.filter(
    (point) => point.hz >= 100 && point.hz <= 120
  );
  expect(
    strongest.db - Math.max(...lowTone.map((point) => point.db))
  ).toBeGreaterThan(30);
  await page.getByRole("button", { name: /比較・履歴/ }).click();
  await expect(
    page.getByRole("heading", { name: "暗騒音の記録", exact: true })
  ).toBeVisible();
  expect(remoteRequests).toEqual([]);
  expect(errors).toEqual([]);
});

for (const mode of ["preview", "ambient"] as const) {
  test(`stops during pending permission for ${mode} and closes a microphone granted afterward`, async ({
    page,
  }) => {
    await page.goto("/");
    await configureInput(page);
    await page
      .getByRole("button", {
        name:
          mode === "preview" ? "入力・スペクトルを確認" : "暗騒音を10秒測定",
        exact: true,
      })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { audioTestPending: boolean })
              .audioTestPending
        )
      )
      .toBe(true);
    await page
      .getByRole("button", {
        name: mode === "preview" ? "■ 入力確認を停止" : "■ ローカル測定を停止",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", { name: "入力・スペクトルを確認", exact: true })
    ).toBeEnabled({ timeout: 3000 });
    await page.evaluate(() =>
      (window as unknown as { audioTestRelease: () => void }).audioTestRelease()
    );
    await expect
      .poll(() =>
        page.evaluate(() => {
          const streams = (
            window as unknown as { audioTestStreams: MediaStream[] }
          ).audioTestStreams;
          return (
            streams.length === 2 &&
            streams.every((stream) =>
              stream.getTracks().every((track) => track.readyState === "ended")
            )
          );
        })
      )
      .toBe(true);
    expect(await localRecords(page)).toEqual({
      captures: [],
      observations: [],
      results: [],
    });
  });
}
