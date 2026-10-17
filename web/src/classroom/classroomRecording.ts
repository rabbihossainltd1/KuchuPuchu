import type { ApiClient } from "../auth/authApi";

const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 15;

type Part = { readonly partNumber: number; readonly etag: string };
type UploadStart = {
  readonly uploadId: string;
  readonly uploadToken: string;
  readonly partUploadUrl: string;
  readonly partSize: number;
  readonly partCount: number;
};

export class InstructorRecorder {
  private readonly chunks: Blob[] = [];
  private readonly videos: HTMLVideoElement[] = [];
  private readonly audio = new AudioContext();
  private readonly destination = this.audio.createMediaStreamDestination();
  private readonly canvas = document.createElement("canvas");
  private frame = 0;
  private recorder: MediaRecorder | null = null;
  private stopped: Promise<Blob> | null = null;

  constructor(private readonly streams: readonly MediaStream[]) {
    if (streams.length === 0) throw new Error("No classroom media is available to record.");
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
  }

  async start(): Promise<void> {
    await this.audio.resume();
    for (const stream of this.streams) {
      if (stream.getAudioTracks().length > 0) {
        const source = this.audio.createMediaStreamSource(stream);
        source.connect(this.destination);
      }
      if (stream.getVideoTracks().length > 0) {
        const video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.srcObject = stream;
        await video.play();
        this.videos.push(video);
      }
    }
    this.draw();
    const output = new MediaStream([
      ...this.canvas.captureStream(FPS).getVideoTracks(),
      ...this.destination.stream.getAudioTracks(),
    ]);
    const mimeType = recordingMimeType();
    const recorder = new MediaRecorder(output, {
      mimeType,
      videoBitsPerSecond: 2_000_000,
      audioBitsPerSecond: 96_000,
    });
    recorder.ondataavailable = (event) => event.data.size > 0 && this.chunks.push(event.data);
    this.stopped = new Promise((resolve, reject) => {
      recorder.onerror = () => reject(new Error("The device recording failed."));
      recorder.onstop = () => resolve(new Blob(this.chunks, { type: mimeType }));
    });
    recorder.start(2_000);
    this.recorder = recorder;
  }

  async stop(): Promise<Blob> {
    if (!this.recorder || !this.stopped) throw new Error("Recording has not started.");
    if (this.recorder.state !== "inactive") this.recorder.stop();
    cancelAnimationFrame(this.frame);
    const blob = await this.stopped;
    this.videos.forEach((video) => {
      video.pause();
      video.srcObject = null;
    });
    await this.audio.close();
    if (blob.size === 0) throw new Error("The device produced an empty recording.");
    return blob;
  }

  private draw = (): void => {
    const context = this.canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#071426";
    context.fillRect(0, 0, WIDTH, HEIGHT);
    const count = Math.max(1, this.videos.length);
    const columns = count <= 1 ? 1 : count <= 4 ? 2 : 3;
    const rows = Math.ceil(count / columns);
    const gap = 12;
    const tileWidth = (WIDTH - gap * (columns + 1)) / columns;
    const tileHeight = (HEIGHT - gap * (rows + 1)) / rows;
    this.videos.forEach((video, index) => {
      const x = gap + (index % columns) * (tileWidth + gap);
      const y = gap + Math.floor(index / columns) * (tileHeight + gap);
      drawCover(context, video, x, y, tileWidth, tileHeight);
    });
    this.frame = requestAnimationFrame(this.draw);
  };
}

export async function uploadClassRecording(
  api: ApiClient,
  classId: string,
  blob: Blob,
  onProgress: (percent: number) => void,
): Promise<void> {
  const contentType = blob.type.startsWith("video/mp4") ? "video/mp4" : "video/webm";
  const session = await api.request<UploadStart>(
    `/api/classroom/v1/classes/${encodeURIComponent(classId)}/recording/uploads`,
    { method: "POST", body: JSON.stringify({ contentType, size: blob.size }) },
  );
  const parts: Part[] = [];
  try {
    for (let partNumber = 1; partNumber <= session.partCount; partNumber += 1) {
      const start = (partNumber - 1) * session.partSize;
      const chunk = blob.slice(start, Math.min(blob.size, start + session.partSize));
      const partUrl = session.partUploadUrl.replace("__PART__", String(partNumber));
      const etag = await putWithRetry(partUrl, chunk, contentType, session.uploadToken);
      if (!etag) throw new Error("Object storage did not return a part checksum.");
      parts.push({ partNumber, etag });
      onProgress(Math.round((partNumber / session.partCount) * 100));
    }
    await api.request(
      `/api/classroom/v1/classes/${encodeURIComponent(classId)}/recording/uploads/${session.uploadId}/complete`,
      { method: "POST", body: JSON.stringify({ parts }) },
    );
  } catch (error) {
    await api
      .request(
        `/api/classroom/v1/classes/${encodeURIComponent(classId)}/recording/uploads/${session.uploadId}`,
        { method: "DELETE" },
      )
      .catch(() => undefined);
    throw error;
  }
}

function recordingMimeType(): string {
  for (const value of ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/mp4"]) {
    if (MediaRecorder.isTypeSupported(value)) return value;
  }
  throw new Error("This browser cannot record the class.");
}

async function putWithRetry(
  url: string,
  body: Blob,
  contentType: string,
  token: string,
): Promise<string> {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "PUT",
        body,
        headers: { authorization: `Bearer ${token}`, "content-type": contentType },
        credentials: "omit",
        cache: "no-store",
      });
      if (response.ok) {
        const result = (await response.json()) as { etag?: unknown };
        return typeof result.etag === "string" ? result.etag : "";
      }
      last = new Error(`Recording part upload failed (${response.status}).`);
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 750 * 2 ** attempt));
  }
  throw last instanceof Error ? last : new Error("Recording upload failed.");
}

function drawCover(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  if (video.videoWidth === 0 || video.videoHeight === 0) return;
  const scale = Math.max(width / video.videoWidth, height / video.videoHeight);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  context.drawImage(
    video,
    (video.videoWidth - sourceWidth) / 2,
    (video.videoHeight - sourceHeight) / 2,
    sourceWidth,
    sourceHeight,
    x,
    y,
    width,
    height,
  );
}
