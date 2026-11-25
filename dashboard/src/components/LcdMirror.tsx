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
export function LcdMirror({ latest }: LcdMirrorProps) {
  const pwm = latest?.pwm ?? 0;
  const voltage = latest?.voltage ?? 24.4;
  const rpm = latest?.rpm ?? 0;
  const sp = latest?.setpoint ?? 0;
  const err = latest?.error ?? 0;
  const mode = latest?.mode ?? 1;
  const runState = latest?.runState ?? 0;

  const badge =
    runState === 2 ? "!" : runState === 1 ? (mode === 1 ? "P" : "O") : "S";

  const pwmPad = String(pwm).padStart(3, " ");
  const vPad = voltage.toFixed(1).padStart(4, " ");
  const line0 = `PWM:${pwmPad} V:${vPad} ${badge}`.slice(0, 16).padEnd(16, " ");

  const rpmInt = String(Math.round(rpm)).padEnd(4, " ");
  const targetLabel = mode === 1 ? "SP" : "OL";
  const targetInt = String(Math.round(mode === 1 ? sp : pwm)).padEnd(4, " ");
  const line1 = `RPM:${rpmInt} ${targetLabel}:${targetInt}`.slice(0, 16).padEnd(16, " ");

  const dutyPct = (pwm / 255) * 100;
  const vEff = (voltage * pwm) / 255;
  const withinTol = mode === 1 && runState === 1 && Math.abs(err) <= Math.max(sp * 0.02, 1.5);

  return (
    <section className="grid grid-cols-1 gap-px border border-[#dfe2e8] bg-[#dfe2e8] lg:grid-cols-12">
      {/* Virtual 16x2 LCD Hardware Mirror */}
      <div className="flex flex-col justify-between bg-white p-3.5 lg:col-span-4 xl:col-span-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#64748b]">
            LCD 16×2 SHIELD MIRROR
          </span>
          <span
            className={`px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase ${
              runState === 2
                ? "bg-red-100 text-[#dc2626]"
                : runState === 1
                  ? "bg-emerald-50 text-[#059669]"
                  : "bg-[#f0f1f4] text-[#475569]"
            }`}
          >
            {runState === 2 ? "E-STOP" : runState === 1 ? (mode === 1 ? "PID RUN" : "OPEN RUN") : "STOPPED"}
          </span>
        </div>

        <div className="border-2 border-[#1e293b] bg-[#0c1610] p-2.5 shadow-inner">
          <div className="lcd-matrix border border-[#22422d] px-3 py-2 font-mono text-[15px] leading-snug tracking-[0.12em] text-[#86efac] sm:text-base">
            <div className="whitespace-pre tabular-nums">{line0}</div>
            <div className="whitespace-pre tabular-nums">{line1}</div>
          </div>
        </div>
      </div>

      {/* 5 Precision Telemetry KPI Cells */}
      <div className="grid grid-cols-2 gap-px bg-[#dfe2e8] sm:grid-cols-5 lg:col-span-8 xl:col-span-9">
        {/* 1. Actual RPM */}
        <div className="flex flex-col justify-between bg-white p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#64748b]">
              ACTUAL RPM
            </span>
            <span className="h-2 w-2 bg-[#1d4ed8]" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="font-mono text-2xl font-semibold tracking-tight tabular-nums text-[#0f172a] xl:text-3xl">
              {rpm.toFixed(1)}
            </span>
            <span className="font-mono text-[11px] text-[#64748b]">RPM</span>
          </div>
          <div className="mt-1.5 font-mono text-[10px] tabular-nums text-[#64748b]">
            {sp > 0 && mode === 1
              ? `${((rpm / sp) * 100).toFixed(1)}% of SP`
              : mode === 0
                ? "Open-Loop Feedback"
                : "Standby"}
          </div>
        </div>

        {/* 2. Setpoint */}
        <div className="flex flex-col justify-between bg-white p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#64748b]">
              SETPOINT (SP)
            </span>
            <span className="h-2 w-2 bg-[#ea580c]" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="font-mono text-2xl font-semibold tracking-tight tabular-nums text-[#ea580c] xl:text-3xl">
              {mode === 1 ? sp.toFixed(1) : "—"}
            </span>
            {mode === 1 && (
              <span className="font-mono text-[11px] text-[#64748b]">RPM</span>
            )}
          </div>
          <div className="mt-1.5 font-mono text-[10px] text-[#64748b]">
            {mode === 1 ? "Closed-Loop Target" : "Bypassed (Manual PWM)"}
          </div>
        </div>

        {/* 3. Error */}
        <div className="flex flex-col justify-between bg-white p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#64748b]">
              ERROR (e)
            </span>
            {withinTol && (
              <span className="font-mono text-[9px] font-semibold uppercase text-[#059669]">
                IN BAND
              </span>
            )}
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span
              className={`font-mono text-2xl font-semibold tracking-tight tabular-nums xl:text-3xl ${
                mode !== 1
                  ? "text-[#94a3b8]"
                  : withinTol
                    ? "text-[#059669]"
                    : Math.abs(err) > 25
                      ? "text-[#dc2626]"
                      : "text-[#0f172a]"
              }`}
            >
              {mode === 1 ? `${err >= 0 ? "+" : ""}${err.toFixed(1)}` : "—"}
            </span>
            {mode === 1 && (
              <span className="font-mono text-[11px] text-[#64748b]">RPM</span>
            )}
          </div>
          <div className="mt-1.5 font-mono text-[10px] tabular-nums text-[#64748b]">
            e(t) = SP − RPM
          </div>
        </div>

        {/* 4. PWM Output */}
        <div className="flex flex-col justify-between bg-white p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#64748b]">
              PWM OUTPUT
            </span>
            <span className="font-mono text-[10px] tabular-nums text-[#475569]">
              {dutyPct.toFixed(0)}%
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="font-mono text-2xl font-semibold tracking-tight tabular-nums text-[#0f172a] xl:text-3xl">
              {pwm}
            </span>
            <span className="font-mono text-[11px] text-[#64748b]">/ 255</span>
          </div>
          <div className="mt-2 h-1.5 w-full bg-[#eceef2]">
            <div
              className={`h-full transition-[width] duration-75 ${
                pwm >= 250 ? "bg-[#dc2626]" : "bg-[#0f172a]"
              }`}
              style={{ width: `${Math.min(100, dutyPct)}%` }}
            />
          </div>
        </div>

        {/* 5. Supply Voltage */}
        <div className="col-span-2 flex flex-col justify-between bg-white p-3.5 sm:col-span-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#64748b]">
              BUS VOLTAGE
            </span>
            <span className="font-mono text-[10px] text-[#64748b]">24V DC</span>
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="font-mono text-2xl font-semibold tracking-tight tabular-nums text-[#0f172a] xl:text-3xl">
              {voltage.toFixed(1)}
            </span>
            <span className="font-mono text-[11px] text-[#64748b]">V</span>
          </div>
          <div className="mt-1.5 font-mono text-[10px] tabular-nums text-[#64748b]">
            V_arm ≈ {vEff.toFixed(1)} V
          </div>
        </div>
      </div>
    </section>
  );
}
