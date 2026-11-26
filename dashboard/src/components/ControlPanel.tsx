"use client";

import React, { useState } from "react";
import {
  ArrowLeftRight,
  ChevronRight,
  Power,
  RefreshCw,
  RotateCcw,
  Send,
  SlidersHorizontal,
} from "lucide-react";
import { MotorArcGauge } from "@/components/MotorArcGauge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type {
  AdvancedControlConfig,
  ControlMode,
  PIDParams,
  RunState,
  TelemetrySample,
} from "@/types/telemetry";

interface ControlPanelProps {
  hydrated: boolean;
  connected: boolean;
  latestSample: TelemetrySample | null;
  activeMode: ControlMode;
  runState: RunState;
  activePid: PIDParams;
  activeSetpoint: number;
  draftPid: PIDParams;
  draftSetpoint: number;
  draftManualPwm: number;
  autoSendPid: boolean;
  pprValue: number;
  advancedConfig: AdvancedControlConfig;
  onChangeDraftPid: (next: PIDParams) => void;
  onApplyPid: (gains?: PIDParams) => void;
  onToggleAutoSendPid: (enabled: boolean) => void;
  onChangeSetpoint: (rpm: number) => void;
  onTriggerStepTest: (targetRpm: number) => void;
  onChangeManualPwm: (pwm: number) => void;
  onSwitchMode: (mode: ControlMode) => void;
  onCommand: (cmd: "START" | "STOP" | "RESET" | "SYNC" | "CLEARFAULT") => void;
  onApplyPpr: (ppr: number) => void;
  onUpdateAdvancedConfig: (patch: Partial<AdvancedControlConfig>) => void;
}

const PID_PRESETS: Array<{ id: string; label: string; gains: PIDParams }> = [
  { id: "p", label: "P", gains: { kp: 0.45, ki: 0.0, kd: 0.0 } },
  { id: "pi", label: "PI", gains: { kp: 0.50, ki: 1.15, kd: 0.0 } },
  { id: "pid", label: "PID", gains: { kp: 0.55, ki: 1.35, kd: 0.015 } },
  { id: "fast", label: "Fast", gains: { kp: 0.85, ki: 2.10, kd: 0.025 } },
];

const SETPOINT_PRESETS = [-350, 0, 200, 350, 650] as const;

export const ControlPanel = React.memo(function ControlPanel({
  hydrated,
  connected,
  latestSample,
  activeMode,
  runState,
  activePid,
  activeSetpoint,
  draftPid,
  draftSetpoint,
  draftManualPwm,
  autoSendPid,
  pprValue,
  advancedConfig,
  onChangeDraftPid,
  onApplyPid,
  onToggleAutoSendPid,
  onChangeSetpoint,
  onTriggerStepTest,
  onChangeManualPwm,
  onSwitchMode,
  onCommand,
  onApplyPpr,
  onUpdateAdvancedConfig,
}: ControlPanelProps) {
  const [pprInput, setPprInput] = useState(String(pprValue));
  const [rampInput, setRampInput] = useState(String(advancedConfig.rampRate));
  const [imaxInput, setImaxInput] = useState(String(advancedConfig.currentLimitAmp));
  const [calibrationOpen, setCalibrationOpen] = useState(false);

  const isRunning = runState === 1;
  const isEstop = runState === 2;
  const isStall = runState === 3;
  const isDisabled = hydrated && !connected;

  const pidDirty =
    Math.abs(draftPid.kp - activePid.kp) > 0.0005 ||
    Math.abs(draftPid.ki - activePid.ki) > 0.0005 ||
    Math.abs(draftPid.kd - activePid.kd) > 0.0005;

  const activePresetId = PID_PRESETS.find(
    (p) =>
      Math.abs(p.gains.kp - draftPid.kp) < 0.001 &&
      Math.abs(p.gains.ki - draftPid.ki) < 0.001 &&
      Math.abs(p.gains.kd - draftPid.kd) < 0.001
  )?.id;

  const handleTogglePower = () => {
    if (isRunning) {
      onCommand("STOP");
    } else {
      onCommand("START");
    }
  };

  return (
    <aside
      aria-label="Panel kendali motor dan PID"
      className="flex w-full shrink-0 flex-col gap-3 xl:w-[372px] xl:min-h-0"
    >
      {/* CARD A: Drive Control (Mode + Tactile Power Switch + Setpoint) */}
      <section className="phoenix-card flex shrink-0 flex-col gap-3 rounded-xl p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold tracking-tight text-foreground">
            Kendali Motor
          </h2>
          {isEstop ? (
            <Badge
              variant="outline"
              className="rounded-md border-[var(--accent-danger-border)] bg-[var(--accent-danger-bg)] px-2 py-0 font-mono text-[0.6875rem] font-semibold text-[var(--accent-danger-ink)]"
            >
              E-STOP
            </Badge>
          ) : isStall ? (
            <div className="flex items-center gap-1.5">
              <Badge
                variant="outline"
                className="rounded-md border-[var(--accent-danger-border)] bg-[var(--accent-danger-bg)] px-2 py-0 font-mono text-[0.6875rem] font-semibold text-[var(--accent-danger-ink)]"
              >
                Stall Fault
              </Badge>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => onCommand("CLEARFAULT")}
                className="h-5 rounded-md px-2 text-[0.6875rem]"
              >
                Reset Fault
              </Button>
            </div>
          ) : (
            <span className="font-mono text-[0.6875rem] text-muted-foreground">
              {activeMode === 1 ? "2-DOF PID" : "Manual PWM"}
            </span>
          )}
        </div>

        {/* Mode Segmented Control */}
        <div
          role="radiogroup"
          aria-label="Mode kendali motor"
          className="grid h-8 w-full grid-cols-2 rounded-lg border border-border bg-[var(--bg-canvas)] p-0.5"
        >
          <button
            type="button"
            role="radio"
            aria-checked={activeMode === 1}
            disabled={isDisabled}
            onClick={() => onSwitchMode(1)}
            className={cn(
              "inline-flex h-full items-center justify-center rounded-md px-2 text-xs font-medium transition-colors disabled:opacity-50",
              activeMode === 1
                ? "bg-[var(--bg-subtle)] font-semibold text-foreground"
                : "text-[var(--ink-secondary)] hover:text-foreground"
            )}
          >
            Closed-Loop
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={activeMode === 0}
            disabled={isDisabled}
            onClick={() => onSwitchMode(0)}
            className={cn(
              "inline-flex h-full items-center justify-center rounded-md px-2 text-xs font-medium transition-colors disabled:opacity-50",
              activeMode === 0
                ? "bg-[var(--bg-subtle)] font-semibold text-foreground"
                : "text-[var(--ink-secondary)] hover:text-foreground"
            )}
          >
            Open-Loop
          </button>
        </div>

        {/* Tactile Power Row (Clean matte ring, no neon bloom) */}
        <div className="flex items-center justify-between rounded-lg border border-border bg-[var(--bg-canvas)] px-3.5 py-2.5">
          <div className="flex flex-col">
            <span className="text-[0.6875rem] text-muted-foreground">Status Drive</span>
            <span className="font-mono text-xs font-semibold text-foreground">
              {isRunning ? "Aktif" : isEstop ? "E-Stop" : isStall ? "Fault" : "Siaga"}
            </span>
          </div>

          <button
            type="button"
            aria-pressed={isRunning}
            aria-label={isRunning ? "Hentikan motor" : "Jalankan motor"}
            disabled={isDisabled}
            onClick={handleTogglePower}
            data-active={isRunning ? "true" : "false"}
            className="phoenix-power-ring inline-flex size-12 items-center justify-center rounded-full border border-[var(--border-control)] text-foreground transition-colors hover:border-[var(--accent-phoenix)] disabled:opacity-50"
          >
            <Power
              aria-hidden="true"
              className={cn(
                "size-5",
                isRunning ? "text-[var(--accent-phoenix)]" : "text-[var(--ink-secondary)]"
              )}
            />
          </button>

          <div className="flex flex-col items-end gap-1">
            <span
              className={cn(
                "font-mono text-[0.6875rem] font-semibold",
                isRunning ? "text-[var(--accent-sp)]" : "text-muted-foreground"
              )}
            >
              {isRunning ? "ON" : "OFF"}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={isDisabled}
              onClick={() => onCommand("RESET")}
              className="h-5 gap-1 rounded-md px-1.5 font-mono text-[0.6875rem] text-[var(--ink-secondary)] hover:text-foreground"
            >
              <RotateCcw aria-hidden="true" className="size-3" />
              Reset
            </Button>
          </div>
        </div>

        {/* Setpoint / Manual PWM Section */}
        {activeMode === 1 ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="setpoint-number"
                className="text-xs font-medium text-[var(--ink-secondary)]"
              >
                Setpoint
              </label>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-xs"
                  disabled={isDisabled || draftSetpoint === 0}
                  onClick={() => onChangeSetpoint(-draftSetpoint)}
                  aria-label="Balik arah CW/CCW"
                  title="Balik arah putaran (CW ↔ CCW)"
                  className="size-7 rounded-lg border-input bg-[var(--bg-canvas)] text-[var(--ink-secondary)] shadow-none hover:text-foreground dark:bg-[var(--bg-canvas)]"
                >
                  <ArrowLeftRight aria-hidden="true" className="size-3" />
                </Button>
                <Input
                  id="setpoint-number"
                  type="number"
                  min={-750}
                  max={750}
                  step={5}
                  disabled={isDisabled}
                  value={draftSetpoint}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    if (Number.isFinite(val)) {
                      onChangeSetpoint(Math.max(-750, Math.min(750, val)));
                    }
                  }}
                  className="h-7 w-18 rounded-lg border-input bg-[var(--bg-canvas)] px-2 text-right font-mono text-xs font-semibold tabular-nums text-[var(--accent-sp)] shadow-none dark:bg-[var(--bg-canvas)]"
                />
                <span className="font-mono text-[0.6875rem] text-muted-foreground">
                  RPM
                </span>
              </div>
            </div>

            <Slider
              aria-label="Slider Setpoint RPM (-750 hingga +750)"
              min={-750}
              max={750}
              step={5}
              disabled={isDisabled}
              value={[draftSetpoint]}
              onValueChange={([v]) => onChangeSetpoint(v)}
              className="py-0.5 [&_[data-slot=slider-range]]:bg-[var(--accent-phoenix)] [&_[data-slot=slider-thumb]]:size-3.5 [&_[data-slot=slider-thumb]]:border-[var(--accent-phoenix)]"
            />

            <div className="grid grid-cols-5 gap-1">
              {SETPOINT_PRESETS.map((rpm) => {
                const active = Math.abs(activeSetpoint - rpm) < 1;
                return (
                  <Button
                    key={rpm}
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={isDisabled}
                    onClick={() => onChangeSetpoint(rpm)}
                    className={cn(
                      "h-7 rounded-lg px-1 font-mono text-[0.6875rem] tabular-nums shadow-none",
                      active
                        ? "border-[var(--accent-sp-bright)] bg-[var(--accent-sp-bg)] font-semibold text-[var(--accent-sp)] hover:bg-[var(--accent-sp-bg-hover)] dark:border-[var(--accent-sp-bright)] dark:bg-[var(--accent-sp-bg)]"
                        : "border-input bg-[var(--bg-canvas)] text-[var(--ink-secondary)] hover:border-[var(--border-strong)] hover:text-foreground dark:bg-[var(--bg-canvas)]"
                    )}
                  >
                    {rpm}
                  </Button>
                );
              })}
            </div>

            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={isDisabled}
              onClick={() => onTriggerStepTest(draftSetpoint === 0 ? 350 : draftSetpoint)}
              className="h-8 w-full gap-1.5 rounded-lg text-xs font-semibold shadow-none"
            >
              <SlidersHorizontal aria-hidden="true" className="size-3.5" />
              <span>
                Step Test ke {draftSetpoint === 0 ? 350 : draftSetpoint} RPM
              </span>
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="manual-pwm-number"
                className="text-xs font-medium text-[var(--ink-secondary)]"
              >
                PWM Manual
              </label>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-xs"
                  disabled={isDisabled || draftManualPwm === 0}
                  onClick={() => onChangeManualPwm(-draftManualPwm)}
                  aria-label="Balik arah PWM"
                  className="size-7 rounded-lg border-input bg-[var(--bg-canvas)] text-[var(--ink-secondary)] shadow-none hover:text-foreground dark:bg-[var(--bg-canvas)]"
                >
                  <ArrowLeftRight aria-hidden="true" className="size-3" />
                </Button>
                <Input
                  id="manual-pwm-number"
                  type="number"
                  min={-255}
                  max={255}
                  step={1}
                  disabled={isDisabled}
                  value={draftManualPwm}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    if (Number.isFinite(val)) {
                      onChangeManualPwm(Math.max(-255, Math.min(255, Math.round(val))));
                    }
                  }}
                  className="h-7 w-18 rounded-lg border-input bg-[var(--bg-canvas)] px-2 text-right font-mono text-xs font-semibold tabular-nums shadow-none dark:bg-[var(--bg-canvas)]"
                />
                <span className="font-mono text-[0.6875rem] text-muted-foreground">
                  / 255
                </span>
              </div>
            </div>

            <Slider
              aria-label="Slider PWM Manual (-255 hingga +255)"
              min={-255}
              max={255}
              step={1}
              disabled={isDisabled}
              value={[draftManualPwm]}
              onValueChange={([v]) => onChangeManualPwm(v)}
              className="py-0.5 [&_[data-slot=slider-range]]:bg-[var(--accent-phoenix)] [&_[data-slot=slider-thumb]]:size-3.5 [&_[data-slot=slider-thumb]]:border-[var(--accent-phoenix)]"
            />

            <div className="grid grid-cols-5 gap-1">
              {([-180, 0, 100, 180, 255] as const).map((p) => (
                <Button
                  key={p}
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={isDisabled}
                  onClick={() => onChangeManualPwm(p)}
                  className={cn(
                    "h-7 rounded-lg px-1 font-mono text-[0.6875rem] tabular-nums shadow-none",
                    draftManualPwm === p
                      ? "border-[var(--accent-sp-bright)] bg-[var(--accent-sp-bg)] font-semibold text-[var(--accent-sp)] dark:border-[var(--accent-sp-bright)] dark:bg-[var(--accent-sp-bg)]"
                      : "border-input bg-[var(--bg-canvas)] text-[var(--ink-secondary)] hover:text-foreground dark:bg-[var(--bg-canvas)]"
                  )}
                >
                  {p}
                </Button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* CARD B: Output Motor Gauge + PID Gains (Balanced natural spacing, zero awkward void) */}
      <section className="phoenix-card flex min-h-0 flex-1 flex-col gap-4 rounded-xl p-4 xl:overflow-y-auto">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-xs font-semibold tracking-tight text-foreground">
              Output Motor
            </h2>
            <span className="font-mono text-[0.6875rem] text-muted-foreground">
              IBT-2 24V
            </span>
          </div>
          <MotorArcGauge latest={latestSample} />
        </div>

        {/* PID Gains — Refined Neutral Monochrome Sliders (zero orange-vs-cyan clash) */}
        <div className="flex flex-1 flex-col justify-between gap-3 border-t border-border pt-3.5">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold tracking-tight text-foreground">
                Parameter PID
              </h3>
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-[var(--ink-secondary)]">
                <Switch
                  size="sm"
                  aria-label="Kirim PID otomatis saat slider digeser"
                  checked={autoSendPid}
                  onCheckedChange={onToggleAutoSendPid}
                  className="data-[state=checked]:bg-[var(--accent-phoenix)]"
                />
                <span>Live</span>
              </label>
            </div>

            {(
              [
                { key: "kp", label: "Kp", min: 0, max: 3, step: 0.05, digits: 2 },
                { key: "ki", label: "Ki", min: 0, max: 5, step: 0.05, digits: 2 },
                { key: "kd", label: "Kd", min: 0, max: 0.3, step: 0.005, digits: 3 },
              ] as const
            ).map((item) => {
              const val = draftPid[item.key];
              return (
                <div key={item.key} className="flex items-center gap-2.5">
                  <label
                    htmlFor={`pid-${item.key}`}
                    className="w-6 shrink-0 font-mono text-xs font-medium text-[var(--ink-secondary)]"
                  >
                    {item.label}
                  </label>
                  <Slider
                    aria-label={`Slider ${item.label}`}
                    min={item.min}
                    max={item.max}
                    step={item.step}
                    disabled={isDisabled}
                    value={[Math.min(item.max, Math.max(item.min, val))]}
                    onValueChange={([v]) =>
                      onChangeDraftPid({
                        ...draftPid,
                        [item.key]: Number(v.toFixed(item.digits)),
                      })
                    }
                    className="flex-1 [&_[data-slot=slider-range]]:bg-foreground/75 [&_[data-slot=slider-thumb]]:size-3 [&_[data-slot=slider-thumb]]:border-foreground"
                  />
                  <Input
                    id={`pid-${item.key}`}
                    type="number"
                    min={0}
                    max={item.max * 4}
                    step={item.step}
                    disabled={isDisabled}
                    value={val}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n) && n >= 0) {
                        onChangeDraftPid({ ...draftPid, [item.key]: n });
                      }
                    }}
                    className="h-7 w-16 shrink-0 rounded-lg border-input bg-[var(--bg-canvas)] px-2 text-right font-mono text-xs tabular-nums shadow-none dark:bg-[var(--bg-canvas)]"
                  />
                </div>
              );
            })}

            <div className="flex items-center gap-1.5 pt-1">
              <div className="grid flex-1 grid-cols-4 gap-1">
                {PID_PRESETS.map((preset) => {
                  const active = activePresetId === preset.id;
                  return (
                    <Button
                      key={preset.id}
                      type="button"
                      variant="outline"
                      size="xs"
                      disabled={isDisabled}
                      onClick={() => {
                        onChangeDraftPid(preset.gains);
                        onApplyPid(preset.gains);
                      }}
                      className={cn(
                        "h-7 rounded-lg px-1 font-mono text-xs font-medium shadow-none",
                        active
                          ? "border-[var(--border-strong)] bg-[var(--bg-subtle)] font-semibold text-foreground dark:border-[var(--border-strong)] dark:bg-[var(--bg-subtle)]"
                          : "border-input bg-[var(--bg-canvas)] text-[var(--ink-secondary)] hover:text-foreground dark:bg-[var(--bg-canvas)]"
                      )}
                    >
                      {preset.label}
                    </Button>
                  );
                })}
              </div>

              {pidDirty ? (
                <Button
                  type="button"
                  variant="default"
                  size="xs"
                  disabled={isDisabled}
                  onClick={() => onApplyPid()}
                  className="h-7 gap-1 rounded-lg px-2.5 text-xs font-semibold shadow-none"
                >
                  <Send aria-hidden="true" className="size-3" />
                  Kirim
                </Button>
              ) : null}
            </div>
          </div>

          {/* Collapsible Calibration & Protection Limits */}
          <Collapsible
            open={calibrationOpen}
            onOpenChange={setCalibrationOpen}
            className="border-t border-border pt-2.5"
          >
            <CollapsibleTrigger className="flex w-full items-center justify-between text-xs font-medium text-[var(--ink-secondary)] hover:text-foreground">
              <span className="inline-flex items-center gap-1">
                <ChevronRight
                  aria-hidden="true"
                  className={cn(
                    "size-3.5 transition-transform",
                    calibrationOpen && "rotate-90"
                  )}
                />
                Kalibrasi & Ramp
              </span>
              <span className="font-mono text-[0.6875rem] text-muted-foreground">
                PPR {pprValue} / {advancedConfig.rampRate} RPM/s
              </span>
            </CollapsibleTrigger>

            <CollapsibleContent className="mt-2.5 space-y-2">
              <div className="grid grid-cols-3 gap-1.5">
                <div>
                  <label
                    htmlFor="cal-ppr"
                    className="mb-0.5 block font-mono text-[0.625rem] text-muted-foreground"
                  >
                    PPR
                  </label>
                  <Input
                    id="cal-ppr"
                    type="number"
                    min={10}
                    max={10000}
                    disabled={isDisabled}
                    value={pprInput}
                    onChange={(e) => setPprInput(e.target.value)}
                    onBlur={() => {
                      const n = Number(pprInput);
                      if (Number.isFinite(n) && n >= 10) onApplyPpr(n);
                    }}
                    className="h-7 rounded-lg bg-[var(--bg-canvas)] px-2 font-mono text-xs dark:bg-[var(--bg-canvas)]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="cal-ramp"
                    className="mb-0.5 block font-mono text-[0.625rem] text-muted-foreground"
                  >
                    Ramp
                  </label>
                  <Input
                    id="cal-ramp"
                    type="number"
                    min={0}
                    max={5000}
                    step={50}
                    disabled={isDisabled}
                    value={rampInput}
                    onChange={(e) => setRampInput(e.target.value)}
                    onBlur={() => {
                      const n = Number(rampInput);
                      if (Number.isFinite(n) && n >= 0) {
                        onUpdateAdvancedConfig({ rampRate: n });
                      }
                    }}
                    className="h-7 rounded-lg bg-[var(--bg-canvas)] px-2 font-mono text-xs dark:bg-[var(--bg-canvas)]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="cal-imax"
                    className="mb-0.5 block font-mono text-[0.625rem] text-muted-foreground"
                  >
                    Imax (A)
                  </label>
                  <Input
                    id="cal-imax"
                    type="number"
                    min={0.5}
                    max={25}
                    step={0.5}
                    disabled={isDisabled}
                    value={imaxInput}
                    onChange={(e) => setImaxInput(e.target.value)}
                    onBlur={() => {
                      const n = Number(imaxInput);
                      if (Number.isFinite(n) && n >= 0.5) {
                        onUpdateAdvancedConfig({ currentLimitAmp: n });
                      }
                    }}
                    className="h-7 rounded-lg bg-[var(--bg-canvas)] px-2 font-mono text-xs dark:bg-[var(--bg-canvas)]"
                  />
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={isDisabled}
                onClick={() => onCommand("SYNC")}
                className="h-7 w-full gap-1.5 rounded-lg border-input bg-[var(--bg-canvas)] text-xs text-[var(--ink-secondary)] shadow-none hover:text-foreground dark:bg-[var(--bg-canvas)]"
              >
                <RefreshCw aria-hidden="true" className="size-3" />
                Sinkronisasi Firmware DUE
              </Button>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </section>
    </aside>
  );
});
