import type { SupabaseClient } from "@supabase/supabase-js";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncCapture, syncResult } from "./cloud";
import { initialContext } from "./defaults";
import {
  exportBackup,
  observationCSV,
  reportHTML,
  restoreBackup,
  resultCSV,
} from "./export";
import { sha256 } from "./local";
import type { AmbientObservation, AnalysisResult, LocalCapture } from "./types";

const memory = vi.hoisted(() => new Map<string, unknown>());
vi.mock("./local", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./local")>();
  const list = (store: string) =>
    [...memory.entries()]
      .filter(([key]) => key.startsWith(`${store}:`))
      .map(([, value]) => value);
  return {
    ...actual,
    getLocal: vi.fn(async (store: string, key: string) =>
      memory.get(`${store}:${key}`)
    ),
    putLocal: vi.fn(async (store: string, key: string, value: unknown) => {
      memory.set(`${store}:${key}`, value);
    }),
    localResults: async () => list("results"),
    localCaptures: async () => list("captures"),
    localExperiments: async () => list("experiments"),
    localObservations: async () => list("observations"),
  };
});

function fixture() {
  const context = initialContext();
  context.microphoneProfile = "sm58";
  context.input = {
    deviceId: "ur12",
    label: "Steinberg UR12",
    channel: 1,
    channelCount: 2,
    sampleRate: 48000,
  };
  const capture: LocalCapture = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    context,
    sampleRate: 48000,
    frames: 2,
    chunkCount: 1,
    status: "complete",
    purpose: "ambient",
    analysisOwner: "browser",
  };
  const observation: AmbientObservation = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    createdAt: capture.createdAt,
    context,
    localCaptureId: capture.id,
    durationSeconds: 10,
    sampleRate: 48000,
    spectrumUnit: "dBFS/Hz",
    spectrum: [{ hz: 100, db: -48 }],
    rmsDBFS: -45,
    peakDBFS: -30,
    clippedSamples: 0,
    reasons: ["絶対SPLではありません"],
  };
  return { capture, observation };
}

async function archive(data: unknown, pcm: Record<string, Uint8Array> = {}) {
  const files = { "data.json": strToU8(JSON.stringify(data)), ...pcm };
  const hashes: Record<string, string> = {};
  for (const [path, bytes] of Object.entries(files))
    hashes[path] = await sha256(bytes.slice().buffer);
  return new File(
    [
      zipSync({
        ...files,
        "manifest.json": strToU8(
          JSON.stringify({ version: 1, scope: "this-browser-cache", hashes })
        ),
      }).slice().buffer,
    ],
    "backup.zip"
  );
}

beforeEach(() => memory.clear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("local measurement backups", () => {
  it("round trips v2 observations, input metadata and raw PCM", async () => {
    const { capture, observation } = fixture();
    const pcm = new Float32Array([0.1, -0.1]).buffer;
    memory.set(`captures:${capture.id}`, capture);
    memory.set(`chunks:${capture.id}:0`, pcm);
    memory.set(`observations:${observation.id}`, observation);
    memory.set("settings:context", capture.context);
    let blob: Blob | undefined;
    vi.spyOn(URL, "createObjectURL").mockImplementation((value) => {
      blob = value as Blob;
      return "blob:backup";
    });
    vi.stubGlobal("document", { createElement: () => ({ click: vi.fn() }) });
    vi.useFakeTimers();
    await exportBackup();
    if (!blob) throw new Error("Missing backup");
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const data = JSON.parse(strFromU8(files["data.json"]));
    expect(data.version).toBe(2);
    expect(data.observations).toEqual([observation]);
    memory.clear();
    await restoreBackup(new File([blob], "backup.zip"));
    expect(memory.get(`observations:${observation.id}`)).toEqual(observation);
    expect(memory.get(`chunks:${capture.id}:0`)).toEqual(pcm);
    expect(memory.get("settings:context")).toEqual(capture.context);
    expect(memory.has(`results:${observation.id}`)).toBe(false);
  });

  it("restores v1 data and preserves existing immutable IDs", async () => {
    const { capture } = fixture();
    capture.status = "recording";
    const file = await archive(
      { version: 1, results: [], captures: [capture], experiments: [] },
      { [`pcm/${capture.id}/0.f32`]: new Uint8Array(8) }
    );
    await restoreBackup(file);
    expect(memory.get(`captures:${capture.id}`)).toMatchObject({
      status: "interrupted",
    });
    const existing = { ...capture, reason: "Existing recording" };
    memory.set(`captures:${capture.id}`, existing);
    await restoreBackup(file);
    expect(memory.get(`captures:${capture.id}`)).toEqual(existing);
    expect(
      [...memory.keys()].some((key) => key.startsWith("observations:"))
    ).toBe(false);
  });

  it("rejects invalid observations and missing PCM before any writes", async () => {
    const { capture, observation } = fixture();
    for (const invalid of [
      { ...observation, rmsDBFS: null },
      { ...observation, localCaptureId: crypto.randomUUID() },
      { ...observation, spectrum: [{ hz: 30000, db: -50 }] },
    ]) {
      const file = await archive(
        {
          version: 2,
          results: [],
          captures: [capture],
          experiments: [],
          observations: [invalid],
        },
        { [`pcm/${capture.id}/0.f32`]: new Uint8Array(8) }
      );
      await expect(restoreBackup(file)).rejects.toThrow("環境音データ");
      expect(memory.size).toBe(0);
    }
    const missing = await archive({
      version: 2,
      results: [],
      captures: [capture],
      experiments: [],
      observations: [observation],
    });
    await expect(restoreBackup(missing)).rejects.toThrow("録音チャンク");
    expect(memory.size).toBe(0);
  });

  it("labels ambient spectrum as dBFS/Hz and broadband levels as dBFS", () => {
    const csv = observationCSV(fixture().observation);
    expect(csv).toContain(
      "frequency_hz,power_spectral_density_dbfs_per_hz\n100,-48"
    );
    expect(csv).toContain("# spectrum_unit dBFS/Hz");
    expect(csv).toContain("# rms_dbfs -45");
    expect(csv).toContain("not SPL or transfer response");
    expect(csv).not.toContain("phase_degrees");
  });
});

describe("cloud capture boundary", () => {
  it.each([
    { purpose: "ambient" as const },
    { purpose: "manual" as const },
    { purpose: "sweep" as const, analysisOwner: "browser" as const },
  ])("never queues local-only recordings: %j", async (metadata) => {
    const { capture } = fixture();
    delete capture.purpose;
    delete capture.analysisOwner;
    Object.assign(capture, metadata);
    const from = vi.fn();
    await expect(
      syncCapture(
        { from } as unknown as SupabaseClient,
        "workspace",
        capture,
        "",
        "",
        vi.fn()
      )
    ).rejects.toThrow("端末内");
    expect(from).not.toHaveBeenCalled();
    expect(memory.size).toBe(0);
  });

  it("keeps legacy captures eligible for the existing upload path", async () => {
    const { capture } = fixture();
    delete capture.purpose;
    delete capture.analysisOwner;
    const from = vi.fn(() => {
      throw new Error("cloud reached");
    });
    await expect(
      syncCapture(
        { from } as unknown as SupabaseClient,
        "workspace",
        capture,
        "",
        "",
        vi.fn()
      )
    ).rejects.toThrow("cloud reached");
    expect(from).toHaveBeenCalledWith("measurement_sessions");
  });

  it("syncs a browser result while retaining local PCM provenance", async () => {
    const { capture } = fixture();
    const result: AnalysisResult = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      sessionId: "local",
      createdAt: capture.createdAt,
      version: "browser-1",
      source: "sweep",
      title: "Local sweep",
      context: capture.context,
      response: [{ hz: 100, db: -10 }],
      quality: {
        level: "verified",
        reasons: [],
        snrDB: 40,
        clippedSamples: 0,
        driftPPM: null,
      },
      delaySeconds: null,
      rawArtifactId: null,
      localCaptureId: capture.id,
    };
    const insertResult = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn((table: string) =>
      table === "measurement_sessions"
        ? {
            insert: () => ({
              select: () => ({
                single: async () => ({
                  data: { id: "cloud-session" },
                  error: null,
                }),
              }),
            }),
          }
        : {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
            insert: insertResult,
          }
    );
    await syncResult(
      { from } as unknown as SupabaseClient,
      "workspace",
      result
    );
    expect(resultCSV(result)).toContain("# quality relative");
    expect(reportHTML(result)).toContain("SM58は単一指向性");
    expect(insertResult).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          rawArtifactId: null,
          localCaptureId: capture.id,
          sessionId: "cloud-session",
          quality: expect.objectContaining({ level: "relative" }),
        }),
      })
    );
    expect(result.sessionId).toBe("local");
  });
});
