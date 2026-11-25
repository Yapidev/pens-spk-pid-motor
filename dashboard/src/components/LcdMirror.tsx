"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { TelemetrySample } from "@/types/telemetry";

interface LcdMirrorProps {
  latest: TelemetrySample | null;
}

/**
 * Replikasi ringkas layar fisik LCD 16x2 Arduino DUE (Halaman 0 Monitor Utama)
 * mendukung bidirectional CW/CCW (-255..+255 PWM, +/- RPM) dan kode STALL FAULT (FL).
 */
export const LcdMirror = React.memo(function LcdMirror({
  latest,
}: LcdMirrorProps) {
  const pwm = latest?.pwm ?? 0;
  const voltage = latest?.voltage ?? 24.4;
  const rpm = latest?.rpm ?? 0;
  const sp = latest?.setpoint ?? 0;
  const mode = latest?.mode ?? 1;
  const runState = latest?.runState ?? 0;
  const flags = latest?.flags;

  const badge =
    runState === 2
      ? "!!"
      : runState === 3
        ? "FL"
        : runState === 1
          ? mode === 1
            ? "CL"
            : "OL"
          : "ST";

  const vPad = voltage.toFixed(1).padStart(4, " ");
  const line0Raw =
    pwm >= 0
      ? `PWM:${String(pwm).padStart(3, " ")} ${vPad}V ${badge}`
      : `PW:${String(pwm).padEnd(4, " ")} ${vPad}V ${badge}`;
  const line0 = line0Raw.slice(0, 16).padEnd(16, " ");

  const rpmInt = String(Math.round(rpm)).padEnd(4, " ");
  const targetLabel = mode === 1 ? "SP" : "OL";
  const targetInt = String(Math.round(mode === 1 ? sp : pwm)).padEnd(4, " ");
  const line1 = `RPM:${rpmInt} ${targetLabel}:${targetInt}`.slice(0, 16).padEnd(16, " ");

  const modeLabel = mode === 1 ? "CLOSED-LOOP" : "OPEN-LOOP";
  const runLabel =
    runState === 2
      ? "E-STOP"
      : runState === 3
        ? "STALL FAULT"
        : runState === 1
          ? modeLabel
          : `STOP · ${modeLabel}`;

  return (
    <div className="panel-isolated flex flex-wrap items-center gap-4 px-4 py-2.5">
      <div className="shrink-0 rounded-sm border border-[#2c3a32] bg-[#09120c] p-1.5">
        <pre
          aria-label={`Layar LCD 16x2: PWM ${pwm}, Tegangan ${voltage.toFixed(1)} Volt, RPM ${Math.round(rpm)}, ${targetLabel} ${Math.round(mode === 1 ? sp : pwm)}, Status ${runLabel}`}
          className="lcd-matrix m-0 border border-[#1f3b28] px-3 py-1.5 font-mono text-sm leading-snug tracking-[0.12em] text-[#86efac]"
        >
          <code className="block whitespace-pre tabular-nums">{line0}</code>
          <code className="block whitespace-pre tabular-nums">{line1}</code>
        </pre>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge
            variant="outline"
            className={cn(
              "rounded-sm px-2 py-0.5 font-mono text-[0.6875rem] font-semibold",
              runState === 2 || runState === 3
                ? "border-[var(--accent-danger-border)] bg-[var(--accent-danger-bg)] text-[var(--accent-danger-ink)]"
                : runState === 1
                  ? "border-[var(--accent-ok-border)] bg-[var(--accent-ok-bg)] text-[var(--accent-ok)]"
                  : "border-input bg-muted text-[var(--ink-secondary)]"
            )}
          >
            {runLabel}
          </Badge>
          {flags?.hwTimerActive ? (
            <Badge
              variant="outline"
              className="rounded-sm border-border bg-[var(--bg-surface-alt)] px-1.5 py-0.5 font-mono text-[0.625rem] text-muted-foreground"
            >
              TC3 20Hz
            </Badge>
          ) : null}
          {flags?.ffEnabled ? (
            <Badge
              variant="outline"
              className="rounded-sm border-[var(--accent-rpm)] bg-[var(--accent-rpm-bg)] px-1.5 py-0.5 font-mono text-[0.625rem] text-[var(--accent-rpm)]"
            >
              2-DOF FF
            </Badge>
          ) : null}
          {flags?.vcompEnabled ? (
            <Badge
              variant="outline"
              className="rounded-sm border-border bg-[var(--bg-surface-alt)] px-1.5 py-0.5 font-mono text-[0.625rem] text-[var(--ink-secondary)]"
            >
              V-COMP
            </Badge>
          ) : null}
          {flags?.currentLimited ? (
            <Badge
              variant="outline"
              className="rounded-sm border-[var(--accent-warn-border)] bg-[var(--accent-warn-bg)] px-1.5 py-0.5 font-mono text-[0.625rem] text-[var(--accent-warn)]"
            >
              ILIM AKTIF
            </Badge>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-mono text-[0.6875rem] text-muted-foreground">
          <span className={badge === "CL" ? "font-semibold text-foreground" : undefined}>
            CL: Closed
          </span>
          <span aria-hidden="true">·</span>
          <span className={badge === "OL" ? "font-semibold text-foreground" : undefined}>
            OL: Open
          </span>
          <span aria-hidden="true">·</span>
          <span className={badge === "ST" ? "font-semibold text-foreground" : undefined}>
            ST: Stop
          </span>
          <span aria-hidden="true">·</span>
          <span
            className={
              badge === "!!" ? "font-semibold text-[var(--accent-danger-ink)]" : undefined
            }
          >
            !!: E-Stop
          </span>
          <span aria-hidden="true">·</span>
          <span
            className={
              badge === "FL" ? "font-semibold text-[var(--accent-danger-ink)]" : undefined
            }
          >
            FL: Stall
          </span>
        </div>
      </div>
    </div>
  );
});
