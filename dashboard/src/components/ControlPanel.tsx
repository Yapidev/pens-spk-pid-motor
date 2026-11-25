"use client";

import React, { useState } from "react";
import {
  ChevronDown,
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
  connected: boolean;
  connectionMode: ConnectionMode;
  activeMode: ControlMode;
  runState: RunState;
  activePid: PIDParams;
  activeSetpoint: number;
  activePwm: number;
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

const SP_QUICK_VALUES = [0, 60, 120, 180, 240];

export function ControlPanel({
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
  const [calibOpen, setCalibOpen] = useState(false);
  const [pprInput, setPprInput] = useState(String(pprValue));

  const pidDirty =
    Math.abs(draftPid.kp - activePid.kp) > 0.004 ||
    Math.abs(draftPid.ki - activePid.ki) > 0.004 ||
    Math.abs(draftPid.kd - activePid.kd) > 0.004;

  const isRunning = runState === 1;
  const isEstop = runState === 2;

  const adjustPidField = (field: keyof PIDParams, delta: number, max: number) => {
    const raw = Math.max(0, Math.min(max, Number((draftPid[field] + delta).toFixed(3))));
    onChangeDraftPid({ ...draftPid, [field]: raw }, true);
  };

  return (
    <aside className="flex flex-col divide-y divide-[#dfe2e8] border border-[#dfe2e8] bg-white">
      {/* SECTION 1: EXECUTION & SAFETY */}
      <div className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#0f172a]">
            MOTOR EXECUTION &amp; SAFETY
          </span>
          <span className="font-mono text-[10px] text-[#64748b]">WRITE → MC</span>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          <button
            type="button"
            disabled={!connected}
            onClick={() => onCommand("START")}
            className={`flex h-9 items-center justify-center gap-1.5 border font-mono text-xs font-semibold transition-colors disabled:opacity-40 ${
              isRunning
                ? "border-[#059669] bg-[#059669] text-white"
                : "border-[#0f172a] bg-[#0f172a] text-white hover:bg-[#1e293b]"
            }`}
          >
            <Play className="h-3.5 w-3.5" />
            <span>START</span>
          </button>

          <button
            type="button"
            disabled={!connected}
            onClick={() => onCommand("STOP")}
            className="flex h-9 items-center justify-center gap-1.5 border border-[#dfe2e8] bg-white font-mono text-xs font-semibold text-[#0f172a] transition-colors hover:border-[#0f172a] hover:bg-[#f5f5f3] disabled:opacity-40"
          >
            <Square className="h-3.5 w-3.5" />
            <span>STOP</span>
          </button>

          <button
            type="button"
            disabled={!connected}
            onClick={() => onCommand("RESET")}
            className="flex h-9 items-center justify-center gap-1.5 border border-[#dfe2e8] bg-white font-mono text-xs font-semibold text-[#475569] transition-colors hover:border-[#0f172a] hover:text-[#0f172a] disabled:opacity-40"
            title="Reset integral PID, encoder, dan timer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>RESET</span>
          </button>
        </div>

        {/* Emergency Stop Button */}
        <button
          type="button"
          disabled={!connected}
          onClick={() => onCommand("ESTOP")}
          className={`mt-2 flex h-11 w-full items-center justify-center gap-2 border-2 font-mono text-xs font-bold tracking-wider transition-colors disabled:opacity-40 ${
            isEstop
              ? "border-[#991b1b] bg-[#991b1b] text-white"
              : "border-[#dc2626] bg-[#dc2626] text-white hover:bg-[#b91c1c]"
          }`}
        >
          <OctagonAlert className="h-4 w-4" />
          <span>{isEstop ? "E-STOP LATCHED — KLIK START UNTUK LANJUT" : "EMERGENCY STOP (ESC)"}</span>
        </button>

        {/* Simulator-Only Load Disturbance Test */}
        {connectionMode === "simulator" && onInjectDisturbance && (
          <button
            type="button"
            disabled={!connected || !isRunning}
            onClick={onInjectDisturbance}
            className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 border border-amber-300 bg-amber-50 font-mono text-[11px] font-medium text-amber-900 transition-colors hover:bg-amber-100 disabled:opacity-40"
            title="Simulasikan beban mekanis sesaat (2.5s) untuk menguji disturbance rejection PID"
          >
            <Zap className="h-3.5 w-3.5" />
            <span>Simulasi Gangguan Beban (+Torsi 2.5s)</span>
          </button>
        )}
      </div>

      {/* SECTION 2: CONTROL MODE & SETPOINT / MANUAL PWM */}
      <div className="p-4">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#0f172a]">
            CONTROL MODE
          </span>
          <span className="font-mono text-[10px] text-[#64748b]">
            {activeMode === 1 ? "CLOSED-LOOP" : "OPEN-LOOP"}
          </span>
        </div>

        <div className="grid grid-cols-2 border border-[#dfe2e8] bg-[#f5f5f3] p-0.5 text-xs font-medium">
          <button
            type="button"
            disabled={!connected}
            onClick={() => onSwitchMode(1)}
            className={`py-1.5 transition-colors disabled:opacity-50 ${
              activeMode === 1
                ? "bg-[#0f172a] font-semibold text-white"
                : "text-[#475569] hover:text-[#0f172a]"
            }`}
          >
            Closed-Loop PID
          </button>
          <button
            type="button"
            disabled={!connected}
            onClick={() => onSwitchMode(0)}
            className={`py-1.5 transition-colors disabled:opacity-50 ${
              activeMode === 0
                ? "bg-[#0f172a] font-semibold text-white"
                : "text-[#475569] hover:text-[#0f172a]"
            }`}
          >
            Open-Loop PWM
          </button>
        </div>

        {activeMode === 1 ? (
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between">
              <label
                htmlFor="sp-input"
                className="text-[11px] font-semibold text-[#0f172a]"
              >
                Setpoint Kecepatan (SP)
              </label>
              <div className="flex items-center gap-1">
                <input
                  id="sp-input"
                  type="number"
                  min={0}
                  max={500}
                  step={5}
                  disabled={!connected}
                  value={draftSetpoint}
                  onChange={(e) => {
                    const v = Number.parseFloat(e.target.value);
                    if (Number.isFinite(v)) {
                      onChangeSetpoint(Math.max(0, Math.min(500, v)));
                    }
                  }}
                  className="w-20 border border-[#dfe2e8] bg-white px-2 py-0.5 text-right font-mono text-sm font-semibold tabular-nums text-[#ea580c] outline-none focus:border-[#ea580c]"
                />
                <span className="font-mono text-[11px] text-[#64748b]">RPM</span>
              </div>
            </div>

            <input
              type="range"
              min={0}
              max={320}
              step={5}
              disabled={!connected}
              value={Math.min(320, draftSetpoint)}
              onChange={(e) => onChangeSetpoint(Number(e.target.value))}
              className="swiss-slider swiss-slider-orange my-2"
            />

            {/* Quick SP Step Presets */}
            <div className="mt-2 grid grid-cols-5 gap-1">
              {SP_QUICK_VALUES.map((spVal) => (
                <button
                  key={spVal}
                  type="button"
                  disabled={!connected}
                  onClick={() => onChangeSetpoint(spVal)}
                  className={`border py-1 font-mono text-[11px] tabular-nums transition-colors disabled:opacity-40 ${
                    Math.abs(activeSetpoint - spVal) < 1
                      ? "border-[#ea580c] bg-orange-50 font-semibold text-[#ea580c]"
                      : "border-[#dfe2e8] bg-white text-[#475569] hover:border-[#0f172a] hover:text-[#0f172a]"
                  }`}
                >
                  {spVal}
                </button>
              ))}
            </div>

            {/* Dedicated Step Test Trigger */}
            <button
              type="button"
              disabled={!connected}
              onClick={() => onTriggerStepTest(draftSetpoint > 0 ? draftSetpoint : 150)}
              className="mt-2.5 flex h-8 w-full items-center justify-center gap-1.5 border border-[#ea580c] bg-orange-50/70 font-mono text-[11px] font-semibold text-[#c2410c] transition-colors hover:bg-orange-100 disabled:opacity-40"
              title="Mulai pengujian respon step baru ke nilai Setpoint aktif"
            >
              <Sliders className="h-3.5 w-3.5" />
              <span>
                Trigger Step Test (→ {draftSetpoint > 0 ? draftSetpoint : 150} RPM)
              </span>
            </button>
          </div>
        ) : (
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between">
              <label
                htmlFor="pwm-input"
                className="text-[11px] font-semibold text-[#0f172a]"
              >
                Manual PWM Output
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  id="pwm-input"
                  type="number"
                  min={0}
                  max={255}
                  step={5}
                  disabled={!connected}
                  value={draftManualPwm}
                  onChange={(e) => {
                    const v = Number.parseInt(e.target.value, 10);
                    if (Number.isFinite(v)) {
                      onChangeManualPwm(Math.max(0, Math.min(255, v)));
                    }
                  }}
                  className="w-20 border border-[#dfe2e8] bg-white px-2 py-0.5 text-right font-mono text-sm font-semibold tabular-nums text-[#0f172a] outline-none focus:border-[#0f172a]"
                />
                <span className="font-mono text-[11px] text-[#64748b]">
                  ({Math.round((draftManualPwm / 255) * 100)}%)
                </span>
              </div>
            </div>

            <input
              type="range"
              min={0}
              max={255}
              step={1}
              disabled={!connected}
              value={draftManualPwm}
              onChange={(e) => onChangeManualPwm(Number(e.target.value))}
              className="swiss-slider my-2"
            />

            <div className="mt-2 grid grid-cols-5 gap-1">
              {[0, 64, 128, 192, 255].map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={!connected}
                  onClick={() => onChangeManualPwm(p)}
                  className="border border-[#dfe2e8] bg-white py-1 font-mono text-[11px] tabular-nums text-[#475569] hover:border-[#0f172a] hover:text-[#0f172a] disabled:opacity-40"
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
        <div className="mb-3 flex items-center justify-between">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#0f172a]">
              PID PARAMETER TUNING
            </span>
            <div className="mt-0.5 font-mono text-[10px] tabular-nums text-[#64748b]">
              MC: Kp={activePid.kp.toFixed(2)} · Ki={activePid.ki.toFixed(2)} · Kd=
              {activePid.kd.toFixed(2)}
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[#475569]">
            <input
              type="checkbox"
              checked={autoSendPid}
              onChange={(e) => onToggleAutoSendPid(e.target.checked)}
              className="h-3.5 w-3.5 accent-[#0f172a]"
            />
            <span>Live</span>
          </label>
        </div>

        <div className="space-y-3.5">
          {/* Kp */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="font-mono text-xs font-semibold text-[#0f172a]">
                Kp <span className="font-sans text-[10px] font-normal text-[#64748b]">(Proportional)</span>
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={!connected}
                  onClick={() => adjustPidField("kp", -0.05, 10)}
                  className="h-6 w-6 border border-[#dfe2e8] font-mono text-xs text-[#475569] hover:border-[#0f172a] disabled:opacity-40"
                >
                  −
                </button>
                <input
                  type="number"
                  step={0.05}
                  min={0}
                  max={50}
                  disabled={!connected}
                  value={draftPid.kp}
                  onChange={(e) => {
                    const v = Number.parseFloat(e.target.value);
                    if (Number.isFinite(v)) {
                      onChangeDraftPid({ ...draftPid, kp: Math.max(0, v) });
                    }
                  }}
                  className="h-6 w-16 border border-[#dfe2e8] px-1.5 text-right font-mono text-xs tabular-nums text-[#0f172a] outline-none focus:border-[#0f172a]"
                />
                <button
                  type="button"
                  disabled={!connected}
                  onClick={() => adjustPidField("kp", 0.05, 10)}
                  className="h-6 w-6 border border-[#dfe2e8] font-mono text-xs text-[#475569] hover:border-[#0f172a] disabled:opacity-40"
                >
                  +
                </button>
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={6}
              step={0.05}
              disabled={!connected}
              value={Math.min(6, draftPid.kp)}
              onChange={(e) =>
                onChangeDraftPid({ ...draftPid, kp: Number(e.target.value) })
              }
              className="swiss-slider"
            />
          </div>

          {/* Ki */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="font-mono text-xs font-semibold text-[#0f172a]">
                Ki <span className="font-sans text-[10px] font-normal text-[#64748b]">(Integral)</span>
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={!connected}
                  onClick={() => adjustPidField("ki", -0.05, 10)}
                  className="h-6 w-6 border border-[#dfe2e8] font-mono text-xs text-[#475569] hover:border-[#0f172a] disabled:opacity-40"
                >
                  −
                </button>
                <input
                  type="number"
                  step={0.05}
                  min={0}
                  max={50}
                  disabled={!connected}
                  value={draftPid.ki}
                  onChange={(e) => {
                    const v = Number.parseFloat(e.target.value);
                    if (Number.isFinite(v)) {
                      onChangeDraftPid({ ...draftPid, ki: Math.max(0, v) });
                    }
                  }}
                  className="h-6 w-16 border border-[#dfe2e8] px-1.5 text-right font-mono text-xs tabular-nums text-[#0f172a] outline-none focus:border-[#0f172a]"
                />
                <button
                  type="button"
                  disabled={!connected}
                  onClick={() => adjustPidField("ki", 0.05, 10)}
                  className="h-6 w-6 border border-[#dfe2e8] font-mono text-xs text-[#475569] hover:border-[#0f172a] disabled:opacity-40"
                >
                  +
                </button>
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={6}
              step={0.05}
              disabled={!connected}
              value={Math.min(6, draftPid.ki)}
              onChange={(e) =>
                onChangeDraftPid({ ...draftPid, ki: Number(e.target.value) })
              }
              className="swiss-slider"
            />
          </div>

          {/* Kd */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="font-mono text-xs font-semibold text-[#0f172a]">
                Kd <span className="font-sans text-[10px] font-normal text-[#64748b]">(Derivative)</span>
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={!connected}
                  onClick={() => adjustPidField("kd", -0.01, 5)}
                  className="h-6 w-6 border border-[#dfe2e8] font-mono text-xs text-[#475569] hover:border-[#0f172a] disabled:opacity-40"
                >
                  −
                </button>
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  max={20}
                  disabled={!connected}
                  value={draftPid.kd}
                  onChange={(e) => {
                    const v = Number.parseFloat(e.target.value);
                    if (Number.isFinite(v)) {
                      onChangeDraftPid({ ...draftPid, kd: Math.max(0, v) });
                    }
                  }}
                  className="h-6 w-16 border border-[#dfe2e8] px-1.5 text-right font-mono text-xs tabular-nums text-[#0f172a] outline-none focus:border-[#0f172a]"
                />
                <button
                  type="button"
                  disabled={!connected}
                  onClick={() => adjustPidField("kd", 0.01, 5)}
                  className="h-6 w-6 border border-[#dfe2e8] font-mono text-xs text-[#475569] hover:border-[#0f172a] disabled:opacity-40"
                >
                  +
                </button>
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              disabled={!connected}
              value={Math.min(1, draftPid.kd)}
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
          disabled={!connected}
          onClick={onApplyPid}
          className={`mt-3.5 flex h-8 w-full items-center justify-center gap-1.5 border font-mono text-xs font-semibold transition-colors disabled:opacity-40 ${
            pidDirty
              ? "border-[#1d4ed8] bg-[#1d4ed8] text-white hover:bg-[#1e40af]"
              : "border-[#dfe2e8] bg-[#f5f5f3] text-[#475569] hover:border-[#0f172a] hover:text-[#0f172a]"
          }`}
        >
          <Send className="h-3.5 w-3.5" />
          <span>{pidDirty ? "Kirim Parameter PID ke MC" : "PID Tersinkronisasi"}</span>
        </button>

        {/* Presets */}
        <div className="mt-3">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#64748b]">
            PRESET PRAKTIKUM
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {PID_PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                disabled={!connected}
                onClick={() =>
                  onChangeDraftPid({ kp: p.kp, ki: p.ki, kd: p.kd }, true)
                }
                className="border border-[#dfe2e8] bg-white px-2 py-1.5 text-left transition-colors hover:border-[#0f172a] hover:bg-[#f5f5f3] disabled:opacity-40"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-[#0f172a]">
                    {p.name}
                  </span>
                  <span className="text-[9px] text-[#64748b]">{p.desc}</span>
                </div>
                <div className="mt-0.5 font-mono text-[10px] tabular-nums text-[#64748b]">
                  {p.kp.toFixed(1)} / {p.ki.toFixed(2)} / {p.kd.toFixed(2)}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* SECTION 4: HARDWARE CALIBRATION (COLLAPSIBLE) */}
      <div>
        <button
          type="button"
          onClick={() => setCalibOpen((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-[#475569] hover:bg-[#fafaf9]"
        >
          <span>KALIBRASI ENCODER &amp; SYNC</span>
          {calibOpen ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>

        {calibOpen && (
          <div className="border-t border-[#eceef2] px-4 py-3">
            <div className="flex items-center gap-1.5">
              <label
                htmlFor="ppr-input"
                className="shrink-0 font-mono text-[11px] text-[#475569]"
              >
                PPR:
              </label>
              <input
                id="ppr-input"
                type="number"
                min={1}
                max={10000}
                step={1}
                value={pprInput}
                onChange={(e) => setPprInput(e.target.value)}
                className="h-7 w-full border border-[#dfe2e8] px-2 font-mono text-xs tabular-nums text-[#0f172a] outline-none focus:border-[#0f172a]"
              />
              <button
                type="button"
                disabled={!connected}
                onClick={() => {
                  const v = Number.parseFloat(pprInput);
                  if (Number.isFinite(v) && v >= 1) onApplyPpr(v);
                }}
                className="h-7 shrink-0 border border-[#0f172a] bg-[#0f172a] px-2.5 font-mono text-[11px] font-medium text-white hover:bg-[#1e293b] disabled:opacity-40"
              >
                Set
              </button>
            </div>

            <button
              type="button"
              disabled={!connected}
              onClick={() => onCommand("SYNC")}
              className="mt-2 flex h-7 w-full items-center justify-center gap-1.5 border border-[#dfe2e8] bg-white font-mono text-[11px] text-[#475569] hover:border-[#0f172a] hover:text-[#0f172a] disabled:opacity-40"
            >
              <RefreshCw className="h-3 w-3" />
              <span>Request Sync (CMD:SYNC)</span>
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
