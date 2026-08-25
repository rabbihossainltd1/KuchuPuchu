import { createId } from "../../domain/ids.js";
import { sha256 } from "../../domain/hash.js";
import { prisma } from "../db.js";

export async function writeAudit(input: {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}) {
  await prisma.auditLog.create({
    data: {
      id: createId("aud"),
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadataJson: JSON.stringify(input.metadata ?? {}),
      ipHash: input.ip ? sha256(input.ip) : null,
    },
  });
}
