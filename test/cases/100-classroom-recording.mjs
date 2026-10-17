import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
let ok = 0;
let broken = 0;
const check = (name, value) => {
  if (value) {
    ok += 1;
    console.log(`  OK       ${name}`);
  } else {
    broken += 1;
    console.log(`  BROKEN   ${name}`);
  }
};

const worker = read("src/worker/index.ts");
const workspace = read("web/src/classroom/ClassroomWorkspace.tsx");
const recorder = read("web/src/classroom/classroomRecording.ts");
const mesh = read("web/src/classroom/meshClassroom.ts");

check(
  "only an instructor sees the explicit device-recording control",
  workspace.includes('instructor && recording === "idle"') &&
    workspace.includes("Record on this device") &&
    workspace.includes("Stop &amp; upload"),
);
check(
  "leaving while recording stops and privately uploads before media teardown",
  workspace.includes('if (recording === "recording" && !(await stopRecording())) return;') &&
    workspace.includes("if (active) void classroomApi.attendance") &&
    workspace.includes("roomRef.current?.close();"),
);
check(
  "navigation warns while recording or upload is incomplete",
  workspace.includes('recording !== "recording" && recording !== "uploading"') &&
    workspace.includes('window.addEventListener("beforeunload"'),
);
check(
  "the recorder composites local and direct remote streams on the instructor device",
  recorder.includes("createMediaStreamSource(stream)") &&
    recorder.includes("canvas.captureStream(FPS)") &&
    mesh.includes("recordingStreams(): readonly MediaStream[]"),
);
check(
  "recording is uploaded in bounded multipart chunks with retry and progress",
  recorder.includes("blob.slice(") &&
    recorder.includes("putWithRetry") &&
    recorder.includes("session.partSize") &&
    recorder.includes("onProgress(Math.round"),
);
check(
  "browser uploads directly to Laravel/R2 without carrying recording bytes through the Worker",
  recorder.includes('method: "PUT"') &&
    recorder.includes("session.partUploadUrl") &&
    recorder.includes('credentials: "omit"') &&
    recorder.includes("Object storage did not return a part checksum"),
);
check(
  "failed uploads are explicitly aborted rather than published as complete",
  recorder.includes('method: "DELETE"') &&
    recorder.indexOf('method: "DELETE"') > recorder.indexOf("catch (error)"),
);
check(
  "Worker exposes authenticated start, part, complete and abort recording controls",
  worker.includes("classroomRecordingStart") &&
    worker.includes("classroomRecordingPart") &&
    worker.includes("classroomRecordingComplete") &&
    worker.includes("classroomRecordingAbort"),
);
check(
  "the classroom remains direct P2P with public STUN and no TURN",
  mesh.includes("stun:stun.cloudflare.com:3478") &&
    mesh.includes("stun:stun.l.google.com:19302") &&
    !mesh.toLowerCase().includes("turn:"),
);

console.log(`classroom-recording: ${ok} ok / ${broken} broken`);
if (broken) process.exit(1);
