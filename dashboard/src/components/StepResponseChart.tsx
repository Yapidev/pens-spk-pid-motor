"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Pause, Pin, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  getResolvedColorScheme,
  subscribeColorSchemeChange,
  type ResolvedColorScheme,
} from "@/lib/theme";
import type {
  FopdtModel,
  SavedRunSnapshot,
  StepMetrics,
  TelemetrySample,
} from "@/types/telemetry";

interface StepResponseChartProps {
  samplesRef: React.RefObject<TelemetrySample[]>;
  telemetryVersionRef: React.RefObject<number>;
  metrics: StepMetrics;
  ghostRuns: SavedRunSnapshot[];
  fopdtModel: FopdtModel | null;
  showFopdtOverlay: boolean;
  onPinRun: () => void;
  onClearPlot: () => void;
  onExportPngSuccess?: () => void;
}

type TimeWindow = 10 | 20 | 30 | 60 | 0; // 0 = ALL
type SubTraceMode = "pwm" | "error" | "current";

interface ChartLayout {
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
  gap: number;
  plotW: number;
  mainH: number;
  subH: number;
  mainTop: number;
  subTop: number;
}

interface ChartDomains {
  tMin: number;
  tMax: number;
  yMinRpm: number;
  yMaxRpm: number;
  isBidirectionalRpm: boolean;
  isBidirectionalPwm: boolean;
  errAbsMax: number;
}

interface ChartPalette {
  bg: string;
  plotBg: string;
  grid: string;
  axis: string;
  inkPrimary: string;
  inkSecondary: string;
  inkMuted: string;
  sp: string;
  rpm: string;
  ok: string;
  danger: string;
  pwmStroke: string;
  pwmFill: string;
  bandFill: string;
  stepLine: string;
  tsLine: string;
  peakStroke: string;
}

const DEFAULT_LIGHT_PALETTE: ChartPalette = {
  bg: "#ffffff",
  plotBg: "#fafbfc",
  grid: "#eceff4",
  axis: "#d2d7e0",
  inkPrimary: "#11151d",
  inkSecondary: "#3d4656",
  inkMuted: "#5c6678",
  sp: "#ea580c",
  rpm: "#1d4ed8",
  ok: "#047857",
  danger: "#dc2626",
  pwmStroke: "#334155",
  pwmFill: "rgba(51, 65, 85, 0.08)",
  bandFill: "rgba(4, 120, 87, 0.09)",
  stepLine: "rgba(17, 21, 29, 0.25)",
  tsLine: "rgba(4, 120, 87, 0.45)",
  peakStroke: "#ffffff",
};

function readChartPalette(scheme: ResolvedColorScheme): ChartPalette {
  if (typeof window === "undefined") return DEFAULT_LIGHT_PALETTE;
  const styles = getComputedStyle(document.documentElement);
  const s = scheme === "dark" ? "dark" : "light";
  const pick = (name: string, fallback: string) =>
    styles.getPropertyValue(`--${name}-${s}`).trim() || fallback;

  return {
    bg: pick("chart-bg", scheme === "dark" ? "#0e1117" : "#ffffff"),
    plotBg: pick("chart-plot-bg", scheme === "dark" ? "#090b10" : "#fafbfc"),
    grid: pick("chart-grid", scheme === "dark" ? "#191e29" : "#eceff4"),
    axis: pick("chart-axis", scheme === "dark" ? "#2a3140" : "#d2d7e0"),
    inkPrimary: pick("ink-primary", scheme === "dark" ? "#edf1f7" : "#11151d"),
    inkSecondary: pick("ink-secondary", scheme === "dark" ? "#b4bece" : "#3d4656"),
    inkMuted: pick("ink-muted", scheme === "dark" ? "#8592a6" : "#5c6678"),
    sp: pick("accent-sp-bright", scheme === "dark" ? "#fb923c" : "#ea580c"),
    rpm: pick("accent-rpm", scheme === "dark" ? "#60a5fa" : "#1d4ed8"),
    ok: pick("accent-ok", scheme === "dark" ? "#34d399" : "#047857"),
    danger: pick("accent-danger", scheme === "dark" ? "#ef4444" : "#dc2626"),
    pwmStroke: pick("chart-pwm-stroke", scheme === "dark" ? "#cbd5e1" : "#334155"),
    pwmFill: pick(
      "chart-pwm-fill",
      scheme === "dark" ? "rgba(203, 213, 225, 0.10)" : "rgba(51, 65, 85, 0.08)"
    ),
    bandFill: pick(
      "chart-band-fill",
      scheme === "dark" ? "rgba(52, 211, 153, 0.12)" : "rgba(4, 120, 87, 0.09)"
    ),
    stepLine: pick(
      "chart-step-line",
      scheme === "dark" ? "rgba(237, 241, 247, 0.28)" : "rgba(17, 21, 29, 0.25)"
    ),
    tsLine: pick(
      "chart-ts-line",
      scheme === "dark" ? "rgba(52, 211, 153, 0.50)" : "rgba(4, 120, 87, 0.45)"
    ),
    peakStroke: scheme === "dark" ? "#090b10" : "#ffffff",
  };
}

function getVisibleRange(
  source: TelemetrySample[],
  timeWindow: TimeWindow
): { startIdx: number; endIdx: number } {
  const len = source.length;
  if (len === 0) return { startIdx: 0, endIdx: 0 };
  if (timeWindow === 0) return { startIdx: 0, endIdx: len };

  const latestT = source[len - 1].elapsedSec;
  const minT = latestT - timeWindow;
  let startIdx = 0;
  for (let i = len - 1; i >= 0; i--) {
    if (source[i].elapsedSec < minT) {
      startIdx = i;
      break;
    }
  }
  return { startIdx, endIdx: len };
}

function computeDomains(
  source: TelemetrySample[],
  startIdx: number,
  endIdx: number,
  timeWindow: TimeWindow,
  ghostRuns: SavedRunSnapshot[]
): ChartDomains {
  if (endIdx <= startIdx) {
    return {
      tMin: 0,
      tMax: timeWindow === 0 ? 20 : timeWindow,
      yMinRpm: 0,
      yMaxRpm: 500,
      isBidirectionalRpm: false,
      isBidirectionalPwm: false,
      errAbsMax: 100,
    };
  }

  const firstT = source[startIdx].elapsedSec;
  const lastT = source[endIdx - 1].elapsedSec;
  const tMin = timeWindow === 0 ? firstT : Math.max(0, lastT - timeWindow);
  const tMax =
    timeWindow === 0
      ? Math.max(firstT + 5, lastT)
      : Math.max(tMin + timeWindow, lastT);

  let maxVal = 150;
  let minVal = 0;
  let maxAbsErr = 25;
  let hasNegPwm = false;

  for (let i = startIdx; i < endIdx; i++) {
    const s = source[i];
    if (s.setpoint > maxVal) maxVal = s.setpoint;
    if (s.rpm > maxVal) maxVal = s.rpm;
    if (s.setpoint < minVal) minVal = s.setpoint;
    if (s.rpm < minVal) minVal = s.rpm;
    if (s.pwm < 0) hasNegPwm = true;
    const ae = Math.abs(s.error);
    if (ae > maxAbsErr) maxAbsErr = ae;
  }

  for (const run of ghostRuns) {
    if (!run.visible) continue;
    if (run.targetSetpoint > maxVal) maxVal = run.targetSetpoint;
    if (run.targetSetpoint < minVal) minVal = run.targetSetpoint;
    if (run.metrics.peakRpm !== null) {
      if (run.metrics.peakRpm > maxVal) maxVal = run.metrics.peakRpm;
      if (run.metrics.peakRpm < minVal) minVal = run.metrics.peakRpm;
    }
  }

  const isBidirectionalRpm = minVal < -5;
  let yMinRpm = 0;
  let yMaxRpm = Math.max(150, Math.ceil((maxVal * 1.15) / 50) * 50);

  if (isBidirectionalRpm) {
    const absBound = Math.max(
      150,
      Math.ceil((Math.max(Math.abs(maxVal), Math.abs(minVal)) * 1.15) / 50) * 50
    );
    yMinRpm = -absBound;
    yMaxRpm = absBound;
  }

  const errAbsMax = Math.max(25, Math.ceil((maxAbsErr * 1.15) / 25) * 25);

  return {
    tMin,
    tMax,
    yMinRpm,
    yMaxRpm,
    isBidirectionalRpm,
    isBidirectionalPwm: hasNegPwm,
    errAbsMax,
  };
}

export const StepResponseChart = React.memo(function StepResponseChart({
  samplesRef,
  telemetryVersionRef,
  metrics,
  ghostRuns,
  fopdtModel,
  showFopdtOverlay,
  onPinRun,
  onClearPlot,
  onExportPngSuccess,
}: StepResponseChartProps) {
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [timeWindow, setTimeWindow] = useState<TimeWindow>(20);
  const [subTrace, setSubTrace] = useState<SubTraceMode>("pwm");
  const [showBand, setShowBand] = useState(true);
  const [isFrozen, setIsFrozen] = useState(false);
  const [hoveredSample, setHoveredSample] = useState<TelemetrySample | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 420 });

  const frozenSamplesRef = useRef<TelemetrySample[]>([]);
  const isFrozenRef = useRef(false);
  const timeWindowRef = useRef<TimeWindow>(20);
  const subTraceRef = useRef<SubTraceMode>("pwm");
  const showBandRef = useRef(true);
  const metricsRef = useRef<StepMetrics>(metrics);
  const ghostRunsRef = useRef<SavedRunSnapshot[]>(ghostRuns);
  const fopdtModelRef = useRef<FopdtModel | null>(fopdtModel);
  const showFopdtRef = useRef<boolean>(showFopdtOverlay);
  const canvasSizeRef = useRef(canvasSize);
  const hoverIdxRef = useRef<number | null>(null);
  const lastDrawnVersionRef = useRef(-1);
  const needsRedrawRef = useRef(true);
  const paletteRef = useRef<ChartPalette>(DEFAULT_LIGHT_PALETTE);
  const fontsRef = useRef({
    sans: '"Space Grotesk", -apple-system, BlinkMacSystemFont, sans-serif',
    mono: '"IBM Plex Mono", ui-monospace, SFMono-Regular, monospace',
  });

  useEffect(() => {
    isFrozenRef.current = isFrozen;
    timeWindowRef.current = timeWindow;
    subTraceRef.current = subTrace;
    showBandRef.current = showBand;
    metricsRef.current = metrics;
    ghostRunsRef.current = ghostRuns;
    fopdtModelRef.current = fopdtModel;
    showFopdtRef.current = showFopdtOverlay;
    canvasSizeRef.current = canvasSize;
    needsRedrawRef.current = true;
  }, [
    isFrozen,
    timeWindow,
    subTrace,
    showBand,
    metrics,
    ghostRuns,
    fopdtModel,
    showFopdtOverlay,
    canvasSize,
  ]);

  useEffect(() => {
    const syncThemeAndFonts = (scheme: ResolvedColorScheme) => {
      paletteRef.current = readChartPalette(scheme);
      const styles = getComputedStyle(document.documentElement);
      const sans = styles.getPropertyValue("--font-sans-stack").trim();
      const mono = styles.getPropertyValue("--font-mono-stack").trim();
      if (sans || mono) {
        fontsRef.current = {
          sans: sans || fontsRef.current.sans,
          mono: mono || fontsRef.current.mono,
        };
      }
      needsRedrawRef.current = true;
    };

    syncThemeAndFonts(getResolvedColorScheme());
    const unsubscribe = subscribeColorSchemeChange((resolved) => {
      syncThemeAndFonts(resolved);
    });

    if (document.fonts && "ready" in document.fonts) {
      void document.fonts.ready.then(() => {
        needsRedrawRef.current = true;
      });
    }

    return unsubscribe;
  }, []);

  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;

    const applySize = (rawW: number, rawH: number) => {
      const nextWidth = Math.floor(rawW);
      const measuredHeight = Math.floor(rawH);
      if (nextWidth > 0) {
        const nextHeight =
          measuredHeight >= 260 ? measuredHeight : nextWidth < 640 ? 320 : 400;
        setCanvasSize((prev) =>
          prev.width === nextWidth && prev.height === nextHeight
            ? prev
            : { width: nextWidth, height: nextHeight }
        );
      }
    };

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      applySize(entry.contentRect.width, entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo<ChartLayout>(() => {
    const padLeft = 52;
    const padRight = 24;
    const padTop = 12;
    const padBottom = 26;
    const gap = 18;
    const plotW = Math.max(100, canvasSize.width - padLeft - padRight);
    const totalPlotH = Math.max(180, canvasSize.height - padTop - padBottom - gap);
    const mainH = Math.round(totalPlotH * 0.72);
    const subH = totalPlotH - mainH;
    const mainTop = padTop;
    const subTop = padTop + mainH + gap;

    return {
      padLeft,
      padRight,
      padTop,
      padBottom,
      gap,
      plotW,
      mainH,
      subH,
      mainTop,
      subTop,
    };
  }, [canvasSize]);

  const layoutRef = useRef<ChartLayout>(layout);
  useEffect(() => {
    layoutRef.current = layout;
    needsRedrawRef.current = true;
  }, [layout]);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height } = canvasSizeRef.current;
    const dpr = window.devicePixelRatio || 1;
    const targetW = Math.round(width * dpr);
    const targetH = Math.round(height * dpr);

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const source = isFrozenRef.current ? frozenSamplesRef.current : samplesRef.current;
    const tw = timeWindowRef.current;
    const st = subTraceRef.current;
    const sb = showBandRef.current;
    const m = metricsRef.current;
    const ghosts = ghostRunsRef.current;
    const fopdt = showFopdtRef.current ? fopdtModelRef.current : null;
    const lay = layoutRef.current;
    const fonts = fontsRef.current;
    const pal = paletteRef.current;

    const { startIdx, endIdx } = getVisibleRange(source, tw);
    const visibleCount = endIdx - startIdx;
    const domains = computeDomains(source, startIdx, endIdx, tw, ghosts);

    const { padLeft, plotW, mainH, subH, mainTop, subTop } = lay;
    const {
      tMin,
      tMax,
      yMinRpm,
      yMaxRpm,
      isBidirectionalRpm,
      isBidirectionalPwm,
      errAbsMax,
    } = domains;
    const tSpan = Math.max(0.001, tMax - tMin);
    const ySpanRpm = Math.max(1, yMaxRpm - yMinRpm);

    const xOf = (t: number) => padLeft + ((t - tMin) / tSpan) * plotW;
    const yRpmOf = (rpm: number) => {
      const clamped = Math.max(yMinRpm, Math.min(yMaxRpm, rpm));
      return mainTop + mainH - ((clamped - yMinRpm) / ySpanRpm) * mainH;
    };
    const yPwmOf = (pwm: number) => {
      if (isBidirectionalPwm) {
        const clamped = Math.max(-255, Math.min(255, pwm));
        return subTop + subH / 2 - (clamped / 255) * (subH / 2);
      }
      return subTop + subH - (Math.max(0, Math.min(255, pwm)) / 255) * subH;
    };
    const yCurOf = (amp: number) =>
      subTop + subH - (Math.max(0, Math.min(5, amp)) / 5) * subH;
    const yErrOf = (err: number) =>
      subTop +
      subH / 2 -
      (Math.max(-errAbsMax, Math.min(errAbsMax, err)) / errAbsMax) * (subH / 2);

    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = pal.plotBg;
    ctx.fillRect(padLeft, mainTop, plotW, mainH);
    ctx.fillRect(padLeft, subTop, plotW, subH);

    // Time ticks
    const xTickCount = width < 480 ? 4 : 6;
    ctx.font = `10px ${fonts.mono}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    for (let i = 0; i <= xTickCount; i++) {
      const frac = i / xTickCount;
      const x = Math.round(padLeft + frac * plotW) + 0.5;
      const tVal = tMin + frac * tSpan;

      ctx.strokeStyle = i === 0 || i === xTickCount ? pal.axis : pal.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, mainTop);
      ctx.lineTo(x, mainTop + mainH);
      ctx.moveTo(x, subTop);
      ctx.lineTo(x, subTop + subH);
      ctx.stroke();

      ctx.fillStyle = pal.inkMuted;
      ctx.fillText(`${tVal.toFixed(1)}s`, x, subTop + subH + 6);
    }

    // Main Y-axis ticks (RPM — supports bidirectional)
    const yTickCount = isBidirectionalRpm ? 4 : 5;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= yTickCount; i++) {
      const val = yMinRpm + (ySpanRpm * i) / yTickCount;
      const y = Math.round(yRpmOf(val)) + 0.5;
      const isZeroLine = Math.abs(val) < 0.5;

      ctx.strokeStyle = isZeroLine ? pal.axis : pal.grid;
      ctx.lineWidth = isZeroLine && isBidirectionalRpm ? 1.25 : 1;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + plotW, y);
      ctx.stroke();

      ctx.fillStyle = pal.inkMuted;
      ctx.fillText(String(Math.round(val)), padLeft - 7, y);
    }

    ctx.save();
    ctx.fillStyle = pal.inkMuted;
    ctx.font = `500 10px ${fonts.sans}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(isBidirectionalRpm ? "RPM (±)" : "RPM", padLeft + 7, mainTop + 5);
    ctx.restore();

    // Sub-pane Y-axis ticks
    ctx.font = `10px ${fonts.mono}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    if (st === "pwm") {
      const pwmTicks = isBidirectionalPwm ? [-255, 0, 255] : [0, 128, 255];
      for (const v of pwmTicks) {
        const y = Math.round(yPwmOf(v)) + 0.5;
        ctx.strokeStyle = v === 0 ? pal.axis : pal.grid;
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(padLeft + plotW, y);
        ctx.stroke();
        ctx.fillStyle = pal.inkMuted;
        ctx.fillText(String(v), padLeft - 7, y);
      }
    } else if (st === "current") {
      for (const v of [0, 2.5, 5]) {
        const y = Math.round(yCurOf(v)) + 0.5;
        ctx.strokeStyle = v === 0 ? pal.axis : pal.grid;
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(padLeft + plotW, y);
        ctx.stroke();
        ctx.fillStyle = pal.inkMuted;
        ctx.fillText(`${v}A`, padLeft - 7, y);
      }
    } else {
      for (const v of [-errAbsMax, 0, errAbsMax]) {
        const y = Math.round(yErrOf(v)) + 0.5;
        ctx.strokeStyle = v === 0 ? pal.axis : pal.grid;
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(padLeft + plotW, y);
        ctx.stroke();
        ctx.fillStyle = pal.inkMuted;
        ctx.fillText(v > 0 ? `+${v}` : String(v), padLeft - 7, y);
      }
    }

    ctx.fillStyle = pal.inkMuted;
    ctx.font = `500 10px ${fonts.sans}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(
      st === "pwm"
        ? isBidirectionalPwm
          ? "PWM (±255)"
          : "PWM (0–255)"
        : st === "current"
          ? "Arus (A)"
          : "Error (RPM)",
      padLeft + 7,
      subTop + 4
    );

    if (visibleCount > 0) {
      const latest = source[endIdx - 1];

      // ±2% Tolerance Band
      if (sb && latest.mode === 1 && Math.abs(latest.setpoint) >= 5) {
        const tol = Math.max(Math.abs(latest.setpoint) * 0.02, 2.0);
        const yHi = yRpmOf(latest.setpoint + tol);
        const yLo = yRpmOf(latest.setpoint - tol);
        ctx.fillStyle = pal.bandFill;
        ctx.fillRect(padLeft, Math.min(yHi, yLo), plotW, Math.max(2, Math.abs(yLo - yHi)));
      }

      // Step Start (t0) & Settling Time (Ts)
      if (
        m.hasStep &&
        m.stepStartTimeSec !== null &&
        m.stepStartTimeSec >= tMin &&
        m.stepStartTimeSec <= tMax
      ) {
        const sx = Math.round(xOf(m.stepStartTimeSec)) + 0.5;
        ctx.save();
        ctx.strokeStyle = pal.stepLine;
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx, mainTop);
        ctx.lineTo(sx, mainTop + mainH);
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = pal.inkMuted;
        ctx.font = `500 9.5px ${fonts.mono}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText("t₀", sx + 4, mainTop + 18);
      }

      if (
        m.hasStep &&
        m.isSettled &&
        m.stepStartTimeSec !== null &&
        m.settlingTimeSec !== null
      ) {
        const tsAbs = m.stepStartTimeSec + m.settlingTimeSec;
        if (tsAbs >= tMin && tsAbs <= tMax) {
          const tx = Math.round(xOf(tsAbs)) + 0.5;
          ctx.save();
          ctx.strokeStyle = pal.tsLine;
          ctx.setLineDash([3, 3]);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(tx, mainTop);
          ctx.lineTo(tx, mainTop + mainH);
          ctx.stroke();
          ctx.restore();

          ctx.fillStyle = pal.ok;
          ctx.font = `500 9.5px ${fonts.mono}`;
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
          ctx.fillText(`Ts ${m.settlingTimeSec.toFixed(1)}s`, tx + 4, mainTop + 31);
        }
      }

      // Sub-trace
      ctx.save();
      ctx.beginPath();
      ctx.rect(padLeft, subTop, plotW, subH);
      ctx.clip();

      if (st === "pwm") {
        const zeroY = yPwmOf(0);
        ctx.beginPath();
        for (let i = startIdx; i < endIdx; i++) {
          const s = source[i];
          const x = xOf(s.elapsedSec);
          const y = yPwmOf(s.pwm);
          if (i === startIdx) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.lineTo(xOf(source[endIdx - 1].elapsedSec), zeroY);
        ctx.lineTo(xOf(source[startIdx].elapsedSec), zeroY);
        ctx.closePath();
        ctx.fillStyle = pal.pwmFill;
        ctx.fill();

        ctx.beginPath();
        for (let i = startIdx; i < endIdx; i++) {
          const s = source[i];
          const x = xOf(s.elapsedSec);
          const y = yPwmOf(s.pwm);
          if (i === startIdx) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = pal.pwmStroke;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else if (st === "current") {
        ctx.beginPath();
        for (let i = startIdx; i < endIdx; i++) {
          const s = source[i];
          const x = xOf(s.elapsedSec);
          const y = yCurOf(s.currentAmp);
          if (i === startIdx) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.lineTo(xOf(source[endIdx - 1].elapsedSec), subTop + subH);
        ctx.lineTo(xOf(source[startIdx].elapsedSec), subTop + subH);
        ctx.closePath();
        ctx.fillStyle = pal.bandFill;
        ctx.fill();

        ctx.beginPath();
        for (let i = startIdx; i < endIdx; i++) {
          const s = source[i];
          const x = xOf(s.elapsedSec);
          const y = yCurOf(s.currentAmp);
          if (i === startIdx) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = pal.ok;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        ctx.beginPath();
        for (let i = startIdx; i < endIdx; i++) {
          const s = source[i];
          const x = xOf(s.elapsedSec);
          const y = yErrOf(s.error);
          if (i === startIdx) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = pal.danger;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.restore();

      // Main traces: Ghost Overlays + FOPDT Model + Setpoint + Actual RPM
      ctx.save();
      ctx.beginPath();
      ctx.rect(padLeft, mainTop, plotW, mainH);
      ctx.clip();

      // A/B Ghost Run Overlays (aligned to active step t0)
      const ghostOriginT = m.stepStartTimeSec ?? source[startIdx].elapsedSec;
      for (const run of ghosts) {
        if (!run.visible || run.points.length < 2) continue;
        ctx.save();
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < run.points.length; i++) {
          const pt = run.points[i];
          const absT = ghostOriginT + pt.relSec;
          if (absT < tMin - 0.5 || absT > tMax + 0.5) continue;
          const x = xOf(absT);
          const y = yRpmOf(pt.rpm);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.strokeStyle = run.color;
        ctx.globalAlpha = 0.72;
        ctx.lineWidth = 1.6;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.restore();
      }

      // FOPDT Identified Model Overlay (when enabled)
      if (fopdt && fopdt.predictedPoints.length >= 2) {
        ctx.save();
        ctx.beginPath();
        let started = false;
        for (const pt of fopdt.predictedPoints) {
          const absT = fopdt.stepStartSec + pt.relSec;
          if (absT < tMin - 0.5 || absT > tMax + 0.5) continue;
          const x = xOf(absT);
          const y = yRpmOf(pt.rpm);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.strokeStyle = pal.ok;
        ctx.lineWidth = 1.8;
        ctx.setLineDash([2, 3]);
        ctx.stroke();
        ctx.restore();
      }

      // Setpoint trace
      ctx.beginPath();
      for (let i = startIdx; i < endIdx; i++) {
        const s = source[i];
        const x = xOf(s.elapsedSec);
        const y = yRpmOf(s.setpoint);
        if (i === startIdx) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, yRpmOf(source[i - 1].setpoint));
          ctx.lineTo(x, y);
        }
      }
      ctx.strokeStyle = pal.sp;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Actual RPM trace
      ctx.beginPath();
      for (let i = startIdx; i < endIdx; i++) {
        const s = source[i];
        const x = xOf(s.elapsedSec);
        const y = yRpmOf(s.rpm);
        if (i === startIdx) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = pal.rpm;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.stroke();

      // Peak Overshoot dot
      if (
        m.hasStep &&
        m.overshootPct !== null &&
        m.overshootPct > 0.5 &&
        m.stepStartTimeSec !== null &&
        m.peakTimeSec !== null &&
        m.peakRpm !== null
      ) {
        const peakT = m.stepStartTimeSec + m.peakTimeSec;
        if (peakT >= tMin && peakT <= tMax) {
          const px = xOf(peakT);
          const py = yRpmOf(m.peakRpm);
          ctx.fillStyle = pal.danger;
          ctx.beginPath();
          ctx.arc(px, py, 3.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = pal.peakStroke;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      ctx.restore();

      // Hover Crosshair
      const hIdx = hoverIdxRef.current;
      if (hIdx !== null && hIdx >= startIdx && hIdx < endIdx) {
        const hs = source[hIdx];
        const hx = Math.round(xOf(hs.elapsedSec)) + 0.5;
        const hyRpm = yRpmOf(hs.rpm);
        const hySp = yRpmOf(hs.setpoint);

        ctx.save();
        ctx.strokeStyle = pal.inkMuted;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(hx, mainTop);
        ctx.lineTo(hx, mainTop + mainH);
        ctx.moveTo(hx, subTop);
        ctx.lineTo(hx, subTop + subH);
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = pal.sp;
        ctx.beginPath();
        ctx.arc(hx, hySp, 3.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = pal.rpm;
        ctx.beginPath();
        ctx.arc(hx, hyRpm, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.fillStyle = pal.inkMuted;
      ctx.font = `12px ${fonts.mono}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        "Menunggu data telemetri...",
        padLeft + plotW / 2,
        mainTop + mainH / 2
      );
    }

    ctx.strokeStyle = pal.axis;
    ctx.lineWidth = 1;
    ctx.strokeRect(padLeft + 0.5, mainTop + 0.5, plotW, mainH);
    ctx.strokeRect(padLeft + 0.5, subTop + 0.5, plotW, subH);
  }, [samplesRef]);

  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      const currentVersion = telemetryVersionRef.current;
      if (
        needsRedrawRef.current ||
        (!isFrozenRef.current && currentVersion !== lastDrawnVersionRef.current)
      ) {
        lastDrawnVersionRef.current = currentVersion;
        needsRedrawRef.current = false;
        drawCanvas();
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [drawCanvas, telemetryVersionRef]);

  const toggleFreeze = () => {
    if (!isFrozen) {
      frozenSamplesRef.current = samplesRef.current.slice();
      setIsFrozen(true);
    } else {
      frozenSamplesRef.current = [];
      setIsFrozen(false);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const source = isFrozenRef.current ? frozenSamplesRef.current : samplesRef.current;
    const { startIdx, endIdx } = getVisibleRange(source, timeWindowRef.current);
    if (endIdx <= startIdx) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const { padLeft, plotW } = layoutRef.current;
    if (x < padLeft || x > padLeft + plotW) {
      if (hoverIdxRef.current !== null) {
        hoverIdxRef.current = null;
        needsRedrawRef.current = true;
        setHoveredSample(null);
      }
      return;
    }

    const { tMin, tMax } = computeDomains(
      source,
      startIdx,
      endIdx,
      timeWindowRef.current,
      ghostRunsRef.current
    );
    const targetT = tMin + ((x - padLeft) / plotW) * (tMax - tMin);

    let lo = startIdx;
    let hi = endIdx - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (source[mid].elapsedSec < targetT) lo = mid + 1;
      else hi = mid;
    }
    if (
      lo > startIdx &&
      Math.abs(source[lo - 1].elapsedSec - targetT) <
        Math.abs(source[lo].elapsedSec - targetT)
    ) {
      lo = lo - 1;
    }

    if (hoverIdxRef.current !== lo) {
      hoverIdxRef.current = lo;
      needsRedrawRef.current = true;
      setHoveredSample(source[lo]);
    }
  };

  const handleMouseLeave = () => {
    if (hoverIdxRef.current !== null) {
      hoverIdxRef.current = null;
      needsRedrawRef.current = true;
      setHoveredSample(null);
    }
  };

  const handleExportPng = () => {
    const srcCanvas = canvasRef.current;
    if (!srcCanvas) return;

    const dpr = window.devicePixelRatio || 1;
    const headerH = 42;
    const outCanvas = document.createElement("canvas");
    outCanvas.width = srcCanvas.width;
    outCanvas.height = srcCanvas.height + headerH * dpr;
    const ctx = outCanvas.getContext("2d");
    if (!ctx) return;

    const source = isFrozenRef.current ? frozenSamplesRef.current : samplesRef.current;
    const latest = source.length > 0 ? source[source.length - 1] : null;
    const fonts = fontsRef.current;
    const pal = paletteRef.current;

    ctx.scale(dpr, dpr);
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, canvasSize.width, canvasSize.height + headerH);

    ctx.fillStyle = pal.inkPrimary;
    ctx.font = `600 12px ${fonts.sans}`;
    ctx.fillText("PENS SPK — 2-DOF PID Step Response (Setpoint vs Actual RPM)", 16, 17);

    ctx.fillStyle = pal.inkSecondary;
    ctx.font = `11px ${fonts.mono}`;
    const meta = latest
      ? `Kp=${latest.kp.toFixed(2)}  Ki=${latest.ki.toFixed(2)}  Kd=${latest.kd.toFixed(3)}  FF=${latest.flags.ffEnabled ? "ON" : "OFF"}  |  Tr=${metrics.riseTimeSec != null ? metrics.riseTimeSec.toFixed(2) + "s" : "—"}  OS=${metrics.overshootPct != null ? metrics.overshootPct.toFixed(1) + "%" : "—"}  Ts=${metrics.settlingTimeSec != null ? metrics.settlingTimeSec.toFixed(2) + "s" : "—"}`
      : "No telemetry data";
    ctx.fillText(meta, 16, 33);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(srcCanvas, 0, headerH * dpr);

    const url = outCanvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = url;
    link.download = `PENS_SPK_StepResponse_${Date.now()}.png`;
    link.click();
    onExportPngSuccess?.();
  };

  const visibleGhostCount = ghostRuns.filter((r) => r.visible).length;

  const chartSummary = metrics.hasStep
    ? `Grafik respon step dari ${metrics.initialRpm.toFixed(0)} ke ${metrics.targetSetpoint.toFixed(0)} RPM. Rise time ${metrics.riseTimeSec != null ? metrics.riseTimeSec.toFixed(2) + " detik" : "belum tercapai"}, overshoot ${metrics.overshootPct != null ? metrics.overshootPct.toFixed(1) + "%" : "belum terukur"}, settling time ${metrics.settlingTimeSec != null ? metrics.settlingTimeSec.toFixed(2) + " detik" : "belum stabil"}.`
    : "Grafik osiloskop real-time perbandingan Setpoint dan Actual RPM motor DC 24V beserta PWM, error, arus, dan overlay referensi.";

  return (
    <section
      aria-labelledby="oscilloscope-heading"
      className="panel-isolated flex min-h-[340px] flex-1 flex-col bg-[var(--chart-bg)]"
    >
      {/* Quiet Single-Line Oscilloscope Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-3.5 py-1.5">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <h2
            id="oscilloscope-heading"
            className="text-xs font-semibold text-foreground"
          >
            Osiloskop
          </h2>
          <span className="inline-flex items-center gap-1.5 text-[var(--ink-secondary)]">
            <span
              aria-hidden="true"
              className="inline-block h-0.5 w-3 border-t-2 border-dashed border-[var(--accent-sp-bright)]"
            />
            SP
          </span>
          <span className="inline-flex items-center gap-1.5 text-[var(--ink-secondary)]">
            <span
              aria-hidden="true"
              className="inline-block h-0.5 w-3 bg-[var(--accent-rpm)]"
            />
            RPM
          </span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-pressed={showBand}
            onClick={() => setShowBand((v) => !v)}
            className={cn(
              "h-7 gap-1.5 rounded-sm px-1.5 text-xs font-normal",
              showBand
                ? "text-[var(--accent-ok)] hover:bg-[var(--accent-ok-bg)] hover:text-[var(--accent-ok)]"
                : "text-muted-foreground line-through hover:text-foreground"
            )}
          >
            <span
              aria-hidden="true"
              className="inline-block size-2 border border-[var(--accent-ok-border)] bg-[var(--accent-ok-bg)]"
            />
            ±2%
          </Button>
          {visibleGhostCount > 0 ? (
            <span className="font-mono text-[0.6875rem] text-muted-foreground">
              +{visibleGhostCount} overlay
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* Sub-trace selector (semantic radiogroup — zero dangling aria-controls) */}
          <div
            role="radiogroup"
            aria-label="Sub-grafik bawah"
            className="inline-flex h-7 items-center rounded-sm border border-border bg-muted p-0.5 font-mono text-[0.6875rem]"
          >
            {(
              [
                ["pwm", "PWM"],
                ["error", "Err"],
                ["current", "Arus"],
              ] as const
            ).map(([key, label]) => {
              const active = subTrace === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setSubTrace(key)}
                  className={cn(
                    "inline-flex h-full items-center justify-center rounded-[2px] px-2 whitespace-nowrap transition-colors",
                    active
                      ? "bg-card font-semibold text-foreground shadow-2xs"
                      : "text-[var(--ink-secondary)] hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Timebase window (semantic radiogroup with fixed widths to prevent font-swap CLS) */}
          <div
            role="radiogroup"
            aria-label="Jendela waktu"
            className="inline-flex h-7 items-center rounded-sm border border-border bg-muted p-0.5 font-mono text-[0.6875rem]"
          >
            {([10, 20, 30, 60, 0] as TimeWindow[]).map((w) => {
              const active = timeWindow === w;
              return (
                <button
                  key={w}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setTimeWindow(w)}
                  className={cn(
                    "inline-flex h-full w-8 items-center justify-center rounded-[2px] whitespace-nowrap transition-colors",
                    active
                      ? "bg-card font-semibold text-foreground shadow-2xs"
                      : "text-[var(--ink-secondary)] hover:text-foreground"
                  )}
                >
                  {w === 0 ? "All" : `${w}s`}
                </button>
              );
            })}
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={!metrics.hasStep}
                onClick={onPinRun}
                className="h-7 gap-1 rounded-sm border-input bg-card px-2 text-xs font-medium text-[var(--ink-secondary)] shadow-none hover:border-[var(--border-strong)] hover:text-foreground dark:bg-card"
              >
                <Pin aria-hidden="true" className="size-3" />
                <span>Pin</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Simpan kurva ini sebagai overlay perbandingan A/B</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={toggleFreeze}
                className={cn(
                  "h-7 gap-1 rounded-sm px-2 text-xs font-medium shadow-none",
                  isFrozen
                    ? "border-[var(--accent-warn-border)] bg-[var(--accent-warn-bg)] text-[var(--accent-warn)] hover:bg-[var(--accent-warn-bg-hover)] hover:text-[var(--accent-warn)] dark:border-[var(--accent-warn-border)] dark:bg-[var(--accent-warn-bg)]"
                    : "border-input bg-card text-[var(--ink-secondary)] hover:border-[var(--border-strong)] hover:text-foreground dark:bg-card"
                )}
              >
                {isFrozen ? (
                  <Play aria-hidden="true" className="size-3" />
                ) : (
                  <Pause aria-hidden="true" className="size-3" />
                )}
                <span>{isFrozen ? "Lanjut" : "Freeze"}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Bekukan grafik tanpa menghentikan motor</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon-xs"
                onClick={() => {
                  hoverIdxRef.current = null;
                  setHoveredSample(null);
                  if (isFrozenRef.current) frozenSamplesRef.current = [];
                  onClearPlot();
                  needsRedrawRef.current = true;
                }}
                aria-label="Bersihkan grafik"
                className="size-7 rounded-sm border-input bg-card text-[var(--ink-secondary)] shadow-none hover:border-[var(--border-strong)] hover:text-foreground dark:bg-card"
              >
                <RotateCcw aria-hidden="true" className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Bersihkan grafik</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={handleExportPng}
                className="h-7 gap-1 rounded-sm border-input bg-card px-2 text-xs font-medium text-foreground shadow-none hover:border-[var(--border-strong)] dark:bg-card"
              >
                <Camera aria-hidden="true" className="size-3" />
                <span>PNG</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Simpan grafik PNG</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Full-Bleed Canvas Workspace */}
      <figure className="m-0 flex min-h-0 flex-1 flex-col p-1.5">
        <div ref={canvasWrapRef} className="relative min-h-[280px] w-full flex-1 select-none">
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={chartSummary}
            style={{ width: canvasSize.width, height: canvasSize.height }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            className="block max-w-full cursor-crosshair"
          />

          {hoveredSample ? (
            <div className="pointer-events-none absolute right-3 top-2 rounded-sm border border-[var(--border-control)] bg-[var(--bg-surface)]/95 px-2.5 py-1.5 font-mono text-[0.6875rem] tabular-nums shadow-sm">
              <div className="mb-1 flex items-center justify-between gap-4 border-b border-[var(--border-hairline)] pb-0.5 text-[var(--ink-muted)]">
                <span>t = {hoveredSample.elapsedSec.toFixed(2)}s</span>
                <span>
                  {hoveredSample.voltage.toFixed(1)}V · {hoveredSample.currentAmp.toFixed(2)}A
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                <span className="text-[var(--accent-sp)]">
                  SP {hoveredSample.setpoint.toFixed(1)}
                </span>
                <span className="text-[var(--accent-rpm)]">
                  RPM {hoveredSample.rpm.toFixed(1)}
                </span>
                <span className="text-[var(--ink-secondary)]">
                  Err {hoveredSample.error >= 0 ? "+" : ""}
                  {hoveredSample.error.toFixed(1)}
                </span>
                <span className="text-[var(--ink-primary)]">
                  PWM {hoveredSample.pwm}
                  {hoveredSample.flags.ffEnabled
                    ? ` (FF ${hoveredSample.ffPwm.toFixed(0)})`
                    : ""}
                </span>
              </div>
            </div>
          ) : null}
        </div>
        <figcaption className="visually-hidden">{chartSummary}</figcaption>
      </figure>
    </section>
  );
});
