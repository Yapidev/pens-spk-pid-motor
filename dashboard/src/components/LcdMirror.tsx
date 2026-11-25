"use client";

import React from "react";
import type { TelemetrySample } from "@/types/telemetry";

interface LcdMirrorProps {
  latest: TelemetrySample | null;
}

/**
 * Merekonstruksi tampilan 16x2 LCD Keypad Shield persis seperti firmware Arduino
 * sekaligus menampilkan 5 blok KPI telemetri bergaya Swiss Technical.
 */
export const LcdMirror = React.memo(function LcdMirror({
  latest,
}: LcdMirrorProps) {
  const pwm = latest?.pwm ?? 0;
  const voltage = latest?.voltage ?? 24.4;
  const rpm = latest?.rpm ?? 0;
  const sp = latest?.setpoint ?? 0;
  const err = latest?.error ?? 0;
  const mode = latest?.mode ?? 1;
  const runState = latest?.runState ?? 0;

  const badge =
    runState === 2 ? "!!" : runState === 1 ? (mode === 1 ? "CL" : "OL") : "ST";

  const pwmPad = String(pwm).padStart(3, " ");
  const vPad = voltage.toFixed(1).padStart(4, " ");
  const line0 = `PWM:${pwmPad} ${vPad}V ${badge}`.slice(0, 16).padEnd(16, " ");

  const rpmInt = String(Math.round(rpm)).padEnd(4, " ");
  const targetLabel = mode === 1 ? "SP" : "OL";
  const targetInt = String(Math.round(mode === 1 ? sp : pwm)).padEnd(4, " ");
  const line1 = `RPM:${rpmInt} ${targetLabel}:${targetInt}`.slice(0, 16).padEnd(16, " ");

  const dutyPct = (pwm / 255) * 100;
  const vEff = (voltage * pwm) / 255;
  const isSaturated = pwm >= 250;
  const withinTol =
    mode === 1 && runState === 1 && Math.abs(err) <= Math.max(sp * 0.02, 1.5);

  const modeLabel = mode === 1 ? "CLOSED-LOOP" : "OPEN-LOOP";
  const runLabel =
    runState === 2
      ? "E-STOP"
      : runState === 1
        ? modeLabel
        : `STOP · ${modeLabel}`;

  return (
    <section
      aria-labelledby="lcd-mirror-heading"
      className="panel-isolated grid grid-cols-1 gap-px border border-[var(--border-hairline)] bg-[var(--border-hairline)] lg:grid-cols-12"
    >
      {/* Virtual 16x2 LCD Hardware Mirror */}
      <div className="flex flex-col justify-between bg-[var(--bg-surface)] p-3.5 lg:col-span-4 xl:col-span-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2
            id="lcd-mirror-heading"
            className="text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-[var(--ink-muted)]"
          >
            LCD 16×2 SHIELD MIRROR
          </h2>
          <span
            className={`border px-1.5 py-0.5 font-mono text-[0.6875rem] font-semibold uppercase ${
              runState === 2
                ? "border-[var(--accent-danger-border)] bg-[var(--accent-danger-bg)] text-[var(--accent-danger-ink)]"
                : runState === 1
                  ? "border-[var(--accent-ok-border)] bg-[var(--accent-ok-bg)] text-[var(--accent-ok)]"
                  : "border-[var(--border-control)] bg-[var(--bg-subtle)] text-[var(--ink-secondary)]"
            }`}
          >
            {runLabel}
          </span>
        </div>

        <div className="border-2 border-[#334155] bg-[#09120c] p-2.5 shadow-inner">
          <pre
            aria-label={`Layar LCD 16x2: PWM ${pwm}, Tegangan ${voltage.toFixed(1)} Volt, RPM ${Math.round(rpm)}, ${targetLabel} ${Math.round(mode === 1 ? sp : pwm)}, Status ${runLabel}`}
            className="lcd-matrix m-0 overflow-x-auto border border-[#22422d] px-3 py-2 font-mono text-[0.9375rem] leading-snug tracking-[0.12em] text-[#86efac] sm:text-base"
          >
            <code className="block whitespace-pre tabular-nums">{line0}</code>
            <code className="block whitespace-pre tabular-nums">{line1}</code>
          </pre>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[0.625rem] text-[var(--ink-muted)]">
          <span className={badge === "CL" ? "font-semibold text-[var(--ink-primary)]" : undefined}>
            CL: Closed
          </span>
          <span aria-hidden="true">·</span>
          <span className={badge === "OL" ? "font-semibold text-[var(--ink-primary)]" : undefined}>
            OL: Open
          </span>
          <span aria-hidden="true">·</span>
          <span className={badge === "ST" ? "font-semibold text-[var(--ink-primary)]" : undefined}>
            ST: Stop
          </span>
          <span aria-hidden="true">·</span>
          <span className={badge === "!!" ? "font-semibold text-[var(--accent-danger-ink)]" : undefined}>
            !!: E-Stop
          </span>
        </div>
      </div>

      {/* 5 Precision Telemetry KPI Cells */}
      <div className="grid grid-cols-2 gap-px bg-[var(--border-hairline)] sm:grid-cols-5 lg:col-span-8 xl:col-span-9">
        {/* 1. Actual RPM */}
        <div className="flex flex-col justify-between bg-[var(--bg-surface)] p-3.5">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-[var(--ink-muted)]">
              ACTUAL RPM
            </span>
            <span aria-hidden="true" className="h-2 w-2 shrink-0 bg-[var(--accent-rpm)]" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="font-mono text-2xl font-semibold tracking-tight tabular-nums text-[var(--ink-primary)] xl:text-3xl">
              {rpm.toFixed(1)}
            </span>
            <span className="font-mono text-xs text-[var(--ink-muted)]">RPM</span>
          </div>
          <div className="mt-1.5 font-mono text-[0.6875rem] tabular-nums text-[var(--ink-muted)]">
            {sp > 0 && mode === 1
              ? `${((rpm / sp) * 100).toFixed(1)}% of SP`
              : mode === 0
                ? "Open-Loop Feedback"
                : "Standby"}
          </div>
        </div>

        {/* 2. Setpoint */}
        <div className="flex flex-col justify-between bg-[var(--bg-surface)] p-3.5">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-[var(--ink-muted)]">
              SETPOINT (SP)
            </span>
            <span aria-hidden="true" className="h-2 w-2 shrink-0 bg-[var(--accent-sp-bright)]" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="font-mono text-2xl font-semibold tracking-tight tabular-nums text-[var(--accent-sp)] xl:text-3xl">
              {mode === 1 ? sp.toFixed(1) : "—"}
            </span>
            {mode === 1 ? (
              <span className="font-mono text-xs text-[var(--ink-muted)]">RPM</span>
            ) : null}
          </div>
          <div className="mt-1.5 font-mono text-[0.6875rem] text-[var(--ink-muted)]">
            {mode === 1 ? "Closed-Loop Target" : "Bypassed (Manual PWM)"}
          </div>
        </div>

        {/* 3. Error */}
        <div className="flex flex-col justify-between bg-[var(--bg-surface)] p-3.5">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-[var(--ink-muted)]">
              ERROR (e)
            </span>
            {withinTol ? (
              <span className="border border-[var(--accent-ok-border)] bg-[var(--accent-ok-bg)] px-1 py-0.5 font-mono text-[0.625rem] font-semibold uppercase text-[var(--accent-ok)]">
                IN BAND
              </span>
            ) : null}
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span
              className={`font-mono text-2xl font-semibold tracking-tight tabular-nums xl:text-3xl ${
                mode !== 1
                  ? "text-[var(--ink-muted)]"
                  : withinTol
                    ? "text-[var(--accent-ok)]"
                    : Math.abs(err) > 25
                      ? "text-[var(--accent-danger-ink)]"
                      : "text-[var(--ink-primary)]"
              }`}
            >
              {mode === 1 ? `${err >= 0 ? "+" : ""}${err.toFixed(1)}` : "—"}
            </span>
            {mode === 1 ? (
              <span className="font-mono text-xs text-[var(--ink-muted)]">RPM</span>
            ) : null}
          </div>
          <div className="mt-1.5 font-mono text-[0.6875rem] tabular-nums text-[var(--ink-muted)]">
            e(t) = SP − RPM
          </div>
        </div>

        {/* 4. PWM Output */}
        <div className="flex flex-col justify-between bg-[var(--bg-surface)] p-3.5">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-[var(--ink-muted)]">
              PWM OUTPUT
            </span>
            <span
              className={`font-mono text-[0.6875rem] font-medium tabular-nums ${
                isSaturated ? "font-semibold text-[var(--accent-danger-ink)]" : "text-[var(--ink-secondary)]"
              }`}
            >
              {isSaturated ? "SAT" : `${dutyPct.toFixed(0)}%`}
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="font-mono text-2xl font-semibold tracking-tight tabular-nums text-[var(--ink-primary)] xl:text-3xl">
              {pwm}
            </span>
            <span className="font-mono text-xs text-[var(--ink-muted)]">/ 255</span>
          </div>
          <div
            role="progressbar"
            aria-label="Siklus kerja PWM"
            aria-valuenow={pwm}
            aria-valuemin={0}
            aria-valuemax={255}
            aria-valuetext={`${dutyPct.toFixed(0)}% (${pwm} dari 255)`}
            className="mt-2 h-2 w-full bg-[var(--bg-subtle)]"
          >
            <div
              className={`h-full motion-safe:transition-[width] motion-safe:duration-75 ${
                isSaturated ? "bg-[var(--accent-danger)]" : "bg-[var(--ink-primary)]"
              }`}
              style={{ width: `${Math.min(100, dutyPct)}%` }}
            />
          </div>
        </div>

        {/* 5. Supply Voltage */}
        <div className="col-span-2 flex flex-col justify-between bg-[var(--bg-surface)] p-3.5 sm:col-span-1">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-[var(--ink-muted)]">
              BUS VOLTAGE
            </span>
            <span className="font-mono text-[0.6875rem] text-[var(--ink-muted)]">24V DC</span>
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="font-mono text-2xl font-semibold tracking-tight tabular-nums text-[var(--ink-primary)] xl:text-3xl">
              {voltage.toFixed(1)}
            </span>
            <span className="font-mono text-xs text-[var(--ink-muted)]">V</span>
          </div>
          <div className="mt-1.5 font-mono text-[0.6875rem] tabular-nums text-[var(--ink-muted)]">
            V_arm ≈ {vEff.toFixed(1)} V
          </div>
        </div>
      </div>
    </section>
  );
});
