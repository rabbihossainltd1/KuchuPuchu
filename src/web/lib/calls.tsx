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
import { lastSeenLabel } from "./time";
import { cancelCallOs, listenNotifyActions, pingOs } from "./notify";
import { playTone, stopTone, unlockAudio } from "./sounds";
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
  startCall: (userId: string, kind: CallKind, other?: PublicUser) => Promise<void>;
};

const Ctx = createContext<CallCtx | null>(null);
const ICE: RTCConfiguration = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    { urls: "stun:stun.cloudflare.com:3478" },
    {
      urls: [
        "turn:openrelay.metered.ca:80",
        "turn:openrelay.metered.ca:80?transport=tcp",
        "turn:openrelay.metered.ca:443",
        "turns:openrelay.metered.ca:443",
      ],
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
  iceCandidatePoolSize: 4,
};

declare global {
  interface Window {
    KpCallAudio?: {
      setSpeaker: (on: boolean) => void;
      startRing?: () => void;
      endAudio?: () => void;
      startScreen?: () => void;
      stopScreen?: () => void;
    };
    KpCallBridge?: {
      answerFromNotify?: (callId: string) => void;
      declineFromNotify?: (callId: string) => void;
    };
    KpOnScreenFrame?: (dataUrl: string) => void;
    webkitAudioContext?: typeof AudioContext;
  }
}

export function useCall() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("CallProvider missing");
  return ctx;
}

function stubUser(userId: string, person?: PublicUser): PublicUser {
  return (
    person ?? {
      userId,
      displayName: "Player",
      username: "player",
      avatarUrl: null,
      bio: null,
      country: null,
      district: null,
      approximateArea: null,
      ffUid: null,
      ffIgn: null,
      serverRegion: null,
      level: null,
      rank: null,
      preferredModes: [],
      playStyle: null,
      languages: [],
      availability: [],
      micPreference: null,
      relationshipStatus: null,
      facebookId: null,
      instagram: null,
      whatsapp: null,
      verifiedFf: false,
      verifiedIdentity: false,
      reputation: 0,
      lastActiveAt: new Date().toISOString(),
      online: false,
    }
  );
}

function playMedia(el: HTMLMediaElement | null, stream: MediaStream | null, mute = false) {
  if (!el) return;
  el.setAttribute("playsinline", "true");
  el.setAttribute("webkit-playsinline", "true");
  el.controls = false;
  el.muted = mute;
  el.volume = 1;
  if (el.srcObject !== stream) el.srcObject = stream;
  if (stream) {
    const go = () => void el.play().catch(() => undefined);
    go();
    window.setTimeout(go, 200);
    window.setTimeout(go, 800);
  }
}

function clock(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function blankVideo() {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, 16, 16);
  }
  const track = canvas.captureStream(1).getVideoTracks()[0];
  if (track) track.enabled = false;
  return track;
}

export function CallProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<CallRecord | null>(null);
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [remoteReady, setRemoteReady] = useState(false);
  const [hasLocal, setHasLocal] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const seenIce = useRef(new Set<string>());
  const ignored = useRef(new Set<string>());
  const pinged = useRef(new Set<string>());
  const leftRef = useRef(false);
  const liveSince = useRef<number | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const localVideo = useRef<HTMLVideoElement | null>(null);
  const remoteVideo = useRef<HTMLVideoElement | null>(null);
  const remoteAudio = useRef<HTMLAudioElement | null>(null);
  const answering = useRef(false);
  const hookedKey = useRef("");
  const activeRef = useRef<CallRecord | null>(null);
  const speakerRef = useRef(false);
  activeRef.current = active;
  speakerRef.current = speaker;

  const routeAudio = useCallback((on: boolean) => {
    try {
      window.KpCallAudio?.setSpeaker(on);
    } catch {
      /* web */
    }
  }, []);

  const hookRemoteSound = useCallback((stream: MediaStream) => {
    unlockAudio();
    playMedia(remoteAudio.current, stream, false);
    const key = stream
      .getAudioTracks()
      .map((track) => track.id)
      .join("|");
    if (!key || hookedKey.current === key) {
      void audioCtx.current?.resume().catch(() => undefined);
      return;
    }
    hookedKey.current = key;
    if (window.KpCallAudio) return;
    try {
      void audioCtx.current?.close();
    } catch {
      /* */
    }
    audioCtx.current = null;
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      void ctx.resume();
      const src = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain();
      gain.gain.value = 1;
      src.connect(gain);
      gain.connect(ctx.destination);
      audioCtx.current = ctx;
    } catch {
      /* element fallback */
    }
  }, []);

  const stopMedia = useCallback(() => {
    stopTone();
    try {
      window.KpCallAudio?.stopScreen?.();
      window.KpCallAudio?.endAudio?.();
    } catch {
      /* web */
    }
    window.KpOnScreenFrame = undefined;
    try {
      void audioCtx.current?.close();
    } catch {
      /* */
    }
    audioCtx.current = null;
    hookedKey.current = "";
    localRef.current?.getTracks().forEach((track) => track.stop());
    localRef.current = null;
    remoteStreamRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    seenIce.current.clear();
    liveSince.current = null;
    answering.current = false;
    setMuted(false);
    setCameraOff(false);
    setSharing(false);
    setRemoteReady(false);
    setHasLocal(false);
    setElapsed(0);
    playMedia(localVideo.current, null, true);
    playMedia(remoteVideo.current, null, true);
    playMedia(remoteAudio.current, null);
  }, []);

  const attachRemote = useCallback(
    (incoming: MediaStream) => {
      const stream = remoteStreamRef.current ?? new MediaStream();
      for (const track of incoming.getTracks()) {
        if (!stream.getTracks().some((item) => item.id === track.id)) stream.addTrack(track);
        track.onunmute = () => {
          if (track.kind === "video") setRemoteReady(true);
        };
      }
      remoteStreamRef.current = stream;
      playMedia(remoteVideo.current, stream, true);
      hookRemoteSound(stream);
      if (stream.getVideoTracks().some((track) => track.readyState === "live" && track.enabled)) {
        setRemoteReady(true);
      }
    },
    [hookRemoteSound],
  );

  const wirePc = useCallback(
    (pc: RTCPeerConnection, callId: string) => {
      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        void api(`/api/calls/${callId}/ice`, {
          method: "POST",
          body: JSON.stringify({ candidate: event.candidate.toJSON() }),
        }).catch(() => undefined);
      };
      pc.ontrack = (event) => {
        const stream = event.streams[0] ?? new MediaStream([event.track]);
        attachRemote(stream);
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") {
          void pc.restartIce();
        }
      };
      pcRef.current = pc;
    },
    [attachRemote],
  );

  const media = useCallback(
    async (kind: CallKind) => {
      unlockAudio();
      routeAudio(speakerRef.current);
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 860 } },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        const blank = blankVideo();
        if (blank) stream.addTrack(blank);
      }
      if (kind === "AUDIO") {
        stream.getVideoTracks().forEach((track) => {
          track.enabled = false;
        });
        setCameraOff(true);
      } else {
        setCameraOff(false);
      }
      localRef.current = stream;
      setHasLocal(true);
      playMedia(localVideo.current, stream, true);
      return stream;
    },
    [routeAudio],
  );

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
        /* early */
      }
    }
  }, []);

  const hangup = useCallback(
    async (callId?: string) => {
      leftRef.current = true;
      const current = activeRef.current;
      const id = callId ?? current?.id;
      if (id) ignored.current.add(id);
      if (current?.id) ignored.current.add(current.id);
      const seconds = liveSince.current ? Math.floor((Date.now() - liveSince.current) / 1000) : 0;
      const ended = [id, current?.id].filter(Boolean) as string[];
      stopMedia();
      setActive(null);
      setError("");
      for (const item of ended) {
        void cancelCallOs(item);
        if (!item.startsWith("pending")) {
          await api(`/api/calls/${item}/hangup`, {
            method: "POST",
            body: JSON.stringify({ seconds }),
          }).catch(() => undefined);
        }
      }
      await api("/api/calls/clear", { method: "POST", body: "{}" }).catch(() => undefined);
    },
    [stopMedia],
  );

  const startCall = useCallback(
    async (userId: string, kind: CallKind, person?: PublicUser) => {
      if (activeRef.current) return;
      leftRef.current = false;
      setError("");
      unlockAudio();
      const placeholder: CallRecord = {
        id: `pending-${Date.now()}`,
        kind,
        status: "RINGING",
        callerId: "me",
        calleeId: userId,
        offerSdp: null,
        answerSdp: null,
        incoming: false,
        other: stubUser(userId, person),
      };
      setActive(placeholder);
      setSpeaker(false);
      routeAudio(false);
      playTone("/sounds/calling.wav");
      try {
        const stream = await media(kind);
        if (leftRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const pc = new RTCPeerConnection(ICE);
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
        if (!stream.getVideoTracks().length) {
          const blank = blankVideo();
          if (blank) pc.addTrack(blank, stream);
        }
        const pending: RTCIceCandidate[] = [];
        pc.onicecandidate = (event) => {
          if (event.candidate) pending.push(event.candidate);
        };
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });
        await pc.setLocalDescription(offer);
        const created = await api<{ call: CallRecord }>("/api/calls", {
          method: "POST",
          body: JSON.stringify({ userId, kind, offerSdp: offer.sdp }),
        });
        if (leftRef.current) {
          ignored.current.add(created.call.id);
          await api(`/api/calls/${created.call.id}/hangup`, {
            method: "POST",
            body: JSON.stringify({ seconds: 0 }),
          }).catch(() => undefined);
          stopMedia();
          setActive(null);
          return;
        }
        wirePc(pc, created.call.id);
        for (const candidate of pending) {
          void api(`/api/calls/${created.call.id}/ice`, {
            method: "POST",
            body: JSON.stringify({ candidate: candidate.toJSON() }),
          }).catch(() => undefined);
        }
        setActive({ ...created.call, other: person ?? created.call.other });
      } catch (err) {
        stopMedia();
        setActive(null);
        setError(
          err instanceof RequestError
            ? err.body.message
            : err instanceof DOMException
              ? "Microphone or camera permission is required for calls."
              : "Could not start the call.",
        );
      }
    },
    [media, routeAudio, stopMedia, wirePc],
  );

  const answerRecord = useCallback(
    async (record: CallRecord) => {
      if (!record.offerSdp || answering.current || pcRef.current) return;
      answering.current = true;
      leftRef.current = false;
      setError("");
      stopTone();
      unlockAudio();
      routeAudio(speakerRef.current);
      setActive(record);
      try {
        const stream = await media(record.kind);
        if (leftRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const pc = new RTCPeerConnection(ICE);
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
        if (!stream.getVideoTracks().length) {
          const blank = blankVideo();
          if (blank) pc.addTrack(blank, stream);
        }
        wirePc(pc, record.id);
        await pc.setRemoteDescription({ type: "offer", sdp: record.offerSdp });
        const answerDesc = await pc.createAnswer();
        await pc.setLocalDescription(answerDesc);
        const updated = await api<{ call: CallRecord }>(`/api/calls/${record.id}/answer`, {
          method: "POST",
          body: JSON.stringify({ answerSdp: answerDesc.sdp }),
        });
        void cancelCallOs(record.id);
        setActive(updated.call);
      } catch (err) {
        answering.current = false;
        setError(
          err instanceof RequestError
            ? err.body.message
            : "Could not answer. Allow microphone access and try again.",
        );
      }
    },
    [media, routeAudio, wirePc],
  );

  const answer = useCallback(async () => {
    const record = activeRef.current;
    if (record) await answerRecord(record);
  }, [answerRecord]);

  const decline = useCallback(
    async (callId?: string) => {
      const current = activeRef.current;
      const id = callId || current?.id;
      if (id) {
        ignored.current.add(id);
        void cancelCallOs(id);
        await api(`/api/calls/${id}/decline`, { method: "POST" }).catch(() => undefined);
      }
      if (!callId || !current || current.id === callId) {
        stopMedia();
        setActive(null);
      }
    },
    [stopMedia],
  );

  useEffect(() => {
    void navigator.mediaDevices
      ?.getUserMedia({ audio: true })
      .then((stream) => stream.getTracks().forEach((track) => track.stop()))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void api<{ items: CallRecord[] }>("/api/calls/active")
        .then(async (data) => {
          const live = data.items.filter((item) => !ignored.current.has(item.id));
          const current = activeRef.current;
          let next = live[0] ?? null;
          if (current?.id && !current.id.startsWith("pending")) {
            next = live.find((item) => item.id === current.id) ?? next;
          }
          if (leftRef.current) {
            for (const item of live) {
              if (!item.incoming) {
                ignored.current.add(item.id);
                await api(`/api/calls/${item.id}/hangup`, {
                  method: "POST",
                  body: JSON.stringify({ seconds: 0 }),
                }).catch(() => undefined);
                void cancelCallOs(item.id);
              }
            }
            const incoming = live.find((item) => item.incoming);
            if (!incoming) {
              if (current) {
                stopMedia();
                setActive(null);
              }
              if (!live.some((item) => !item.incoming)) leftRef.current = false;
              return;
            }
            leftRef.current = false;
            next = incoming;
          }
          if (!next) {
            if (
              current &&
              !current.id.startsWith("pending") &&
              ["RINGING", "ACTIVE"].includes(current.status)
            ) {
              void cancelCallOs(current.id);
              stopMedia();
              setActive(null);
            }
            return;
          }
          if (["ENDED", "DECLINED", "MISSED", "CANCELLED"].includes(next.status)) {
            ignored.current.add(next.id);
            void cancelCallOs(next.id);
            stopMedia();
            setActive(null);
            return;
          }
          if (next.incoming && next.status === "RINGING" && !pinged.current.has(next.id)) {
            pinged.current.add(next.id);
            void pingOs(
              "calls",
              next.kind === "VIDEO" ? "Incoming video call" : "Incoming call",
              next.other.displayName,
              { callId: next.id },
            );
            playTone("/sounds/ringtone.wav");
            try {
              window.KpCallAudio?.startRing?.();
            } catch {
              /* web */
            }
          }
          setActive((prev) => {
            if (ignored.current.has(next.id)) return prev;
            if (prev?.id.startsWith("pending") && prev.calleeId === next.calleeId) {
              return { ...next, other: prev.other };
            }
            if (
              prev &&
              prev.id === next.id &&
              prev.status === next.status &&
              prev.answerSdp === next.answerSdp &&
              prev.kind === next.kind
            ) {
              return prev;
            }
            return prev ? { ...prev, ...next } : next;
          });
          if (
            next.status === "ACTIVE" &&
            next.answerSdp &&
            pcRef.current &&
            !pcRef.current.currentRemoteDescription
          ) {
            await pcRef.current.setRemoteDescription({ type: "answer", sdp: next.answerSdp });
            stopTone();
            void cancelCallOs(next.id);
          }
          if (next.status === "ACTIVE" || next.status === "RINGING") {
            await pullIce(next.id);
          }
          if (next.status === "ACTIVE" && remoteStreamRef.current) {
            hookRemoteSound(remoteStreamRef.current);
            playMedia(remoteVideo.current, remoteStreamRef.current, true);
            playMedia(localVideo.current, localRef.current, true);
          }
        })
        .catch(() => undefined);
    }, 600);
    return () => window.clearInterval(timer);
  }, [hookRemoteSound, pullIce, stopMedia]);

  useEffect(() => {
    const stream = localRef.current;
    if (!stream) return;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    if (!sharing) {
      stream.getVideoTracks().forEach((track) => {
        track.enabled = !cameraOff;
      });
    }
  }, [muted, cameraOff, sharing]);

  useEffect(() => {
    if (!active) {
      stopTone();
      return;
    }
    if (active.status === "RINGING") {
      if (active.incoming) playTone("/sounds/ringtone.wav");
      else playTone("/sounds/calling.wav");
      return;
    }
    stopTone();
  }, [active]);

  useEffect(() => {
    if (active?.status !== "ACTIVE") {
      liveSince.current = null;
      setElapsed(0);
      return;
    }
    stopTone();
    routeAudio(speaker);
    if (!liveSince.current) liveSince.current = Date.now();
    const tick = () =>
      setElapsed(Math.floor((Date.now() - (liveSince.current ?? Date.now())) / 1000));
    tick();
    const timer = window.setInterval(tick, 400);
    return () => window.clearInterval(timer);
  }, [active?.id, active?.status, routeAudio, speaker]);

  useEffect(() => {
    if (!active) return;
    routeAudio(speaker);
  }, [speaker, active, routeAudio]);

  useEffect(() => {
    playMedia(localVideo.current, localRef.current, true);
    playMedia(remoteVideo.current, remoteStreamRef.current, true);
    if (remoteStreamRef.current) hookRemoteSound(remoteStreamRef.current);
  }, [active?.kind, active?.id, hookRemoteSound]);

  async function applyVideoTrack(track: MediaStreamTrack, stream: MediaStream) {
    const sender = pcRef.current?.getSenders().find((item) => item.track?.kind === "video");
    if (sender) await sender.replaceTrack(track);
    else pcRef.current?.addTrack(track, stream);
    if (localRef.current) {
      localRef.current.getVideoTracks().forEach((item) => {
        if (item !== track) {
          localRef.current?.removeTrack(item);
          item.stop();
        }
      });
      if (!localRef.current.getVideoTracks().includes(track)) localRef.current.addTrack(track);
    } else localRef.current = stream;
    setHasLocal(true);
    setCameraOff(false);
    setActive((current) => (current ? { ...current, kind: "VIDEO" } : current));
    window.setTimeout(() => playMedia(localVideo.current, localRef.current, true), 50);
  }

  async function toggleCamera() {
    if (active?.status !== "ACTIVE") return;
    if (!cameraOff && active.kind === "VIDEO") {
      localRef.current?.getVideoTracks().forEach((track) => {
        track.enabled = false;
      });
      setCameraOff(true);
      return;
    }
    const existing = localRef.current
      ?.getVideoTracks()
      .find((track) => track.readyState === "live");
    if (existing && existing.label && !existing.label.includes("canvas")) {
      existing.enabled = true;
      const sender = pcRef.current?.getSenders().find((item) => item.track?.kind === "video");
      if (sender && sender.track !== existing) await sender.replaceTrack(existing);
      setCameraOff(false);
      setActive((current) => (current ? { ...current, kind: "VIDEO" } : current));
      playMedia(localVideo.current, localRef.current, true);
      return;
    }
    const cam = await navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 860 } },
        audio: false,
      })
      .catch(() => null);
    const track = cam?.getVideoTracks()[0];
    if (!track) {
      setError("Could not open the camera.");
      return;
    }
    await applyVideoTrack(track, cam ?? new MediaStream([track]));
  }

  useEffect(() => {
    window.KpCallBridge = {
      answerFromNotify: (callId) => {
        void (async () => {
          const data = await api<{ items: CallRecord[] }>("/api/calls/active").catch(() => ({
            items: [] as CallRecord[],
          }));
          const record =
            data.items.find((item) => item.id === callId) ??
            data.items.find((item) => item.incoming && item.status === "RINGING") ??
            activeRef.current;
          if (record) await answerRecord(record);
        })();
      },
      declineFromNotify: (callId) => {
        void decline(callId);
      },
    };
    void listenNotifyActions();
    return () => {
      window.KpCallBridge = undefined;
    };
  }, [answerRecord, decline]);

  async function shareFromFrames() {
    const canvas = document.createElement("canvas");
    canvas.width = 720;
    canvas.height = 1280;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const img = new Image();
    window.KpOnScreenFrame = (url) => {
      img.onload = () => {
        if (
          img.width &&
          img.height &&
          (canvas.width !== img.width || canvas.height !== img.height)
        ) {
          canvas.width = img.width;
          canvas.height = img.height;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      };
      img.src = url;
    };
    try {
      window.KpCallAudio?.startScreen?.();
    } catch {
      return null;
    }
    const stream = canvas.captureStream(8);
    return stream.getVideoTracks()[0] ? stream : null;
  }

  async function shareScreen() {
    if (active?.status !== "ACTIVE") return;
    if (sharing) {
      try {
        window.KpCallAudio?.stopScreen?.();
      } catch {
        /* */
      }
      window.KpOnScreenFrame = undefined;
      const cam = await navigator.mediaDevices
        .getUserMedia({ video: { facingMode: "user" }, audio: false })
        .catch(() => null);
      const next = cam?.getVideoTracks()[0];
      if (next) await applyVideoTrack(next, cam ?? new MediaStream([next]));
      setSharing(false);
      return;
    }
    let display: MediaStream | null = null;
    if (typeof navigator.mediaDevices?.getDisplayMedia === "function") {
      display = await navigator.mediaDevices
        .getDisplayMedia({ video: true, audio: false })
        .catch(() => null);
    }
    if (!display) display = await shareFromFrames();
    const track = display?.getVideoTracks()[0];
    if (!track) {
      setError("Screen share is not available on this phone.");
      return;
    }
    track.onended = () => {
      setSharing(false);
      void toggleCamera();
    };
    await applyVideoTrack(track, display ?? new MediaStream([track]));
    setSharing(true);
  }

  const value = useMemo(() => ({ startCall }), [startCall]);
  const ringing = active?.status === "RINGING";
  const live = active?.status === "ACTIVE";
  const showVideo = Boolean(
    active && (active.kind === "VIDEO" || !cameraOff || remoteReady || sharing),
  );
  const otherOnline = Boolean(active?.other.online);
  const statusLabel = ringing
    ? active?.incoming
      ? "Incoming call"
      : otherOnline
        ? "Ringing…"
        : "Calling…"
    : live
      ? clock(elapsed)
      : (active?.status ?? "").toLowerCase();
  const seenLine = lastSeenLabel(active?.other.lastActiveAt, otherOnline);

  return (
    <Ctx.Provider value={value}>
      {children}
      <audio ref={remoteAudio} autoPlay playsInline style={{ display: "none" }} />
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
              <div className={`call-stage ${showVideo ? "video" : "audio"}`}>
                <video
                  ref={remoteVideo}
                  className={showVideo && remoteReady ? "remote-video" : "remote-video idle"}
                  autoPlay
                  playsInline
                  muted
                  onPlaying={() => setRemoteReady(true)}
                />
                <video
                  ref={localVideo}
                  className={
                    showVideo && hasLocal && !cameraOff ? "local-video" : "local-video idle"
                  }
                  autoPlay
                  playsInline
                  muted
                />
                {!remoteReady || !showVideo ? (
                  <div className="call-audio">
                    <Avatar name={active.other.displayName} url={active.other.avatarUrl} large />
                    <h2>{active.other.displayName}</h2>
                    <p className="call-status">{statusLabel}</p>
                    {live ? (
                      <p className="call-seen">Connected</p>
                    ) : (
                      <p className="call-seen">{seenLine}</p>
                    )}
                  </div>
                ) : (
                  <div className="call-live-name">
                    <strong>{active.other.displayName}</strong>
                    <span>{statusLabel}</span>
                  </div>
                )}
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
                        className={live && muted ? "call-btn on" : "call-btn"}
                        type="button"
                        aria-label="Mute"
                        disabled={!live}
                        onClick={() => setMuted((v) => !v)}
                      >
                        {muted ? <MicOff size={22} /> : <Mic size={22} />}
                      </button>
                      <button
                        className={live && cameraOff ? "call-btn on" : "call-btn"}
                        type="button"
                        aria-label="Camera"
                        disabled={!live}
                        onClick={() => void toggleCamera()}
                      >
                        {cameraOff || active.kind === "AUDIO" ? (
                          <CameraOff size={22} />
                        ) : (
                          <Camera size={22} />
                        )}
                      </button>
                      <button
                        className={live && sharing ? "call-btn on" : "call-btn"}
                        type="button"
                        aria-label="Share screen"
                        disabled={!live}
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
