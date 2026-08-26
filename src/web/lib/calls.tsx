import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Camera,
  CameraOff,
  Mic,
  MicOff,
  MonitorUp,
  Phone,
  PhoneOff,
  Video,
  Volume2,
  VolumeX,
} from "lucide-react";
import { api, RequestError } from "./api";
import type { PublicUser } from "./types";
import { Avatar } from "../components/ui";

type CallKind = "AUDIO" | "VIDEO";

export type CallRecord = {
  id: string;
  kind: CallKind;
  status: string;
  callerId: string;
  calleeId: string;
  offerSdp: string | null;
  answerSdp: string | null;
  incoming: boolean;
  other: PublicUser;
};

type CallCtx = {
  startCall: (userId: string, kind: CallKind) => Promise<void>;
};

const Ctx = createContext<CallCtx | null>(null);
const ICE = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

export function useCall() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("CallProvider missing");
  return ctx;
}

export function CallProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<CallRecord | null>(null);
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(true);
  const [cameraOff, setCameraOff] = useState(false);
  const [sharing, setSharing] = useState(false);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const seenIce = useRef(new Set<string>());
  const localVideo = useRef<HTMLVideoElement | null>(null);
  const remoteVideo = useRef<HTMLVideoElement | null>(null);
  const remoteAudio = useRef<HTMLAudioElement | null>(null);

  const stopMedia = useCallback(() => {
    localRef.current?.getTracks().forEach((track) => track.stop());
    localRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    seenIce.current.clear();
    setMuted(false);
    setCameraOff(false);
    setSharing(false);
    if (localVideo.current) localVideo.current.srcObject = null;
    if (remoteVideo.current) remoteVideo.current.srcObject = null;
    if (remoteAudio.current) remoteAudio.current.srcObject = null;
  }, []);

  const attachRemote = useCallback((stream: MediaStream) => {
    if (remoteVideo.current) remoteVideo.current.srcObject = stream;
    if (remoteAudio.current) remoteAudio.current.srcObject = stream;
  }, []);

  const makePc = useCallback(
    (callId: string) => {
      const pc = new RTCPeerConnection(ICE);
      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        void api(`/api/calls/${callId}/ice`, {
          method: "POST",
          body: JSON.stringify({ candidate: event.candidate }),
        }).catch(() => undefined);
      };
      pc.ontrack = (event) => {
        const stream = event.streams[0] ?? new MediaStream([event.track]);
        attachRemote(stream);
      };
      pcRef.current = pc;
      return pc;
    },
    [attachRemote],
  );

  const media = useCallback(async (kind: CallKind) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: kind === "VIDEO",
    });
    localRef.current = stream;
    if (localVideo.current) localVideo.current.srcObject = stream;
    return stream;
  }, []);

  const pullIce = useCallback(async (callId: string) => {
    const data = await api<{ items: Array<{ id: string; candidate: RTCIceCandidateInit }> }>(
      `/api/calls/${callId}/ice`,
    );
    for (const item of data.items) {
      if (seenIce.current.has(item.id) || !item.candidate) continue;
      seenIce.current.add(item.id);
      try {
        await pcRef.current?.addIceCandidate(item.candidate);
      } catch {
        /* candidate may arrive early */
      }
    }
  }, []);

  const hangup = useCallback(
    async (callId?: string) => {
      const id = callId ?? active?.id;
      stopMedia();
      setActive(null);
      setError("");
      if (id) await api(`/api/calls/${id}/hangup`, { method: "POST" }).catch(() => undefined);
    },
    [active?.id, stopMedia],
  );

  const startCall = useCallback(
    async (userId: string, kind: CallKind) => {
      setError("");
      try {
        const stream = await media(kind);
        const pc = new RTCPeerConnection(ICE);
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
        const pending: RTCIceCandidate[] = [];
        pc.onicecandidate = (event) => {
          if (event.candidate) pending.push(event.candidate);
        };
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const created = await api<{ call: CallRecord }>("/api/calls", {
          method: "POST",
          body: JSON.stringify({ userId, kind, offerSdp: offer.sdp }),
        });
        pc.onicecandidate = (event) => {
          if (!event.candidate) return;
          void api(`/api/calls/${created.call.id}/ice`, {
            method: "POST",
            body: JSON.stringify({ candidate: event.candidate }),
          }).catch(() => undefined);
        };
        for (const candidate of pending) {
          void api(`/api/calls/${created.call.id}/ice`, {
            method: "POST",
            body: JSON.stringify({ candidate }),
          }).catch(() => undefined);
        }
        pc.ontrack = (event) => {
          const remote = event.streams[0] ?? new MediaStream([event.track]);
          attachRemote(remote);
        };
        pcRef.current = pc;
        setActive(created.call);
      } catch (err) {
        stopMedia();
        setError(
          err instanceof RequestError
            ? err.body.message
            : err instanceof DOMException
              ? "Microphone or camera permission is required for calls."
              : "Could not start the call.",
        );
      }
    },
    [attachRemote, media, stopMedia],
  );

  const answer = useCallback(async () => {
    if (!active?.offerSdp) return;
    setError("");
    try {
      const stream = await media(active.kind);
      const pc = makePc(active.id);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      await pc.setRemoteDescription({ type: "offer", sdp: active.offerSdp });
      const answerDesc = await pc.createAnswer();
      await pc.setLocalDescription(answerDesc);
      const updated = await api<{ call: CallRecord }>(`/api/calls/${active.id}/answer`, {
        method: "POST",
        body: JSON.stringify({ answerSdp: answerDesc.sdp }),
      });
      setActive(updated.call);
    } catch (err) {
      setError(
        err instanceof RequestError
          ? err.body.message
          : "Could not answer. Allow microphone access and try again.",
      );
    }
  }, [active, makePc, media]);

  const decline = useCallback(async () => {
    if (!active) return;
    await api(`/api/calls/${active.id}/decline`, { method: "POST" }).catch(() => undefined);
    stopMedia();
    setActive(null);
  }, [active, stopMedia]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void api<{ items: CallRecord[] }>("/api/calls/active")
        .then(async (data) => {
          const next = data.items[0] ?? null;
          if (!next) {
            if (active && ["RINGING", "ACTIVE"].includes(active.status)) {
              stopMedia();
              setActive(null);
            }
            return;
          }
          setActive((current) => {
            if (!current) return next;
            return { ...current, ...next };
          });
          if (
            next.status === "ACTIVE" &&
            next.answerSdp &&
            pcRef.current &&
            !pcRef.current.currentRemoteDescription
          ) {
            await pcRef.current.setRemoteDescription({ type: "answer", sdp: next.answerSdp });
          }
          if (next.status === "ACTIVE" || next.status === "RINGING") {
            await pullIce(next.id);
          }
          if (["ENDED", "DECLINED", "MISSED", "CANCELLED"].includes(next.status)) {
            stopMedia();
            setActive(null);
          }
        })
        .catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [active, pullIce, stopMedia]);

  useEffect(() => {
    const stream = localRef.current;
    if (!stream) return;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    stream.getVideoTracks().forEach((track) => {
      track.enabled = !cameraOff;
    });
  }, [muted, cameraOff]);

  useEffect(() => {
    const el = remoteAudio.current as
      (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (el && typeof el.setSinkId === "function") {
      void el.setSinkId(speaker ? "default" : "").catch(() => undefined);
    }
  }, [speaker, active]);

  async function shareScreen() {
    if (sharing) {
      const cam = await navigator.mediaDevices
        .getUserMedia({ video: true, audio: false })
        .catch(() => null);
      const next = cam?.getVideoTracks()[0];
      const sender = pcRef.current?.getSenders().find((item) => item.track?.kind === "video");
      if (next && sender) await sender.replaceTrack(next);
      if (next && localRef.current) {
        localRef.current.getVideoTracks().forEach((track) => track.stop());
        localRef.current.addTrack(next);
        if (localVideo.current) localVideo.current.srcObject = localRef.current;
      }
      setSharing(false);
      return;
    }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = display.getVideoTracks()[0];
      if (!track) return;
      const sender = pcRef.current?.getSenders().find((item) => item.track?.kind === "video");
      if (sender) await sender.replaceTrack(track);
      else pcRef.current?.addTrack(track, display);
      track.onended = () => setSharing(false);
      if (localVideo.current) localVideo.current.srcObject = display;
      setSharing(true);
    } catch {
      setError("Screen share needs permission, or this phone does not support it.");
    }
  }

  const value = useMemo(() => ({ startCall }), [startCall]);
  const ringing = active?.status === "RINGING";
  const live = active?.status === "ACTIVE";
  const statusLabel = ringing
    ? active?.incoming
      ? "Incoming call"
      : "Ringing…"
    : live
      ? "Connected"
      : (active?.status ?? "").toLowerCase();

  return (
    <Ctx.Provider value={value}>
      {children}
      {error && !active ? (
        <div className="call-toast" role="status">
          {error}
          <button className="btn-ghost" type="button" onClick={() => setError("")}>
            Dismiss
          </button>
        </div>
      ) : null}
      {active
        ? createPortal(
            <div
              className="call-overlay"
              role="dialog"
              aria-label="Call"
              style={{
                position: "fixed",
                inset: 0,
                width: "100vw",
                height: "100dvh",
                zIndex: 400,
                background: "#1c1917",
                padding: 0,
                margin: 0,
              }}
            >
              <div className={`call-stage ${active.kind === "VIDEO" ? "video" : "audio"}`}>
                {active.kind === "VIDEO" ? (
                  <>
                    <video ref={remoteVideo} className="remote-video" autoPlay playsInline />
                    <video ref={localVideo} className="local-video" autoPlay playsInline muted />
                  </>
                ) : (
                  <div className="call-audio">
                    <Avatar name={active.other.displayName} url={active.other.avatarUrl} large />
                    <h2>{active.other.displayName}</h2>
                    <p className="call-status">{statusLabel}</p>
                  </div>
                )}
                <audio ref={remoteAudio} autoPlay />
                {error ? <p className="call-error">{error}</p> : null}
                <div className="call-actions">
                  {ringing && active.incoming ? (
                    <>
                      <button
                        className="call-btn accept"
                        type="button"
                        onClick={() => void answer()}
                      >
                        {active.kind === "VIDEO" ? <Video size={26} /> : <Phone size={26} />}
                      </button>
                      <button className="call-btn end" type="button" onClick={() => void decline()}>
                        <PhoneOff size={26} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className={speaker ? "call-btn on" : "call-btn"}
                        type="button"
                        aria-label="Speaker"
                        onClick={() => setSpeaker((v) => !v)}
                      >
                        {speaker ? <Volume2 size={22} /> : <VolumeX size={22} />}
                      </button>
                      <button
                        className={muted ? "call-btn on" : "call-btn"}
                        type="button"
                        aria-label="Mute"
                        onClick={() => setMuted((v) => !v)}
                      >
                        {muted ? <MicOff size={22} /> : <Mic size={22} />}
                      </button>
                      <button
                        className={cameraOff ? "call-btn on" : "call-btn"}
                        type="button"
                        aria-label="Camera"
                        onClick={() => setCameraOff((v) => !v)}
                      >
                        {cameraOff ? <CameraOff size={22} /> : <Camera size={22} />}
                      </button>
                      <button
                        className={sharing ? "call-btn on" : "call-btn"}
                        type="button"
                        aria-label="Share screen"
                        onClick={() => void shareScreen()}
                      >
                        <MonitorUp size={22} />
                      </button>
                      <button
                        className="call-btn end"
                        type="button"
                        aria-label="End call"
                        onClick={() => void hangup(active.id)}
                      >
                        <PhoneOff size={26} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </Ctx.Provider>
  );
}
