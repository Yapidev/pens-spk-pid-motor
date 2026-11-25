"use client";

import React from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Download,
  Moon,
  Plug,
  PlugZap,
  Radio,
  Sun,
  Trash2,
  Unplug,
  Wifi,
} from "lucide-react";
import type {
  ConnectionMode,
  ConnectionStatus,
  DeviceInfo,
} from "@/types/telemetry";

interface TopBarProps {
  hydrated: boolean;
  connectionMode: ConnectionMode;
  connectionStatus: ConnectionStatus;
  connectionLabel: string;
  baudRate: number;
  wsUrl: string;
  webSerialSupported: boolean;
  sampleRateHz: number;
  deviceInfo: DeviceInfo | null;
  isRecording: boolean;
  recordedCount: number;
  errorMessage: string | null;
  statusNotice: string | null;
  onChangeMode: (mode: ConnectionMode) => void;
  onChangeBaudRate: (baud: number) => void;
  onChangeWsUrl: (url: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onToggleRecording: () => void;
  onClearRecording: () => void;
  onExportCsv: () => void;
  onToggleTheme: () => void;
}

const BAUD_OPTIONS = [9600, 38400, 57600, 115200, 230400] as const;

// Hoisted static JSX elements (rendering-hoist-jsx)
const brandMark = (
  <div
    aria-hidden="true"
    className="flex h-9 w-9 shrink-0 items-center justify-center bg-[var(--btn-primary-bg)] font-mono text-xs font-bold tracking-wider text-[var(--btn-primary-ink)]"
  >
    SPK
  </div>
);

const toolbarDivider = (
  <div
    aria-hidden="true"
    className="hidden h-6 w-px bg-[var(--border-hairline)] sm:block"
  />
);

const themeToggleIcons = (
  <>
    <span className="theme-when-light items-center gap-1.5">
      <Moon aria-hidden="true" className="h-3.5 w-3.5" />
      <span className="visually-hidden">Aktifkan mode gelap</span>
    </span>
    <span className="theme-when-dark items-center gap-1.5">
      <Sun aria-hidden="true" className="h-3.5 w-3.5" />
      <span className="visually-hidden">Aktifkan mode terang</span>
    </span>
  </>
);

export const TopBar = React.memo(function TopBar({
  hydrated,
  connectionMode,
  connectionStatus,
  connectionLabel,
  baudRate,
  wsUrl,
  webSerialSupported,
  sampleRateHz,
  deviceInfo,
  isRecording,
  recordedCount,
  errorMessage,
  statusNotice,
  onChangeMode,
  onChangeBaudRate,
  onChangeWsUrl,
  onConnect,
  onDisconnect,
  onToggleRecording,
  onClearRecording,
  onExportCsv,
  onToggleTheme,
}: TopBarProps) {
  const isConnected = connectionStatus === "connected";
  const isConnecting = connectionStatus === "connecting";

  return (
    <header className="z-30 border-b border-[var(--border-hairline)] bg-[var(--bg-surface)] lg:sticky lg:top-0">
      <div className="mx-auto flex max-w-[1640px] flex-wrap items-center justify-between gap-2.5 px-4 py-2.5 lg:px-6">
        {/* Brand & Hardware Identity */}
        <div className="flex items-center gap-3">
          {brandMark}
          <div className="leading-tight">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-sm font-semibold tracking-tight text-[var(--ink-primary)]">
                DC MOTOR PID CONTROLLER
              </h1>
              <span className="hidden border border-[var(--border-hairline)] bg-[var(--bg-subtle)] px-1.5 py-0.5 font-mono text-[0.6875rem] font-medium text-[var(--ink-secondary)] sm:inline-block">
                {deviceInfo
                  ? `${deviceInfo.firmware} ${deviceInfo.version}`
                  : "PENS · 24V PLANT"}
              </span>
            </div>
            <p className="text-xs text-[var(--ink-muted)]">
              Modul Sistem Pengaturan Komputer — Real-Time Telemetry &amp; R/W Tuning
            </p>
          </div>
        </div>

        {/* Center/Right Controls: Transport + Data Logger + Theme */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Source Selector */}
          <div
            role="group"
            aria-label="Sumber koneksi telemetri"
            className="flex border border-[var(--border-control)] bg-[var(--bg-subtle)] p-0.5 text-xs font-medium"
          >
            <button
              type="button"
              aria-pressed={connectionMode === "serial"}
              onClick={() => onChangeMode("serial")}
              className={`flex min-h-8 items-center gap-1.5 px-2.5 py-1 transition-colors ${
                connectionMode === "serial"
                  ? "bg-[var(--bg-surface)] text-[var(--ink-primary)] shadow-[inset_0_0_0_1px_var(--border-control)]"
                  : "text-[var(--ink-muted)] hover:text-[var(--ink-primary)]"
              }`}
              title="Hubungkan langsung ke Arduino via Web Serial API (Chrome/Edge)"
            >
              <Plug aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              <span>Web Serial</span>
            </button>
            <button
              type="button"
              aria-pressed={connectionMode === "ws"}
              onClick={() => onChangeMode("ws")}
              className={`flex min-h-8 items-center gap-1.5 px-2.5 py-1 transition-colors ${
                connectionMode === "ws"
                  ? "bg-[var(--bg-surface)] text-[var(--ink-primary)] shadow-[inset_0_0_0_1px_var(--border-control)]"
                  : "text-[var(--ink-muted)] hover:text-[var(--ink-primary)]"
              }`}
              title="Hubungkan via Node.js Serial-to-WebSocket Bridge"
            >
              <Wifi aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              <span>WS Bridge</span>
            </button>
            <button
              type="button"
              aria-pressed={connectionMode === "simulator"}
              onClick={() => onChangeMode("simulator")}
              className={`flex min-h-8 items-center gap-1.5 px-2.5 py-1 transition-colors ${
                connectionMode === "simulator"
                  ? "bg-[var(--bg-surface)] text-[var(--ink-primary)] shadow-[inset_0_0_0_1px_var(--border-control)]"
                  : "text-[var(--ink-muted)] hover:text-[var(--ink-primary)]"
              }`}
              title="Uji lokal dengan Digital Twin Motor DC 24V"
            >
              <Cpu aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              <span>Simulator</span>
            </button>
          </div>

          {/* Mode-Specific Parameter */}
          {connectionMode === "serial" ? (
            <select
              aria-label="Baud Rate Serial"
              disabled={isConnected || isConnecting}
              value={baudRate}
              onChange={(e) => onChangeBaudRate(Number(e.target.value))}
              className="min-h-9 border border-[var(--border-control)] bg-[var(--bg-surface)] px-2.5 py-1 font-mono text-xs text-[var(--ink-primary)] focus:border-[var(--border-strong)] disabled:opacity-50"
            >
              {BAUD_OPTIONS.map((b) => (
                <option key={b} value={b}>
                  {b} baud
                </option>
              ))}
            </select>
          ) : null}

          {connectionMode === "ws" ? (
            <input
              type="url"
              aria-label="URL WebSocket Bridge"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              disabled={isConnected || isConnecting}
              value={wsUrl}
              onChange={(e) => onChangeWsUrl(e.target.value)}
              placeholder="ws://localhost:8080"
              className="min-h-9 w-44 border border-[var(--border-control)] bg-[var(--bg-surface)] px-2.5 py-1 font-mono text-xs text-[var(--ink-primary)] focus:border-[var(--border-strong)] disabled:opacity-50"
            />
          ) : null}

          {/* Connect / Disconnect Action */}
          {isConnected ? (
            <button
              type="button"
              onClick={onDisconnect}
              className="flex min-h-9 items-center gap-1.5 border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-primary)] transition-colors hover:bg-[var(--bg-hover)]"
            >
              <Unplug aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              <span>Disconnect</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onConnect}
              disabled={
                hydrated &&
                (isConnecting || (connectionMode === "serial" && !webSerialSupported))
              }
              className="flex min-h-9 items-center gap-1.5 bg-[var(--btn-primary-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--btn-primary-ink)] transition-colors hover:bg-[var(--btn-primary-hover)] disabled:cursor-not-allowed disabled:opacity-45"
            >
              <PlugZap aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              <span>
                {isConnecting
                  ? "Connecting..."
                  : connectionMode === "serial"
                    ? "Select COM Port"
                    : connectionMode === "ws"
                      ? "Connect Bridge"
                      : "Start Simulator"}
              </span>
            </button>
          )}

          {/* Vertical Divider */}
          {toolbarDivider}

          {/* Data Logger: REC + Clear + CSV Export */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-pressed={isRecording}
              onClick={onToggleRecording}
              className={`flex min-h-9 items-center gap-1.5 border px-2.5 py-1.5 font-mono text-xs font-semibold transition-colors ${
                isRecording
                  ? "border-[var(--accent-danger)] bg-[var(--accent-danger-bg)] text-[var(--accent-danger-ink)]"
                  : "border-[var(--border-control)] bg-[var(--bg-surface)] text-[var(--ink-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--ink-primary)]"
              }`}
              title="Mulai atau hentikan perekaman data telemetri untuk ekspor CSV"
            >
              <span
                aria-hidden="true"
                className={`h-2 w-2 rounded-full ${
                  isRecording
                    ? "bg-[var(--accent-danger)] motion-safe:animate-pulse"
                    : "bg-[var(--ink-muted)]"
                }`}
              />
              <span>{isRecording ? "REC" : "LOG"}</span>
              <span className="tabular-nums text-[0.6875rem] opacity-90">
                ({recordedCount})
              </span>
            </button>

            {recordedCount > 0 ? (
              <button
                type="button"
                onClick={onClearRecording}
                aria-label="Hapus buffer rekaman CSV"
                className="flex min-h-9 min-w-9 items-center justify-center border border-[var(--border-control)] bg-[var(--bg-surface)] text-[var(--ink-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--ink-primary)]"
                title="Hapus buffer rekaman CSV"
              >
                <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            ) : null}

            <button
              type="button"
              onClick={onExportCsv}
              disabled={hydrated && recordedCount === 0}
              className="flex min-h-9 items-center gap-1.5 border border-[var(--border-control)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ink-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-45"
              title="Unduh hasil pengujian dalam format .csv"
            >
              <Download aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              <span>Export .CSV</span>
            </button>

            {/* Two-State Dark Mode Toggle (CSS-driven icon & AT text, zero hydration flicker) */}
            <button
              type="button"
              onClick={onToggleTheme}
              className="theme-toggle-btn flex min-h-9 min-w-9 items-center justify-center border border-[var(--border-control)] bg-[var(--bg-surface)] px-2 text-[var(--ink-secondary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] hover:text-[var(--ink-primary)]"
              title="Ganti tema terang / gelap"
            >
              {themeToggleIcons}
            </button>
          </div>
        </div>
      </div>

      {/* Sub-Bar: Connection Status, Live Action Notice & Error Banner */}
      <div className="border-t border-[var(--border-hairline)] bg-[var(--bg-surface-alt)]">
        <div className="mx-auto flex max-w-[1640px] flex-wrap items-center justify-between gap-2 px-4 py-1.5 text-xs lg:px-6">
          <div className="flex flex-wrap items-center gap-2 font-mono text-[0.6875rem]">
            <span
              aria-hidden="true"
              className={`inline-flex h-2 w-2 rounded-full ${
                isConnected
                  ? connectionMode === "simulator"
                    ? "bg-amber-500"
                    : "bg-[var(--accent-ok)]"
                  : connectionStatus === "error"
                    ? "bg-[var(--accent-danger)]"
                    : "bg-[var(--ink-muted)]"
              }`}
            />
            <span className="font-semibold uppercase tracking-wider text-[var(--ink-primary)]">
              {isConnected
                ? connectionMode === "simulator"
                  ? "DIGITAL TWIN SIMULATOR"
                  : "HARDWARE CONNECTED"
                : connectionStatus === "connecting"
                  ? "CONNECTING"
                  : "OFFLINE"}
            </span>
            <span aria-hidden="true" className="text-[var(--border-control)]">|</span>
            <span className="text-[var(--ink-secondary)]">{connectionLabel}</span>
            {isConnected ? (
              <>
                <span aria-hidden="true" className="text-[var(--border-control)]">|</span>
                <span className="inline-flex items-center gap-1 tabular-nums text-[var(--ink-secondary)]">
                  <Activity aria-hidden="true" className="h-3 w-3 text-[var(--accent-rpm)]" />
                  {sampleRateHz.toFixed(1)} Hz
                </span>
              </>
            ) : null}
          </div>

          <div className="flex items-center gap-3 text-[0.6875rem]">
            {connectionMode === "serial" && !webSerialSupported ? (
              <span
                role="status"
                className="inline-flex items-center gap-1 font-medium text-[var(--accent-warn)]"
              >
                <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                Web Serial API membutuhkan Chrome / Edge / Opera — gunakan tab WS Bridge atau Simulator.
              </span>
            ) : null}

            {errorMessage ? (
              <span
                role="alert"
                className="inline-flex items-center gap-1 font-semibold text-[var(--accent-danger-ink)]"
              >
                <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                {errorMessage}
              </span>
            ) : null}

            {!errorMessage && statusNotice ? (
              <span
                role="status"
                aria-live="polite"
                className="inline-flex items-center gap-1 font-medium text-[var(--accent-ok)]"
              >
                <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                {statusNotice}
              </span>
            ) : null}

            {!errorMessage && !statusNotice && connectionMode === "simulator" && isConnected ? (
              <span className="hidden items-center gap-1 text-[var(--ink-muted)] md:inline-flex">
                <Radio aria-hidden="true" className="h-3 w-3 text-[var(--accent-warn)]" />
                Mode simulasi plant 24V aktif — pilih &ldquo;Web Serial&rdquo; untuk koneksi ke modul Arduino fisik.
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
});
