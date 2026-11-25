"use client";

import React, { useId, useState } from "react";
import {
  ArrowLeftRight,
  ChevronRight,
  Play,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldAlert,
  Sliders,
  Square,
  Zap,
} from "lucide-react";
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
  ConnectionMode,
  ControlMode,
  PIDParams,
  RunState,
} from "@/types/telemetry";

interface ControlPanelProps {
  hydrated: boolean;
  connected: boolean;
  connectionMode: ConnectionMode;
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
  onChangeDraftPid: (next: PIDParams, immediate?: boolean) => void;
  onApplyPid: () => void;
  onToggleAutoSendPid: (enabled: boolean) => void;
  onChangeSetpoint: (sp: number) => void;
  onTriggerStepTest: (targetSp: number) => void;
  onChangeManualPwm: (pwm: number) => void;
  onSwitchMode: (mode: ControlMode) => void;
  onCommand: (
    cmd: "START" | "STOP" | "ESTOP" | "RESET" | "SYNC" | "CLEARFAULT"
  ) => void;
  onApplyPpr: (ppr: number) => void;
  onUpdateAdvancedConfig: (patch: Partial<AdvancedControlConfig>) => void;
  onInjectDisturbance?: () => void;
  onInjectVoltageSag?: () => void;
  onInjectStallTest?: () => void;
}

interface PidPreset {
  name: string;
  kp: number;
  ki: number;
  kd: number;
}

// Dikalibrasi untuk motor lab PENS ~701 RPM @ PWM 255
const PID_PRESETS: PidPreset[] = [
  { name: "P", kp: 0.65, ki: 0.0, kd: 0.0 },
  { name: "PI", kp: 0.45, ki: 1.1, kd: 0.0 },
  { name: "PID", kp: 0.55, ki: 1.35, kd: 0.015 },
  { name: "Fast", kp: 1.1, ki: 2.5, kd: 0.03 },
];

const SP_QUICK_VALUES = [-350, 0, 200, 350, 650] as const;
const PWM_QUICK_VALUES = [-255, -128, 0, 128, 255] as const;
const RAMP_QUICK_VALUES = [0, 250, 500] as const;

export const ControlPanel = React.memo(function ControlPanel({
  hydrated,
  connected,
  connectionMode,
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
  onInjectDisturbance,
  onInjectVoltageSag,
  onInjectStallTest,
}: ControlPanelProps) {
  const [pprInput, setPprInput] = useState(() => String(pprValue));
  const [syncedPprProp, setSyncedPprProp] = useState(pprValue);
  const [advOpen, setAdvOpen] = useState(false);
  const [calibOpen, setCalibOpen] = useState(false);

  if (pprValue !== syncedPprProp) {
    setSyncedPprProp(pprValue);
    setPprInput(String(pprValue));
  }

  const spInputId = useId();
  const pwmInputId = useId();
  const kpInputId = useId();
  const kiInputId = useId();
  const kdInputId = useId();
  const liveSwitchId = useId();
  const ffSwitchId = useId();
  const kffInputId = useId();
  const dzInputId = useId();
  const vcompSwitchId = useId();
  const rampInputId = useId();
  const ilimInputId = useId();
  const pprInputId = useId();

  const pidDirty =
    Math.abs(draftPid.kp - activePid.kp) > 0.004 ||
    Math.abs(draftPid.ki - activePid.ki) > 0.004 ||
    Math.abs(draftPid.kd - activePid.kd) > 0.002;

  const isRunning = runState === 1;
  const isEstop = runState === 2;
  const isStall = runState === 3;
  const isDisabled = hydrated && !connected;

  const adjustPidField = (field: keyof PIDParams, delta: number, max: number) => {
    const raw = Math.max(
      0,
      Math.min(max, Number((draftPid[field] + delta).toFixed(3)))
    );
    onChangeDraftPid({ ...draftPid, [field]: raw }, true);
  };

  return (
    <aside
      aria-label="Panel kontrol motor dan tuning PID"
      className="panel-isolated flex w-full flex-col divide-y divide-border border-t border-border bg-card xl:w-[328px] xl:shrink-0 xl:overflow-y-auto xl:border-l xl:border-t-0"
    >
      {/* SECTION 1: KONTROL & MODE */}
      <div className="space-y-2 p-3.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold text-foreground">Kontrol</h2>
          {isEstop ? (
            <Badge
              variant="outline"
              className="rounded-sm border-[var(--accent-danger-border)] bg-[var(--accent-danger-bg)] px-1.5 py-0 font-mono text-[0.6875rem] font-semibold text-[var(--accent-danger-ink)]"
            >
              E-STOP terkunci
            </Badge>
          ) : isStall ? (
            <div className="flex items-center gap-1.5">
              <Badge
                variant="outline"
                className="rounded-sm border-[var(--accent-danger-border)] bg-[var(--accent-danger-bg)] px-1.5 py-0 font-mono text-[0.6875rem] font-semibold text-[var(--accent-danger-ink)]"
              >
                STALL FAULT
              </Badge>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => onCommand("CLEARFAULT")}
                className="h-5 rounded-sm px-1.5 text-[0.625rem]"
              >
                Clear
              </Button>
            </div>
          ) : null}
        </div>

        <div
          role="radiogroup"
          aria-label="Mode kendali motor"
          className="grid h-8 w-full grid-cols-2 rounded-sm border border-border bg-muted p-0.5"
        >
          <button
            type="button"
            role="radio"
            aria-checked={activeMode === 1}
            disabled={isDisabled}
            onClick={() => onSwitchMode(1)}
            className={cn(
              "inline-flex h-full items-center justify-center rounded-[3px] px-2 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
              activeMode === 1
                ? "bg-card font-semibold text-foreground shadow-2xs"
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
              "inline-flex h-full items-center justify-center rounded-[3px] px-2 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
              activeMode === 0
                ? "bg-card font-semibold text-foreground shadow-2xs"
                : "text-[var(--ink-secondary)] hover:text-foreground"
            )}
          >
            Open-Loop
          </button>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          <Button
            type="button"
            variant={isRunning ? "default" : "outline"}
            size="sm"
            disabled={isDisabled}
            aria-pressed={isRunning}
            onClick={() => onCommand("START")}
            className={cn(
              "h-8 gap-1.5 rounded-sm px-2 text-xs font-medium shadow-none",
              !isRunning &&
                "border-input bg-card text-foreground hover:border-[var(--border-strong)] dark:bg-card"
            )}
          >
            <Play aria-hidden="true" className="size-3.5 shrink-0" />
            <span>Start</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isDisabled}
            onClick={() => onCommand("STOP")}
            className="h-8 gap-1.5 rounded-sm border-input bg-card px-2 text-xs font-medium text-foreground shadow-none hover:border-[var(--border-strong)] dark:bg-card"
          >
            <Square aria-hidden="true" className="size-3.5 shrink-0" />
            <span>Stop</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isDisabled}
            onClick={() => onCommand("RESET")}
            title="Reset integral PID, encoder, dan timer"
            className="h-8 gap-1.5 rounded-sm border-input bg-card px-2 text-xs font-medium text-[var(--ink-secondary)] shadow-none hover:border-[var(--border-strong)] hover:text-foreground dark:bg-card"
          >
            <RotateCcw aria-hidden="true" className="size-3.5 shrink-0" />
            <span>Reset</span>
          </Button>
        </div>

        {connectionMode === "simulator" ? (
          <div className="grid grid-cols-3 gap-1">
            {onInjectDisturbance ? (
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={hydrated && (!connected || !isRunning)}
                onClick={onInjectDisturbance}
                title="Simulasikan beban torsi 2.5 detik"
                className="h-7 gap-1 rounded-sm border-input bg-[var(--bg-surface-alt)] px-1.5 text-[0.6875rem] text-[var(--ink-secondary)] shadow-none hover:border-[var(--border-strong)] hover:text-foreground dark:bg-[var(--bg-surface-alt)]"
              >
                <Zap aria-hidden="true" className="size-3 shrink-0" />
                <span>Beban</span>
              </Button>
            ) : null}
            {onInjectVoltageSag ? (
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={hydrated && (!connected || !isRunning)}
                onClick={onInjectVoltageSag}
                title="Simulasikan tegangan PSU drop -3V selama 3 detik (uji V-Comp)"
                className="h-7 rounded-sm border-input bg-[var(--bg-surface-alt)] px-1.5 text-[0.6875rem] text-[var(--ink-secondary)] shadow-none hover:border-[var(--border-strong)] hover:text-foreground dark:bg-[var(--bg-surface-alt)]"
              >
                Drop -3V
              </Button>
            ) : null}
            {onInjectStallTest ? (
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={hydrated && (!connected || !isRunning)}
                onClick={onInjectStallTest}
                title="Simulasikan rotor macet total (uji Soft Current Limit & Stall Guard)"
                className="h-7 gap-1 rounded-sm border-input bg-[var(--bg-surface-alt)] px-1.5 text-[0.6875rem] text-[var(--ink-secondary)] shadow-none hover:border-[var(--border-strong)] hover:text-foreground dark:bg-[var(--bg-surface-alt)]"
              >
                <ShieldAlert aria-hidden="true" className="size-3 shrink-0" />
                <span>Uji Stall</span>
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* SECTION 2: SETPOINT / MANUAL PWM (BIDIRECTIONAL ±700 RPM / ±255 PWM) */}
      <div className="p-3.5">
        {activeMode === 1 ? (
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label
                htmlFor={spInputId}
                className="text-xs font-semibold text-foreground"
              >
                Setpoint
              </label>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-xs"
                  disabled={isDisabled || draftSetpoint === 0}
                  onClick={() => onChangeSetpoint(-draftSetpoint)}
                  aria-label="Balik arah CW/CCW"
                  title="Balik arah putar CW ↔ CCW"
                  className="size-7 rounded-sm border-input bg-card text-[var(--ink-secondary)] shadow-none hover:border-[var(--border-strong)] hover:text-foreground dark:bg-card"
                >
                  <ArrowLeftRight aria-hidden="true" className="size-3" />
                </Button>
                <Input
                  id={spInputId}
                  name="setpoint_rpm"
                  type="number"
                  inputMode="numeric"
                  min={-750}
                  max={750}
                  step={10}
                  disabled={isDisabled}
                  value={draftSetpoint}
                  onChange={(e) => {
                    const v = Number.parseFloat(e.target.value);
                    if (Number.isFinite(v)) {
                      onChangeSetpoint(Math.max(-750, Math.min(750, v)));
                    }
                  }}
                  className="h-7 w-18 rounded-sm border-input bg-card px-2 py-0.5 text-right font-mono text-xs font-semibold tabular-nums text-[var(--accent-sp)] shadow-none focus-visible:border-[var(--accent-sp-bright)] md:text-xs dark:bg-card"
                />
                <span className="font-mono text-[0.6875rem] text-muted-foreground">
                  RPM
                </span>
              </div>
            </div>

            <Slider
              aria-label="Slider Setpoint Kecepatan Bidirectional (RPM)"
              aria-valuetext={`${draftSetpoint} RPM`}
              min={-700}
              max={700}
              step={10}
              disabled={isDisabled}
              value={[Math.max(-700, Math.min(700, draftSetpoint))]}
              onValueChange={([v]) => onChangeSetpoint(v)}
              className="my-2.5 [&_[data-slot=slider-range]]:bg-[var(--accent-sp-bright)] [&_[data-slot=slider-thumb]]:border-[var(--accent-sp-bright)]"
            />

            <div
              role="group"
              aria-label="Preset cepat Setpoint RPM"
              className="mt-1.5 grid grid-cols-5 gap-1"
            >
              {SP_QUICK_VALUES.map((spVal) => {
                const isActiveSp = Math.abs(activeSetpoint - spVal) < 2;
                return (
                  <Button
                    key={spVal}
                    type="button"
                    variant="outline"
                    size="xs"
                    aria-pressed={isActiveSp}
                    disabled={isDisabled}
                    onClick={() => onChangeSetpoint(spVal)}
                    className={cn(
                      "h-7 rounded-sm px-1 font-mono text-[0.6875rem] tabular-nums shadow-none",
                      isActiveSp
                        ? "border-[var(--accent-sp-bright)] bg-[var(--accent-sp-bg)] font-semibold text-[var(--accent-sp)] hover:bg-[var(--accent-sp-bg-hover)] hover:text-[var(--accent-sp)] dark:border-[var(--accent-sp-bright)] dark:bg-[var(--accent-sp-bg)]"
                        : "border-input bg-card text-[var(--ink-secondary)] hover:border-[var(--border-strong)] hover:text-foreground dark:bg-card"
                    )}
                  >
                    {spVal}
                  </Button>
                );
              })}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isDisabled}
              onClick={() =>
                onTriggerStepTest(draftSetpoint !== 0 ? draftSetpoint : 350)
              }
              title="Reset grafik lalu mulai uji respon step ke setpoint aktif"
              className="mt-2 h-8 w-full gap-1.5 rounded-sm border-input bg-card px-2.5 text-xs font-medium text-foreground shadow-none hover:border-[var(--border-strong)] dark:bg-card"
            >
              <Sliders
                aria-hidden="true"
                className="size-3.5 shrink-0 text-[var(--accent-sp)]"
              />
              <span>
                Step Test → {draftSetpoint !== 0 ? draftSetpoint : 350} RPM
              </span>
            </Button>
          </div>
        ) : (
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label
                htmlFor={pwmInputId}
                className="text-xs font-semibold text-foreground"
              >
                Manual PWM (±)
              </label>
              <div className="flex items-center gap-1.5">
                <Input
                  id={pwmInputId}
                  name="manual_pwm"
                  type="number"
                  inputMode="numeric"
                  min={-255}
                  max={255}
                  step={5}
                  disabled={isDisabled}
                  value={draftManualPwm}
                  onChange={(e) => {
                    const v = Number.parseInt(e.target.value, 10);
                    if (Number.isFinite(v)) {
                      onChangeManualPwm(Math.max(-255, Math.min(255, v)));
                    }
                  }}
                  className="h-7 w-18 rounded-sm border-input bg-card px-2 py-0.5 text-right font-mono text-xs font-semibold tabular-nums text-foreground shadow-none md:text-xs dark:bg-card"
                />
                <span className="font-mono text-[0.6875rem] text-muted-foreground">
                  {Math.round((draftManualPwm / 255) * 100)}%
                </span>
              </div>
            </div>

            <Slider
              aria-label="Slider Manual PWM Bidirectional"
              aria-valuetext={`${draftManualPwm} dari ±255 (${Math.round((draftManualPwm / 255) * 100)}%)`}
              min={-255}
              max={255}
              step={1}
              disabled={isDisabled}
              value={[draftManualPwm]}
              onValueChange={([v]) => onChangeManualPwm(v)}
              className="my-2.5 [&_[data-slot=slider-range]]:bg-[var(--accent-rpm)] [&_[data-slot=slider-thumb]]:border-[var(--accent-rpm)]"
            />

            <div
              role="group"
              aria-label="Preset cepat Duty Cycle PWM"
              className="mt-1.5 grid grid-cols-5 gap-1"
            >
              {PWM_QUICK_VALUES.map((p) => {
                const isActivePwm = Math.abs(draftManualPwm - p) <= 2;
                return (
                  <Button
                    key={p}
                    type="button"
                    variant="outline"
                    size="xs"
                    aria-pressed={isActivePwm}
                    disabled={isDisabled}
                    onClick={() => onChangeManualPwm(p)}
                    className={cn(
                      "h-7 rounded-sm px-0.5 font-mono text-[0.625rem] tabular-nums shadow-none",
                      isActivePwm
                        ? "border-[var(--border-strong)] bg-muted font-semibold text-foreground dark:border-[var(--border-strong)] dark:bg-muted"
                        : "border-input bg-card text-[var(--ink-secondary)] hover:border-[var(--border-strong)] hover:text-foreground dark:bg-card"
                    )}
                  >
                    {p > 0 ? `+${Math.round((p / 255) * 100)}%` : `${Math.round((p / 255) * 100)}%`}
                  </Button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* SECTION 3: PID GAINS */}
      <div className="p-3.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold text-foreground">PID Gains</h2>

          <div className="flex items-center gap-2 text-xs text-[var(--ink-secondary)]">
            <Switch
              id={liveSwitchId}
              size="sm"
              aria-label="Kirim PID otomatis secara live"
              checked={autoSendPid}
              onCheckedChange={onToggleAutoSendPid}
              className="data-[state=checked]:bg-[var(--accent-rpm)]"
            />
            <label
              htmlFor={liveSwitchId}
              className="cursor-pointer whitespace-nowrap select-none text-xs"
            >
              Live
            </label>
          </div>
        </div>

        <div className="space-y-2">
          {/* Kp */}
          <div>
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor={kpInputId}
                className="font-mono text-xs font-medium text-foreground"
              >
                Kp
              </label>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-xs"
                  aria-label="Kurangi Kp sebesar 0.05"
                  disabled={isDisabled}
                  onClick={() => adjustPidField("kp", -0.05, 10)}
                  className="size-7 rounded-sm border-input bg-card font-mono text-xs text-[var(--ink-secondary)] shadow-none hover:border-[var(--border-strong)] hover:text-foreground dark:bg-card"
                >
                  −
                </Button>
                <Input
                  id={kpInputId}
                  name="pid_kp"
                  type="number"
                  inputMode="decimal"
                  step={0.05}
                  min={0}
                  max={50}
                  disabled={isDisabled}
                  value={draftPid.kp}
                  onChange={(e) => {
                    const v = Number.parseFloat(e.target.value);
                    if (Number.isFinite(v)) {
                      onChangeDraftPid({ ...draftPid, kp: Math.max(0, v) });
                    }
                  }}
                  className="h-7 w-16 rounded-sm border-input bg-card px-1.5 text-right font-mono text-xs tabular-nums text-foreground shadow-none md:text-xs dark:bg-card"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon-xs"
                  aria-label="Tambah Kp sebesar 0.05"
                  disabled={isDisabled}
                  onClick={() => adjustPidField("kp", 0.05, 10)}
                  className="size-7 rounded-sm border-input bg-card font-mono text-xs text-[var(--ink-secondary)] shadow-none hover:border-[var(--border-strong)] hover:text-foreground dark:bg-card"
                >
                  +
                </Button>
              </div>
            </div>
            <Slider
              aria-label="Slider Kp Proportional"
              aria-valuetext={`Kp ${draftPid.kp.toFixed(2)}`}
              min={0}
              max={4}
              step={0.05}
              disabled={isDisabled}
              value={[Math.min(4, draftPid.kp)]}
              onValueChange={([v]) =>
                onChangeDraftPid({ ...draftPid, kp: v })
              }
              className="mt-1.5 [&_[data-slot=slider-range]]:bg-[var(--accent-rpm)] [&_[data-slot=slider-thumb]]:border-[var(--accent-rpm)]"
            />
          </div>

          {/* Ki */}
          <div>
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor={kiInputId}
                className="font-mono text-xs font-medium text-foreground"
              >
                Ki
              </label>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-xs"
                  aria-label="Kurangi Ki sebesar 0.05"
                  disabled={isDisabled}
                  onClick={() => adjustPidField("ki", -0.05, 15)}
                  className="size-7 rounded-sm border-input bg-card font-mono text-xs text-[var(--ink-secondary)] shadow-none hover:border-[var(--border-strong)] hover:text-foreground dark:bg-card"
                >
                  −
                </Button>
                <Input
                  id={kiInputId}
                  name="pid_ki"
                  type="number"
                  inputMode="decimal"
                  step={0.05}
                  min={0}
                  max={50}
                  disabled={isDisabled}
                  value={draftPid.ki}
                  onChange={(e) => {
                    const v = Number.parseFloat(e.target.value);
                    if (Number.isFinite(v)) {
                      onChangeDraftPid({ ...draftPid, ki: Math.max(0, v) });
                    }
                  }}
                  className="h-7 w-16 rounded-sm border-input bg-card px-1.5 text-right font-mono text-xs tabular-nums text-foreground shadow-none md:text-xs dark:bg-card"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon-xs"
                  aria-label="Tambah Ki sebesar 0.05"
                  disabled={isDisabled}
                  onClick={() => adjustPidField("ki", 0.05, 15)}
                  className="size-7 rounded-sm border-input bg-card font-mono text-xs text-[var(--ink-secondary)] shadow-none hover:border-[var(--border-strong)] hover:text-foreground dark:bg-card"
                >
                  +
                </Button>
              </div>
            </div>
            <Slider
              aria-label="Slider Ki Integral"
              aria-valuetext={`Ki ${draftPid.ki.toFixed(2)}`}
              min={0}
              max={6}
              step={0.05}
              disabled={isDisabled}
              value={[Math.min(6, draftPid.ki)]}
              onValueChange={([v]) =>
                onChangeDraftPid({ ...draftPid, ki: v })
              }
              className="mt-1.5 [&_[data-slot=slider-range]]:bg-[var(--accent-rpm)] [&_[data-slot=slider-thumb]]:border-[var(--accent-rpm)]"
            />
          </div>

          {/* Kd */}
          <div>
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor={kdInputId}
                className="font-mono text-xs font-medium text-foreground"
              >
                Kd
              </label>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-xs"
                  aria-label="Kurangi Kd sebesar 0.005"
                  disabled={isDisabled}
                  onClick={() => adjustPidField("kd", -0.005, 5)}
                  className="size-7 rounded-sm border-input bg-card font-mono text-xs text-[var(--ink-secondary)] shadow-none hover:border-[var(--border-strong)] hover:text-foreground dark:bg-card"
                >
                  −
                </Button>
                <Input
                  id={kdInputId}
                  name="pid_kd"
                  type="number"
                  inputMode="decimal"
                  step={0.005}
                  min={0}
                  max={20}
                  disabled={isDisabled}
                  value={draftPid.kd}
                  onChange={(e) => {
                    const v = Number.parseFloat(e.target.value);
                    if (Number.isFinite(v)) {
                      onChangeDraftPid({ ...draftPid, kd: Math.max(0, v) });
                    }
                  }}
                  className="h-7 w-16 rounded-sm border-input bg-card px-1.5 text-right font-mono text-xs tabular-nums text-foreground shadow-none md:text-xs dark:bg-card"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon-xs"
                  aria-label="Tambah Kd sebesar 0.005"
                  disabled={isDisabled}
                  onClick={() => adjustPidField("kd", 0.005, 5)}
                  className="size-7 rounded-sm border-input bg-card font-mono text-xs text-[var(--ink-secondary)] shadow-none hover:border-[var(--border-strong)] hover:text-foreground dark:bg-card"
                >
                  +
                </Button>
              </div>
            </div>
            <Slider
              aria-label="Slider Kd Derivative"
              aria-valuetext={`Kd ${draftPid.kd.toFixed(3)}`}
              min={0}
              max={0.25}
              step={0.005}
              disabled={isDisabled}
              value={[Math.min(0.25, draftPid.kd)]}
              onValueChange={([v]) =>
                onChangeDraftPid({ ...draftPid, kd: v })
              }
              className="mt-1.5 [&_[data-slot=slider-range]]:bg-[var(--accent-rpm)] [&_[data-slot=slider-thumb]]:border-[var(--accent-rpm)]"
            />
          </div>
        </div>

        <Button
          type="button"
          variant={pidDirty ? "default" : "outline"}
          size="sm"
          disabled={isDisabled}
          onClick={onApplyPid}
          className={cn(
            "mt-2.5 h-8 w-full gap-1.5 rounded-sm px-2.5 text-xs font-medium shadow-none",
            pidDirty
              ? "border-[#1d4ed8] bg-[#1d4ed8] text-white hover:bg-[#1e40af]"
              : "border-border bg-[var(--bg-surface-alt)] text-[var(--ink-secondary)] hover:border-input hover:text-foreground dark:bg-[var(--bg-surface-alt)]"
          )}
        >
          <Send aria-hidden="true" className="size-3.5 shrink-0" />
          <span>{pidDirty ? "Kirim PID ke Modul" : "PID Tersinkron"}</span>
        </Button>

        <div
          role="group"
          aria-label="Preset PID"
          className="mt-2 grid grid-cols-4 gap-1"
        >
          {PID_PRESETS.map((p) => {
            const isActivePreset =
              Math.abs(activePid.kp - p.kp) < 0.01 &&
              Math.abs(activePid.ki - p.ki) < 0.01 &&
              Math.abs(activePid.kd - p.kd) < 0.003;
            return (
              <Button
                key={p.name}
                type="button"
                variant="outline"
                size="xs"
                aria-pressed={isActivePreset}
                disabled={isDisabled}
                onClick={() =>
                  onChangeDraftPid({ kp: p.kp, ki: p.ki, kd: p.kd }, true)
                }
                title={`Kp=${p.kp}, Ki=${p.ki}, Kd=${p.kd}`}
                className={cn(
                  "h-7 rounded-sm px-1.5 font-mono text-xs shadow-none",
                  isActivePreset
                    ? "border-[var(--accent-rpm)] bg-[var(--accent-rpm-bg)] font-semibold text-[var(--accent-rpm)] hover:bg-[var(--accent-rpm-bg)] hover:text-[var(--accent-rpm)] dark:border-[var(--accent-rpm)] dark:bg-[var(--accent-rpm-bg)]"
                    : "border-input bg-card text-[var(--ink-secondary)] hover:border-[var(--border-strong)] hover:text-foreground dark:bg-card"
                )}
              >
                {p.name}
              </Button>
            );
          })}
        </div>
      </div>

      {/* SECTION 4: 2-DOF FEEDFORWARD, V-COMP, RAMP & CURRENT LIMIT */}
      <Collapsible open={advOpen} onOpenChange={setAdvOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-h-9 w-full items-center justify-between gap-1.5 px-3.5 py-2 text-xs font-medium text-[var(--ink-secondary)] transition-colors hover:bg-[var(--bg-surface-alt)] hover:text-foreground"
          >
            <span className="flex items-center gap-1.5">
              <ChevronRight
                aria-hidden="true"
                className={cn(
                  "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
                  advOpen && "rotate-90"
                )}
              />
              <span>2-DOF &amp; Proteksi</span>
            </span>
            <span className="flex items-center gap-1 font-mono text-[0.625rem]">
              {advancedConfig.ffEnabled ? (
                <span className="text-[var(--accent-rpm)]">FF</span>
              ) : null}
              {advancedConfig.vcompEnabled ? (
                <span className="text-[var(--accent-ok)]">VC</span>
              ) : null}
              {advancedConfig.rampRate > 0 ? (
                <span className="text-[var(--accent-sp)]">RMP</span>
              ) : null}
            </span>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent className="space-y-2.5 border-t border-border px-3.5 py-2.5">
          {/* Feedforward 2-DOF */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor={ffSwitchId}
                className="cursor-pointer select-none text-xs font-medium text-foreground"
              >
                Feedforward (2-DOF)
              </label>
              <Switch
                id={ffSwitchId}
                size="sm"
                aria-label="Aktifkan Feedforward 2-DOF"
                disabled={isDisabled}
                checked={advancedConfig.ffEnabled}
                onCheckedChange={(checked) =>
                  onUpdateAdvancedConfig({ ffEnabled: checked })
                }
                className="data-[state=checked]:bg-[var(--accent-rpm)]"
              />
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <div className="flex items-center gap-1">
                <label
                  htmlFor={kffInputId}
                  className="shrink-0 font-mono text-[0.6875rem] text-muted-foreground"
                >
                  Kff
                </label>
                <Input
                  id={kffInputId}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={5}
                  step={0.01}
                  disabled={isDisabled}
                  value={advancedConfig.kff}
                  onChange={(e) => {
                    const v = Number.parseFloat(e.target.value);
                    if (Number.isFinite(v)) {
                      onUpdateAdvancedConfig({ kff: Math.max(0, Math.min(5, v)) });
                    }
                  }}
                  className="h-7 w-full rounded-sm border-input bg-card px-1.5 text-right font-mono text-xs tabular-nums shadow-none md:text-xs dark:bg-card"
                />
              </div>
              <div className="flex items-center gap-1">
                <label
                  htmlFor={dzInputId}
                  className="shrink-0 font-mono text-[0.6875rem] text-muted-foreground"
                >
                  DZ
                </label>
                <Input
                  id={dzInputId}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={60}
                  step={1}
                  disabled={isDisabled}
                  value={advancedConfig.deadzonePwm}
                  onChange={(e) => {
                    const v = Number.parseFloat(e.target.value);
                    if (Number.isFinite(v)) {
                      onUpdateAdvancedConfig({
                        deadzonePwm: Math.max(0, Math.min(60, v)),
                      });
                    }
                  }}
                  className="h-7 w-full rounded-sm border-input bg-card px-1.5 text-right font-mono text-xs tabular-nums shadow-none md:text-xs dark:bg-card"
                />
              </div>
            </div>
          </div>

          {/* Voltage Compensation */}
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor={vcompSwitchId}
              className="cursor-pointer select-none text-xs font-medium text-foreground"
            >
              Kompensasi 24V (A10)
            </label>
            <Switch
              id={vcompSwitchId}
              size="sm"
              aria-label="Aktifkan kompensasi tegangan supply 24V"
              disabled={isDisabled}
              checked={advancedConfig.vcompEnabled}
              onCheckedChange={(checked) =>
                onUpdateAdvancedConfig({ vcompEnabled: checked })
              }
              className="data-[state=checked]:bg-[var(--accent-ok)]"
            />
          </div>

          {/* Trapezoidal Ramp */}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor={rampInputId}
                className="text-xs font-medium text-foreground"
              >
                Ramp (RPM/s)
              </label>
              <Input
                id={rampInputId}
                type="number"
                inputMode="numeric"
                min={0}
                max={3000}
                step={50}
                disabled={isDisabled}
                value={advancedConfig.rampRate}
                onChange={(e) => {
                  const v = Number.parseFloat(e.target.value);
                  if (Number.isFinite(v)) {
                    onUpdateAdvancedConfig({
                      rampRate: Math.max(0, Math.min(3000, v)),
                    });
                  }
                }}
                className="h-7 w-20 rounded-sm border-input bg-card px-1.5 text-right font-mono text-xs tabular-nums shadow-none md:text-xs dark:bg-card"
              />
            </div>
            <div className="grid grid-cols-3 gap-1">
              {RAMP_QUICK_VALUES.map((r) => (
                <Button
                  key={r}
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={isDisabled}
                  onClick={() => onUpdateAdvancedConfig({ rampRate: r })}
                  className={cn(
                    "h-6 rounded-sm font-mono text-[0.6875rem] shadow-none",
                    advancedConfig.rampRate === r
                      ? "border-[var(--accent-sp-bright)] bg-[var(--accent-sp-bg)] text-[var(--accent-sp)]"
                      : "border-input bg-card text-muted-foreground dark:bg-card"
                  )}
                >
                  {r === 0 ? "Step" : `${r}/s`}
                </Button>
              ))}
            </div>
          </div>

          {/* Current Limit ACS712 */}
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor={ilimInputId}
              className="text-xs font-medium text-foreground"
            >
              Limit Arus (A)
            </label>
            <Input
              id={ilimInputId}
              type="number"
              inputMode="decimal"
              min={0}
              max={5}
              step={0.25}
              disabled={isDisabled}
              value={advancedConfig.currentLimitAmp}
              onChange={(e) => {
                const v = Number.parseFloat(e.target.value);
                if (Number.isFinite(v)) {
                  onUpdateAdvancedConfig({
                    currentLimitAmp: Math.max(0, Math.min(5, v)),
                  });
                }
              }}
              className="h-7 w-20 rounded-sm border-input bg-card px-1.5 text-right font-mono text-xs tabular-nums shadow-none md:text-xs dark:bg-card"
            />
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* SECTION 5: KALIBRASI (shadcn Collapsible) */}
      <Collapsible open={calibOpen} onOpenChange={setCalibOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-h-9 w-full items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[var(--ink-secondary)] transition-colors hover:bg-[var(--bg-surface-alt)] hover:text-foreground"
          >
            <ChevronRight
              aria-hidden="true"
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
                calibOpen && "rotate-90"
              )}
            />
            <span>Kalibrasi &amp; Sync</span>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent className="border-t border-border px-3.5 py-2.5">
          <div className="flex items-center gap-1.5">
            <label
              htmlFor={pprInputId}
              className="shrink-0 font-mono text-xs text-[var(--ink-secondary)]"
            >
              PPR
            </label>
            <Input
              id={pprInputId}
              name="encoder_ppr"
              type="number"
              inputMode="decimal"
              min={1}
              max={20000}
              step={1}
              value={pprInput}
              onChange={(e) => setPprInput(e.target.value)}
              className="h-8 w-full rounded-sm border-input bg-card px-2 font-mono text-xs tabular-nums text-foreground shadow-none md:text-xs dark:bg-card"
            />
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={isDisabled}
              onClick={() => {
                const v = Number.parseFloat(pprInput);
                if (Number.isFinite(v) && v >= 1) onApplyPpr(v);
              }}
              className="h-8 shrink-0 rounded-sm px-2.5 text-xs font-medium shadow-none"
            >
              Set
            </Button>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isDisabled}
            onClick={() => onCommand("SYNC")}
            className="mt-2 h-8 w-full gap-1.5 rounded-sm border-input bg-card px-2.5 text-xs font-medium text-[var(--ink-secondary)] shadow-none hover:border-[var(--border-strong)] hover:text-foreground dark:bg-card"
          >
            <RefreshCw aria-hidden="true" className="size-3.5 shrink-0" />
            <span>Sinkronisasi (CMD:SYNC)</span>
          </Button>
        </CollapsibleContent>
      </Collapsible>
    </aside>
  );
});
