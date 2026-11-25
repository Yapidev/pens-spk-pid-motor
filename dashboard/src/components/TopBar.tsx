"use client";

import React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Moon,
  OctagonAlert,
  PlugZap,
  Sun,
  Trash2,
  Unplug,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
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

interface TopBarProps {
  hydrated: boolean;
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

  const statusText = isConnected
    ? `${connectionMode === "simulator" ? "Sim" : connectionMode === "serial" ? "USB" : "WS"} · ${sampleRateHz.toFixed(0)} Hz`
    : isConnecting
      ? "Menghubungkan..."
      : "Terputus";

  return (
    <header className="z-30 shrink-0 border-b border-border bg-card">
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 px-3 py-1.5 lg:px-4">
        {/* Left: Instrument Title + Connection Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 pr-1">
            <h1 className="text-[0.8125rem] font-semibold tracking-tight text-foreground">
              SPK PID Motor
            </h1>
            <Badge
              variant="outline"
              className="gap-1.5 rounded-sm border-border bg-[var(--bg-surface-alt)] px-1.5 py-0.5 font-mono text-[0.6875rem] font-normal tabular-nums text-[var(--ink-secondary)]"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "size-1.5 rounded-full",
                  isConnected
                    ? connectionMode === "simulator"
                      ? "bg-[var(--accent-sp-bright)]"
                      : "bg-[var(--accent-ok)]"
                    : connectionStatus === "error"
                      ? "bg-[var(--accent-danger)]"
                      : "bg-muted-foreground"
                )}
              />
              {statusText}
            </Badge>
          </div>

          <Separator
            orientation="vertical"
            className="hidden h-4 sm:block"
          />

          {/* Compact Source Selector (shadcn Select) */}
          <Select
            value={connectionMode}
            onValueChange={(v) => onChangeMode(v as ConnectionMode)}
          >
            <SelectTrigger
              size="sm"
              aria-label="Sumber koneksi"
              className="h-8 rounded-sm border-input bg-card px-2.5 text-xs font-medium text-foreground shadow-none dark:bg-card"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
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
                className="h-8 rounded-sm border-input bg-card px-2 font-mono text-xs text-foreground shadow-none dark:bg-card"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="start">
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
              className="h-8 w-40 rounded-sm border-input bg-card px-2 font-mono text-xs text-foreground shadow-none dark:bg-card"
            />
          ) : null}

          {isConnected ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onDisconnect}
              className="h-8 gap-1.5 rounded-sm border-input bg-card px-2.5 text-xs font-medium text-[var(--ink-secondary)] shadow-none hover:border-[var(--border-strong)] hover:text-foreground dark:bg-card"
            >
              <Unplug aria-hidden="true" className="size-3.5" />
              <span>Putus</span>
            </Button>
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
              className="h-8 gap-1.5 rounded-sm px-2.5 text-xs font-medium shadow-none"
            >
              <PlugZap aria-hidden="true" className="size-3.5" />
              <span>
                {isConnecting
                  ? "Menghubungkan..."
                  : connectionMode === "serial"
                    ? "Pilih Port"
                    : "Hubungkan"}
              </span>
            </Button>
          )}

          {/* Contextual inline alert/notice — completely quiet when idle */}
          {connectionMode === "serial" && !webSerialSupported ? (
            <span
              role="status"
              className="inline-flex items-center gap-1 text-xs text-[var(--accent-warn)]"
            >
              <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />
              Gunakan Chrome/Edge atau WS Bridge
            </span>
          ) : errorMessage ? (
            <span
              role="alert"
              className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent-danger-ink)]"
            >
              <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />
              {errorMessage}
            </span>
          ) : statusNotice ? (
            <span
              role="status"
              aria-live="polite"
              className="inline-flex items-center gap-1 text-xs text-[var(--accent-ok)]"
            >
              <CheckCircle2 aria-hidden="true" className="size-3.5 shrink-0" />
              {statusNotice}
            </span>
          ) : null}
        </div>

        {/* Right: Data Logger + Theme + Global E-STOP */}
        <div className="flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-pressed={isRecording}
                onClick={onToggleRecording}
                className={cn(
                  "h-8 gap-1.5 rounded-sm px-2 font-mono text-xs shadow-none",
                  isRecording
                    ? "border-[var(--accent-danger-border)] bg-[var(--accent-danger-bg)] font-medium text-[var(--accent-danger-ink)] hover:bg-[var(--accent-danger-bg)] hover:text-[var(--accent-danger-ink)] dark:border-[var(--accent-danger-border)] dark:bg-[var(--accent-danger-bg)]"
                    : "border-input bg-card text-[var(--ink-secondary)] hover:border-[var(--border-strong)] hover:text-foreground dark:bg-card"
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 rounded-full",
                    isRecording
                      ? "bg-[var(--accent-danger)] motion-safe:animate-pulse"
                      : "bg-muted-foreground"
                  )}
                />
                <span>REC</span>
                <span className="tabular-nums opacity-85">{recordedCount}</span>
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
                  className="size-8 rounded-sm border-input bg-card text-muted-foreground shadow-none hover:border-[var(--border-strong)] hover:text-foreground dark:bg-card"
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
                size="sm"
                onClick={onExportCsv}
                disabled={hydrated && recordedCount === 0}
                className="h-8 gap-1.5 rounded-sm border-input bg-card px-2.5 text-xs font-medium text-foreground shadow-none hover:border-[var(--border-strong)] dark:bg-card"
              >
                <Download aria-hidden="true" className="size-3.5" />
                <span>CSV</span>
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
                className="theme-toggle-btn size-8 rounded-sm border-input bg-card text-[var(--ink-secondary)] shadow-none hover:border-[var(--border-strong)] hover:text-foreground dark:bg-card"
              >
                {themeToggleIcons}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Ganti tema terang / gelap</TooltipContent>
          </Tooltip>

          <Separator
            orientation="vertical"
            className="hidden h-4 sm:block"
          />

          {/* Global Emergency Stop — always 1 click away, sole red CTA on the screen */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={hydrated && !isConnected}
                onClick={onEstop}
                className={cn(
                  "h-8 gap-1.5 rounded-sm px-2.5 font-mono text-xs font-semibold tracking-wide text-white shadow-none",
                  isEstop
                    ? "bg-[#991b1b] hover:bg-[#991b1b] dark:bg-[#991b1b]"
                    : "bg-[var(--accent-danger)] hover:bg-[#b91c1c] dark:bg-[var(--accent-danger)] dark:hover:bg-[#dc2626]"
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
