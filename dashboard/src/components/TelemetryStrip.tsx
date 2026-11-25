"use client";

import React from "react";
import type { TelemetrySample } from "@/types/telemetry";

interface TelemetryStripProps {
  latest: TelemetrySample | null;
}

/**
 * Strip readout instrumen ringkas: 6 nilai telemetri utama sejajar
 * mendukung bidirectional CW/CCW, 2-DOF Feedforward, Voltage Comp, dan Current Limit/Stall.
 */
export const TelemetryStrip = React.memo(function TelemetryStrip({
  latest,
}: TelemetryStripProps) {
  const rpm = latest?.rpm ?? 0;
  const sp = latest?.setpoint ?? 0;
  const err = latest?.error ?? 0;
  const pwm = latest?.pwm ?? 0;
  const voltage = latest?.voltage ?? 24.4;
  const currentAmp = latest?.currentAmp ?? 0;
  const mode = latest?.mode ?? 1;
  const runState = latest?.runState ?? 0;
  const flags = latest?.flags;

  const absPwm = Math.abs(pwm);
  const dutyPct = (absPwm / 255) * 100;
  const isSaturated = absPwm >= 250;
  const isCurrentLimited = Boolean(flags?.currentLimited);
  const isStall = runState === 3;
  const isOverCurrent = currentAmp >= 4.2 || isCurrentLimited;
  const withinTol =
    mode === 1 &&
    runState === 1 &&
    Math.abs(err) <= Math.max(Math.abs(sp) * 0.02, 2.0);
  const dirLabel =
    Math.abs(rpm) < 2 ? null : rpm > 0 ? "CW" : "CCW";

  return (
    <section
      aria-label="Telemetri langsung"
      className="panel-isolated grid shrink-0 grid-cols-3 divide-x divide-y divide-[var(--border-hairline)] border-b border-[var(--border-hairline)] bg-[var(--bg-surface)] sm:grid-cols-6 sm:divide-y-0"
    >
      {/* 1. Actual RPM */}
      <div className="px-3.5 py-2">
        <div className="flex items-center justify-between gap-1 text-[0.6875rem] font-medium tracking-[0.02em] text-[var(--ink-muted)]">
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[var(--accent-rpm)]" />
            <span>Aktual</span>
          </span>
          {dirLabel ? (
            <span className="font-mono text-[0.625rem] text-[var(--ink-muted)]">
              {dirLabel}
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 flex items-baseline gap-1 font-mono tabular-nums">
          <span className="text-lg font-semibold tracking-[-0.03em] text-[var(--ink-primary)] xl:text-[1.35rem]">
            {rpm.toFixed(1)}
          </span>
          <span className="text-[0.6875rem] text-[var(--ink-muted)]">RPM</span>
        </div>
      </div>

      {/* 2. Setpoint */}
      <div className="px-3.5 py-2">
        <div className="flex items-center justify-between gap-1 text-[0.6875rem] font-medium tracking-[0.02em] text-[var(--ink-muted)]">
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[var(--accent-sp-bright)]" />
            <span>Setpoint</span>
          </span>
          {flags?.ffEnabled ? (
            <span className="font-mono text-[0.625rem] font-medium text-[var(--accent-rpm)]">
              2-DOF
            </span>
          ) : flags?.rampEnabled ? (
            <span className="font-mono text-[0.625rem] text-[var(--ink-muted)]">
              RAMP
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 flex items-baseline gap-1 font-mono tabular-nums">
          <span className="text-lg font-semibold tracking-[-0.03em] text-[var(--accent-sp)] xl:text-[1.35rem]">
            {mode === 1 ? sp.toFixed(1) : "—"}
          </span>
          {mode === 1 ? (
            <span className="text-[0.6875rem] text-[var(--ink-muted)]">RPM</span>
          ) : null}
        </div>
      </div>

      {/* 3. Error */}
      <div className="px-3.5 py-2">
        <div className="flex items-center justify-between gap-1 text-[0.6875rem] font-medium tracking-[0.02em] text-[var(--ink-muted)]">
          <span>Error</span>
          {withinTol ? (
            <span className="font-mono text-[0.625rem] font-medium text-[var(--accent-ok)]">
              ±2%
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 flex items-baseline gap-1 font-mono tabular-nums">
          <span
            className={`text-lg font-semibold tracking-[-0.03em] xl:text-[1.35rem] ${
              mode !== 1
                ? "text-[var(--ink-muted)]"
                : withinTol
                  ? "text-[var(--accent-ok)]"
                  : Math.abs(err) > 40
                    ? "text-[var(--accent-danger-ink)]"
                    : "text-[var(--ink-primary)]"
            }`}
          >
            {mode === 1 ? `${err >= 0 ? "+" : ""}${err.toFixed(1)}` : "—"}
          </span>
          {mode === 1 ? (
            <span className="text-[0.6875rem] text-[var(--ink-muted)]">RPM</span>
          ) : null}
        </div>
      </div>

      {/* 4. PWM Output */}
      <div className="px-3.5 py-2">
        <div className="flex items-center justify-between gap-1 text-[0.6875rem] font-medium tracking-[0.02em] text-[var(--ink-muted)]">
          <span>PWM</span>
          <span
            className={`font-mono text-[0.625rem] tabular-nums ${
              isCurrentLimited
                ? "font-semibold text-[var(--accent-warn)]"
                : isSaturated
                  ? "font-semibold text-[var(--accent-danger-ink)]"
                  : "text-[var(--ink-muted)]"
            }`}
          >
            {isCurrentLimited ? "ILIM" : isSaturated ? "SAT" : `${dutyPct.toFixed(0)}%`}
          </span>
        </div>
        <div className="mt-0.5 flex items-baseline gap-1 font-mono tabular-nums">
          <span className="text-lg font-semibold tracking-[-0.03em] text-[var(--ink-primary)] xl:text-[1.35rem]">
            {pwm > 0 ? `+${pwm}` : pwm}
          </span>
          <span className="text-[0.6875rem] text-[var(--ink-muted)]">/ 255</span>
        </div>
        <div
          role="progressbar"
          aria-label="Siklus kerja PWM"
          aria-valuenow={absPwm}
          aria-valuemin={0}
          aria-valuemax={255}
          aria-valuetext={`${dutyPct.toFixed(0)}% (${pwm} dari ±255)`}
          className="mt-1 h-1 w-full overflow-hidden bg-[var(--bg-subtle)]"
        >
          <div
            className={`h-full w-full origin-left motion-safe:transition-transform motion-safe:duration-75 ${
              isCurrentLimited
                ? "bg-[var(--accent-warn)]"
                : isSaturated
                  ? "bg-[var(--accent-danger)]"
                  : pwm < 0
                    ? "bg-[var(--accent-sp-bright)]"
                    : "bg-[var(--ink-secondary)]"
            }`}
            style={{ transform: `scaleX(${Math.min(1, dutyPct / 100)})` }}
          />
        </div>
      </div>

      {/* 5. Bus Voltage */}
      <div className="px-3.5 py-2">
        <div className="flex items-center justify-between gap-1 text-[0.6875rem] font-medium tracking-[0.02em] text-[var(--ink-muted)]">
          <span>Tegangan</span>
          {flags?.vcompEnabled ? (
            <span className="font-mono text-[0.625rem] text-[var(--accent-ok)]">
              COMP
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 flex items-baseline gap-1 font-mono tabular-nums">
          <span className="text-lg font-semibold tracking-[-0.03em] text-[var(--ink-primary)] xl:text-[1.35rem]">
            {voltage.toFixed(1)}
          </span>
          <span className="text-[0.6875rem] text-[var(--ink-muted)]">V</span>
        </div>
      </div>

      {/* 6. Motor Current (ACS712 5A) */}
      <div className="px-3.5 py-2">
        <div className="flex items-center justify-between gap-1 text-[0.6875rem] font-medium tracking-[0.02em] text-[var(--ink-muted)]">
          <span>Arus</span>
          {isStall ? (
            <span className="font-mono text-[0.625rem] font-semibold text-[var(--accent-danger-ink)]">
              STALL
            </span>
          ) : isCurrentLimited ? (
            <span className="font-mono text-[0.625rem] font-semibold text-[var(--accent-warn)]">
              LIMIT
            </span>
          ) : isOverCurrent ? (
            <span className="font-mono text-[0.625rem] font-semibold text-[var(--accent-danger-ink)]">
              OVER
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 flex items-baseline gap-1 font-mono tabular-nums">
          <span
            className={`text-lg font-semibold tracking-[-0.03em] xl:text-[1.35rem] ${
              isStall || isOverCurrent
                ? "text-[var(--accent-danger-ink)]"
                : "text-[var(--ink-primary)]"
            }`}
          >
            {currentAmp.toFixed(2)}
          </span>
          <span className="text-[0.6875rem] text-[var(--ink-muted)]">A</span>
        </div>
      </div>
    </section>
  );
});
