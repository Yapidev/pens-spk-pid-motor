"use client";

import React from "react";
import type { StepMetrics } from "@/types/telemetry";

interface MetricsPanelProps {
  metrics: StepMetrics;
}

/**
 * Strip pengukuran respon step 1 baris bergaya osiloskop (Tektronix/Keysight),
 * menyatu langsung di bawah grafik tanpa kartu berat atau teks teori berlebih.
 */
export const MetricsPanel = React.memo(function MetricsPanel({
  metrics,
}: MetricsPanelProps) {
  const osColor =
    metrics.overshootPct === null
      ? "text-[var(--ink-muted)]"
      : metrics.overshootPct > 15
        ? "text-[var(--accent-danger-ink)]"
        : metrics.overshootPct > 5
          ? "text-[var(--accent-warn)]"
          : "text-[var(--accent-ok)]";

  const essColor =
    metrics.steadyStateErrorPct === null
      ? "text-[var(--ink-muted)]"
      : metrics.steadyStateErrorPct <= 2
        ? "text-[var(--accent-ok)]"
        : metrics.steadyStateErrorPct <= 5
          ? "text-[var(--accent-warn)]"
          : "text-[var(--accent-danger-ink)]";

  return (
    <section
      aria-label="Metrik respon step"
      className="panel-isolated flex shrink-0 flex-wrap items-center justify-between gap-x-5 gap-y-1.5 border-t border-[var(--border-hairline)] bg-[var(--bg-surface-alt)] px-4 py-2 text-xs"
    >
      <div className="flex items-center gap-2 font-mono text-[0.6875rem] text-[var(--ink-muted)]">
        <span className="font-sans font-medium text-[var(--ink-secondary)]">
          Respon Step
        </span>
        {metrics.hasStep ? (
          <span className="tabular-nums text-[var(--ink-primary)]">
            {metrics.initialRpm.toFixed(0)} → {metrics.targetSetpoint.toFixed(0)} RPM
          </span>
        ) : (
          <span>—</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-xs tabular-nums">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[0.6875rem] text-[var(--ink-muted)]">Tr</span>
          <span className="font-semibold text-[var(--ink-primary)]">
            {metrics.riseTimeSec !== null ? `${metrics.riseTimeSec.toFixed(2)}s` : "—"}
          </span>
        </div>

        <div className="flex items-baseline gap-1.5">
          <span className="text-[0.6875rem] text-[var(--ink-muted)]">%OS</span>
          <span className={`font-semibold ${osColor}`}>
            {metrics.overshootPct !== null ? `${metrics.overshootPct.toFixed(1)}%` : "—"}
          </span>
        </div>

        <div className="flex items-baseline gap-1.5">
          <span className="text-[0.6875rem] text-[var(--ink-muted)]">Ts</span>
          <span className="font-semibold text-[var(--ink-primary)]">
            {metrics.settlingTimeSec !== null ? `${metrics.settlingTimeSec.toFixed(2)}s` : "—"}
          </span>
          {metrics.hasStep ? (
            <span
              className={`text-[0.625rem] font-medium ${
                metrics.isSettled ? "text-[var(--accent-ok)]" : "text-[var(--accent-warn)]"
              }`}
            >
              {metrics.isSettled ? "Stabil" : "Transien"}
            </span>
          ) : null}
        </div>

        <div className="flex items-baseline gap-1.5">
          <span className="text-[0.6875rem] text-[var(--ink-muted)]">Ess</span>
          <span className={`font-semibold ${essColor}`}>
            {metrics.steadyStateErrorRpm !== null
              ? `${metrics.steadyStateErrorRpm >= 0 ? "+" : ""}${metrics.steadyStateErrorRpm.toFixed(2)}`
              : "—"}
          </span>
        </div>

        <div className="flex items-baseline gap-1.5">
          <span className="text-[0.6875rem] text-[var(--ink-muted)]">IAE</span>
          <span className="font-semibold text-[var(--ink-primary)]">
            {metrics.iae !== null ? metrics.iae.toFixed(1) : "—"}
          </span>
        </div>
      </div>
    </section>
  );
});
