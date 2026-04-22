import { statfs } from "node:fs/promises";
import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";

function cpuTimesTotal(times: os.CpuInfo["times"]): number {
  let t =
    times.user + times.nice + times.sys + times.idle + times.irq;
  const steal = (times as { steal?: number }).steal;
  if (typeof steal === "number") t += steal;
  return t;
}

/** Approximate CPU usage across all cores, 0–100 (sampled over `sampleMs`). */
export async function sampleCpuUsagePercent(sampleMs = 150): Promise<number> {
  const cpus1 = os.cpus();
  const idle1 = cpus1.map((c) => c.times.idle);
  const total1 = cpus1.map((c) => cpuTimesTotal(c.times));
  await delay(sampleMs);
  const cpus2 = os.cpus();
  let idleDiff = 0;
  let totalDiff = 0;
  const n = Math.min(cpus1.length, cpus2.length);
  for (let i = 0; i < n; i++) {
    idleDiff += cpus2[i]!.times.idle - idle1[i]!;
    totalDiff += cpuTimesTotal(cpus2[i]!.times) - total1[i]!;
  }
  if (totalDiff <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round(100 * (1 - idleDiff / totalDiff))));
}

export type MemoryMetrics = {
  totalBytes: number;
  freeBytes: number;
  usedPercent: number;
};

export function getMemoryMetrics(): MemoryMetrics {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedPercent =
    totalBytes > 0
      ? Math.min(100, Math.max(0, Math.round(100 * (1 - freeBytes / totalBytes))))
      : 0;
  return { totalBytes, freeBytes, usedPercent };
}

export type LoadMetrics = {
  load1: number;
  load5: number;
  load15: number;
  cores: number;
};

export function getLoadMetrics(): LoadMetrics {
  const [load1, load5, load15] = os.loadavg();
  return { load1, load5, load15, cores: os.cpus().length };
}

export type DiskMetrics = {
  path: string;
  totalBytes: number;
  freeBytes: number;
  usedPercent: number;
};

function rootFsPath(): string {
  return process.platform === "win32" ? "C:\\" : "/";
}

export async function getRootDiskMetrics(): Promise<DiskMetrics> {
  const path = rootFsPath();
  try {
    const s = await statfs(path);
    const bsize = Number(s.bsize);
    const blocks = Number(s.blocks);
    const bavail = Number(s.bavail);
    const totalBytes = bsize * blocks;
    const freeBytes = bavail * bsize;
    const usedPercent =
      totalBytes > 0
        ? Math.min(
            100,
            Math.max(0, Math.round((100 * (totalBytes - freeBytes)) / totalBytes))
          )
        : 0;
    return { path, totalBytes, freeBytes, usedPercent };
  } catch {
    return { path, totalBytes: 0, freeBytes: 0, usedPercent: 0 };
  }
}
