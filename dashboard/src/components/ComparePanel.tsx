"use client";

import React from "react";
import { Pin, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { SavedRunSnapshot } from "@/types/telemetry";

interface ComparePanelProps {
  runs: SavedRunSnapshot[];
  canPinCurrent: boolean;
  onPinCurrent: () => void;
  onToggleRunVisible: (id: string, visible: boolean) => void;
  onRemoveRun: (id: string) => void;
  onClearAll: () => void;
}

export const ComparePanel = React.memo(function ComparePanel({
  runs,
  canPinCurrent,
  onPinCurrent,
  onToggleRunVisible,
  onRemoveRun,
  onClearAll,
}: ComparePanelProps) {
  return (
    <div className="panel-isolated flex flex-col gap-2 px-4 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            Overlay A/B ({runs.length}/3)
          </span>
          <span>
            Kurva tersimpan ditumpuk pada t₀ step aktif untuk perbandingan kuantitatif.
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={!canPinCurrent}
            onClick={onPinCurrent}
            className="h-7 gap-1 rounded-sm border-input bg-card px-2 text-xs shadow-none dark:bg-card"
          >
            <Pin aria-hidden="true" className="size-3" />
            <span>Pin Run Ini</span>
          </Button>
          {runs.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={onClearAll}
              className="h-7 gap-1 rounded-sm px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <Trash2 aria-hidden="true" className="size-3" />
              <span>Hapus Semua</span>
            </Button>
          ) : null}
        </div>
      </div>

      {runs.length === 0 ? (
        <div className="rounded-sm border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          Belum ada kurva referensi. Jalankan <strong className="font-medium text-foreground">Step Test</strong>, lalu klik{" "}
          <strong className="font-medium text-foreground">Pin Run Ini</strong> untuk membandingkan PID standar vs Auto-Tune vs 2-DOF Feedforward.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left font-mono text-xs tabular-nums">
            <thead>
              <tr className="border-b border-border text-[0.6875rem] text-muted-foreground">
                <th className="py-1 pr-2 font-sans font-medium">Tampil</th>
                <th className="py-1 pr-3 font-sans font-medium">Konfigurasi</th>
                <th className="py-1 pr-3 font-medium">SP</th>
                <th className="py-1 pr-3 font-medium">Tr</th>
                <th className="py-1 pr-3 font-medium">%OS</th>
                <th className="py-1 pr-3 font-medium">Ts</th>
                <th className="py-1 pr-3 font-medium">Ess</th>
                <th className="py-1 pr-2 font-medium">IAE</th>
                <th className="py-1 text-right font-sans font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {runs.map((run) => (
                <tr key={run.id} className="text-[0.6875rem]">
                  <td className="py-1 pr-2">
                    <div className="flex items-center gap-1.5">
                      <span
                        aria-hidden="true"
                        className="inline-block size-2.5 rounded-full"
                        style={{ backgroundColor: run.color }}
                      />
                      <Switch
                        size="sm"
                        aria-label={`Tampilkan overlay ${run.label}`}
                        checked={run.visible}
                        onCheckedChange={(v) => onToggleRunVisible(run.id, v)}
                      />
                    </div>
                  </td>
                  <td className="py-1 pr-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-sans font-medium text-foreground">
                        {run.label}
                      </span>
                      <span className="text-muted-foreground">
                        ({run.pid.kp.toFixed(2)}/{run.pid.ki.toFixed(2)}/
                        {run.pid.kd.toFixed(3)})
                      </span>
                      {run.ffEnabled ? (
                        <Badge
                          variant="outline"
                          className="rounded-sm border-[var(--accent-rpm)] px-1 py-0 text-[0.6rem] text-[var(--accent-rpm)]"
                        >
                          2-DOF
                        </Badge>
                      ) : null}
                      {run.rampRate > 0 ? (
                        <Badge
                          variant="outline"
                          className="rounded-sm border-border px-1 py-0 text-[0.6rem] text-muted-foreground"
                        >
                          Ramp {run.rampRate}
                        </Badge>
                      ) : null}
                    </div>
                  </td>
                  <td className="py-1 pr-3 text-foreground">
                    {run.targetSetpoint.toFixed(0)}
                  </td>
                  <td className="py-1 pr-3 text-foreground">
                    {run.metrics.riseTimeSec !== null
                      ? `${run.metrics.riseTimeSec.toFixed(2)}s`
                      : "—"}
                  </td>
                  <td className="py-1 pr-3 text-foreground">
                    {run.metrics.overshootPct !== null
                      ? `${run.metrics.overshootPct.toFixed(1)}%`
                      : "—"}
                  </td>
                  <td className="py-1 pr-3 text-foreground">
                    {run.metrics.settlingTimeSec !== null
                      ? `${run.metrics.settlingTimeSec.toFixed(2)}s`
                      : "—"}
                  </td>
                  <td className="py-1 pr-3 text-foreground">
                    {run.metrics.steadyStateErrorRpm !== null
                      ? `${run.metrics.steadyStateErrorRpm >= 0 ? "+" : ""}${run.metrics.steadyStateErrorRpm.toFixed(2)}`
                      : "—"}
                  </td>
                  <td className="py-1 pr-2 text-foreground">
                    {run.metrics.iae !== null ? run.metrics.iae.toFixed(1) : "—"}
                  </td>
                  <td className="py-1 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Hapus ${run.label}`}
                      onClick={() => onRemoveRun(run.id)}
                      className="size-6 text-muted-foreground hover:text-foreground"
                    >
                      <Trash2 aria-hidden="true" className="size-3" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
});
