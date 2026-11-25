"use client";

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronRight, CornerDownLeft, Terminal, Trash2 } from "lucide-react";
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
  const [expanded, setExpanded] = useState(false);
  const [hideTelemetry, setHideTelemetry] = useState(true);
  const [cmdInput, setCmdInput] = useState("");

  const panelId = useId();
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

  const latestPreview = visibleLogs[visibleLogs.length - 1] ?? logs[logs.length - 1];

  useEffect(() => {
    if (!expanded) return;
    const el = logViewportRef.current;
    if (el && pinnedToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [expanded, visibleLogs.length]);

  const handleToggleExpanded = () => {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    onTelemetryVisibilityChange(nextExpanded && !hideTelemetry);
  };

  const handleToggleHideTelemetry = (checked: boolean) => {
    setHideTelemetry(checked);
    onTelemetryVisibilityChange(expanded && !checked);
  };

  const handleLogScroll = () => {
    const el = logViewportRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinnedToBottomRef.current = distanceFromBottom < 28;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = cmdInput.trim();
    if (!trimmed || !connected) return;
    onSendRaw(trimmed);
    setCmdInput("");
  };

  return (
    <section
      aria-labelledby={`${panelId}-heading`}
      className="below-fold-region border border-[var(--border-hairline)] bg-[var(--bg-surface)]"
    >
      {/* Header Bar — Custom Accordion Pattern: <h2> wraps disclosure <button> */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
        <h2 id={`${panelId}-heading`} className="m-0">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={handleToggleExpanded}
            className="flex min-h-8 items-center gap-2 py-1 text-left"
          >
            <span
              aria-hidden="true"
              className={`inline-flex shrink-0 text-[var(--ink-muted)] motion-safe:transition-transform motion-safe:duration-150 ${
                expanded ? "rotate-90" : "rotate-0"
              }`}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </span>
            <Terminal aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--ink-primary)]" />
            <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-[var(--ink-primary)]">
              SERIAL MONITOR (R/W PROTOCOL)
            </span>
          </button>
        </h2>

        {!expanded && latestPreview ? (
          <div className="hidden max-w-xl truncate font-mono text-xs text-[var(--ink-muted)] md:block">
            <span className="mr-1.5 font-semibold text-[var(--ink-primary)]">
              [{latestPreview.dir}]
            </span>
            {latestPreview.text}
          </div>
        ) : null}

        <div className="flex items-center gap-3">
          {expanded ? (
            <>
              <div className="flex items-center gap-1.5 text-xs text-[var(--ink-secondary)]">
                <input
                  id={filterId}
                  type="checkbox"
                  checked={hideTelemetry}
                  onChange={(e) => handleToggleHideTelemetry(e.target.checked)}
                  className="h-4 w-4 cursor-pointer accent-[var(--accent-rpm)]"
                />
                <label htmlFor={filterId} className="cursor-pointer select-none">
                  Sembunyikan frame T,...
                </label>
              </div>

              <button
                type="button"
                onClick={onClearLogs}
                className="flex min-h-8 items-center gap-1 px-1.5 font-mono text-[0.6875rem] text-[var(--ink-muted)] hover:text-[var(--ink-primary)]"
              >
                <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                <span>Clear</span>
              </button>
            </>
          ) : null}
          <span className="font-mono text-[0.6875rem] tabular-nums text-[var(--ink-muted)]">
            {visibleLogs.length} lines
          </span>
        </div>
      </div>

      {expanded ? (
        <div id={panelId} className="border-t border-[var(--border-hairline)]">
          <div
            ref={logViewportRef}
            onScroll={handleLogScroll}
            role="region"
            aria-label="Riwayat log serial"
            tabIndex={0}
            className="h-48 overflow-y-auto bg-[#070b14] p-3 font-mono text-xs leading-relaxed text-slate-200"
          >
            {visibleLogs.length === 0 ? (
              <div className="text-slate-400">
                Belum ada log perintah. Coba ubah Setpoint, kirim PID, atau matikan filter frame T,...
              </div>
            ) : (
              visibleLogs.slice(-120).map((entry) => (
                <div key={entry.id} className="flex gap-2">
                  <span className="shrink-0 text-slate-400">{entry.time}</span>
                  <span
                    className={`w-8 shrink-0 font-semibold ${
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
            className="flex items-center border-t border-[var(--border-hairline)] bg-[var(--bg-surface-alt)]"
          >
            <label htmlFor={inputId} className="visually-hidden">
              Kirim perintah serial manual
            </label>
            <input
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
              placeholder="Kirim perintah manual (mis. SP:180, PID:1.2,0.85,0.05, CMD:SYNC)..."
              className="min-h-10 flex-1 bg-transparent px-3 font-mono text-xs text-[var(--ink-primary)] placeholder:text-[var(--ink-muted)] disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={hydrated && (!connected || !cmdInput.trim())}
              className="flex min-h-10 items-center gap-1.5 border-l border-[var(--border-hairline)] bg-[var(--bg-surface)] px-4 font-mono text-xs font-semibold text-[var(--ink-primary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-45"
            >
              <span>SEND</span>
              <CornerDownLeft aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
});
