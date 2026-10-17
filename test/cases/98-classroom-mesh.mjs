import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const worker = read("src/worker/index.ts");
const signal = read("src/worker/durable-objects/ClassroomSignal.ts");
const web = read("web/src/classroom/meshClassroom.ts");
const webStage = read("web/src/classroom/ClassroomWorkspace.tsx");
const webApp = read("web/src/App.tsx");
const router = read("web/src/router.ts");
const api = read("web/src/classroom/classroomApi.ts");
const android = read("native-android/app/src/main/java/app/kuchupuchu/android/VintoxMediaRoom.kt");
const wrangler = read("wrangler.toml");
const checks = [
  [
    "Worker admission calls Laravel before opening signalling",
    worker.includes("await classroomUpstream(") && worker.includes("/ws/classroom/"),
  ],
  [
    "Worker returns P2P credentials and no relay fallback",
    worker.includes('transport: "p2p-mesh"') && worker.includes("turnFallback: false"),
  ],
  [
    "Durable Object has hard six-person admission cap",
    signal.includes("const MAX_PARTICIPANTS = 6") &&
      signal.includes('return new Response("Class full", { status: 409 })'),
  ],
  [
    "Durable Object stamps authenticated sender identity",
    signal.includes("from: attachment.userId"),
  ],
  [
    "Signalling targets one peer instead of broadcasting SDP",
    signal.includes("target?.userId === frame.to"),
  ],
  [
    "Web media uses direct ICE with no TURN",
    web.includes('iceTransportPolicy: "all"') && !web.includes("turn:"),
  ],
  [
    "Web publishes audio for all and video only for instructor",
    web.includes("audio: true, video: this.instructor"),
  ],
  [
    "Android media uses direct ICE with no TURN",
    android.includes("IceTransportsType.ALL") && !android.includes("turn:"),
  ],
  [
    "Android publishes audio and conditionally starts instructor camera",
    android.includes("createAudioTrack") && android.includes("if (instructor) startCamera()"),
  ],
  [
    "Both native clients enforce six participants",
    web.includes("const MAX_PARTICIPANTS = 6") &&
      android.includes("const val MAX_PARTICIPANTS = 6"),
  ],
  [
    "Room API rejects transport downgrade",
    api.includes('room.transport !== "p2p-mesh"') && api.includes("room.turnFallback !== false"),
  ],
  [
    "Web Class option is mounted as an authenticated native route",
    webApp.includes("<ClassroomWorkspace />") &&
      webApp.includes('id: "classroom", label: "Class"') &&
      router.includes('route.section === "classroom"') &&
      webStage.includes("new MeshClassroom("),
  ],
  [
    "Classroom signalling Durable Object is registered for deployment",
    wrangler.includes('name = "CLASSROOM_SIGNAL"') &&
      wrangler.includes('class_name = "ClassroomSignal"'),
  ],
];
console.log("\n[98] VPS-free classroom mesh");
for (const [name, ok] of checks) console.log(`  ${ok ? "OK    " : "BROKEN"}  ${name}`);
process.exit(checks.some(([, ok]) => !ok) ? 1 : 0);
