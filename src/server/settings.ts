import { DEFAULT_SETTINGS } from "../shared/constants.js";
import { prisma } from "./db.js";

type Settings = typeof DEFAULT_SETTINGS;

export async function getSettings(): Promise<Settings> {
  const rows = await prisma.systemSetting.findMany();
  const merged: Settings = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    const key = row.key as keyof Settings;
    if (!(key in merged)) continue;
    try {
      const value = JSON.parse(row.valueJson) as Settings[typeof key];
      (merged as Record<string, unknown>)[key] = value;
    } catch {
      /* ignore corrupt setting */
    }
  }
  return merged;
}

export async function setSetting(key: string, value: unknown) {
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, valueJson: JSON.stringify(value) },
    update: { valueJson: JSON.stringify(value) },
  });
}

export async function getMatchWeights() {
  const row = await prisma.systemSetting.findUnique({ where: { key: "matchWeights" } });
  if (!row) return {};
  try {
    return JSON.parse(row.valueJson) as Record<string, number>;
  } catch {
    return {};
  }
}
