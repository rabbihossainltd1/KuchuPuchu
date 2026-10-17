const MAX_PARTICIPANTS = 6;
const DIRECT_ICE: RTCIceServer[] = [
  { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] },
];

type Wire =
  | { type: "roster"; participants: string[] }
  | { type: "peer-joined" | "peer-left"; participant: string }
  | { type: "offer" | "answer"; from: string; to: string; sdp: string }
  | { type: "candidate"; from: string; to: string; candidate: RTCIceCandidateInit };

type Peer = { pc: RTCPeerConnection; pending: RTCIceCandidateInit[] };

/**
 * VPS-free classroom mesh: signalling only crosses the Worker; media is P2P.
 * Hard-capped at six participants. There is deliberately no TURN fallback.
 */
export class MeshClassroom {
  private socket: WebSocket | null = null;
  private peers = new Map<string, Peer>();
  private remoteStreams = new Map<string, MediaStream>();
  private local: MediaStream | null = null;

  constructor(
    private readonly self: string,
    private readonly instructor: boolean,
    private readonly onRemote: (id: string, stream: MediaStream) => void,
    private readonly onCount: (count: number) => void,
    private readonly onFailure: (message: string) => void,
  ) {}

  async connect(url: string, ticket: string): Promise<void> {
    // Everyone may speak; only the instructor publishes camera video by default.
    this.local = await navigator.mediaDevices.getUserMedia({ audio: true, video: this.instructor });
    const socketUrl = new URL(url, window.location.href);
    socketUrl.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    socketUrl.searchParams.set("ticket", ticket);
    const socket = new WebSocket(socketUrl.toString());
    this.socket = socket;
    socket.onmessage = ({ data }) => void this.receive(JSON.parse(String(data)) as Wire);
    socket.onclose = () => this.close();
  }

  private async receive(message: Wire): Promise<void> {
    if (message.type === "roster") {
      if (message.participants.length > MAX_PARTICIPANTS) return this.onFailure("CLASS_FULL");
      for (const id of message.participants)
        if (id !== this.self) await this.ensure(id, this.self < id);
    } else if (message.type === "peer-joined") {
      if (this.peers.size + 2 > MAX_PARTICIPANTS) return this.onFailure("CLASS_FULL");
      await this.ensure(message.participant, this.self < message.participant);
    } else if (message.type === "peer-left") {
      this.peers.get(message.participant)?.pc.close();
      this.peers.delete(message.participant);
      this.remoteStreams.delete(message.participant);
      this.onCount(this.peers.size + 1);
    } else if ("to" in message && message.to === this.self) {
      const peer = await this.ensure(message.from, false);
      if (message.type === "offer") {
        await peer.pc.setRemoteDescription({ type: "offer", sdp: message.sdp });
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        this.send({ type: "answer", from: this.self, to: message.from, sdp: answer.sdp! });
      } else if (message.type === "answer") {
        await peer.pc.setRemoteDescription({ type: "answer", sdp: message.sdp });
      } else if (message.type === "candidate") {
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(message.candidate);
        else peer.pending.push(message.candidate);
      }
      if (peer.pc.remoteDescription)
        for (const candidate of peer.pending.splice(0)) await peer.pc.addIceCandidate(candidate);
    }
  }

  private async ensure(id: string, offer: boolean): Promise<Peer> {
    const existing = this.peers.get(id);
    if (existing) return existing;
    const pc = new RTCPeerConnection({ iceServers: DIRECT_ICE, iceTransportPolicy: "all" });
    const peer = { pc, pending: [] as RTCIceCandidateInit[] };
    this.peers.set(id, peer);
    this.local?.getTracks().forEach((track) => pc.addTrack(track, this.local!));
    pc.ontrack = ({ streams, track }) => {
      const stream = streams[0] ?? new MediaStream([track]);
      this.remoteStreams.set(id, stream);
      this.onRemote(id, stream);
    };
    pc.onicecandidate = ({ candidate }) =>
      candidate &&
      this.send({ type: "candidate", from: this.self, to: id, candidate: candidate.toJSON() });
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed") this.onFailure("DIRECT_CONNECTION_FAILED");
    };
    this.onCount(this.peers.size + 1);
    if (offer) {
      const description = await pc.createOffer();
      await pc.setLocalDescription(description);
      this.send({ type: "offer", from: this.self, to: id, sdp: description.sdp! });
    }
    return peer;
  }

  private send(value: Wire): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(value));
  }

  recordingStreams(): readonly MediaStream[] {
    return this.local
      ? [this.local, ...this.remoteStreams.values()]
      : [...this.remoteStreams.values()];
  }

  close(): void {
    this.local?.getTracks().forEach((track) => track.stop());
    for (const peer of this.peers.values()) peer.pc.close();
    this.peers.clear();
    this.remoteStreams.clear();
    this.socket?.close();
    this.socket = null;
    this.local = null;
  }
}

export { MAX_PARTICIPANTS };
