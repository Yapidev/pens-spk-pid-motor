"use client";

import React from "react";
import { cn } from "@/lib/utils";
import type { TelemetrySample } from "@/types/telemetry";

interface MotorArcGaugeProps {
  latest: TelemetrySample | null;
  maxRpm?: number;
}

/**
 * 180-degree Semi-Circular Arc Gauge untuk output kecepatan RPM & duty PWM.
 * Bersih tanpa dekorasi berlebih dan proporsional pada kolom kanan.
 */
export const MotorArcGauge = React.memo(function MotorArcGauge({
  latest,
  maxRpm = 750,
}: MotorArcGaugeProps) {
  const rpm = latest?.rpm ?? 0;
  const pwm = latest?.pwm ?? 0;
  const voltage = latest?.voltage ?? 24.4;
  const current = latest?.currentAmp ?? 0;

  const absRpm = Math.abs(rpm);
  const ratio = Math.min(1, Math.max(0, absRpm / maxRpm));
  const pwmPct = Math.min(100, Math.round((Math.abs(pwm) / 255) * 100));
  const dirLabel = rpm < -3 ? "CCW" : rpm > 3 ? "CW" : "IDLE";

  const radius = 78;
  const circumference = Math.PI * radius;
  const dashOffset = circumference * (1 - ratio);

  return (
    <div className="flex flex-col items-center">
      <div className="relative flex w-full max-w-[240px] flex-col items-center">
        <svg
          viewBox="0 0 200 110"
          className="h-[116px] w-full overflow-visible"
          role="img"
          aria-label={`Gauge kecepatan motor ${rpm.toFixed(0)} RPM (${Math.round(ratio * 100)}% dari ${maxRpm} RPM), PWM ${pwm}`}
        >
          <defs>
            <linearGradient id="phoenixArcGrad" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#c2410c" />
              <stop offset="60%" stopColor="#ff5c1a" />
              <stop offset="100%" stopColor="#ff884d" />
            </linearGradient>
          </defs>

          <path
            d="M 22 96 A 78 78 0 0 1 178 96"
            fill="none"
            stroke="var(--bg-subtle)"
            strokeWidth="12"
            strokeLinecap="round"
          />

          <path
            d="M 22 96 A 78 78 0 0 1 178 96"
            fill="none"
            stroke="url(#phoenixArcGrad)"
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-150"
          />
        </svg>

        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex flex-col items-center">
          <span className="font-mono text-[0.6875rem] font-medium tracking-wider text-[var(--accent-sp)]">
            {dirLabel}
          </span>
          <div className="font-mono text-3xl font-semibold leading-none tracking-tight tabular-nums text-foreground">
            {rpm.toFixed(0)}
          </div>
          <div className="mt-1 font-mono text-[0.6875rem] text-muted-foreground">
            RPM ({pwmPct}% PWM)
          </div>
        </div>

        <div className="flex w-full justify-between px-3 font-mono text-[0.625rem] text-muted-foreground">
          <span>0</span>
          <span>{maxRpm}</span>
        </div>
      </div>

      {/* Properly separated 2-column footer readout */}
      <div className="mt-3 grid w-full grid-cols-2 divide-x divide-border rounded-lg border border-border bg-[var(--bg-canvas)] py-2 font-mono text-xs tabular-nums">
        <div className="px-3">
          <div className="font-sans text-[0.6875rem] text-muted-foreground">Daya</div>
          <div className="font-semibold text-foreground">
            {current.toFixed(2)} A / {voltage.toFixed(1)} V
          </div>
        </div>
        <div className="px-3">
          <div className="font-sans text-[0.6875rem] text-muted-foreground">
            Sinyal PWM
          </div>
          <div
            className={cn(
              "font-semibold",
              pwm < 0 ? "text-[var(--accent-sp)]" : "text-foreground"
            )}
          >
            {pwm > 0 ? `+${pwm}` : pwm} / 255
          </div>
        </div>
      </div>
    </div>
  );
});
