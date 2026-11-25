import type { StepMetrics, TelemetrySample } from "@/types/telemetry";

/**
 * Ekspor rekaman data telemetri pengujian ke format .csv standar
 * siap diimpor ke Excel, MATLAB, Google Sheets, atau Python Pandas untuk Laporan Praktikum.
 */
export function exportTelemetryCsv(
  samples: TelemetrySample[],
  metrics?: StepMetrics | null
): void {
  if (samples.length === 0) return;

  const headers = [
    "timestamp_ms",
    "elapsed_s",
    "setpoint_rpm",
    "actual_rpm",
    "error_rpm",
    "pwm_0_255",
    "voltage_v",
    "current_a",
    "kp",
    "ki",
    "kd",
    "mode",
    "run_state",
  ];

  const lines: string[] = [];

  // Ringkasan metadata di baris komentar opsional?
  // Gunakan format CSV bersih tanpa komentar agar langsung terbaca oleh Excel & MATLAB readtable().
  lines.push(headers.join(","));

  for (const s of samples) {
    lines.push(
      [
        s.timestampMs,
        s.elapsedSec.toFixed(3),
        s.setpoint.toFixed(2),
        s.rpm.toFixed(2),
        s.error.toFixed(2),
        s.pwm,
        s.voltage.toFixed(2),
        s.currentAmp.toFixed(2),
        s.kp.toFixed(3),
        s.ki.toFixed(3),
        s.kd.toFixed(3),
        s.mode === 1 ? "PID" : "OPEN_LOOP",
        s.runState === 1 ? "RUN" : s.runState === 2 ? "ESTOP" : "STOP",
      ].join(",")
    );
  }

  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "_",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");

  const suffix =
    metrics?.hasStep && metrics.targetSetpoint > 0
      ? `_SP${Math.round(metrics.targetSetpoint)}`
      : "";

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `PENS_SPK_PID_${stamp}${suffix}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
