"use client";

import React from "react";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  AdvancedControlConfig,
  ConnectionMode,
  ControlMode,
  StepMetrics,
  TelemetrySample,
} from "@/types/telemetry";

interface PhoenixBentoRowProps {
  hydrated: boolean;
  connected: boolean;
  connectionMode: ConnectionMode;
  activeMode: ControlMode;
  latest: TelemetrySample | null;
  metrics: StepMetrics;
  advancedConfig: AdvancedControlConfig;
  onUpdateAdvancedConfig: (patch: Partial<AdvancedControlConfig>) => void;
  onInjectDisturbance?: () => void;
  onInjectVoltageSag?: () => void;
  onInjectStallTest?: () => void;
  onSync?: () => void;
}

function MatteToggle({
  label,
  sublabel,
  checked,
  disabled,
  onToggle,
}: {
  label: string;
  sublabel: string;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="truncate text-xs font-medium text-foreground">
          {label}
        </div>
        <div className="truncate font-mono text-[0.6875rem] text-muted-foreground">
          {sublabel}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={onToggle}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-md border p-0.5 transition-colors disabled:opacity-50",
          checked
            ? "border-[var(--accent-phoenix)] bg-[var(--accent-phoenix-soft)] justify-end"
            : "border-input bg-[var(--bg-canvas)] justify-start"
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "h-4 w-4 rounded-[4px] transition-colors",
            checked ? "bg-[var(--accent-phoenix)]" : "bg-muted-foreground/50"
          )}
        />
      </button>
    </div>
  );
}

export const PhoenixBentoRow = React.memo(function PhoenixBentoRow({
  hydrated,
  connected,
  connectionMode,
  activeMode,
  latest,
  metrics,
  advancedConfig,
  onUpdateAdvancedConfig,
  onInjectDisturbance,
  onInjectVoltageSag,
  onInjectStallTest,
  onSync,
}: PhoenixBentoRowProps) {
  const isDisabled = hydrated && !connected;
  const voltage = latest?.voltage ?? 24.4;
  const current = latest?.currentAmp ?? 0;
  const pwm = latest?.pwm ?? 0;
  const rpm = latest?.rpm ?? 0;
  const sp = latest?.setpoint ?? 0;
  const runState = latest?.runState ?? 0;
  const flags = latest?.flags;

  const modeCode =
    activeMode === 1
      ? advancedConfig.ffEnabled
        ? "2-DOF CL"
        : "1-DOF CL"
      : "Open-Loop";

  const lcdBadge =
    runState === 2
      ? "!!"
      : runState === 3
        ? "FL"
        : runState === 1
          ? activeMode === 1
            ? "CL"
            : "OL"
          : "ST";

  const vPad = voltage.toFixed(1).padStart(4, " ");
  const line0 = (
    pwm >= 0
      ? `PWM:${String(pwm).padStart(3, " ")} ${vPad}V ${lcdBadge}`
      : `PW:${String(pwm).padEnd(4, " ")} ${vPad}V ${lcdBadge}`
  )
    .slice(0, 16)
    .padEnd(16, " ");
  const rpmInt = String(Math.round(rpm)).padEnd(4, " ");
  const tgtLbl = activeMode === 1 ? "SP" : "OL";
  const tgtInt = String(Math.round(activeMode === 1 ? sp : pwm)).padEnd(4, " ");
  const line1 = `RPM:${rpmInt} ${tgtLbl}:${tgtInt}`.slice(0, 16).padEnd(16, " ");

  const detailItems = [
    {
      label: "Mode",
      value: modeCode,
      accent: advancedConfig.ffEnabled && activeMode === 1,
    },
    {
      label: "Loop Timer",
      value: flags?.hwTimerActive === false ? "20 Hz" : "TC3 20 Hz",
      accent: false,
    },
    {
      label: "Rise Time",
      value: metrics.riseTimeSec != null ? `${metrics.riseTimeSec.toFixed(2)} s` : "—",
      accent: false,
    },
    {
      label: "Overshoot",
      value: metrics.overshootPct != null ? `${metrics.overshootPct.toFixed(1)}%` : "—",
      accent: metrics.overshootPct != null && metrics.overshootPct > 10,
    },
    {
      label: "Settling ±2%",
      value: metrics.settlingTimeSec != null ? `${metrics.settlingTimeSec.toFixed(2)} s` : "—",
      accent: false,
    },
    {
      label: "IAE / Ess",
      value:
        metrics.iae != null
          ? `${metrics.iae.toFixed(0)} / ${metrics.steadyStateErrorRpm != null ? metrics.steadyStateErrorRpm.toFixed(1) : "—"}`
          : "—",
      accent: false,
    },
  ];

  return (
    <div className="grid shrink-0 grid-cols-1 gap-3 md:grid-cols-3">
      {/* CARD 1: Respon Step (Clean 2x3 Metric Grid — numbers lead, zero decorative icons) */}
      <section
        aria-label="Detail sistem dan metrik respon step"
        className="phoenix-card flex flex-col justify-between rounded-xl p-4"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold tracking-tight text-foreground">
            Respon Step
          </h2>
          <span className="font-mono text-[0.6875rem] tabular-nums text-muted-foreground">
            {metrics.hasStep ? `Target ${metrics.targetSetpoint.toFixed(0)} RPM` : "Menunggu"}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          {detailItems.map((item) => (
            <div key={item.label} className="min-w-0">
              <div className="truncate text-[0.6875rem] text-muted-foreground">
                {item.label}
              </div>
              <div
                className={cn(
                  "truncate font-mono text-[0.8125rem] font-semibold tabular-nums",
                  item.accent ? "text-[var(--accent-sp)]" : "text-foreground"
                )}
              >
                {item.value}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CARD 2: 2-DOF & Proteksi (Clean matte switches + disturbance test triggers) */}
      <section
        aria-label="Kontrol 2-DOF dan proteksi motor"
        className="phoenix-card flex flex-col justify-between rounded-xl p-4"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold tracking-tight text-foreground">
            2-DOF & Proteksi
          </h2>
          <span className="font-mono text-[0.6875rem] tabular-nums text-muted-foreground">
            Batas {advancedConfig.currentLimitAmp.toFixed(1)} A
          </span>
        </div>

        <div className="space-y-3">
          <MatteToggle
            label="Feedforward 2-DOF"
            sublabel={`Kff ${advancedConfig.kff.toFixed(2)} / DZ ${advancedConfig.deadzonePwm}`}
            checked={advancedConfig.ffEnabled}
            disabled={isDisabled}
            onToggle={() =>
              onUpdateAdvancedConfig({ ffEnabled: !advancedConfig.ffEnabled })
            }
          />
          <MatteToggle
            label="Voltage Comp"
            sublabel="Kompensasi sag suplai A10"
            checked={advancedConfig.vcompEnabled}
            disabled={isDisabled}
            onToggle={() =>
              onUpdateAdvancedConfig({ vcompEnabled: !advancedConfig.vcompEnabled })
            }
          />
        </div>

        <div className="mt-3 flex items-center gap-1.5 border-t border-border pt-2.5">
          {connectionMode === "simulator" ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={isDisabled}
                onClick={onInjectDisturbance}
                className="h-7 flex-1 rounded-lg border-input bg-[var(--bg-canvas)] px-2 text-xs font-medium text-[var(--ink-secondary)] shadow-none hover:border-[var(--border-strong)] hover:text-foreground dark:bg-[var(--bg-canvas)]"
              >
                Beban
              </Button>
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={isDisabled}
                onClick={onInjectVoltageSag}
                className="h-7 flex-1 rounded-lg border-input bg-[var(--bg-canvas)] px-2 text-xs font-medium text-[var(--ink-secondary)] shadow-none hover:border-[var(--border-strong)] hover:text-foreground dark:bg-[var(--bg-canvas)]"
              >
                Drop -3V
              </Button>
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={isDisabled}
                onClick={onInjectStallTest}
                className="h-7 flex-1 gap-1 rounded-lg border-input bg-[var(--bg-canvas)] px-2 text-xs font-medium text-[var(--ink-secondary)] shadow-none hover:border-[var(--accent-danger-border)] hover:text-[var(--accent-danger-ink)] dark:bg-[var(--bg-canvas)]"
              >
                <ShieldAlert aria-hidden="true" className="size-3" />
                Stall
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={isDisabled}
              onClick={onSync}
              className="h-7 w-full gap-1.5 rounded-lg border-input bg-[var(--bg-canvas)] text-xs font-medium text-[var(--ink-secondary)] shadow-none hover:text-foreground dark:bg-[var(--bg-canvas)]"
            >
              <RefreshCw aria-hidden="true" className="size-3" />
              Sinkronisasi DUE
            </Button>
          )}
        </div>
      </section>

      {/* CARD 3: Daya & LCD 16x2 (Clean recessed readouts + hardware LCD mirror, no faux PCB lines) */}
      <section
        aria-label="Pembacaan daya, arus, dan LCD 16x2"
        className="phoenix-card flex flex-col justify-between rounded-xl p-4"
      >
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="text-xs font-semibold tracking-tight text-foreground">
            Daya & LCD 16×2
          </h2>
          <span
            className={cn(
              "font-mono text-[0.6875rem] font-medium",
              flags?.currentLimited
                ? "text-[var(--accent-warn)]"
                : runState === 3 || runState === 2
                  ? "text-[var(--accent-danger-ink)]"
                  : "text-[var(--accent-ok)]"
            )}
          >
            {flags?.currentLimited
              ? "ILIM Aktif"
              : runState === 3
                ? "Stall Fault"
                : runState === 2
                  ? "E-Stop"
                  : "Normal"}
          </span>
        </div>

        <div className="grid grid-cols-2 divide-x divide-border rounded-lg border border-border bg-[var(--bg-canvas)] py-2">
          <div className="px-3">
            <div className="text-[0.6875rem] text-muted-foreground">Suplai DC</div>
            <div className="font-mono text-base font-semibold leading-tight tabular-nums text-foreground">
              {voltage.toFixed(1)}
              <span className="ml-1 text-xs font-normal text-muted-foreground">V</span>
            </div>
          </div>
          <div className="px-3">
            <div className="text-[0.6875rem] text-muted-foreground">Arus Motor</div>
            <div
              className={cn(
                "font-mono text-base font-semibold leading-tight tabular-nums",
                flags?.currentLimited ? "text-[var(--accent-warn)]" : "text-foreground"
              )}
            >
              {current.toFixed(2)}
              <span className="ml-1 text-xs font-normal text-muted-foreground">A</span>
            </div>
          </div>
        </div>

        <div className="mt-2.5 rounded-lg border border-[#1f3226] bg-[#09120c] p-1">
          <pre
            aria-label={`Layar LCD 16x2: PWM ${pwm}, ${voltage.toFixed(1)}V, RPM ${Math.round(rpm)}, ${tgtLbl} ${Math.round(activeMode === 1 ? sp : pwm)}`}
            className="lcd-matrix m-0 rounded px-2.5 py-1.5 font-mono text-[0.75rem] leading-tight tracking-[0.1em] text-[#86efac]"
          >
            <code className="block whitespace-pre tabular-nums">{line0}</code>
            <code className="block whitespace-pre tabular-nums">{line1}</code>
          </pre>
        </div>
      </section>
    </div>
  );
});
