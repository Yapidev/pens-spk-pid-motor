"use client";

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { SerialLogEntry } from "@/types/telemetry";

interface SerialConsoleProps {
  hydrated: boolean;
  logs: SerialLogEntry[];
  connected: boolean;
  onSendRaw: (cmd: string) => void;
  onClearLogs: () => void;
  onTelemetryVisibilityChange: (visible: boolean) => void;
}

export const SerialConsole = React.memo(function SerialConsole({
  hydrated,
  logs,
  connected,
  onSendRaw,
  onClearLogs,
  onTelemetryVisibilityChange,
}: SerialConsoleProps) {
  const [hideTelemetry, setHideTelemetry] = useState(true);
  const [cmdInput, setCmdInput] = useState("");

  const inputId = useId();
  const filterId = useId();
  const logViewportRef = useRef<HTMLDivElement | null>(null);
  const pinnedToBottomRef = useRef(true);

  const visibleLogs = useMemo(
    () =>
      hideTelemetry
        ? logs.filter((l) => !(l.dir === "RX" && l.text.startsWith("T,")))
        : logs,
    [logs, hideTelemetry]
  );

  useEffect(() => {
    const el = logViewportRef.current;
    if (el && pinnedToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [visibleLogs.length]);

  const handleLogScroll = () => {
    const el = logViewportRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinnedToBottomRef.current = distanceFromBottom < 28;
  };

  const handleToggleHideTelemetry = (checked: boolean) => {
    setHideTelemetry(checked);
    onTelemetryVisibilityChange(!checked);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = cmdInput.trim();
    if (!trimmed || !connected) return;
    onSendRaw(trimmed);
    setCmdInput("");
  };

  return (
    <div className="flex flex-col">
      <div
        ref={logViewportRef}
        onScroll={handleLogScroll}
        role="region"
        aria-label="Riwayat log serial"
        tabIndex={0}
        className="h-32 overflow-y-auto bg-[#080a0f] px-3.5 py-2 font-mono text-xs leading-relaxed text-slate-200"
      >
        {visibleLogs.length === 0 ? (
          <div className="text-slate-400">
            Belum ada log perintah. Kirim perintah atau matikan filter frame T,...
          </div>
        ) : (
          visibleLogs.slice(-120).map((entry) => (
            <div key={entry.id} className="flex gap-2">
              <span className="shrink-0 text-slate-500">{entry.time}</span>
              <span
                className={`w-7 shrink-0 font-semibold ${
                  entry.dir === "TX"
                    ? "text-amber-300"
                    : entry.dir === "SYS"
                      ? "text-sky-300"
                      : "text-emerald-300"
                }`}
              >
                {entry.dir}
              </span>
              <span className="break-all text-slate-100">{entry.text}</span>
            </div>
          ))
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex flex-wrap items-center gap-2 border-t border-border bg-[var(--bg-surface-alt)] px-3 py-1.5"
      >
        <label htmlFor={inputId} className="visually-hidden">
          Perintah serial manual
        </label>
        <Input
          id={inputId}
          name="serial_command"
          type="text"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="send"
          disabled={hydrated && !connected}
          value={cmdInput}
          onChange={(e) => setCmdInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.nativeEvent.isComposing) {
              e.preventDefault();
            }
          }}
          placeholder="Perintah manual (SP:180, PID:1.2,0.85,0.05, CMD:SYNC)..."
          className="h-8 min-w-[200px] flex-1 border-transparent bg-transparent px-1 font-mono text-xs text-foreground shadow-none focus-visible:border-input focus-visible:ring-0 md:text-xs dark:bg-transparent"
        />

        <div className="flex items-center gap-3">
          <div className="flex shrink-0 items-center gap-2 text-xs text-[var(--ink-secondary)]">
            <Switch
              id={filterId}
              size="sm"
              aria-label="Sembunyikan frame telemetri T"
              checked={hideTelemetry}
              onCheckedChange={handleToggleHideTelemetry}
              className="data-[state=checked]:bg-[var(--accent-rpm)]"
            />
            <label
              htmlFor={filterId}
              className="cursor-pointer whitespace-nowrap select-none"
            >
              Filter T,...
            </label>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={onClearLogs}
            aria-label="Bersihkan log serial"
            className="h-7 gap-1 rounded-sm px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <Trash2 aria-hidden="true" className="size-3.5" />
            <span>Hapus</span>
          </Button>

          <Button
            type="submit"
            variant="outline"
            size="xs"
            disabled={hydrated && (!connected || !cmdInput.trim())}
            className="h-7 gap-1 rounded-sm border-input bg-card px-2.5 text-xs font-medium text-foreground shadow-none hover:border-[var(--border-strong)] dark:bg-card"
          >
            <span>Kirim</span>
            <CornerDownLeft aria-hidden="true" className="size-3" />
          </Button>
        </div>
      </form>
    </div>
  );
});
