import { createId } from "../../domain/ids.js";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../db.js";
import { assertCanMessage, publicUser } from "./users.js";
import { notify } from "./notify.js";

const RING_TTL_MS = 45_000;

export async function expireCalls() {
  await prisma.call.updateMany({
    where: { status: "RINGING", createdAt: { lt: new Date(Date.now() - RING_TTL_MS) } },
    data: { status: "MISSED", endedAt: new Date() },
  });
}

async function loadCall(userId: string, callId: string) {
  const call = await prisma.call.findUnique({ where: { id: callId } });
  if (!call || (call.callerId !== userId && call.calleeId !== userId)) {
    throw new AppError("NOT_FOUND", "Call not found.", 404);
  }
  return call;
}

export async function serializeCall(userId: string, callId: string) {
  const call = await loadCall(userId, callId);
  const otherId = call.callerId === userId ? call.calleeId : call.callerId;
  return {
    id: call.id,
    kind: call.kind,
    status: call.status,
    callerId: call.callerId,
    calleeId: call.calleeId,
    offerSdp: call.offerSdp,
    answerSdp: call.answerSdp,
    createdAt: call.createdAt.toISOString(),
    other: await publicUser(userId, otherId),
    incoming: call.calleeId === userId,
  };
}

export async function startCall(
  callerId: string,
  calleeId: string,
  kind: "AUDIO" | "VIDEO",
  offerSdp: string,
) {
  await expireCalls();
  if (callerId === calleeId) throw new AppError("INVALID", "You cannot call yourself.", 400);
  await assertCanMessage(callerId, calleeId);
  const busy = await prisma.call.findFirst({
    where: {
      status: { in: ["RINGING", "ACTIVE"] },
      OR: [{ callerId }, { calleeId: callerId }, { callerId: calleeId }, { calleeId }],
    },
  });
  if (busy) throw new AppError("BUSY", "One of you is already on a call.", 409);
  const call = await prisma.call.create({
    data: {
      id: createId("cal"),
      callerId,
      calleeId,
      kind,
      status: "RINGING",
      offerSdp,
    },
  });
  await notify({
    userId: calleeId,
    type: "call",
    title: kind === "VIDEO" ? "Incoming video call" : "Incoming voice call",
    body: "Tap to answer.",
    link: "/messages",
    dedupeKey: `call-${call.id}`,
  });
  return serializeCall(callerId, call.id);
}

export async function incomingCalls(userId: string) {
  await expireCalls();
  const rows = await prisma.call.findMany({
    where: {
      OR: [
        { calleeId: userId, status: { in: ["RINGING", "ACTIVE"] } },
        { callerId: userId, status: { in: ["RINGING", "ACTIVE"] } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  return Promise.all(rows.map((row) => serializeCall(userId, row.id)));
}

export async function answerCall(userId: string, callId: string, answerSdp: string) {
  await expireCalls();
  const call = await loadCall(userId, callId);
  if (call.calleeId !== userId) throw new AppError("FORBIDDEN", "Only the callee can answer.", 403);
  if (call.status !== "RINGING")
    throw new AppError("INVALID_STATE", "This call is no longer ringing.", 409);
  await prisma.call.update({
    where: { id: callId },
    data: { status: "ACTIVE", answerSdp, answeredAt: new Date() },
  });
  return serializeCall(userId, callId);
}

export async function declineCall(userId: string, callId: string) {
  const call = await loadCall(userId, callId);
  if (call.calleeId !== userId)
    throw new AppError("FORBIDDEN", "Only the callee can decline.", 403);
  if (call.status !== "RINGING")
    throw new AppError("INVALID_STATE", "This call cannot be declined.", 409);
  await prisma.call.update({
    where: { id: callId },
    data: { status: "DECLINED", endedAt: new Date(), endedById: userId },
  });
  return serializeCall(userId, callId);
}

export async function hangupCall(userId: string, callId: string) {
  const call = await loadCall(userId, callId);
  if (call.status === "ENDED" || call.status === "DECLINED" || call.status === "MISSED") {
    return serializeCall(userId, callId);
  }
  const status = call.status === "RINGING" && call.callerId === userId ? "CANCELLED" : "ENDED";
  await prisma.call.update({
    where: { id: callId },
    data: { status, endedAt: new Date(), endedById: userId },
  });
  return serializeCall(userId, callId);
}

export async function addIce(userId: string, callId: string, candidate: unknown) {
  await loadCall(userId, callId);
  await prisma.callSignal.create({
    data: {
      id: createId("ice"),
      callId,
      fromUserId: userId,
      payload: JSON.stringify(candidate),
    },
  });
  return { ok: true };
}

export async function listIce(userId: string, callId: string, after?: string) {
  await loadCall(userId, callId);
  const items = await prisma.callSignal.findMany({
    where: {
      callId,
      fromUserId: { not: userId },
      ...(after ? { id: { gt: after } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  return {
    items: items.map((item) => ({
      id: item.id,
      candidate: JSON.parse(item.payload) as unknown,
    })),
  };
}
