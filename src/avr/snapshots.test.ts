import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CloudAvrClient } from "./client";

describe("private AVR snapshot export", () => {
  const blob = new Blob(['{"complete":false}'], { type: "application/json" });
  const client = new CloudAvrClient({ storage: { from: () => ({ download: async () => ({ data: blob, error: null }) }) } } as unknown as SupabaseClient, "workspace");
  const snapshot = { id: "snapshot", created_at: "2026-09-13T00:00:00Z", raw_path: "receiver/snapshot.json", raw_sha256: "" };
  it("exports identical stored bytes after hash verification", async () => {
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())), value => value.toString(16).padStart(2, "0")).join("");
    expect(await (await client.snapshotFile("receiver", { ...snapshot, raw_sha256: hash })).text()).toBe(await blob.text());
  });
  it("rejects corrupted objects", async () => {
    await expect(client.snapshotFile("receiver", snapshot)).rejects.toThrow("SHA-256");
  });
  it("rejects paths belonging to a different receiver", async () => {
    await expect(client.snapshotFile("other", snapshot)).rejects.toThrow("保存先");
  });
});
