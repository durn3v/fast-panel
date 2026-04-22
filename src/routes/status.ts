import type { FastifyInstance } from "fastify";
import type { XrayClients } from "../services/xrayClient.js";
import { grpcListInbounds } from "../services/xrayClient.js";
import {
  getLoadMetrics,
  getMemoryMetrics,
  getRootDiskMetrics,
  sampleCpuUsagePercent,
} from "../services/systemMetrics.js";

export async function registerStatus(
  app: FastifyInstance,
  xray: XrayClients | null
) {
  app.get("/status", async () => {
    const [cpu, memory, load, disk] = await Promise.all([
      sampleCpuUsagePercent(),
      Promise.resolve(getMemoryMetrics()),
      Promise.resolve(getLoadMetrics()),
      getRootDiskMetrics(),
    ]);

    let xrayStatus: {
      connected: boolean;
      inboundCount?: number;
      error?: string;
    };
    if (!xray) {
      xrayStatus = {
        connected: false,
        error: "Xray gRPC client not initialized (check XRAY_PROTO_ROOT / API)",
      };
    } else {
      try {
        const inbounds = await grpcListInbounds(xray);
        xrayStatus = { connected: true, inboundCount: inbounds.length };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        xrayStatus = { connected: false, error: msg };
      }
    }

    return {
      uptimeSec: Math.floor(process.uptime()),
      server: {
        cpu: { usagePercent: cpu },
        memory,
        load,
        disk,
      },
      xray: xrayStatus,
    };
  });
}
