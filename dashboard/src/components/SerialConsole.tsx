"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronUp, CornerDownLeft, Terminal, Trash2 } from "lucide-react";
import type { SerialLogEntry } from "@/types/telemetry";

interface SerialConsoleProps {
  logs: SerialLogEntry[];
  connected: boolean;
  onSendRaw: (cmd: string) => void;
  onClearLogs: () => void;
}

export function SerialConsole({
  logs,
  connected,
  onSendRaw,
  onClearLogs,
}: SerialConsoleProps) {
  const [expanded, setExpanded] = useState(false);
  const [hideTelemetry, setHideTelemetry] = useState(true);
  const [cmdInput, setCmdInput] = useState("");

  const visibleLogs = hideTelemetry
    ? logs.filter((l) => !(l.dir === "RX" && l.text.startsWith("T,")))
    : logs;

  const latestPreview = visibleLogs[visibleLogs.length - 1] ?? logs[logs.length - 1];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = cmdInput.trim();
    if (!trimmed || !connected) return;
    onSendRaw(trimmed);
    setCmdInput("");
  };

  return (
    <section className="border border-[#dfe2e8] bg-white">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 text-left"
        >
          <Terminal className="h-3.5 w-3.5 text-[#0f172a]" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#0f172a]">
            SERIAL MONITOR (R/W PROTOCOL)
          </span>
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-[#64748b]" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5 text-[#64748b]" />
          )}
        </button>

        {!expanded && latestPreview && (
          <div className="hidden max-w-xl truncate font-mono text-[11px] text-[#64748b] md:block">
            <span className="mr-1.5 font-semibold text-[#0f172a]">
              [{latestPreview.dir}]
            </span>
            {latestPreview.text}
          </div>
        )}

        <div className="flex items-center gap-3">
          {expanded && (
            <>
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[#475569]">
                <input
                  type="checkbox"
                  checked={hideTelemetry}
                  onChange={(e) => setHideTelemetry(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[#0f172a]"
                />
                <span>Sembunyikan frame T,...</span>
              </label>

              <button
                type="button"
                onClick={onClearLogs}
                className="flex items-center gap-1 font-mono text-[10px] text-[#64748b] hover:text-[#0f172a]"
              >
                <Trash2 className="h-3 w-3" />
                <span>Clear</span>
              </button>
            </>
          )}
          <span className="font-mono text-[10px] tabular-nums text-[#94a3b8]">
            {visibleLogs.length} lines
          </span>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-[#dfe2e8]">
          <div className="h-44 overflow-y-auto bg-[#0f172a] p-3 font-mono text-[11px] leading-relaxed text-slate-200">
            {visibleLogs.length === 0 ? (
              <div className="text-slate-500">
                Belum ada log perintah. Coba ubah Setpoint, kirim PID, atau matikan filter frame T,...
              </div>
            ) : (
              visibleLogs.slice(-120).map((entry) => (
                <div key={entry.id} className="flex gap-2">
                  <span className="shrink-0 text-slate-500">{entry.time}</span>
                  <span
                    className={`w-7 shrink-0 font-semibold ${
                      entry.dir === "TX"
                        ? "text-amber-400"
                        : entry.dir === "SYS"
                          ? "text-sky-400"
                          : "text-emerald-400"
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
            className="flex items-center border-t border-[#dfe2e8] bg-[#fafaf9]"
          >
            <input
              type="text"
              disabled={!connected}
              value={cmdInput}
              onChange={(e) => setCmdInput(e.target.value)}
              placeholder="Kirim perintah manual (mis. SP:180, PID:1.2,0.85,0.05, CMD:SYNC)..."
              className="h-9 flex-1 bg-transparent px-3 font-mono text-xs text-[#0f172a] outline-none placeholder:text-[#94a3b8] disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!connected || !cmdInput.trim()}
              className="flex h-9 items-center gap-1.5 border-l border-[#dfe2e8] bg-white px-4 font-mono text-xs font-semibold text-[#0f172a] hover:bg-[#f5f5f3] disabled:opacity-40"
            >
              <span>SEND</span>
              <CornerDownLeft className="h-3.5 w-3.5" />
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
