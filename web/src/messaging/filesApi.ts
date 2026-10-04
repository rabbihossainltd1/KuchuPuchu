/**
 * Byte-level file routes: upload (single-shot or multipart) and download.
 *
 * Read out of `src/worker/index.ts`; nothing here is invented:
 *
 *   POST /api/files?name=&type=          raw body, ≤ SINGLE_UPLOAD_MAX_BYTES
 *   POST /api/files/mpu/start            {name,type,size} → {uploadId,partSize,key}
 *   PUT  /api/files/mpu/part?uploadId=&n= raw part
 *   POST /api/files/mpu/complete         {uploadId} → {fileKey,size}
 *   POST /api/files/mpu/abort            {uploadId}
 *   GET  /api/files/:key                 the bytes, Bearer-gated
 *
 * The single-shot route answers an oversized body with `413 USE_MULTIPART`, so
 * the client picks the route from `planUpload` before spending the user's
 * bandwidth on a request that is guaranteed to be refused.
 */

import type { ApiClient } from "../auth/authApi";
import {
  UPLOAD_PART_BYTES,
  fileGetPath,
  planUpload,
  safeMediaType,
  type UploadPart,
} from "../media/uploadContract";

export type UploadResult = { fileKey: string; size: number };

export type UploadProgress = {
  sent: number;
  total: number;
  partsDone: number;
  partsTotal: number;
};

export type UploadInput = {
  name: string;
  type: string;
  blob: Blob;
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
};

type StartedUpload = { uploadId: string; partSize: number; key: string };

function filesQuery(name: string, type: string): string {
  const params = new URLSearchParams();
  params.set("name", name);
  params.set("type", type);
  return `?${params.toString()}`;
}

async function uploadSingle(api: ApiClient, input: UploadInput): Promise<UploadResult> {
  const type = safeMediaType(input.type);
  const result = await api.request<UploadResult>(`/api/files${filesQuery(input.name, type)}`, {
    method: "POST",
    headers: { "content-type": type },
    body: input.blob,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!result || typeof result.fileKey !== "string" || !result.fileKey) {
    throw new Error("Upload returned no file key.");
  }
  input.onProgress?.({
    sent: input.blob.size,
    total: input.blob.size,
    partsDone: 1,
    partsTotal: 1,
  });
  return { fileKey: result.fileKey, size: Number(result.size) || input.blob.size };
}

async function uploadMultipart(api: ApiClient, input: UploadInput): Promise<UploadResult> {
  const type = safeMediaType(input.type);
  const total = input.blob.size;
  const plan = planUpload(total);
  if (plan.mode !== "multipart") return uploadSingle(api, input);

  const started = await api.request<StartedUpload>("/api/files/mpu/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: input.name, type, size: total }),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const uploadId = started?.uploadId ?? "";
  if (!uploadId) throw new Error("Upload could not start.");
  const partSize = Number(started.partSize) || UPLOAD_PART_BYTES;

  // The server told us its own chunk size; re-cut with it rather than trusting
  // the constant, so a server-side change does not silently misalign parts.
  const parts: UploadPart[] = [];
  for (let start = 0, n = 1; start < total; start += partSize, n += 1) {
    parts.push({ n, start, end: Math.min(total, start + partSize) });
  }

  try {
    let sent = 0;
    for (const part of parts) {
      const chunk = input.blob.slice(part.start, part.end);
      const response = await api.request<{ n?: number }>(
        `/api/files/mpu/part?uploadId=${encodeURIComponent(uploadId)}&n=${part.n}`,
        {
          method: "PUT",
          headers: { "content-type": type },
          body: chunk,
          ...(input.signal ? { signal: input.signal } : {}),
        },
      );
      // The etags live in the server's session row; all the client can check is
      // that the chunk landed under the number it was sent as. A mismatch would
      // otherwise only surface at `complete`, long after an abort could help.
      if (Number(response?.n ?? part.n) !== part.n) throw new Error("Upload part was refused.");
      sent += part.end - part.start;
      input.onProgress?.({
        sent,
        total,
        partsDone: part.n,
        partsTotal: parts.length,
      });
    }

    const finished = await api.request<UploadResult>("/api/files/mpu/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uploadId }),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (!finished?.fileKey) throw new Error("Upload returned no file key.");
    input.onProgress?.({ sent: total, total, partsDone: parts.length, partsTotal: parts.length });
    return { fileKey: finished.fileKey, size: Number(finished.size) || total };
  } catch (error) {
    // Leave nothing half-finished behind: the server aborts the R2 multipart
    // and drops the session row. Failure to abort must not mask the real error.
    await api
      .request<{ ok?: boolean }>("/api/files/mpu/abort", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uploadId }),
      })
      .catch(() => undefined);
    throw error;
  }
}

/**
 * Upload a file by the cheapest route that can carry it.
 *
 * Progress is byte-exact for multipart uploads (one part per request) and
 * all-or-nothing for a single-shot upload: `fetch` does not expose upload
 * progress, and faking a smooth bar for a request that cannot be observed
 * would be a lie. The composer says "Uploading…" for the single-shot case.
 */
export async function uploadFile(api: ApiClient, input: UploadInput): Promise<UploadResult> {
  if (input.blob.size <= 0) throw new Error("File is empty.");
  const plan = planUpload(input.blob.size);
  return plan.mode === "multipart" ? uploadMultipart(api, input) : uploadSingle(api, input);
}

/** Download a stored file's bytes. The route is Bearer-gated and member-checked. */
/**
 * The bytes of an inline media row: `GET /api/messages/:id/media`.
 *
 * WARNING — for a view-once row this fetch **is** the opening. The Worker
 * deletes the row for everyone, collects the object from the bucket and
 * broadcasts VANISHED before it streams the body (audit H3: a fetch-free route
 * plus a spend-on-`/view` report let a modified client pull the bytes any
 * number of times and never admit to opening them). So nothing may call this
 * while merely rendering a transcript; `openingCostsFetch` marks the rows that
 * have to wait for the reader.
 *
 * For the sender's own row the route streams free and spends nothing.
 */
export async function fetchMessageMediaBlob(
  api: ApiClient,
  messageId: string,
  signal?: AbortSignal,
): Promise<{ blob: Blob; type: string }> {
  const response = await api.requestRaw(`/api/messages/${encodeURIComponent(messageId)}/media`, {
    method: "GET",
    ...(signal ? { signal } : {}),
  });
  const blob = await response.blob();
  return { blob, type: response.headers.get("content-type") || "application/octet-stream" };
}

export async function fetchFileBlob(
  api: ApiClient,
  fileKey: string,
  signal?: AbortSignal,
): Promise<{ blob: Blob; type: string }> {
  const response = await api.requestRaw(fileGetPath(fileKey), {
    method: "GET",
    ...(signal ? { signal } : {}),
  });
  const blob = await response.blob();
  return { blob, type: response.headers.get("content-type") || "application/octet-stream" };
}
