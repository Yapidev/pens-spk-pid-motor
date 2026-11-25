"use client";

import React, { useId, useState } from "react";
import {
  ChevronRight,
  OctagonAlert,
  Play,
  RefreshCw,
  RotateCcw,
  Send,
  Sliders,
  Square,
  Zap,
} from "lucide-react";
import type {
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
  onChangeDraftPid: (next: PIDParams, immediate?: boolean) => void;
  onApplyPid: () => void;
  onToggleAutoSendPid: (enabled: boolean) => void;
  onChangeSetpoint: (sp: number) => void;
  onTriggerStepTest: (targetSp: number) => void;
  onChangeManualPwm: (pwm: number) => void;
  onSwitchMode: (mode: ControlMode) => void;
  onCommand: (cmd: "START" | "STOP" | "ESTOP" | "RESET" | "SYNC") => void;
  onApplyPpr: (ppr: number) => void;
  onInjectDisturbance?: () => void;
}

interface PidPreset {
  name: string;
  desc: string;
  kp: number;
  ki: number;
  kd: number;
}

const PID_PRESETS: PidPreset[] = [
  { name: "P-Only", desc: "Demo Ess", kp: 1.4, ki: 0.0, kd: 0.0 },
  { name: "PI Smooth", desc: "Redam OS", kp: 0.9, ki: 0.65, kd: 0.0 },
  { name: "PID Balanced", desc: "Default Lab", kp: 1.2, ki: 0.85, kd: 0.05 },
  { name: "PID Fast", desc: "Cepat + OS", kp: 2.4, ki: 2.2, kd: 0.12 },
];

const SP_QUICK_VALUES = [0, 60, 120, 180, 240] as const;
const PWM_QUICK_VALUES = [0, 64, 128, 192, 255] as const;

function sliderFillStyle(value: number, max: number): React.CSSProperties {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return { "--slider-pct": `${pct.toFixed(1)}%` } as React.CSSProperties;
}

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
  onChangeDraftPid,
  onApplyPid,
  onToggleAutoSendPid,
  onChangeSetpoint,
  onTriggerStepTest,
  onChangeManualPwm,
  onSwitchMode,
  onCommand,
  onApplyPpr,
  onInjectDisturbance,
}: ControlPanelProps) {
  const [pprInput, setPprInput] = useState(() => String(pprValue));
  const [syncedPprProp, setSyncedPprProp] = useState(pprValue);

  if (pprValue !== syncedPprProp) {
    setSyncedPprProp(pprValue);
    setPprInput(String(pprValue));
  }

  const spInputId = useId();
  const pwmInputId = useId();
  const kpInputId = useId();
  const kiInputId = useId();
  const kdInputId = useId();
  const liveCheckboxId = useId();
  const pprInputId = useId();

  const pidDirty =
    Math.abs(draftPid.kp - activePid.kp) > 0.004 ||
    Math.abs(draftPid.ki - activePid.ki) > 0.004 ||
    Math.abs(draftPid.kd - activePid.kd) > 0.004;

  const isRunning = runState === 1;
  const isEstop = runState === 2;
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
      aria-label="Panel Kontrol dan Tuning PID"
      className="panel-isolated flex flex-col divide-y divide-[var(--border-hairline)] border border-[var(--border-hairline)] bg-[var(--bg-surface)]"
    >
      {/* SECTION 1: EXECUTION & SAFETY */}
      <div className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-[var(--ink-primary)]">
            MOTOR EXECUTION &amp; SAFETY
          </h2>
          <span className="font-mono text-[0.6875rem] text-[var(--ink-muted)]">WRITE → MC</span>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          <button
            type="button"
            disabled={isDisabled}
            aria-pressed={isRunning}
            onClick={() => onCommand("START")}
            className={`flex min-h-10 items-center justify-center gap-1.5 border px-2 py-2 font-mono text-xs font-semibold transition-colors disabled:opacity-45 ${
              isRunning
                ? "border-[#047857] bg-[#047857] text-white"
                : "border-[var(--btn-primary-bg)] bg-[var(--btn-primary-bg)] text-[var(--btn-primary-ink)] hover:bg-[var(--btn-primary-hover)]"
            }`}
          >
            <Play aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            <span>START</span>
          </button>

          <button
            type="button"
            disabled={isDisabled}
            onClick={() => onCommand("STOP")}
            className="flex min-h-10 items-center justify-center gap-1.5 border border-[var(--border-control)] bg-[var(--bg-surface)] px-2 py-2 font-mono text-xs font-semibold text-[var(--ink-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] disabled:opacity-45"
          >
            <Square aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            <span>STOP</span>
          </button>

          <button
            type="button"
            disabled={isDisabled}
            onClick={() => onCommand("RESET")}
            className="flex min-h-10 items-center justify-center gap-1.5 border border-[var(--border-control)] bg-[var(--bg-surface)] px-2 py-2 font-mono text-xs font-semibold text-[var(--ink-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--ink-primary)] disabled:opacity-45"
            title="Reset integral PID, encoder, dan timer"
          >
            <RotateCcw aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            <span>RESET</span>
          </button>
        </div>

        {/* Emergency Stop Button */}
        <button
          type="button"
          disabled={isDisabled}
          onClick={() => onCommand("ESTOP")}
          className={`mt-2 flex min-h-11 w-full items-center justify-center gap-2 border-2 px-3 py-2 font-mono text-xs font-bold tracking-wider transition-colors disabled:opacity-45 ${
            isEstop
              ? "border-[#991b1b] bg-[#991b1b] text-white"
              : "border-[#dc2626] bg-[#dc2626] text-white hover:bg-[#b91c1c]"
          }`}
        >
          <OctagonAlert aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span>
            {isEstop
              ? "E-STOP LATCHED — KLIK START UNTUK LANJUT"
              : "EMERGENCY STOP (ESC)"}
          </span>
        </button>

        {/* Simulator-Only Load Disturbance Test */}
        {connectionMode === "simulator" && onInjectDisturbance ? (
          <button
            type="button"
            disabled={hydrated && (!connected || !isRunning)}
            onClick={onInjectDisturbance}
            className="mt-2 flex min-h-9 w-full items-center justify-center gap-1.5 border border-[var(--accent-warn-border)] bg-[var(--accent-warn-bg)] px-3 py-1.5 font-mono text-xs font-medium text-[var(--accent-warn)] transition-colors hover:bg-[var(--accent-warn-bg-hover)] disabled:opacity-45"
            title="Simulasikan beban mekanis sesaat (2.5s) untuk menguji disturbance rejection PID"
          >
            <Zap aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            <span>Simulasi Gangguan Beban (+Torsi 2.5s)</span>
          </button>
        ) : null}
      </div>

      {/* SECTION 2: CONTROL MODE & SETPOINT / MANUAL PWM */}
      <div className="p-4">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <h2 className="text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-[var(--ink-primary)]">
            CONTROL MODE
          </h2>
          <span className="font-mono text-[0.6875rem] text-[var(--ink-muted)]">
            {activeMode === 1 ? "CLOSED-LOOP" : "OPEN-LOOP"}
          </span>
        </div>

        <div
          role="group"
          aria-label="Mode kendali motor"
          className="grid grid-cols-2 border border-[var(--border-control)] bg-[var(--bg-subtle)] p-0.5 text-xs font-medium"
        >
          <button
            type="button"
            aria-pressed={activeMode === 1}
            disabled={isDisabled}
            onClick={() => onSwitchMode(1)}
            className={`min-h-9 px-2 py-1.5 transition-colors disabled:opacity-50 ${
              activeMode === 1
                ? "bg-[var(--btn-primary-bg)] font-semibold text-[var(--btn-primary-ink)]"
                : "text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
            }`}
          >
            Closed-Loop PID
          </button>
          <button
            type="button"
            aria-pressed={activeMode === 0}
            disabled={isDisabled}
            onClick={() => onSwitchMode(0)}
            className={`min-h-9 px-2 py-1.5 transition-colors disabled:opacity-50 ${
              activeMode === 0
                ? "bg-[var(--btn-primary-bg)] font-semibold text-[var(--btn-primary-ink)]"
                : "text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
            }`}
          >
            Open-Loop PWM
          </button>
        </div>

        {activeMode === 1 ? (
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label
                htmlFor={spInputId}
                className="text-xs font-semibold text-[var(--ink-primary)]"
              >
                Setpoint Kecepatan (SP)
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  id={spInputId}
                  name="setpoint_rpm"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={500}
                  step={5}
                  disabled={isDisabled}
                  value={draftSetpoint}
                  onChange={(e) => {
                    const v = Number.parseFloat(e.target.value);
                    if (Number.isFinite(v)) {
                      onChangeSetpoint(Math.max(0, Math.min(500, v)));
                    }
                  }}
                  className="min-h-8 w-20 border border-[var(--border-control)] bg-[var(--bg-surface)] px-2 py-1 text-right font-mono text-sm font-semibold tabular-nums text-[var(--accent-sp)] focus:border-[var(--accent-sp-bright)]"
                />
                <span className="font-mono text-xs text-[var(--ink-muted)]">RPM</span>
              </div>
            </div>

            <input
              type="range"
              aria-label="Slider Setpoint Kecepatan (RPM)"
              aria-valuetext={`${draftSetpoint} RPM`}
              min={0}
              max={320}
              step={5}
              disabled={isDisabled}
              value={Math.min(320, draftSetpoint)}
              style={sliderFillStyle(Math.min(320, draftSetpoint), 320)}
              onChange={(e) => onChangeSetpoint(Number(e.target.value))}
              className="swiss-slider swiss-slider-orange my-1"
            />

            {/* Quick SP Step Presets */}
            <div
              role="group"
              aria-label="Preset cepat Setpoint RPM"
              className="mt-2 grid grid-cols-5 gap-1"
            >
              {SP_QUICK_VALUES.map((spVal) => {
                const isActiveSp = Math.abs(activeSetpoint - spVal) < 1;
                return (
                  <button
                    key={spVal}
                    type="button"
                    aria-pressed={isActiveSp}
                    disabled={isDisabled}
                    onClick={() => onChangeSetpoint(spVal)}
                    className={`min-h-8 border py-1 font-mono text-xs tabular-nums transition-colors disabled:opacity-45 ${
                      isActiveSp
                        ? "border-[var(--accent-sp-bright)] bg-[var(--accent-sp-bg)] font-semibold text-[var(--accent-sp)]"
                        : "border-[var(--border-control)] bg-[var(--bg-surface)] text-[var(--ink-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--ink-primary)]"
                    }`}
                  >
                    {spVal}
                  </button>
                );
              })}
            </div>

            {/* Dedicated Step Test Trigger */}
            <button
              type="button"
              disabled={isDisabled}
              onClick={() => onTriggerStepTest(draftSetpoint > 0 ? draftSetpoint : 150)}
              className="mt-2.5 flex min-h-9 w-full items-center justify-center gap-1.5 border border-[var(--accent-sp-bright)] bg-[var(--accent-sp-bg)] px-3 py-1.5 font-mono text-xs font-semibold text-[var(--accent-sp)] transition-colors hover:bg-[var(--accent-sp-bg-hover)] disabled:opacity-45"
              title="Mulai pengujian respon step baru ke nilai Setpoint aktif"
            >
              <Sliders aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              <span>
                Trigger Step Test (→ {draftSetpoint > 0 ? draftSetpoint : 150} RPM)
              </span>
            </button>
          </div>
        ) : (
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label
                htmlFor={pwmInputId}
                className="text-xs font-semibold text-[var(--ink-primary)]"
              >
                Manual PWM Output
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  id={pwmInputId}
                  name="manual_pwm"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={255}
                  step={5}
                  disabled={isDisabled}
                  value={draftManualPwm}
                  onChange={(e) => {
                    const v = Number.parseInt(e.target.value, 10);
                    if (Number.isFinite(v)) {
                      onChangeManualPwm(Math.max(0, Math.min(255, v)));
                    }
                  }}
                  className="min-h-8 w-20 border border-[var(--border-control)] bg-[var(--bg-surface)] px-2 py-1 text-right font-mono text-sm font-semibold tabular-nums text-[var(--ink-primary)] focus:border-[var(--border-strong)]"
                />
                <span className="font-mono text-xs text-[var(--ink-muted)]">
                  ({Math.round((draftManualPwm / 255) * 100)}%)
                </span>
              </div>
            </div>

            <input
              type="range"
              aria-label="Slider Manual PWM Output"
              aria-valuetext={`${draftManualPwm} dari 255 (${Math.round((draftManualPwm / 255) * 100)}%)`}
              min={0}
              max={255}
              step={1}
              disabled={isDisabled}
              value={draftManualPwm}
              style={sliderFillStyle(draftManualPwm, 255)}
              onChange={(e) => onChangeManualPwm(Number(e.target.value))}
              className="swiss-slider my-1"
            />

            <div
              role="group"
              aria-label="Preset cepat Duty Cycle PWM"
              className="mt-2 grid grid-cols-5 gap-1"
            >
              {PWM_QUICK_VALUES.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={Math.abs(draftManualPwm - p) <= 2}
                  disabled={isDisabled}
                  onClick={() => onChangeManualPwm(p)}
                  className={`min-h-8 border py-1 font-mono text-xs tabular-nums transition-colors disabled:opacity-45 ${
                    Math.abs(draftManualPwm - p) <= 2
                      ? "border-[var(--border-strong)] bg-[var(--bg-subtle)] font-semibold text-[var(--ink-primary)]"
                      : "border-[var(--border-control)] bg-[var(--bg-surface)] text-[var(--ink-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--ink-primary)]"
                  }`}
                >
                  {Math.round((p / 255) * 100)}%
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* SECTION 3: PID GAIN TUNING */}
      <div className="p-4">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h2 className="text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-[var(--ink-primary)]">
              PID PARAMETER TUNING
            </h2>
            <div className="mt-0.5 font-mono text-[0.6875rem] tabular-nums text-[var(--ink-muted)]">
              MC: Kp={activePid.kp.toFixed(2)} · Ki={activePid.ki.toFixed(2)} · Kd=
              {activePid.kd.toFixed(2)}
            </div>
          </div>

          <div className="flex items-center gap-1.5 pt-0.5 text-xs text-[var(--ink-secondary)]">
            <input
              id={liveCheckboxId}
              type="checkbox"
              checked={autoSendPid}
              onChange={(e) => onToggleAutoSendPid(e.target.checked)}
              className="h-4 w-4 cursor-pointer accent-[var(--accent-rpm)]"
            />
            <label htmlFor={liveCheckboxId} className="cursor-pointer select-none font-medium">
              Live
            </label>
          </div>
        </div>

        <div className="space-y-3">
          {/* Kp */}
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label
                htmlFor={kpInputId}
                className="font-mono text-xs font-semibold text-[var(--ink-primary)]"
              >
                Kp{" "}
                <span className="font-sans text-[0.6875rem] font-normal text-[var(--ink-muted)]">
                  (Proportional)
                </span>
              </label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Kurangi Kp sebesar 0.05"
                  disabled={isDisabled}
                  onClick={() => adjustPidField("kp", -0.05, 10)}
                  className="min-h-8 min-w-8 border border-[var(--border-control)] bg-[var(--bg-surface)] font-mono text-sm text-[var(--ink-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--ink-primary)] disabled:opacity-45"
                >
                  −
                </button>
                <input
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
                  className="min-h-8 w-16 border border-[var(--border-control)] bg-[var(--bg-surface)] px-1.5 text-right font-mono text-xs tabular-nums text-[var(--ink-primary)] focus:border-[var(--border-strong)]"
                />
                <button
                  type="button"
                  aria-label="Tambah Kp sebesar 0.05"
                  disabled={isDisabled}
                  onClick={() => adjustPidField("kp", 0.05, 10)}
                  className="min-h-8 min-w-8 border border-[var(--border-control)] bg-[var(--bg-surface)] font-mono text-sm text-[var(--ink-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--ink-primary)] disabled:opacity-45"
                >
                  +
                </button>
              </div>
            </div>
            <input
              type="range"
              aria-label="Slider Kp Proportional"
              aria-valuetext={`Kp ${draftPid.kp.toFixed(2)}`}
              min={0}
              max={6}
              step={0.05}
              disabled={isDisabled}
              value={Math.min(6, draftPid.kp)}
              style={sliderFillStyle(Math.min(6, draftPid.kp), 6)}
              onChange={(e) =>
                onChangeDraftPid({ ...draftPid, kp: Number(e.target.value) })
              }
              className="swiss-slider"
            />
          </div>

          {/* Ki */}
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label
                htmlFor={kiInputId}
                className="font-mono text-xs font-semibold text-[var(--ink-primary)]"
              >
                Ki{" "}
                <span className="font-sans text-[0.6875rem] font-normal text-[var(--ink-muted)]">
                  (Integral)
                </span>
              </label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Kurangi Ki sebesar 0.05"
                  disabled={isDisabled}
                  onClick={() => adjustPidField("ki", -0.05, 10)}
                  className="min-h-8 min-w-8 border border-[var(--border-control)] bg-[var(--bg-surface)] font-mono text-sm text-[var(--ink-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--ink-primary)] disabled:opacity-45"
                >
                  −
                </button>
                <input
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
                  className="min-h-8 w-16 border border-[var(--border-control)] bg-[var(--bg-surface)] px-1.5 text-right font-mono text-xs tabular-nums text-[var(--ink-primary)] focus:border-[var(--border-strong)]"
                />
                <button
                  type="button"
                  aria-label="Tambah Ki sebesar 0.05"
                  disabled={isDisabled}
                  onClick={() => adjustPidField("ki", 0.05, 10)}
                  className="min-h-8 min-w-8 border border-[var(--border-control)] bg-[var(--bg-surface)] font-mono text-sm text-[var(--ink-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--ink-primary)] disabled:opacity-45"
                >
                  +
                </button>
              </div>
            </div>
            <input
              type="range"
              aria-label="Slider Ki Integral"
              aria-valuetext={`Ki ${draftPid.ki.toFixed(2)}`}
              min={0}
              max={6}
              step={0.05}
              disabled={isDisabled}
              value={Math.min(6, draftPid.ki)}
              style={sliderFillStyle(Math.min(6, draftPid.ki), 6)}
              onChange={(e) =>
                onChangeDraftPid({ ...draftPid, ki: Number(e.target.value) })
              }
              className="swiss-slider"
            />
          </div>

          {/* Kd */}
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label
                htmlFor={kdInputId}
                className="font-mono text-xs font-semibold text-[var(--ink-primary)]"
              >
                Kd{" "}
                <span className="font-sans text-[0.6875rem] font-normal text-[var(--ink-muted)]">
                  (Derivative)
                </span>
              </label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Kurangi Kd sebesar 0.01"
                  disabled={isDisabled}
                  onClick={() => adjustPidField("kd", -0.01, 5)}
                  className="min-h-8 min-w-8 border border-[var(--border-control)] bg-[var(--bg-surface)] font-mono text-sm text-[var(--ink-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--ink-primary)] disabled:opacity-45"
                >
                  −
                </button>
                <input
                  id={kdInputId}
                  name="pid_kd"
                  type="number"
                  inputMode="decimal"
                  step={0.01}
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
                  className="min-h-8 w-16 border border-[var(--border-control)] bg-[var(--bg-surface)] px-1.5 text-right font-mono text-xs tabular-nums text-[var(--ink-primary)] focus:border-[var(--border-strong)]"
                />
                <button
                  type="button"
                  aria-label="Tambah Kd sebesar 0.01"
                  disabled={isDisabled}
                  onClick={() => adjustPidField("kd", 0.01, 5)}
                  className="min-h-8 min-w-8 border border-[var(--border-control)] bg-[var(--bg-surface)] font-mono text-sm text-[var(--ink-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--ink-primary)] disabled:opacity-45"
                >
                  +
                </button>
              </div>
            </div>
            <input
              type="range"
              aria-label="Slider Kd Derivative"
              aria-valuetext={`Kd ${draftPid.kd.toFixed(2)}`}
              min={0}
              max={1}
              step={0.01}
              disabled={isDisabled}
              value={Math.min(1, draftPid.kd)}
              style={sliderFillStyle(Math.min(1, draftPid.kd), 1)}
              onChange={(e) =>
                onChangeDraftPid({ ...draftPid, kd: Number(e.target.value) })
              }
              className="swiss-slider"
            />
          </div>
        </div>

        {/* Apply PID Button */}
        <button
          type="button"
          disabled={isDisabled}
          onClick={onApplyPid}
          className={`mt-3.5 flex min-h-9 w-full items-center justify-center gap-1.5 border px-3 py-1.5 font-mono text-xs font-semibold transition-colors disabled:opacity-45 ${
            pidDirty
              ? "border-[#1d4ed8] bg-[#1d4ed8] text-white hover:bg-[#1e40af]"
              : "border-[var(--border-control)] bg-[var(--bg-subtle)] text-[var(--ink-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--ink-primary)]"
          }`}
        >
          <Send aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          <span>{pidDirty ? "Kirim Parameter PID ke MC" : "PID Tersinkronisasi"}</span>
        </button>

        {/* Presets */}
        <div className="mt-3.5">
          <h3 className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--ink-muted)]">
            PRESET PRAKTIKUM
          </h3>
          <div className="grid grid-cols-2 gap-1.5">
            {PID_PRESETS.map((p) => {
              const isActivePreset =
                Math.abs(activePid.kp - p.kp) < 0.01 &&
                Math.abs(activePid.ki - p.ki) < 0.01 &&
                Math.abs(activePid.kd - p.kd) < 0.005;
              return (
                <button
                  key={p.name}
                  type="button"
                  aria-pressed={isActivePreset}
                  disabled={isDisabled}
                  onClick={() =>
                    onChangeDraftPid({ kp: p.kp, ki: p.ki, kd: p.kd }, true)
                  }
                  className={`border px-2.5 py-2 text-left transition-colors disabled:opacity-45 ${
                    isActivePreset
                      ? "border-[var(--accent-rpm)] bg-[var(--accent-rpm-bg)]"
                      : "border-[var(--border-control)] bg-[var(--bg-surface)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-semibold text-[var(--ink-primary)]">
                      {p.name}
                    </span>
                    <span
                      className={`text-[0.625rem] font-medium ${
                        isActivePreset
                          ? "font-semibold text-[var(--accent-rpm)]"
                          : "text-[var(--ink-muted)]"
                      }`}
                    >
                      {isActivePreset ? "AKTIF" : p.desc}
                    </span>
                  </div>
                  <div className="mt-0.5 font-mono text-[0.6875rem] tabular-nums text-[var(--ink-secondary)]">
                    {p.kp.toFixed(1)} / {p.ki.toFixed(2)} / {p.kd.toFixed(2)}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* SECTION 4: HARDWARE CALIBRATION (Native <details> Disclosure, marker next to label) */}
      <details className="swiss-disclosure">
        <summary className="flex min-h-10 items-center gap-2 px-4 py-2.5 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-[var(--ink-secondary)] hover:bg-[var(--bg-surface-alt)]">
          <span
            aria-hidden="true"
            className="disclosure-chevron inline-flex shrink-0 text-[var(--ink-muted)]"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </span>
          <span>KALIBRASI ENCODER &amp; SYNC</span>
        </summary>

        <div className="border-t border-[var(--border-hairline)] px-4 py-3">
          <div className="flex items-center gap-1.5">
            <label
              htmlFor={pprInputId}
              className="shrink-0 font-mono text-xs font-medium text-[var(--ink-secondary)]"
            >
              PPR:
            </label>
            <input
              id={pprInputId}
              name="encoder_ppr"
              type="number"
              inputMode="decimal"
              min={1}
              max={10000}
              step={1}
              value={pprInput}
              onChange={(e) => setPprInput(e.target.value)}
              className="min-h-8 w-full border border-[var(--border-control)] bg-[var(--bg-surface)] px-2 py-1 font-mono text-xs tabular-nums text-[var(--ink-primary)] focus:border-[var(--border-strong)]"
            />
            <button
              type="button"
              disabled={isDisabled}
              onClick={() => {
                const v = Number.parseFloat(pprInput);
                if (Number.isFinite(v) && v >= 1) onApplyPpr(v);
              }}
              className="min-h-8 shrink-0 border border-[var(--btn-primary-bg)] bg-[var(--btn-primary-bg)] px-3 py-1 font-mono text-xs font-semibold text-[var(--btn-primary-ink)] transition-colors hover:bg-[var(--btn-primary-hover)] disabled:opacity-45"
            >
              Set
            </button>
          </div>

          <button
            type="button"
            disabled={isDisabled}
            onClick={() => onCommand("SYNC")}
            className="mt-2 flex min-h-9 w-full items-center justify-center gap-1.5 border border-[var(--border-control)] bg-[var(--bg-surface)] px-3 py-1.5 font-mono text-xs font-medium text-[var(--ink-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--ink-primary)] disabled:opacity-45"
          >
            <RefreshCw aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            <span>Request Sync (CMD:SYNC)</span>
          </button>
        </div>
      </details>
    </aside>
  );
});
