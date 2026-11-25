"use client";

import React from "react";
import type { StepMetrics } from "@/types/telemetry";

interface MetricsPanelProps {
  metrics: StepMetrics;
}

export const MetricsPanel = React.memo(function MetricsPanel({
  metrics,
}: MetricsPanelProps) {
  const fmtSec = (v: number | null) => (v !== null ? `${v.toFixed(2)} s` : "—");
  const fmtPct = (v: number | null) => (v !== null ? `${v.toFixed(1)} %` : "—");

  const osColor =
    metrics.overshootPct === null
      ? "text-[var(--ink-muted)]"
      : metrics.overshootPct > 15
        ? "text-[var(--accent-danger-ink)]"
        : metrics.overshootPct > 5
          ? "text-[var(--accent-warn)]"
          : "text-[var(--accent-ok)]";

  const osTag =
    metrics.overshootPct === null
      ? "Mp"
      : metrics.overshootPct > 15
        ? "HIGH"
        : metrics.overshootPct > 5
          ? "MOD"
          : "OK";

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
      aria-labelledby="metrics-panel-heading"
      className="panel-isolated border border-[var(--border-hairline)] bg-[var(--bg-surface)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-hairline)] px-4 py-2.5">
        <h2
          id="metrics-panel-heading"
          className="text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-[var(--ink-primary)]"
        >
          STEP RESPONSE PERFORMANCE METRICS
        </h2>
        <div className="flex flex-wrap items-center gap-3 font-mono text-[0.6875rem] text-[var(--ink-secondary)]">
          {metrics.hasStep ? (
            <>
              <span>
                STEP: {metrics.initialRpm.toFixed(0)} → {metrics.targetSetpoint.toFixed(0)} RPM
              </span>
              <span aria-hidden="true" className="text-[var(--border-control)]">|</span>
              <span>
                IAE:{" "}
                <strong className="font-semibold text-[var(--ink-primary)]">
                  {metrics.iae !== null ? metrics.iae.toFixed(1) : "—"}
                </strong>
              </span>
            </>
          ) : (
            <span>Ubah Setpoint atau klik &ldquo;Step Test&rdquo; untuk mengukur respon transien</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px bg-[var(--border-hairline)] sm:grid-cols-4">
        {/* Rise Time */}
        <div className="bg-[var(--bg-surface)] p-3.5">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--ink-muted)]">
              RISE TIME (Tr)
            </span>
            <span className="font-mono text-[0.6875rem] text-[var(--ink-muted)]">10–90%</span>
          </div>
          <div className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-[var(--ink-primary)]">
            {fmtSec(metrics.riseTimeSec)}
          </div>
          <div className="mt-1 font-mono text-[0.6875rem] text-[var(--ink-muted)]">
            {metrics.peakTimeSec !== null
              ? `Peak Tp = ${metrics.peakTimeSec.toFixed(2)} s`
              : "Menunggu 90% target"}
          </div>
        </div>

        {/* Maximum Overshoot */}
        <div className="bg-[var(--bg-surface)] p-3.5">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--ink-muted)]">
              OVERSHOOT (%OS)
            </span>
            <span
              className={`font-mono text-[0.625rem] font-semibold uppercase ${osColor}`}
            >
              {osTag}
            </span>
          </div>
          <div className={`mt-1.5 font-mono text-xl font-semibold tabular-nums ${osColor}`}>
            {fmtPct(metrics.overshootPct)}
          </div>
          <div className="mt-1 font-mono text-[0.6875rem] tabular-nums text-[var(--ink-muted)]">
            {metrics.peakRpm !== null && metrics.hasStep
              ? `Peak = ${metrics.peakRpm.toFixed(1)} RPM`
              : "Target < 10%"}
          </div>
        </div>

        {/* Settling Time */}
        <div className="bg-[var(--bg-surface)] p-3.5">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--ink-muted)]">
              SETTLING TIME (Ts)
            </span>
            <span
              className={`border px-1 py-0.5 font-mono text-[0.625rem] font-semibold uppercase ${
                !metrics.hasStep
                  ? "border-transparent text-[var(--ink-muted)]"
                  : metrics.isSettled
                    ? "border-[var(--accent-ok-border)] bg-[var(--accent-ok-bg)] text-[var(--accent-ok)]"
                    : "border-[var(--accent-warn-border)] bg-[var(--accent-warn-bg)] text-[var(--accent-warn)]"
              }`}
            >
              {metrics.hasStep ? (metrics.isSettled ? "SETTLED" : "TRANSIENT") : "±2%"}
            </span>
          </div>
          <div className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-[var(--ink-primary)]">
            {fmtSec(metrics.settlingTimeSec)}
          </div>
          <div className="mt-1 font-mono text-[0.6875rem] text-[var(--ink-muted)]">
            Pita toleransi ±2% SP
          </div>
        </div>

        {/* Steady-State Error */}
        <div className="bg-[var(--bg-surface)] p-3.5">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--ink-muted)]">
              STEADY-STATE ERR
            </span>
            <span className="font-mono text-[0.6875rem] text-[var(--ink-muted)]">Ess</span>
          </div>
          <div className={`mt-1.5 font-mono text-xl font-semibold tabular-nums ${essColor}`}>
            {metrics.steadyStateErrorRpm !== null
              ? `${metrics.steadyStateErrorRpm >= 0 ? "+" : ""}${metrics.steadyStateErrorRpm.toFixed(2)}`
              : "—"}
            {metrics.steadyStateErrorRpm !== null ? (
              <span className="ml-1 text-xs font-normal text-[var(--ink-muted)]">RPM</span>
            ) : null}
          </div>
          <div className="mt-1 font-mono text-[0.6875rem] tabular-nums text-[var(--ink-muted)]">
            {metrics.steadyStateErrorPct !== null
              ? `Relatif = ${metrics.steadyStateErrorPct.toFixed(2)}%`
              : "Rata-rata 1.0 s akhir"}
          </div>
        </div>
      </div>
    </section>
  );
});
