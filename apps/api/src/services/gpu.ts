import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
export type GpuMetrics = { available: boolean; reason?: string; name?: string; utilization?: number; memoryUsed?: number; memoryTotal?: number; temperature?: number; powerDraw?: number };
let cachedMetrics: GpuMetrics | null = null;
let cachedAt = 0;
const cacheTtlMs = 8_000;
export async function getGpuMetrics(): Promise<GpuMetrics> {
  if (cachedMetrics && Date.now() - cachedAt < cacheTtlMs) return cachedMetrics;
  try {
    const command = process.platform === "win32" ? "C:\\Windows\\System32\\nvidia-smi.exe" : "nvidia-smi";
    const { stdout } = await exec(command, ["--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw", "--format=csv,noheader,nounits"], { timeout: 10_000, windowsHide: true });
    const values = stdout.trim().split("\n")[0]?.split(",").map((value) => value.trim()) ?? [];
    if (values.length < 6) throw new Error("No GPU data returned.");
    cachedMetrics = { available: true, name: values[0], utilization: Number(values[1]), memoryUsed: Number(values[2]), memoryTotal: Number(values[3]), temperature: Number(values[4]), powerDraw: Number(values[5]) };
    cachedAt = Date.now();
    return cachedMetrics;
  } catch (error) {
    if (cachedMetrics?.available) return cachedMetrics;
    return { available: false, reason: `NVIDIA GPU telemetry is unavailable: ${error instanceof Error ? error.message : "unknown error"}` };
  }
}
