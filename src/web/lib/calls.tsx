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
import { Phone, PhoneOff, Video, Mic, MicOff } from "lucide-react";
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
          if (next.status === "ACTIVE" && next.answerSdp && pcRef.current && !pcRef.current.currentRemoteDescription) {
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
    if (stream) {
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    }
  }, [muted]);

  const value = useMemo(() => ({ startCall }), [startCall]);
  const ringing = active?.status === "RINGING";
  const live = active?.status === "ACTIVE";

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
      {active ? (
        <div className="call-overlay" role="dialog" aria-label="Call">
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
                <p className="meta">
                  {ringing
                    ? active.incoming
                      ? "Incoming voice call"
                      : "Ringing…"
                    : live
                      ? "Connected"
                      : active.status.toLowerCase()}
                </p>
              </div>
            )}
            <audio ref={remoteAudio} autoPlay />
            {error ? <p className="call-error">{error}</p> : null}
            <div className="call-actions">
              {ringing && active.incoming ? (
                <>
                  <button className="call-btn accept" type="button" onClick={() => void answer()}>
                    {active.kind === "VIDEO" ? <Video size={20} /> : <Phone size={20} />}
                    Answer
                  </button>
                  <button className="call-btn end" type="button" onClick={() => void decline()}>
                    <PhoneOff size={20} />
                    Decline
                  </button>
                </>
              ) : (
                <>
                  <button className="call-btn" type="button" onClick={() => setMuted((v) => !v)}>
                    {muted ? <MicOff size={20} /> : <Mic size={20} />}
                    {muted ? "Unmute" : "Mute"}
                  </button>
                  <button className="call-btn end" type="button" onClick={() => void hangup(active.id)}>
                    <PhoneOff size={20} />
                    End
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </Ctx.Provider>
  );
}
