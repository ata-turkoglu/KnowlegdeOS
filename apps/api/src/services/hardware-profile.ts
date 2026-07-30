import { availableParallelism, cpus, totalmem } from "node:os";
import { getGpuMetrics } from "./gpu.js";

export type HardwareProfile = {
  cpu: { model: string; logicalCores: number };
  memoryTotalGb: number;
  gpu: Awaited<ReturnType<typeof getGpuMetrics>>;
};

export async function getHardwareProfile(): Promise<HardwareProfile> {
  const cpu = cpus()[0];
  const configuredMemory = Number(process.env.HARDWARE_PROFILE_MEMORY_GB);
  const configuredGpuMemory = Number(process.env.HARDWARE_PROFILE_GPU_MEMORY_MB);
  const detectedGpu = await getGpuMetrics();
  const gpu = detectedGpu.available || !Number.isFinite(configuredGpuMemory) ? detectedGpu : {
    available: true,
    name: process.env.HARDWARE_PROFILE_GPU_NAME ?? "Configured NVIDIA GPU",
    memoryTotal: configuredGpuMemory,
    reason: "Using the configured host hardware profile; NVIDIA telemetry is unavailable inside the API container."
  };
  return {
    cpu: { model: process.env.HARDWARE_PROFILE_CPU_MODEL ?? cpu?.model ?? "Unknown CPU", logicalCores: Number(process.env.HARDWARE_PROFILE_CPU_LOGICAL_CORES) || availableParallelism() },
    memoryTotalGb: Number.isFinite(configuredMemory) ? configuredMemory : Math.round((totalmem() / 1024 ** 3) * 10) / 10,
    gpu
  };
}
