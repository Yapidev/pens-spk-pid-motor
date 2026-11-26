"use client";

import React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleStop,
  Download,
  Moon,
  OctagonAlert,
  PlugZap,
  Radio,
  Sun,
  Trash2,
  Unplug,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type {
  ConnectionMode,
  ConnectionStatus,
  RunState,
} from "@/types/telemetry";

export type WorkspaceView = "dashboard" | "autotune" | "compare" | "serial";

interface TopBarProps {
  hydrated: boolean;
  activeView: WorkspaceView;
  onChangeView: (view: WorkspaceView) => void;
  fopdtRSquared: number | null;
  ghostRunCount: number;
  serialLogCount: number;
  connectionMode: ConnectionMode;
  connectionStatus: ConnectionStatus;
  baudRate: number;
  wsUrl: string;
  webSerialSupported: boolean;
  sampleRateHz: number;
  runState: RunState;
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
  onEstop: () => void;
}

const BAUD_OPTIONS = [9600, 38400, 57600, 115200, 230400] as const;

const themeToggleIcons = (
  <>
    <span className="theme-when-light items-center">
      <Moon aria-hidden="true" className="size-3.5" />
      <span className="visually-hidden">Aktifkan mode gelap</span>
    </span>
    <span className="theme-when-dark items-center">
      <Sun aria-hidden="true" className="size-3.5" />
      <span className="visually-hidden">Aktifkan mode terang</span>
    </span>
  </>
);

export const TopBar = React.memo(function TopBar({
  hydrated,
  activeView,
  onChangeView,
  fopdtRSquared,
  ghostRunCount,
  serialLogCount,
  connectionMode,
  connectionStatus,
  baudRate,
  wsUrl,
  webSerialSupported,
  sampleRateHz,
  runState,
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
  onEstop,
}: TopBarProps) {
  const isConnected = connectionStatus === "connected";
  const isConnecting = connectionStatus === "connecting";
  const isEstop = runState === 2;

  const sourceLabel =
    connectionMode === "simulator"
      ? "Simulator"
      : connectionMode === "serial"
        ? "USB"
        : "WS";

  const statusText = isConnected
    ? `${sourceLabel} ${sampleRateHz.toFixed(0)} Hz`
    : isConnecting
      ? "Menghubungkan"
      : "Offline";

  const navItems: Array<{
    id: WorkspaceView;
    label: string;
    meta?: string;
  }> = [
    { id: "dashboard", label: "Dashboard" },
    {
      id: "autotune",
      label: "Auto-Tune",
      meta: fopdtRSquared != null ? `${(fopdtRSquared * 100).toFixed(0)}%` : undefined,
    },
    {
      id: "compare",
      label: "Bandingkan",
      meta: ghostRunCount > 0 ? String(ghostRunCount) : undefined,
    },
    {
      id: "serial",
      label: "Serial",
      meta: serialLogCount > 0 ? String(serialLogCount) : undefined,
    },
  ];

  return (
    <header className="z-30 shrink-0 border-b border-border bg-[var(--bg-surface)] px-3 lg:px-5">
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 py-1.5">
        {/* Left: Clean Brand Wordmark + Stream Rate */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-flex size-6 items-center justify-center rounded-md bg-[var(--accent-phoenix)] font-mono text-[0.6875rem] font-bold text-white"
            >
              P
            </span>
            <h1 className="text-sm font-semibold tracking-tight text-foreground">
              SPK Motor PID
            </h1>
          </div>

          <span className="hidden h-4 w-px bg-border sm:block" aria-hidden="true" />

          <span
            className={cn(
              "font-mono text-xs font-medium tabular-nums",
              isConnected
                ? "text-[var(--ink-secondary)]"
                : connectionStatus === "error"
                  ? "text-[var(--accent-danger-ink)]"
                  : "text-muted-foreground"
            )}
          >
            {statusText}
          </span>

          {connectionMode === "serial" && !webSerialSupported ? (
            <span
              role="status"
              className="hidden items-center gap-1 text-xs text-[var(--accent-warn)] xl:inline-flex"
            >
              <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />
              Gunakan Chrome/Edge
            </span>
          ) : errorMessage ? (
            <span
              role="alert"
              className="hidden items-center gap-1 text-xs font-medium text-[var(--accent-danger-ink)] xl:inline-flex"
            >
              <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />
              {errorMessage}
            </span>
          ) : statusNotice ? (
            <span
              role="status"
              aria-live="polite"
              className="hidden items-center gap-1 text-xs text-[var(--accent-ok)] xl:inline-flex"
            >
              <CheckCircle2 aria-hidden="true" className="size-3.5 shrink-0" />
              {statusNotice}
            </span>
          ) : null}
        </div>

        {/* Center: Modern Flat Tab Navigation (Vercel / Linear style — zero dots, crisp underline) */}
        <nav
          aria-label="Navigasi utama"
          className="flex items-center gap-1 overflow-x-auto"
        >
          {navItems.map((item) => {
            const active = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => onChangeView(item.id)}
                className={cn(
                  "relative inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium whitespace-nowrap transition-colors",
                  active
                    ? "bg-[var(--bg-subtle)] text-foreground"
                    : "text-[var(--ink-secondary)] hover:bg-[var(--bg-hover)]/60 hover:text-foreground"
                )}
              >
                <span>{item.label}</span>
                {item.meta ? (
                  <span
                    className={cn(
                      "rounded-md px-1.5 py-0.5 font-mono text-[0.625rem] leading-none tabular-nums",
                      active
                        ? "bg-[var(--bg-surface)] text-[var(--accent-sp)]"
                        : "bg-[var(--bg-subtle)] text-muted-foreground"
                    )}
                  >
                    {item.meta}
                  </span>
                ) : null}
                {active ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-3 -bottom-[7px] h-0.5 rounded-full bg-[var(--accent-phoenix)]"
                  />
                ) : null}
              </button>
            );
          })}
        </nav>

        {/* Right: Cohesive Grouped Controls */}
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center gap-1">
            <Select
              value={connectionMode}
              onValueChange={(v) => onChangeMode(v as ConnectionMode)}
            >
              <SelectTrigger
                size="sm"
                aria-label="Sumber koneksi"
                className="h-8 rounded-lg border-input bg-[var(--bg-canvas)] px-2.5 text-xs font-medium text-foreground shadow-none dark:bg-[var(--bg-canvas)]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="end">
                <SelectItem value="simulator" className="text-xs">
                  Simulator 24V
                </SelectItem>
                <SelectItem value="serial" className="text-xs">
                  USB Serial
                </SelectItem>
                <SelectItem value="ws" className="text-xs">
                  WS Bridge
                </SelectItem>
              </SelectContent>
            </Select>

            {connectionMode === "serial" ? (
              <Select
                value={String(baudRate)}
                onValueChange={(v) => onChangeBaudRate(Number(v))}
                disabled={hydrated && (isConnected || isConnecting)}
              >
                <SelectTrigger
                  size="sm"
                  aria-label="Baud rate serial"
                  className="h-8 rounded-lg border-input bg-[var(--bg-canvas)] px-2 font-mono text-xs text-foreground shadow-none dark:bg-[var(--bg-canvas)]"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="end">
                  {BAUD_OPTIONS.map((b) => (
                    <SelectItem
                      key={b}
                      value={String(b)}
                      className="font-mono text-xs"
                    >
                      {b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}

            {connectionMode === "ws" ? (
              <Input
                type="url"
                aria-label="URL WebSocket Bridge"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                disabled={hydrated && (isConnected || isConnecting)}
                value={wsUrl}
                onChange={(e) => onChangeWsUrl(e.target.value)}
                placeholder="ws://localhost:8080"
                className="h-8 w-36 rounded-lg border-input bg-[var(--bg-canvas)] px-2.5 font-mono text-xs text-foreground shadow-none dark:bg-[var(--bg-canvas)]"
              />
            ) : null}

            {isConnected ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    aria-label="Putuskan koneksi"
                    onClick={onDisconnect}
                    className="size-8 rounded-lg border-input bg-[var(--bg-canvas)] text-[var(--ink-secondary)] shadow-none hover:border-[var(--border-strong)] hover:text-foreground dark:bg-[var(--bg-canvas)]"
                  >
                    <Unplug aria-hidden="true" className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Putuskan koneksi</TooltipContent>
              </Tooltip>
            ) : (
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={onConnect}
                disabled={
                  hydrated &&
                  (isConnecting ||
                    (connectionMode === "serial" && !webSerialSupported))
                }
                className="h-8 gap-1.5 rounded-lg px-2.5 text-xs font-semibold shadow-none"
              >
                <PlugZap aria-hidden="true" className="size-3.5" />
                <span>
                  {isConnecting
                    ? "..."
                    : connectionMode === "serial"
                      ? "Port"
                      : "Hubungkan"}
                </span>
              </Button>
            )}
          </div>

          <span className="hidden h-4 w-px bg-border sm:block" aria-hidden="true" />

          {/* Grouped Logger + Theme */}
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-pressed={isRecording}
                  onClick={onToggleRecording}
                  className={cn(
                    "h-8 gap-1.5 rounded-lg px-2.5 font-mono text-xs shadow-none",
                    isRecording
                      ? "border-[var(--accent-danger-border)] bg-[var(--accent-danger-bg)] font-medium text-[var(--accent-danger-ink)] hover:bg-[var(--accent-danger-bg)] hover:text-[var(--accent-danger-ink)] dark:border-[var(--accent-danger-border)] dark:bg-[var(--accent-danger-bg)]"
                      : "border-input bg-[var(--bg-canvas)] text-[var(--ink-secondary)] hover:border-[var(--border-strong)] hover:text-foreground dark:bg-[var(--bg-canvas)]"
                  )}
                >
                  {isRecording ? (
                    <CircleStop aria-hidden="true" className="size-3.5" />
                  ) : (
                    <Radio aria-hidden="true" className="size-3.5" />
                  )}
                  <span>REC</span>
                  <span className="tabular-nums">{recordedCount}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Rekam telemetri untuk ekspor CSV</TooltipContent>
            </Tooltip>

            {recordedCount > 0 ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    onClick={onClearRecording}
                    aria-label="Hapus rekaman CSV"
                    className="size-8 rounded-lg border-input bg-[var(--bg-canvas)] text-[var(--ink-secondary)] shadow-none hover:border-[var(--border-strong)] hover:text-foreground dark:bg-[var(--bg-canvas)]"
                  >
                    <Trash2 aria-hidden="true" className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Hapus rekaman CSV</TooltipContent>
              </Tooltip>
            ) : null}

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  onClick={onExportCsv}
                  disabled={hydrated && recordedCount === 0}
                  aria-label="Unduh CSV"
                  className="size-8 rounded-lg border-input bg-[var(--bg-canvas)] text-foreground shadow-none hover:border-[var(--border-strong)] dark:bg-[var(--bg-canvas)]"
                >
                  <Download aria-hidden="true" className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Unduh data .csv</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  onClick={onToggleTheme}
                  className="theme-toggle-btn size-8 rounded-lg border-input bg-[var(--bg-canvas)] text-[var(--ink-secondary)] shadow-none hover:border-[var(--border-strong)] hover:text-foreground dark:bg-[var(--bg-canvas)]"
                >
                  {themeToggleIcons}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Ganti tema gelap / terang</TooltipContent>
            </Tooltip>
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={hydrated && !isConnected}
                onClick={onEstop}
                className={cn(
                  "h-8 gap-1.5 rounded-lg px-3 font-mono text-xs font-semibold tracking-wide text-white shadow-none",
                  isEstop
                    ? "bg-[#991b1b] hover:bg-[#991b1b] dark:bg-[#991b1b]"
                    : "bg-[var(--accent-danger)] hover:bg-[#b91c1c] dark:bg-[var(--accent-danger)] dark:hover:bg-[#b91c1c]"
                )}
              >
                <OctagonAlert aria-hidden="true" className="size-3.5 shrink-0" />
                <span>{isEstop ? "E-STOP AKTIF" : "E-STOP"}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Emergency Stop instan (ESC)</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </header>
  );
});
