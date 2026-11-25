"use client";

import React from "react";
import type { StepMetrics } from "@/types/telemetry";

interface MetricsPanelProps {
  metrics: StepMetrics;
}

export function MetricsPanel({ metrics }: MetricsPanelProps) {
  const fmtSec = (v: number | null) => (v !== null ? `${v.toFixed(2)} s` : "—");
  const fmtPct = (v: number | null) => (v !== null ? `${v.toFixed(1)} %` : "—");

  const osColor =
    metrics.overshootPct === null
      ? "text-[#94a3b8]"
      : metrics.overshootPct > 15
        ? "text-[#dc2626]"
        : metrics.overshootPct > 5
          ? "text-amber-700"
          : "text-[#059669]";

  const essColor =
    metrics.steadyStateErrorPct === null
      ? "text-[#94a3b8]"
      : metrics.steadyStateErrorPct <= 2
        ? "text-[#059669]"
        : metrics.steadyStateErrorPct <= 5
          ? "text-amber-700"
          : "text-[#dc2626]";

  return (
    <section className="border border-[#dfe2e8] bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#dfe2e8] px-4 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#0f172a]">
          STEP RESPONSE PERFORMANCE METRICS
        </span>
        <div className="flex items-center gap-3 font-mono text-[10px] text-[#64748b]">
          {metrics.hasStep ? (
            <>
              <span>
                STEP: {metrics.initialRpm.toFixed(0)} → {metrics.targetSetpoint.toFixed(0)} RPM
              </span>
              <span className="text-[#cbd5e1]">|</span>
              <span>
                IAE:{" "}
                <strong className="font-semibold text-[#0f172a]">
                  {metrics.iae !== null ? metrics.iae.toFixed(1) : "—"}
                </strong>
              </span>
            </>
          ) : (
            <span>Ubah Setpoint atau klik &ldquo;Step Test&rdquo; untuk mengukur respon transien</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px bg-[#dfe2e8] sm:grid-cols-4">
        {/* Rise Time */}
        <div className="bg-white p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#64748b]">
              RISE TIME (Tr)
            </span>
            <span className="font-mono text-[10px] text-[#94a3b8]">10–90%</span>
          </div>
          <div className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-[#0f172a]">
            {fmtSec(metrics.riseTimeSec)}
          </div>
          <div className="mt-1 font-mono text-[10px] text-[#64748b]">
            {metrics.peakTimeSec !== null
              ? `Peak Tp = ${metrics.peakTimeSec.toFixed(2)} s`
              : "Menunggu 90% target"}
          </div>
        </div>

        {/* Maximum Overshoot */}
        <div className="bg-white p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#64748b]">
              OVERSHOOT (%OS)
            </span>
            <span className="font-mono text-[10px] text-[#94a3b8]">Mp</span>
          </div>
          <div className={`mt-1.5 font-mono text-xl font-semibold tabular-nums ${osColor}`}>
            {fmtPct(metrics.overshootPct)}
          </div>
          <div className="mt-1 font-mono text-[10px] tabular-nums text-[#64748b]">
            {metrics.peakRpm !== null && metrics.hasStep
              ? `Peak = ${metrics.peakRpm.toFixed(1)} RPM`
              : "Target < 10%"}
          </div>
        </div>

        {/* Settling Time */}
        <div className="bg-white p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#64748b]">
              SETTLING TIME (Ts)
            </span>
            <span
              className={`font-mono text-[9px] font-semibold uppercase ${
                metrics.isSettled ? "text-[#059669]" : "text-amber-600"
              }`}
            >
              {metrics.hasStep ? (metrics.isSettled ? "SETTLED" : "TRANSIENT") : "±2%"}
            </span>
          </div>
          <div className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-[#0f172a]">
            {fmtSec(metrics.settlingTimeSec)}
          </div>
          <div className="mt-1 font-mono text-[10px] text-[#64748b]">
            Pita toleransi ±2% SP
          </div>
        </div>

        {/* Steady-State Error */}
        <div className="bg-white p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#64748b]">
              STEADY-STATE ERR
            </span>
            <span className="font-mono text-[10px] text-[#94a3b8]">Ess</span>
          </div>
          <div className={`mt-1.5 font-mono text-xl font-semibold tabular-nums ${essColor}`}>
            {metrics.steadyStateErrorRpm !== null
              ? `${metrics.steadyStateErrorRpm >= 0 ? "+" : ""}${metrics.steadyStateErrorRpm.toFixed(2)}`
              : "—"}
            {metrics.steadyStateErrorRpm !== null && (
              <span className="ml-1 text-xs font-normal text-[#64748b]">RPM</span>
            )}
          </div>
          <div className="mt-1 font-mono text-[10px] tabular-nums text-[#64748b]">
            {metrics.steadyStateErrorPct !== null
              ? `Relatif = ${metrics.steadyStateErrorPct.toFixed(2)}%`
              : "Rata-rata 1.0 s akhir"}
          </div>
        </div>
      </div>
    </section>
  );
}
