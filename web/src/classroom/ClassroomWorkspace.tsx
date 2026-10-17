import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { Icon } from "../icons";
import { classroomApi, type ClassroomSummary } from "./classroomApi";
import { MAX_PARTICIPANTS, MeshClassroom } from "./meshClassroom";
import { InstructorRecorder, uploadClassRecording } from "./classroomRecording";
import "./classroom.css";

export function ClassroomWorkspace() {
  const { api } = useAuth();
  const [classes, setClasses] = useState<readonly ClassroomSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState("");
  const [active, setActive] = useState<ClassroomSummary | null>(null);
  const [streams, setStreams] = useState<Map<string, MediaStream>>(new Map());
  const [participants, setParticipants] = useState(0);
  const [instructor, setInstructor] = useState(false);
  const [recording, setRecording] = useState<"idle" | "recording" | "uploading" | "saved">("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState("");
  const roomRef = useRef<MeshClassroom | null>(null);
  const recorderRef = useRef<InstructorRecorder | null>(null);

  useEffect(() => {
    let live = true;
    void classroomApi
      .list(api)
      .then((rows) => live && setClasses(rows))
      .catch(
        () => live && setError("Classes could not be loaded. Check the approved VintoxBd link."),
      )
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
      roomRef.current?.close();
    };
  }, [api]);

  useEffect(() => {
    if (!active) return;
    const heartbeat = window.setInterval(
      () => void classroomApi.attendance(api, active.id, "heartbeat").catch(() => undefined),
      30_000,
    );
    return () => window.clearInterval(heartbeat);
  }, [active, api]);

  useEffect(() => {
    if (recording !== "recording" && recording !== "uploading") return;
    const protect = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [recording]);

  async function joinClass(item: ClassroomSummary) {
    setJoining(item.id);
    setError("");
    try {
      const credentials = await classroomApi.room(api, item.id);
      const room = new MeshClassroom(
        credentials.participantId,
        credentials.instructor,
        (id, stream) => setStreams((current) => new Map(current).set(id, stream)),
        setParticipants,
        (reason) =>
          setError(
            reason === "CLASS_FULL"
              ? `This class is full (${MAX_PARTICIPANTS}/${MAX_PARTICIPANTS}).`
              : "A direct connection failed. Try another network.",
          ),
      );
      roomRef.current = room;
      await room.connect(credentials.url, credentials.ticket);
      setActive(item);
      setInstructor(credentials.instructor);
      setParticipants(1);
    } catch {
      roomRef.current?.close();
      roomRef.current = null;
      setError(
        "The class could not be opened. Access may have expired or the direct connection failed.",
      );
    } finally {
      setJoining("");
    }
  }

  async function startRecording() {
    if (!instructor || !roomRef.current || recording === "uploading") return;
    setError("");
    try {
      const recorder = new InstructorRecorder(roomRef.current.recordingStreams());
      await recorder.start();
      recorderRef.current = recorder;
      setRecording("recording");
      setUploadProgress(0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The device recording could not start.");
    }
  }

  async function stopRecording(): Promise<boolean> {
    const recorder = recorderRef.current;
    if (!recorder || !active) return true;
    setRecording("uploading");
    setUploadProgress(0);
    try {
      const blob = await recorder.stop();
      recorderRef.current = null;
      await uploadClassRecording(api, active.id, blob, setUploadProgress);
      setRecording("saved");
      return true;
    } catch (reason) {
      setRecording("idle");
      setError(
        reason instanceof Error
          ? `${reason.message} The recording was not published.`
          : "The recording could not be uploaded privately.",
      );
      return false;
    }
  }

  async function leave() {
    if (recording === "uploading") return;
    if (recording === "recording" && !(await stopRecording())) return;
    if (active) void classroomApi.attendance(api, active.id, "leave").catch(() => undefined);
    roomRef.current?.close();
    roomRef.current = null;
    recorderRef.current = null;
    setActive(null);
    setStreams(new Map());
    setParticipants(0);
    setInstructor(false);
    setRecording("idle");
    setUploadProgress(0);
  }

  if (active) {
    return (
      <main className="classroom-room" aria-labelledby="classroom-title">
        <header className="classroom-header">
          <div>
            <p className="eyebrow">DIRECT GROUP CLASS</p>
            <h1 id="classroom-title">{active.title}</h1>
            <p>
              {participants} / {MAX_PARTICIPANTS} participants
            </p>
          </div>
          <div className="classroom-actions">
            {instructor && recording === "idle" && (
              <button
                type="button"
                className="classroom-record"
                onClick={() => void startRecording()}
              >
                Record on this device
              </button>
            )}
            {instructor && recording === "recording" && (
              <button
                type="button"
                className="classroom-record is-recording"
                onClick={() => void stopRecording()}
              >
                Stop &amp; upload
              </button>
            )}
            {recording === "uploading" && (
              <span className="classroom-upload" role="status">
                Private upload {uploadProgress}%
              </span>
            )}
            {recording === "saved" && <span className="classroom-saved">Recording saved</span>}
            <button
              type="button"
              className="classroom-leave"
              disabled={recording === "uploading"}
              onClick={() => void leave()}
            >
              Leave class
            </button>
          </div>
        </header>
        {error && (
          <p className="classroom-error" role="alert">
            {error}
          </p>
        )}
        <section className="classroom-grid" aria-label="Class video streams">
          {[...streams].map(([id, stream]) => (
            <StreamView key={id} id={id} stream={stream} />
          ))}
          {streams.size === 0 && (
            <div className="classroom-waiting">
              <Icon name="classroom" size={42} />
              <strong>Connected to the class</strong>
              <span>Waiting for instructor video. Audio connects automatically.</span>
            </div>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="classroom-workspace" aria-labelledby="classes-title">
      <header className="classroom-header">
        <div>
          <p className="eyebrow">VINTOXBD INSTITUTE</p>
          <h1 id="classes-title">Classes</h1>
          <p>Approved, enrolled classes from your linked VintoxBd account.</p>
        </div>
      </header>
      {error && (
        <p className="classroom-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="classroom-empty">Loading classes…</p>
      ) : classes.length === 0 ? (
        <p className="classroom-empty">No enrolled classes are available.</p>
      ) : (
        <section className="classroom-list" aria-label="Available classes">
          {classes.map((item) => (
            <article className="classroom-card" key={item.id}>
              <div className="classroom-card__icon">
                <Icon name="classroom" size={22} />
              </div>
              <div className="classroom-card__copy">
                <h2>{item.title}</h2>
                <p>{item.startsAt ? new Date(item.startsAt).toLocaleString() : item.status}</p>
              </div>
              <button
                type="button"
                disabled={!item.joinable || joining !== ""}
                onClick={() => void joinClass(item)}
              >
                {joining === item.id ? "Joining…" : item.joinable ? "Join class" : "Not live"}
              </button>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}

function StreamView({ id, stream }: { readonly id: string; readonly stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
    return () => {
      if (ref.current) ref.current.srcObject = null;
    };
  }, [stream]);
  return <video ref={ref} className="classroom-video" data-peer={id} autoPlay playsInline />;
}
