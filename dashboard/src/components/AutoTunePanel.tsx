"use client";

import React, { useId, useState } from "react";
import { Activity, Eye, EyeOff, Sparkles, Square } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AutoTuneCandidate, FopdtModel } from "@/types/telemetry";

interface AutoTunePanelProps {
  hydrated: boolean;
  connected: boolean;
  isIdentifying: boolean;
  identifyProgressPct: number;
  model: FopdtModel | null;
  candidates: AutoTuneCandidate[];
  showModelOverlay: boolean;
  onStartIdentify: (stepPwm: number) => void;
  onCancelIdentify: () => void;
  onToggleModelOverlay: () => void;
  onApplyCandidate: (candidate: AutoTuneCandidate, withFeedforward: boolean) => void;
}

export const AutoTunePanel = React.memo(function AutoTunePanel({
  hydrated,
  connected,
  isIdentifying,
  identifyProgressPct,
  model,
  candidates,
  showModelOverlay,
  onStartIdentify,
  onCancelIdentify,
  onToggleModelOverlay,
  onApplyCandidate,
}: AutoTunePanelProps) {
  const [stepPwmInput, setStepPwmInput] = useState("160");
  const pwmId = useId();
  const isDisabled = hydrated && !connected;

  const parsedPwm = Number.parseInt(stepPwmInput, 10);
  const validPwm = Number.isFinite(parsedPwm)
    ? Math.max(60, Math.min(240, parsedPwm))
    : 160;

  return (
    <div className="panel-isolated flex flex-col gap-2.5 px-4 py-2.5 lg:flex-row lg:items-center lg:gap-4">
      {/* Left: Open-Loop Step Trigger */}
      <div className="flex shrink-0 flex-col gap-1.5 lg:w-52">
        <div className="flex items-center gap-1.5">
          <label
            htmlFor={pwmId}
            className="shrink-0 font-mono text-[0.6875rem] text-muted-foreground"
          >
            Step PWM
          </label>
          <Input
            id={pwmId}
            type="number"
            inputMode="numeric"
            min={60}
            max={240}
            step={10}
            disabled={isDisabled || isIdentifying}
            value={stepPwmInput}
            onChange={(e) => setStepPwmInput(e.target.value)}
            className="h-7 w-16 rounded-sm border-input bg-card px-1.5 text-right font-mono text-xs tabular-nums shadow-none md:text-xs dark:bg-card"
          />
          {isIdentifying ? (
            <Button
              type="button"
              variant="destructive"
              size="xs"
              onClick={onCancelIdentify}
              className="h-7 flex-1 gap-1 rounded-sm text-xs shadow-none"
            >
              <Square aria-hidden="true" className="size-3" />
              <span>Batal</span>
            </Button>
          ) : (
            <Button
              type="button"
              variant="default"
              size="xs"
              disabled={isDisabled}
              onClick={() => onStartIdentify(validPwm)}
              className="h-7 flex-1 gap-1 rounded-sm text-xs shadow-none"
            >
              <Activity aria-hidden="true" className="size-3" />
              <span>Identifikasi</span>
            </Button>
          )}
        </div>

        {isIdentifying ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between font-mono text-[0.6875rem] text-muted-foreground">
              <span>Uji Open-Loop...</span>
              <span className="tabular-nums">{identifyProgressPct}%</span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-[var(--accent-rpm)] transition-[width] duration-150"
                style={{ width: `${identifyProgressPct}%` }}
              />
            </div>
          </div>
        ) : model ? (
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[0.6875rem] text-muted-foreground">
              Fit R² ={" "}
              <strong
                className={cn(
                  "tabular-nums",
                  model.rSquared >= 0.92
                    ? "text-[var(--accent-ok)]"
                    : "text-[var(--accent-warn)]"
                )}
              >
                {(model.rSquared * 100).toFixed(1)}%
              </strong>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={onToggleModelOverlay}
              className="h-6 gap-1 rounded-sm px-1.5 text-[0.6875rem] text-muted-foreground hover:text-foreground"
            >
              {showModelOverlay ? (
                <Eye aria-hidden="true" className="size-3 text-[var(--accent-ok)]" />
              ) : (
                <EyeOff aria-hidden="true" className="size-3" />
              )}
              <span>Kurva Model</span>
            </Button>
          </div>
        ) : (
          <p className="text-[0.6875rem] leading-snug text-muted-foreground">
            Ekstrak model FOPDT (K, τ, θ) metode Smith 2-titik.
          </p>
        )}
      </div>

      {/* Middle: FOPDT Model Readout */}
      {model ? (
        <div className="flex shrink-0 flex-col gap-1 border-border lg:border-l lg:pl-4">
          <div className="flex items-center gap-1.5">
            <Badge
              variant="outline"
              className="rounded-sm border-border bg-[var(--bg-surface-alt)] px-1.5 py-0 font-mono text-[0.625rem] text-[var(--ink-secondary)]"
            >
              FOPDT
            </Badge>
            <span className="font-mono text-[0.6875rem] text-foreground">
              G(s) = {model.gainK.toFixed(2)}·e^(-{model.thetaSec.toFixed(2)}s) / (
              {model.tauSec.toFixed(2)}s + 1)
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[0.6875rem] tabular-nums text-muted-foreground">
            <span>
              K <strong className="text-foreground">{model.gainK.toFixed(2)}</strong>
            </span>
            <span>
              τ <strong className="text-foreground">{model.tauSec.toFixed(2)}s</strong>
            </span>
            <span>
              θ <strong className="text-foreground">{model.thetaSec.toFixed(2)}s</strong>
            </span>
            <span>
              y∞ <strong className="text-foreground">{model.yInfRpm.toFixed(0)} RPM</strong>
            </span>
          </div>
        </div>
      ) : null}

      {/* Right: 3 Analytical Tuning Cards */}
      {candidates.length > 0 ? (
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-1.5 border-border sm:grid-cols-3 lg:border-l lg:pl-4">
          {candidates.map((c) => (
            <div
              key={c.id}
              className="flex flex-col justify-between gap-1.5 rounded-sm border border-border bg-[var(--bg-surface-alt)] px-2.5 py-1.5"
            >
              <div className="flex items-baseline justify-between gap-1">
                <span className="text-xs font-semibold text-foreground">{c.name}</span>
                <span className="truncate text-[0.625rem] text-muted-foreground">
                  {c.tag}
                </span>
              </div>
              <div className="font-mono text-[0.6875rem] tabular-nums text-[var(--ink-secondary)]">
                P:{c.kp.toFixed(2)} · I:{c.ki.toFixed(2)} · D:{c.kd.toFixed(3)}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={isDisabled || isIdentifying}
                  onClick={() => onApplyCandidate(c, false)}
                  className="h-6 flex-1 rounded-sm border-input bg-card px-1.5 text-[0.6875rem] shadow-none dark:bg-card"
                >
                  Pakai PID
                </Button>
                <Button
                  type="button"
                  variant="default"
                  size="xs"
                  disabled={isDisabled || isIdentifying}
                  onClick={() => onApplyCandidate(c, true)}
                  title={`Terapkan PID + Feedforward Kff=${c.recommendedKff.toFixed(2)}`}
                  className="h-6 flex-1 gap-1 rounded-sm px-1.5 text-[0.6875rem] shadow-none"
                >
                  <Sparkles aria-hidden="true" className="size-2.5" />
                  <span>+ 2-DOF</span>
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-1 items-center border-border text-xs text-muted-foreground lg:border-l lg:pl-4">
          Klik <strong className="mx-1 font-medium text-foreground">Identifikasi</strong>{" "}
          untuk menjalankan Open-Loop Step 3.4 detik dan menghitung tuning analitis IMC,
          Cohen-Coon, dan Ziegler-Nichols beserta Feedforward Kff.
        </div>
      )}
    </div>
  );
});
