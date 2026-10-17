import type { ApiClient } from "../auth/authApi";

export type ClassroomSummary = {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly startsAt: string;
  readonly joinable: boolean;
};

export type MeshRoomCredentials = {
  readonly transport: "p2p-mesh";
  readonly url: string;
  readonly ticket: string;
  readonly participantId: string;
  readonly instructor: boolean;
  readonly maxParticipants: 6;
  readonly turnFallback: false;
};

/** Laravel-authoritative class access surfaced through the signed core bridge. */
export const classroomApi = {
  async list(api: ApiClient): Promise<readonly ClassroomSummary[]> {
    const value = await api.request<{ classes?: ClassroomSummary[] }>("/api/classroom/v1/classes");
    return Array.isArray(value.classes) ? value.classes : [];
  },
  async room(api: ApiClient, classId: string): Promise<MeshRoomCredentials> {
    const room = await api.request<MeshRoomCredentials>(
      `/api/classroom/v1/classes/${encodeURIComponent(classId)}/room-token`,
      { method: "POST" },
    );
    if (room.transport !== "p2p-mesh" || room.maxParticipants !== 6 || room.turnFallback !== false)
      throw new Error("Unsupported classroom transport");
    return room;
  },
  async attendance(api: ApiClient, classId: string, event: "heartbeat" | "leave"): Promise<void> {
    await api.request(`/api/classroom/v1/classes/${encodeURIComponent(classId)}/attendance`, {
      method: "POST",
      body: JSON.stringify({ event }),
    });
  },
};
