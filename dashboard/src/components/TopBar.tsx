"use client";

import React from "react";
import {
  Activity,
  Cpu,
  Download,
  Plug,
  PlugZap,
  Radio,
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
  onChangeMode: (mode: ConnectionMode) => void;
  onChangeBaudRate: (baud: number) => void;
  onChangeWsUrl: (url: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onToggleRecording: () => void;
  onClearRecording: () => void;
  onExportCsv: () => void;
}

const BAUD_OPTIONS = [9600, 38400, 57600, 115200, 230400];

export function TopBar({
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
  onChangeMode,
  onChangeBaudRate,
  onChangeWsUrl,
  onConnect,
  onDisconnect,
  onToggleRecording,
  onClearRecording,
  onExportCsv,
}: TopBarProps) {
  const isConnected = connectionStatus === "connected";
  const isConnecting = connectionStatus === "connecting";

  return (
    <header className="sticky top-0 z-30 border-b border-[#dfe2e8] bg-white">
      <div className="mx-auto flex max-w-[1640px] flex-wrap items-center justify-between gap-3 px-4 py-2.5 lg:px-6">
        {/* Brand & Hardware Identity */}
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center bg-[#0f172a] font-mono text-xs font-bold tracking-wider text-white">
            SPK
          </div>
          <div className="leading-tight">
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold tracking-tight text-[#0f172a]">
                DC MOTOR PID CONTROLLER
              </h1>
              <span className="hidden border border-[#dfe2e8] bg-[#f5f5f3] px-1.5 py-0.5 font-mono text-[10px] font-medium text-[#475569] sm:inline-block">
                {deviceInfo ? `${deviceInfo.firmware} ${deviceInfo.version}` : "PENS · 24V PLANT"}
              </span>
            </div>
            <p className="text-[11px] text-[#64748b]">
              Modul Sistem Pengaturan Komputer — Real-Time Telemetry &amp; R/W Tuning
            </p>
          </div>
        </div>

        {/* Center/Right Controls: Transport + Data Logger */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Source Selector */}
          <div className="flex border border-[#dfe2e8] bg-[#f5f5f3] p-0.5 text-[11px] font-medium">
            <button
              type="button"
              onClick={() => onChangeMode("serial")}
              className={`flex items-center gap-1 px-2.5 py-1 transition-colors ${
                connectionMode === "serial"
                  ? "bg-white text-[#0f172a] shadow-[inset_0_0_0_1px_#dfe2e8]"
                  : "text-[#64748b] hover:text-[#0f172a]"
              }`}
              title="Hubungkan langsung ke Arduino via Web Serial API (Chrome/Edge)"
            >
              <Plug className="h-3.5 w-3.5" />
              <span>Web Serial</span>
            </button>
            <button
              type="button"
              onClick={() => onChangeMode("ws")}
              className={`flex items-center gap-1 px-2.5 py-1 transition-colors ${
                connectionMode === "ws"
                  ? "bg-white text-[#0f172a] shadow-[inset_0_0_0_1px_#dfe2e8]"
                  : "text-[#64748b] hover:text-[#0f172a]"
              }`}
              title="Hubungkan via Node.js Serial-to-WebSocket Bridge"
            >
              <Wifi className="h-3.5 w-3.5" />
              <span>WS Bridge</span>
            </button>
            <button
              type="button"
              onClick={() => onChangeMode("simulator")}
              className={`flex items-center gap-1 px-2.5 py-1 transition-colors ${
                connectionMode === "simulator"
                  ? "bg-white text-[#0f172a] shadow-[inset_0_0_0_1px_#dfe2e8]"
                  : "text-[#64748b] hover:text-[#0f172a]"
              }`}
              title="Uji lokal dengan Digital Twin Motor DC 24V"
            >
              <Cpu className="h-3.5 w-3.5" />
              <span>Simulator</span>
            </button>
          </div>

          {/* Mode-Specific Parameter */}
          {connectionMode === "serial" && (
            <select
              aria-label="Baud Rate"
              disabled={isConnected || isConnecting}
              value={baudRate}
              onChange={(e) => onChangeBaudRate(Number(e.target.value))}
              className="h-8 border border-[#dfe2e8] bg-white px-2 font-mono text-xs text-[#0f172a] outline-none focus:border-[#0f172a] disabled:opacity-50"
            >
              {BAUD_OPTIONS.map((b) => (
                <option key={b} value={b}>
                  {b} baud
                </option>
              ))}
            </select>
          )}

          {connectionMode === "ws" && (
            <input
              type="text"
              aria-label="WebSocket Bridge URL"
              disabled={isConnected || isConnecting}
              value={wsUrl}
              onChange={(e) => onChangeWsUrl(e.target.value)}
              placeholder="ws://localhost:8080"
              className="h-8 w-44 border border-[#dfe2e8] bg-white px-2 font-mono text-xs text-[#0f172a] outline-none focus:border-[#0f172a] disabled:opacity-50"
            />
          )}

          {/* Connect / Disconnect Action */}
          {isConnected ? (
            <button
              type="button"
              onClick={onDisconnect}
              className="flex h-8 items-center gap-1.5 border border-[#0f172a] bg-white px-3 text-xs font-medium text-[#0f172a] transition-colors hover:bg-[#f5f5f3]"
            >
              <Unplug className="h-3.5 w-3.5" />
              <span>Disconnect</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onConnect}
              disabled={isConnecting || (connectionMode === "serial" && !webSerialSupported)}
              className="flex h-8 items-center gap-1.5 bg-[#0f172a] px-3 text-xs font-medium text-white transition-colors hover:bg-[#1e293b] disabled:cursor-not-allowed disabled:opacity-45"
            >
              <PlugZap className="h-3.5 w-3.5" />
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
          <div className="hidden h-6 w-px bg-[#dfe2e8] sm:block" />

          {/* Data Logger: REC + Clear + CSV Export */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onToggleRecording}
              className={`flex h-8 items-center gap-1.5 border px-2.5 font-mono text-[11px] font-semibold transition-colors ${
                isRecording
                  ? "border-[#dc2626] bg-red-50 text-[#dc2626]"
                  : "border-[#dfe2e8] bg-white text-[#475569] hover:border-[#0f172a] hover:text-[#0f172a]"
              }`}
              title="Mulai/Hentikan perekaman data telemetri untuk ekspor CSV"
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  isRecording ? "animate-pulse bg-[#dc2626]" : "bg-[#94a3b8]"
                }`}
              />
              <span>{isRecording ? "REC" : "LOG"}</span>
              <span className="tabular-nums text-[10px] opacity-80">
                ({recordedCount})
              </span>
            </button>

            {recordedCount > 0 && (
              <button
                type="button"
                onClick={onClearRecording}
                className="flex h-8 w-8 items-center justify-center border border-[#dfe2e8] bg-white text-[#64748b] transition-colors hover:border-[#0f172a] hover:text-[#0f172a]"
                title="Hapus buffer rekaman CSV"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}

            <button
              type="button"
              onClick={onExportCsv}
              disabled={recordedCount === 0}
              className="flex h-8 items-center gap-1.5 border border-[#dfe2e8] bg-white px-2.5 text-xs font-medium text-[#0f172a] transition-colors hover:border-[#0f172a] hover:bg-[#f5f5f3] disabled:cursor-not-allowed disabled:opacity-40"
              title="Unduh hasil pengujian dalam format .csv"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export .CSV</span>
            </button>
          </div>
        </div>
      </div>

      {/* Sub-Bar: Connection Status & Compatibility / Error Banner */}
      <div className="border-t border-[#eceef2] bg-[#fafaf9]">
        <div className="mx-auto flex max-w-[1640px] flex-wrap items-center justify-between gap-2 px-4 py-1 text-[11px] lg:px-6">
          <div className="flex items-center gap-2 font-mono">
            <span
              className={`inline-flex h-2 w-2 rounded-full ${
                isConnected
                  ? connectionMode === "simulator"
                    ? "bg-amber-500"
                    : "bg-[#059669]"
                  : connectionStatus === "error"
                    ? "bg-[#dc2626]"
                    : "bg-[#94a3b8]"
              }`}
            />
            <span className="font-semibold uppercase tracking-wider text-[#0f172a]">
              {isConnected
                ? connectionMode === "simulator"
                  ? "DIGITAL TWIN SIMULATOR"
                  : "HARDWARE CONNECTED"
                : connectionStatus === "connecting"
                  ? "CONNECTING"
                  : "OFFLINE"}
            </span>
            <span className="text-[#94a3b8]">|</span>
            <span className="text-[#475569]">{connectionLabel}</span>
            {isConnected && (
              <>
                <span className="text-[#94a3b8]">|</span>
                <span className="inline-flex items-center gap-1 tabular-nums text-[#475569]">
                  <Activity className="h-3 w-3 text-[#1d4ed8]" />
                  {sampleRateHz.toFixed(1)} Hz
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-3 text-[11px]">
            {connectionMode === "serial" && !webSerialSupported && (
              <span className="font-medium text-amber-700">
                Web Serial API membutuhkan Chrome / Edge / Opera — gunakan tab WS Bridge atau Simulator.
              </span>
            )}
            {errorMessage && (
              <span className="font-medium text-[#dc2626]">{errorMessage}</span>
            )}
            {!errorMessage && connectionMode === "simulator" && isConnected && (
              <span className="hidden items-center gap-1 text-[#64748b] md:inline-flex">
                <Radio className="h-3 w-3 text-amber-600" />
                Mode simulasi plant 24V aktif — pilih &ldquo;Web Serial&rdquo; untuk koneksi ke modul Arduino fisik.
              </span>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
