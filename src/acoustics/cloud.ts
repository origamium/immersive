import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Upload } from "tus-js-client";
import { getLocal, putLocal, sha256 } from "./local";
import { microphoneQuality } from "./microphones";
import type {
  AnalysisResult,
  CloudDevice,
  LocalCapture,
  MeasurementContext,
  MeasurementSession,
  PlaybackCommand,
} from "./types";

export function makeCloud(url: string, key: string): SupabaseClient {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(parsed.hostname)
  )
    throw new Error("SupabaseにはHTTPS URLを指定してください");
  if (key.startsWith("sb_secret_"))
    throw new Error(
      "公開キーを指定してください。管理用秘密鍵は使用できません。"
    );
  if (key.split(".").length === 3) {
    try {
      const data = JSON.parse(
        atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
      );
      if (data.role === "service_role")
        throw new Error("管理用秘密鍵は使用できません");
    } catch (e) {
      if (e instanceof Error && e.message.includes("管理")) throw e;
    }
  }
  return createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}
export async function ensureWorkspace(client: SupabaseClient): Promise<string> {
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw new Error("ログインしてください");
  const existing = await client
    .from("workspaces")
    .select("id")
    .eq("owner_id", user.id)
    .order("created_at")
    .limit(1);
  if (existing.error) throw existing.error;
  if (existing.data?.[0]) return existing.data[0].id;
  const created = await client
    .from("workspaces")
    .insert({ owner_id: user.id, name: "Acoustic Lab" })
    .select("id")
    .single();
  if (created.error) throw created.error;
  return created.data.id;
}
export async function cloudDevices(
  client: SupabaseClient,
  workspace: string
): Promise<CloudDevice[]> {
  const { data, error } = await client
    .from("devices")
    .select("id,name,kind,capabilities,last_seen,revoked_at")
    .eq("workspace_id", workspace);
  if (error) throw error;
  return data ?? [];
}
export async function createSession(
  client: SupabaseClient,
  workspace: string,
  context: MeasurementContext
): Promise<MeasurementSession> {
  const { data, error } = await client
    .from("measurement_sessions")
    .insert({ workspace_id: workspace, context })
    .select()
    .single();
  if (error) throw error;
  return data;
}
export async function issueCommand(
  client: SupabaseClient,
  session: string,
  device: string,
  action: PlaybackCommand["action"],
  payload: Record<string, unknown> = {}
): Promise<PlaybackCommand> {
  const { data, error } = await client.rpc("issue_command", {
    sid: session,
    target: device,
    requested_action: action,
    body: payload,
    command_id: crypto.randomUUID(),
  });
  if (error) throw error;
  return data;
}
export async function uploadPart(
  client: SupabaseClient,
  url: string,
  key: string,
  path: string,
  blob: Blob,
  progress: (percent: number) => void
) {
  const { data, error } = await client.storage
    .from("acoustic-artifacts")
    .createSignedUploadUrl(path);
  if (error) throw error;
  const { data: auth } = await client.auth.getSession();
  await new Promise<void>((resolve, reject) => {
    const upload = new Upload(blob, {
      endpoint: `${url.replace(/\/$/, "")}/storage/v1/upload/resumable`,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      chunkSize: 6 * 1024 * 1024,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      headers: {
        authorization: `Bearer ${auth.session?.access_token ?? key}`,
        apikey: key,
        "x-signature": data.token,
        "x-upsert": "false",
      },
      metadata: {
        bucketName: "acoustic-artifacts",
        objectName: path,
        contentType: blob.type || "application/octet-stream",
        cacheControl: "3600",
      },
      fingerprint: async () => `acoustic-v1:${url}:${path}:${blob.size}`,
      onProgress: (sent, total) => progress(total ? (sent / total) * 100 : 0),
      onError: reject,
      onSuccess: () => resolve(),
    });
    void upload
      .findPreviousUploads()
      .then((previous) => {
        if (previous[0]) upload.resumeFromPreviousUpload(previous[0]);
        upload.start();
      })
      .catch(reject);
  });
}
export async function syncCapture(
  client: SupabaseClient,
  workspace: string,
  capture: LocalCapture,
  url: string,
  key: string,
  progress: (percent: number) => void
) {
  if (
    capture.purpose === "ambient" ||
    capture.purpose === "manual" ||
    capture.analysisOwner === "browser"
  )
    throw new Error(
      "この録音は端末内で管理します。原音はWAVまたはバックアップで保存してください。"
    );
  const saved = await getLocal<{ artifactId: string; sessionId: string }>(
    "settings",
    `upload:${capture.id}`
  );
  let artifactId: string, sessionId: string;
  if (saved) {
    artifactId = saved.artifactId;
    sessionId = saved.sessionId;
  } else {
    sessionId =
      capture.cloudSessionId ??
      (await createSession(client, workspace, capture.context)).id;
    const { data, error } = await client
      .from("artifacts")
      .insert({
        workspace_id: workspace,
        session_id: sessionId,
        kind: "capture",
      })
      .select("id")
      .single();
    if (error) throw error;
    artifactId = data.id;
    await putLocal("settings", `upload:${capture.id}`, {
      artifactId,
      sessionId,
    });
  }
  const parts = [];
  for (let i = 0; i < capture.chunkCount; i++) {
    const bytes = await getLocal<ArrayBuffer>("chunks", `${capture.id}:${i}`);
    if (!bytes) throw new Error("PCMチャンクが欠落しています");
    const path = `${workspace}/${artifactId}/${String(i).padStart(6, "0")}.f32`;
    const digest = await sha256(bytes);
    const complete = await getLocal<boolean>("settings", `part:${path}`);
    if (!complete) {
      await uploadPart(client, url, key, path, new Blob([bytes]), (p) =>
        progress(((i + p / 100) / capture.chunkCount) * 100)
      );
      await putLocal("settings", `part:${path}`, true);
    }
    parts.push({
      index: i,
      path,
      sha256: digest,
      frames: bytes.byteLength / 4,
      bytes: bytes.byteLength,
    });
  }
  const { error } = await client.rpc("finalize_artifact", {
    aid: artifactId,
    info: {
      schemaVersion: 1,
      encoding: "float32-le",
      sampleRate: capture.sampleRate,
      frames: capture.frames,
      parts,
      complete: capture.status === "complete",
      context: capture.context,
    },
  });
  if (error) throw error;
  await putLocal("captures", capture.id, {
    ...capture,
    status: "uploaded",
    reason: capture.reason,
    cloudSessionId: sessionId,
  });
}
export async function syncResult(
  client: SupabaseClient,
  workspace: string,
  result: AnalysisResult
) {
  result = microphoneQuality(result);
  const existing = await client
    .from("analysis_results")
    .select("id")
    .eq("id", result.id)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return;
  const session = await createSession(client, workspace, result.context);
  const { error } = await client.from("analysis_results").insert({
    id: result.id,
    workspace_id: workspace,
    session_id: session.id,
    version: result.version,
    data: { ...result, sessionId: session.id },
  });
  if (error && error.code !== "23505") throw error;
}
export async function fetchResults(
  client: SupabaseClient,
  workspace: string
): Promise<AnalysisResult[]> {
  const results: AnalysisResult[] = [];
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await client
      .from("analysis_results")
      .select("data")
      .eq("workspace_id", workspace)
      .order("created_at", { ascending: false })
      .order("id")
      .range(offset, offset + 199);
    if (error) throw error;
    results.push(...(data ?? []).map((x) => x.data));
    if (!data || data.length < 200) return results;
  }
}
export async function uploadFile(
  client: SupabaseClient,
  workspace: string,
  context: MeasurementContext,
  file: File,
  kind: "impulse" | "stimulus",
  url: string,
  key: string,
  progress: (p: number) => void,
  mediaProfile?: "stereo" | "multiCh" | "dolbyAtmos"
) {
  if (!file.size || file.size > 512 * 1024 * 1024)
    throw new Error("ファイルは512 MiB以下にしてください");
  const session = await createSession(client, workspace, context);
  const { data, error } = await client
    .from("artifacts")
    .insert({ workspace_id: workspace, session_id: session.id, kind })
    .select("id")
    .single();
  if (error) throw error;
  const parts = [],
    partSize = 12 * 1024 * 1024;
  for (
    let offset = 0, index = 0;
    offset < file.size;
    offset += partSize, index++
  ) {
    const blob = file.slice(offset, offset + partSize),
      bytes = await blob.arrayBuffer();
    const path = `${workspace}/${data.id}/${String(index).padStart(6, "0")}.bin`;
    await uploadPart(client, url, key, path, blob, (p) =>
      progress(((offset + (blob.size * p) / 100) / file.size) * 100)
    );
    parts.push({ index, path, bytes: blob.size, sha256: await sha256(bytes) });
  }
  const finalized = await client.rpc("finalize_artifact", {
    aid: data.id,
    info: {
      schemaVersion: 1,
      encoding: kind === "impulse" ? "wav" : "media",
      ...(kind === "stimulus" && mediaProfile ? { mediaProfile } : {}),
      filename: file.name,
      parts,
      complete: true,
      context,
      channelMappingVerified: false,
    },
  });
  if (finalized.error) throw finalized.error;
  return data.id as string;
}
