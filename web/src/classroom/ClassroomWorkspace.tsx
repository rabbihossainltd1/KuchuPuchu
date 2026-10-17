import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { Icon } from "../icons";
import { classroomApi, type ClassroomSummary } from "./classroomApi";
import { MAX_PARTICIPANTS, MeshClassroom } from "./meshClassroom";
import "./classroom.css";

export function ClassroomWorkspace() {
  const { api } = useAuth();
  const [classes, setClasses] = useState<readonly ClassroomSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState("");
  const [active, setActive] = useState<ClassroomSummary | null>(null);
  const [streams, setStreams] = useState<Map<string, MediaStream>>(new Map());
  const [participants, setParticipants] = useState(0);
  const [error, setError] = useState("");
  const roomRef = useRef<MeshClassroom | null>(null);

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

  function leave() {
    if (active) void classroomApi.attendance(api, active.id, "leave").catch(() => undefined);
    roomRef.current?.close();
    roomRef.current = null;
    setActive(null);
    setStreams(new Map());
    setParticipants(0);
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
          <button type="button" className="classroom-leave" onClick={leave}>
            Leave class
          </button>
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
