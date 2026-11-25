"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Pause, Play, RotateCcw } from "lucide-react";
import type { StepMetrics, TelemetrySample } from "@/types/telemetry";

interface StepResponseChartProps {
  samples: TelemetrySample[];
  metrics: StepMetrics;
  onClearPlot: () => void;
}

type TimeWindow = 10 | 20 | 30 | 60 | 0; // 0 = ALL
type SubTraceMode = "pwm" | "error";

export function StepResponseChart({
  samples,
  metrics,
  onClearPlot,
}: StepResponseChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [timeWindow, setTimeWindow] = useState<TimeWindow>(20);
  const [subTrace, setSubTrace] = useState<SubTraceMode>("pwm");
  const [showBand, setShowBand] = useState(true);
  const [isFrozen, setIsFrozen] = useState(false);
  const [frozenSamples, setFrozenSamples] = useState<TelemetrySample[]>([]);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 420 });

  // Track responsive container width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0) {
        setCanvasSize({
          width: Math.floor(rect.width),
          height: rect.width < 640 ? 340 : 420,
        });
      }
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const activeSource = isFrozen ? frozenSamples : samples;

  const visibleSamples = useMemo(() => {
    if (activeSource.length === 0) return [];
    if (timeWindow === 0) return activeSource;
    const latestT = activeSource[activeSource.length - 1].elapsedSec;
    const minT = latestT - timeWindow;
    let startIdx = 0;
    for (let i = activeSource.length - 1; i >= 0; i--) {
      if (activeSource[i].elapsedSec < minT) {
        startIdx = i;
        break;
      }
    }
    return activeSource.slice(startIdx);
  }, [activeSource, timeWindow]);

  const toggleFreeze = () => {
    if (!isFrozen) {
      setFrozenSamples(samples);
      setIsFrozen(true);
    } else {
      setIsFrozen(false);
    }
  };

  // Layout geometry shared between render & pointer hit-testing
  const layout = useMemo(() => {
    const padLeft = 56;
    const padRight = 18;
    const padTop = 18;
    const padBottom = 28;
    const gap = 22;
    const plotW = Math.max(100, canvasSize.width - padLeft - padRight);
    const totalPlotH = Math.max(180, canvasSize.height - padTop - padBottom - gap);
    const mainH = Math.round(totalPlotH * 0.72);
    const subH = totalPlotH - mainH;
    const mainTop = padTop;
    const subTop = padTop + mainH + gap;

    return { padLeft, padRight, padTop, padBottom, gap, plotW, mainH, subH, mainTop, subTop };
  }, [canvasSize]);

  // Compute axis domains
  const domains = useMemo(() => {
    if (visibleSamples.length === 0) {
      return {
        tMin: 0,
        tMax: timeWindow === 0 ? 20 : timeWindow,
        yMaxRpm: 250,
        errAbsMax: 100,
      };
    }

    const firstT = visibleSamples[0].elapsedSec;
    const lastT = visibleSamples[visibleSamples.length - 1].elapsedSec;
    const tMin = timeWindow === 0 ? firstT : Math.max(0, lastT - timeWindow);
    const tMax =
      timeWindow === 0
        ? Math.max(firstT + 5, lastT)
        : Math.max(tMin + timeWindow, lastT);

    let maxVal = 100;
    let maxAbsErr = 25;
    for (const s of visibleSamples) {
      if (s.setpoint > maxVal) maxVal = s.setpoint;
      if (s.rpm > maxVal) maxVal = s.rpm;
      const ae = Math.abs(s.error);
      if (ae > maxAbsErr) maxAbsErr = ae;
    }

    // Round up cleanly to nearest 50 RPM
    const yMaxRpm = Math.max(100, Math.ceil((maxVal * 1.16) / 50) * 50);
    const errAbsMax = Math.max(25, Math.ceil((maxAbsErr * 1.15) / 25) * 25);

    return { tMin, tMax, yMaxRpm, errAbsMax };
  }, [visibleSamples, timeWindow]);

  // Draw HiDPI oscilloscope canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize.width * dpr;
    canvas.height = canvasSize.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const { padLeft, plotW, mainH, subH, mainTop, subTop } = layout;
    const { tMin, tMax, yMaxRpm, errAbsMax } = domains;
    const tSpan = Math.max(0.001, tMax - tMin);

    const xOf = (t: number) => padLeft + ((t - tMin) / tSpan) * plotW;
    const yRpmOf = (rpm: number) =>
      mainTop + mainH - (Math.max(0, Math.min(yMaxRpm, rpm)) / yMaxRpm) * mainH;
    const yPwmOf = (pwm: number) =>
      subTop + subH - (Math.max(0, Math.min(255, pwm)) / 255) * subH;
    const yErrOf = (err: number) =>
      subTop + subH / 2 - (Math.max(-errAbsMax, Math.min(errAbsMax, err)) / errAbsMax) * (subH / 2);

    // 1. White architectural background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);

    // 2. Plot area frames
    ctx.fillStyle = "#fcfcfb";
    ctx.fillRect(padLeft, mainTop, plotW, mainH);
    ctx.fillRect(padLeft, subTop, plotW, subH);

    // 3. Grid lines (Vertical time ticks)
    const xTickCount = 6;
    ctx.font = '10px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    for (let i = 0; i <= xTickCount; i++) {
      const frac = i / xTickCount;
      const x = Math.round(padLeft + frac * plotW) + 0.5;
      const tVal = tMin + frac * tSpan;

      ctx.strokeStyle = i === 0 || i === xTickCount ? "#cbd5e1" : "#eef0f4";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, mainTop);
      ctx.lineTo(x, mainTop + mainH);
      ctx.moveTo(x, subTop);
      ctx.lineTo(x, subTop + subH);
      ctx.stroke();

      ctx.fillStyle = "#64748b";
      ctx.fillText(`${tVal.toFixed(1)}s`, x, subTop + subH + 7);
    }

    // 4. Grid lines (Main Y-axis RPM ticks)
    const yTickCount = 5;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= yTickCount; i++) {
      const val = (yMaxRpm * i) / yTickCount;
      const y = Math.round(yRpmOf(val)) + 0.5;

      ctx.strokeStyle = i === 0 ? "#cbd5e1" : "#eef0f4";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + plotW, y);
      ctx.stroke();

      ctx.fillStyle = "#64748b";
      ctx.fillText(String(Math.round(val)), padLeft - 8, y);
    }

    // Main Y-axis label
    ctx.save();
    ctx.fillStyle = "#475569";
    ctx.font = '600 9px "Inter", sans-serif';
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("SPEED (RPM)", padLeft + 6, mainTop + 5);
    ctx.restore();

    // 5. Sub-pane Y-axis ticks (PWM or Error)
    ctx.font = '10px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    if (subTrace === "pwm") {
      for (const v of [0, 128, 255]) {
        const y = Math.round(yPwmOf(v)) + 0.5;
        ctx.strokeStyle = v === 0 ? "#cbd5e1" : "#eef0f4";
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(padLeft + plotW, y);
        ctx.stroke();
        ctx.fillStyle = "#64748b";
        ctx.fillText(String(v), padLeft - 8, y);
      }
    } else {
      for (const v of [-errAbsMax, 0, errAbsMax]) {
        const y = Math.round(yErrOf(v)) + 0.5;
        ctx.strokeStyle = v === 0 ? "#cbd5e1" : "#eef0f4";
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(padLeft + plotW, y);
        ctx.stroke();
        ctx.fillStyle = "#64748b";
        ctx.fillText(v > 0 ? `+${v}` : String(v), padLeft - 8, y);
      }
    }

    // Sub-pane label
    ctx.fillStyle = "#475569";
    ctx.font = '600 9px "Inter", sans-serif';
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(
      subTrace === "pwm" ? "ACTUATOR EFFORT (PWM 0–255)" : "TRACKING ERROR (SP − RPM)",
      padLeft + 6,
      subTop + 4
    );

    if (visibleSamples.length > 0) {
      const latest = visibleSamples[visibleSamples.length - 1];

      // 6. Optional ±2% Settling Tolerance Band around active Setpoint
      if (showBand && latest.mode === 1 && latest.setpoint >= 5) {
        const tol = Math.max(latest.setpoint * 0.02, 1.0);
        const yHi = yRpmOf(latest.setpoint + tol);
        const yLo = yRpmOf(latest.setpoint - tol);
        ctx.fillStyle = "rgba(5, 150, 105, 0.09)";
        ctx.fillRect(padLeft, yHi, plotW, Math.max(2, yLo - yHi));
      }

      // 7. Step Start Marker (t0)
      if (
        metrics.hasStep &&
        metrics.stepStartTimeSec !== null &&
        metrics.stepStartTimeSec >= tMin &&
        metrics.stepStartTimeSec <= tMax
      ) {
        const sx = Math.round(xOf(metrics.stepStartTimeSec)) + 0.5;
        ctx.save();
        ctx.strokeStyle = "rgba(15, 23, 42, 0.28)";
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx, mainTop);
        ctx.lineTo(sx, mainTop + mainH);
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = "#475569";
        ctx.font = '600 9px "JetBrains Mono", monospace';
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText("STEP t₀", sx + 4, mainTop + 18);
      }

      // 8. Sub-trace Plot (PWM or Error)
      ctx.save();
      ctx.beginPath();
      ctx.rect(padLeft, subTop, plotW, subH);
      ctx.clip();

      if (subTrace === "pwm") {
        // Area fill
        ctx.beginPath();
        visibleSamples.forEach((s, i) => {
          const x = xOf(s.elapsedSec);
          const y = yPwmOf(s.pwm);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        const lastX = xOf(visibleSamples[visibleSamples.length - 1].elapsedSec);
        const firstX = xOf(visibleSamples[0].elapsedSec);
        ctx.lineTo(lastX, subTop + subH);
        ctx.lineTo(firstX, subTop + subH);
        ctx.closePath();
        ctx.fillStyle = "rgba(15, 23, 42, 0.08)";
        ctx.fill();

        // Stroke line
        ctx.beginPath();
        visibleSamples.forEach((s, i) => {
          const x = xOf(s.elapsedSec);
          const y = yPwmOf(s.pwm);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = "#0f172a";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        ctx.beginPath();
        visibleSamples.forEach((s, i) => {
          const x = xOf(s.elapsedSec);
          const y = yErrOf(s.error);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = "#dc2626";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.restore();

      // 9. Main Plot: Setpoint (Step curve, Signal Orange dashed)
      ctx.save();
      ctx.beginPath();
      ctx.rect(padLeft, mainTop, plotW, mainH);
      ctx.clip();

      ctx.beginPath();
      visibleSamples.forEach((s, i) => {
        const x = xOf(s.elapsedSec);
        const y = yRpmOf(s.setpoint);
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          // Step-hold transition
          const prevY = yRpmOf(visibleSamples[i - 1].setpoint);
          ctx.lineTo(x, prevY);
          ctx.lineTo(x, y);
        }
      });
      ctx.strokeStyle = "#ea580c";
      ctx.lineWidth = 1.75;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // 10. Main Plot: Actual RPM (Precision Blue solid)
      ctx.beginPath();
      visibleSamples.forEach((s, i) => {
        const x = xOf(s.elapsedSec);
        const y = yRpmOf(s.rpm);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = "#1d4ed8";
      ctx.lineWidth = 2.1;
      ctx.lineJoin = "round";
      ctx.stroke();

      // 11. Peak Overshoot Marker
      if (
        metrics.hasStep &&
        metrics.overshootPct !== null &&
        metrics.overshootPct > 0.5 &&
        metrics.stepStartTimeSec !== null &&
        metrics.peakTimeSec !== null &&
        metrics.peakRpm !== null
      ) {
        const peakT = metrics.stepStartTimeSec + metrics.peakTimeSec;
        if (peakT >= tMin && peakT <= tMax) {
          const px = xOf(peakT);
          const py = yRpmOf(metrics.peakRpm);
          ctx.fillStyle = "#dc2626";
          ctx.beginPath();
          ctx.arc(px, py, 3.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      ctx.restore();

      // 12. Interactive Hover Crosshair
      if (hoverIdx !== null && visibleSamples[hoverIdx]) {
        const hs = visibleSamples[hoverIdx];
        const hx = Math.round(xOf(hs.elapsedSec)) + 0.5;
        const hyRpm = yRpmOf(hs.rpm);
        const hySp = yRpmOf(hs.setpoint);

        ctx.save();
        ctx.strokeStyle = "#94a3b8";
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(hx, mainTop);
        ctx.lineTo(hx, mainTop + mainH);
        ctx.moveTo(hx, subTop);
        ctx.lineTo(hx, subTop + subH);
        ctx.stroke();
        ctx.restore();

        // Highlight dots
        ctx.fillStyle = "#ea580c";
        ctx.beginPath();
        ctx.arc(hx, hySp, 3.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#1d4ed8";
        ctx.beginPath();
        ctx.arc(hx, hyRpm, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // Empty state message inside canvas
      ctx.fillStyle = "#94a3b8";
      ctx.font = '12px "JetBrains Mono", monospace';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        "MENUNGGU DATA TELEMETRI SERIAL...",
        padLeft + plotW / 2,
        mainTop + mainH / 2
      );
    }

    // Crisp outer borders for both plot frames
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1;
    ctx.strokeRect(padLeft + 0.5, mainTop + 0.5, plotW, mainH);
    ctx.strokeRect(padLeft + 0.5, subTop + 0.5, plotW, subH);
  }, [canvasSize, layout, domains, visibleSamples, subTrace, showBand, metrics, hoverIdx]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (visibleSamples.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const { padLeft, plotW } = layout;
    if (x < padLeft || x > padLeft + plotW) {
      setHoverIdx(null);
      return;
    }

    const { tMin, tMax } = domains;
    const targetT = tMin + ((x - padLeft) / plotW) * (tMax - tMin);

    // Binary search nearest sample by elapsedSec
    let lo = 0;
    let hi = visibleSamples.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (visibleSamples[mid].elapsedSec < targetT) lo = mid + 1;
      else hi = mid;
    }
    if (
      lo > 0 &&
      Math.abs(visibleSamples[lo - 1].elapsedSec - targetT) <
        Math.abs(visibleSamples[lo].elapsedSec - targetT)
    ) {
      lo = lo - 1;
    }
    setHoverIdx(lo);
  };

  const handleExportPng = () => {
    const srcCanvas = canvasRef.current;
    if (!srcCanvas) return;

    // Compose annotated report PNG (with header & PID summary)
    const dpr = window.devicePixelRatio || 1;
    const headerH = 44;
    const outCanvas = document.createElement("canvas");
    outCanvas.width = srcCanvas.width;
    outCanvas.height = srcCanvas.height + headerH * dpr;
    const ctx = outCanvas.getContext("2d");
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvasSize.width, canvasSize.height + headerH);

    const latest = visibleSamples[visibleSamples.length - 1];
    ctx.fillStyle = "#0f172a";
    ctx.font = '600 12px "Inter", sans-serif';
    ctx.fillText("PENS SPK — STEP RESPONSE (SETPOINT vs ACTUAL RPM)", 16, 18);

    ctx.fillStyle = "#475569";
    ctx.font = '11px "JetBrains Mono", monospace';
    const meta = latest
      ? `Kp=${latest.kp.toFixed(2)}  Ki=${latest.ki.toFixed(2)}  Kd=${latest.kd.toFixed(2)}  |  Tr=${metrics.riseTimeSec != null ? metrics.riseTimeSec.toFixed(2) + "s" : "—"}  OS=${metrics.overshootPct != null ? metrics.overshootPct.toFixed(1) + "%" : "—"}  Ts=${metrics.settlingTimeSec != null ? metrics.settlingTimeSec.toFixed(2) + "s" : "—"}`
      : "No telemetry data";
    ctx.fillText(meta, 16, 35);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(srcCanvas, 0, headerH * dpr);

    const url = outCanvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = url;
    link.download = `PENS_SPK_StepResponse_${Date.now()}.png`;
    link.click();
  };

  const hoveredSample = hoverIdx !== null ? visibleSamples[hoverIdx] : null;

  return (
    <div className="border border-[#dfe2e8] bg-white">
      {/* Chart Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#dfe2e8] px-4 py-2.5">
        <div className="flex items-center gap-4">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-[#0f172a]">
              TRANSIENT STEP RESPONSE
            </h2>
            <div className="mt-0.5 flex items-center gap-3 text-[11px]">
              <span className="inline-flex items-center gap-1.5 text-[#475569]">
                <span className="inline-block h-0.5 w-3.5 border-t-2 border-dashed border-[#ea580c]" />
                Setpoint (SP)
              </span>
              <span className="inline-flex items-center gap-1.5 text-[#475569]">
                <span className="inline-block h-0.5 w-3.5 bg-[#1d4ed8]" />
                Actual RPM
              </span>
              <button
                type="button"
                onClick={() => setShowBand((v) => !v)}
                className={`inline-flex items-center gap-1 text-[11px] transition-opacity ${
                  showBand ? "text-[#059669]" : "text-[#94a3b8] line-through"
                }`}
              >
                <span className="inline-block h-2.5 w-2.5 border border-[#059669]/40 bg-[#059669]/15" />
                ±2% Band
              </button>
            </div>
          </div>
        </div>

        {/* Plot Controls */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Sub-trace toggle */}
          <div className="flex border border-[#dfe2e8] bg-[#f5f5f3] p-0.5 font-mono text-[10px]">
            <button
              type="button"
              onClick={() => setSubTrace("pwm")}
              className={`px-2 py-0.5 ${
                subTrace === "pwm"
                  ? "bg-white font-semibold text-[#0f172a]"
                  : "text-[#64748b] hover:text-[#0f172a]"
              }`}
            >
              PWM
            </button>
            <button
              type="button"
              onClick={() => setSubTrace("error")}
              className={`px-2 py-0.5 ${
                subTrace === "error"
                  ? "bg-white font-semibold text-[#0f172a]"
                  : "text-[#64748b] hover:text-[#0f172a]"
              }`}
            >
              ERROR
            </button>
          </div>

          {/* Time Window */}
          <div className="flex border border-[#dfe2e8] bg-[#f5f5f3] p-0.5 font-mono text-[10px]">
            {([10, 20, 30, 60, 0] as TimeWindow[]).map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setTimeWindow(w)}
                className={`px-1.5 py-0.5 ${
                  timeWindow === w
                    ? "bg-white font-semibold text-[#0f172a]"
                    : "text-[#64748b] hover:text-[#0f172a]"
                }`}
              >
                {w === 0 ? "ALL" : `${w}s`}
              </button>
            ))}
          </div>

          {/* Freeze / Live */}
          <button
            type="button"
            onClick={toggleFreeze}
            className={`flex h-7 items-center gap-1 border px-2 font-mono text-[10px] font-semibold transition-colors ${
              isFrozen
                ? "border-amber-500 bg-amber-50 text-amber-800"
                : "border-[#dfe2e8] bg-white text-[#475569] hover:border-[#0f172a] hover:text-[#0f172a]"
            }`}
            title="Bekukan grafik untuk inspeksi tanpa menghentikan motor"
          >
            {isFrozen ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            <span>{isFrozen ? "RESUME" : "FREEZE"}</span>
          </button>

          <button
            type="button"
            onClick={onClearPlot}
            className="flex h-7 items-center gap-1 border border-[#dfe2e8] bg-white px-2 font-mono text-[10px] text-[#475569] hover:border-[#0f172a] hover:text-[#0f172a]"
            title="Bersihkan grafik"
          >
            <RotateCcw className="h-3 w-3" />
            <span>CLEAR</span>
          </button>

          <button
            type="button"
            onClick={handleExportPng}
            className="flex h-7 items-center gap-1 border border-[#dfe2e8] bg-white px-2 font-mono text-[10px] font-medium text-[#0f172a] hover:border-[#0f172a] hover:bg-[#f5f5f3]"
            title="Simpan grafik PNG untuk Laporan Praktikum"
          >
            <Camera className="h-3 w-3" />
            <span>PNG</span>
          </button>
        </div>
      </div>

      {/* Canvas Container + Hover Readout Bar */}
      <div ref={containerRef} className="relative w-full select-none p-2">
        <canvas
          ref={canvasRef}
          style={{ width: canvasSize.width, height: canvasSize.height }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIdx(null)}
          className="block cursor-crosshair"
        />

        {/* Floating Cursor Inspector */}
        {hoveredSample && (
          <div className="pointer-events-none absolute right-5 top-4 border border-[#0f172a] bg-white/95 px-2.5 py-1.5 font-mono text-[11px] tabular-nums shadow-sm">
            <div className="mb-0.5 flex items-center justify-between gap-4 border-b border-[#eceef2] pb-0.5 text-[10px] text-[#64748b]">
              <span>t = {hoveredSample.elapsedSec.toFixed(2)} s</span>
              <span>{hoveredSample.voltage.toFixed(1)} V</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
              <span className="text-[#ea580c]">SP: {hoveredSample.setpoint.toFixed(1)}</span>
              <span className="text-[#1d4ed8]">RPM: {hoveredSample.rpm.toFixed(1)}</span>
              <span className="text-[#475569]">
                ERR: {hoveredSample.error >= 0 ? "+" : ""}
                {hoveredSample.error.toFixed(1)}
              </span>
              <span className="text-[#0f172a]">PWM: {hoveredSample.pwm}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
