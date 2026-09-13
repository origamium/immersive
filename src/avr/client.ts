import type { SupabaseClient } from "@supabase/supabase-js";

export interface ReceiverZone {
  power?: string;
  volume?: number;
  limit?: number;
  muted?: boolean;
  source?: string;
  name?: string;
}
export interface ReceiverState {
  simulated?: boolean;
  unknownConditions?: string[];
  schemaVersion: 1;
  observedAt: string;
  zones: Record<string, ReceiverZone>;
  channels: {
    name: string;
    active: boolean;
    value?: number;
    speakerType?: number;
  }[];
  sources: {
    name: string;
    function: string;
    enabled: boolean;
    displayName?: string;
  }[];
  modes: { name: string; selected: boolean }[];
  surround?: string;
  friendlyName?: string;
  inputSignal: { name: string; control?: number }[];
  activeSpeakers: { name: string; control?: number }[];
  details: Record<string, Record<string, { value: string; control?: number }>>;
  errors: Record<string, string>;
}
export interface ReceiverLease {
  id: string;
  before: ReceiverState;
  after?: ReceiverState;
  expiresAt: string;
  interrupted: boolean;
  reason?: string;
}
export interface ReceiverPreset {
  id: string;
  createdAt: string;
  before: Record<string, number>;
  applied: Record<string, number>;
  outcome: string;
}
export interface ReceiverObservation {
  receiver_id: string;
  observed_at: string;
  received_at: string;
  revision: string;
  state: ReceiverState;
  measurement: ReceiverLease | null;
  preset: ReceiverPreset | null;
}
export interface Receiver {
  id: string;
  name: string;
  mac_device_id: string;
}
export interface ReceiverSnapshot {
  id: string;
  created_at: string;
  raw_path: string;
  raw_sha256: string;
}
export interface AvrOutcome {
  status: string;
  error?: string;
  state?: ReceiverState;
  measurement?: ReceiverLease;
  observation?: { method: string; raw: string };
  snapshotId?: string;
  changes?: { command: string; status: string; error?: string }[];
}
export interface AvrControlClient {
  receivers(): Promise<Receiver[]>;
  observation(id: string): Promise<ReceiverObservation | null>;
  execute(
    id: string,
    revision: string,
    kind: string,
    body?: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<AvrOutcome>;
}
export const avrFresh = (
  observation: ReceiverObservation | null,
  now = Date.now()
) =>
  !!observation &&
  now - Date.parse(observation.received_at) < 20_000 &&
  now - Date.parse(observation.observed_at) < 30_000;
const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
export class CloudAvrClient implements AvrControlClient {
  private client: SupabaseClient;
  private workspace: string;
  constructor(client: SupabaseClient, workspace: string) {
    this.client = client;
    this.workspace = workspace;
  }
  async receivers() {
    const { data, error } = await this.client
      .from("avr_receivers")
      .select("id,name,mac_device_id")
      .eq("workspace_id", this.workspace)
      .order("created_at");
    if (error) throw error;
    return (data ?? []) as Receiver[];
  }
  async observation(id: string) {
    const { data, error } = await this.client
      .from("avr_observations")
      .select("*")
      .eq("receiver_id", id)
      .maybeSingle();
    if (error) throw error;
    return data as ReceiverObservation | null;
  }
  async snapshots(id: string): Promise<ReceiverSnapshot[]> {
    const { data, error } = await this.client.from("avr_snapshots")
      .select("id,created_at,raw_path,raw_sha256")
      .eq("receiver_id", id).eq("purpose", "diagnostic")
      .order("created_at", { ascending: false }).limit(50);
    if (error) throw error;
    return (data ?? []) as ReceiverSnapshot[];
  }
  async snapshotFile(receiverId: string, snapshot: ReceiverSnapshot): Promise<Blob> {
    if (snapshot.raw_path !== `${receiverId}/${snapshot.id}.json`)
      throw new Error("スナップショットの保存先が一致しません");
    const { data, error } = await this.client.storage.from("avr-private").download(snapshot.raw_path);
    if (error) throw error;
    const digest = await crypto.subtle.digest("SHA-256", await data.arrayBuffer());
    const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
    if (hash !== snapshot.raw_sha256) throw new Error("スナップショットのSHA-256が一致しません");
    return data;
  }
  async execute(
    id: string,
    revision: string,
    kind: string,
    body: Record<string, unknown> = {},
    signal?: AbortSignal
  ) {
    if (signal?.aborted) throw new Error("操作を中断しました");
    const operationId = crypto.randomUUID();
    const { error } = await this.client.rpc("issue_avr_operation", {
      r: id,
      operation_id: operationId,
      rev: revision,
      action: kind,
      payload: body,
    });
    if (error) throw error;
    // Poll acknowledgement only. Never resend a possibly executed operation.
    for (let count = 0; count < (kind === "snapshot" ? 360 : 40); count++) {
      if (signal?.aborted)
        throw new Error(
          "操作待機を中断しました。送信済み操作は実機状態を確認してください"
        );
      const result = await this.client
        .from("avr_operations")
        .select("completed_at,outcome")
        .eq("id", operationId)
        .single();
      if (result.error) throw result.error;
      if (result.data.completed_at) {
        const outcome = result.data.outcome as AvrOutcome;
        if (outcome.status === "rejected")
          throw new Error(outcome.error ?? "操作が拒否されました");
        return outcome;
      }
      await wait(500);
    }
    throw new Error(
      `操作結果が不明です。再送せず実機状態を確認してください（${operationId}）`
    );
  }
}
export class LocalAvrClient implements AvrControlClient {
  private base: string;
  private token: string;
  constructor(base: string, token: string) {
    this.base = base;
    this.token = token;
    const url = new URL(base);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("Macの127.0.0.1のみ指定できます");
  }
  private async request<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.base.replace(/\/$/, "")}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Mac API: ${response.status}`);
    return response.json();
  }
  receivers() {
    return this.request<Receiver[]>("/api/receivers");
  }
  observation(id: string) {
    return this.request<ReceiverObservation>(
      `/api/receivers/${encodeURIComponent(id)}`
    );
  }
  execute(
    id: string,
    revision: string,
    kind: string,
    body: Record<string, unknown> = {}
  ) {
    return this.request<AvrOutcome>("/api/operation", {
      id: crypto.randomUUID(),
      receiverId: id,
      expectedRevision: revision,
      kind,
      ...body,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 10_000).toISOString(),
    });
  }
}
