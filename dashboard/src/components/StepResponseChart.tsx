"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Pause, Play, RotateCcw } from "lucide-react";
import {
  getResolvedColorScheme,
  subscribeColorSchemeChange,
  type ResolvedColorScheme,
} from "@/lib/theme";
import type { StepMetrics, TelemetrySample } from "@/types/telemetry";

interface StepResponseChartProps {
  samplesRef: React.RefObject<TelemetrySample[]>;
  telemetryVersionRef: React.RefObject<number>;
  metrics: StepMetrics;
  onClearPlot: () => void;
  onExportPngSuccess?: () => void;
}

type TimeWindow = 10 | 20 | 30 | 60 | 0; // 0 = ALL
type SubTraceMode = "pwm" | "error";

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
  yMaxRpm: number;
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
  plotBg: "#fcfcfb",
  grid: "#eef0f4",
  axis: "#cbd5e1",
  inkPrimary: "#0f172a",
  inkSecondary: "#334155",
  inkMuted: "#526075",
  sp: "#ea580c",
  rpm: "#1d4ed8",
  ok: "#047857",
  danger: "#dc2626",
  pwmStroke: "#0f172a",
  pwmFill: "rgba(15, 23, 42, 0.08)",
  bandFill: "rgba(4, 120, 87, 0.10)",
  stepLine: "rgba(15, 23, 42, 0.30)",
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
    bg: pick("chart-bg", scheme === "dark" ? "#111827" : "#ffffff"),
    plotBg: pick("chart-plot-bg", scheme === "dark" ? "#0b1120" : "#fcfcfb"),
    grid: pick("chart-grid", scheme === "dark" ? "#1e293b" : "#eef0f4"),
    axis: pick("chart-axis", scheme === "dark" ? "#334155" : "#cbd5e1"),
    inkPrimary: pick("ink-primary", scheme === "dark" ? "#f1f5f9" : "#0f172a"),
    inkSecondary: pick("ink-secondary", scheme === "dark" ? "#cbd5e1" : "#334155"),
    inkMuted: pick("ink-muted", scheme === "dark" ? "#94a3b8" : "#526075"),
    sp: pick("accent-sp-bright", scheme === "dark" ? "#fb923c" : "#ea580c"),
    rpm: pick("accent-rpm", scheme === "dark" ? "#60a5fa" : "#1d4ed8"),
    ok: pick("accent-ok", scheme === "dark" ? "#34d399" : "#047857"),
    danger: pick("accent-danger", scheme === "dark" ? "#ef4444" : "#dc2626"),
    pwmStroke: pick("chart-pwm-stroke", scheme === "dark" ? "#e2e8f0" : "#0f172a"),
    pwmFill: pick(
      "chart-pwm-fill",
      scheme === "dark" ? "rgba(226, 232, 240, 0.12)" : "rgba(15, 23, 42, 0.08)"
    ),
    bandFill: pick(
      "chart-band-fill",
      scheme === "dark" ? "rgba(52, 211, 153, 0.14)" : "rgba(4, 120, 87, 0.10)"
    ),
    stepLine: pick(
      "chart-step-line",
      scheme === "dark" ? "rgba(226, 232, 240, 0.35)" : "rgba(15, 23, 42, 0.30)"
    ),
    tsLine: pick(
      "chart-ts-line",
      scheme === "dark" ? "rgba(52, 211, 153, 0.50)" : "rgba(4, 120, 87, 0.45)"
    ),
    peakStroke: scheme === "dark" ? "#0b1120" : "#ffffff",
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
  timeWindow: TimeWindow
): ChartDomains {
  if (endIdx <= startIdx) {
    return {
      tMin: 0,
      tMax: timeWindow === 0 ? 20 : timeWindow,
      yMaxRpm: 250,
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

  let maxVal = 100;
  let maxAbsErr = 25;
  for (let i = startIdx; i < endIdx; i++) {
    const s = source[i];
    if (s.setpoint > maxVal) maxVal = s.setpoint;
    if (s.rpm > maxVal) maxVal = s.rpm;
    const ae = Math.abs(s.error);
    if (ae > maxAbsErr) maxAbsErr = ae;
  }

  const yMaxRpm = Math.max(100, Math.ceil((maxVal * 1.16) / 50) * 50);
  const errAbsMax = Math.max(25, Math.ceil((maxAbsErr * 1.15) / 25) * 25);

  return { tMin, tMax, yMaxRpm, errAbsMax };
}

export const StepResponseChart = React.memo(function StepResponseChart({
  samplesRef,
  telemetryVersionRef,
  metrics,
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

  // Refs untuk render loop rAF agar bebas re-render React 20–60 FPS
  const frozenSamplesRef = useRef<TelemetrySample[]>([]);
  const isFrozenRef = useRef(false);
  const timeWindowRef = useRef<TimeWindow>(20);
  const subTraceRef = useRef<SubTraceMode>("pwm");
  const showBandRef = useRef(true);
  const metricsRef = useRef<StepMetrics>(metrics);
  const canvasSizeRef = useRef(canvasSize);
  const hoverIdxRef = useRef<number | null>(null);
  const lastDrawnVersionRef = useRef(-1);
  const needsRedrawRef = useRef(true);
  const paletteRef = useRef<ChartPalette>(DEFAULT_LIGHT_PALETTE);
  const fontsRef = useRef({
    sans: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
    mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace',
  });

  // Sinkronkan state UI & props ke refs dan tandai redraw
  useEffect(() => {
    isFrozenRef.current = isFrozen;
    timeWindowRef.current = timeWindow;
    subTraceRef.current = subTrace;
    showBandRef.current = showBand;
    metricsRef.current = metrics;
    canvasSizeRef.current = canvasSize;
    needsRedrawRef.current = true;
  }, [isFrozen, timeWindow, subTrace, showBand, metrics, canvasSize]);

  // Sinkronkan font aktual dan palet tema (light / dark) termasuk perubahan OS & tab lain
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

  // Ukur lebar unpadded inner wrapper (mencegah canvas overflow ke luar border kartu)
  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;

    const update = () => {
      const nextWidth = Math.floor(el.clientWidth);
      if (nextWidth > 0) {
        const nextHeight = nextWidth < 640 ? 340 : 420;
        setCanvasSize((prev) =>
          prev.width === nextWidth && prev.height === nextHeight
            ? prev
            : { width: nextWidth, height: nextHeight }
        );
      }
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo<ChartLayout>(() => {
    const padLeft = 54;
    const padRight = 26;
    const padTop = 18;
    const padBottom = 28;
    const gap = 22;
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
    const lay = layoutRef.current;
    const fonts = fontsRef.current;
    const pal = paletteRef.current;

    const { startIdx, endIdx } = getVisibleRange(source, tw);
    const visibleCount = endIdx - startIdx;
    const domains = computeDomains(source, startIdx, endIdx, tw);

    const { padLeft, plotW, mainH, subH, mainTop, subTop } = lay;
    const { tMin, tMax, yMaxRpm, errAbsMax } = domains;
    const tSpan = Math.max(0.001, tMax - tMin);

    const xOf = (t: number) => padLeft + ((t - tMin) / tSpan) * plotW;
    const yRpmOf = (rpm: number) =>
      mainTop + mainH - (Math.max(0, Math.min(yMaxRpm, rpm)) / yMaxRpm) * mainH;
    const yPwmOf = (pwm: number) =>
      subTop + subH - (Math.max(0, Math.min(255, pwm)) / 255) * subH;
    const yErrOf = (err: number) =>
      subTop +
      subH / 2 -
      (Math.max(-errAbsMax, Math.min(errAbsMax, err)) / errAbsMax) * (subH / 2);

    // 1. Surface background
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, width, height);

    // 2. Plot area frames
    ctx.fillStyle = pal.plotBg;
    ctx.fillRect(padLeft, mainTop, plotW, mainH);
    ctx.fillRect(padLeft, subTop, plotW, subH);

    // 3. Grid lines (Vertical time ticks)
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
      ctx.fillText(`${tVal.toFixed(1)}s`, x, subTop + subH + 7);
    }

    // 4. Grid lines (Main Y-axis RPM ticks)
    const yTickCount = 5;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= yTickCount; i++) {
      const val = (yMaxRpm * i) / yTickCount;
      const y = Math.round(yRpmOf(val)) + 0.5;

      ctx.strokeStyle = i === 0 ? pal.axis : pal.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + plotW, y);
      ctx.stroke();

      ctx.fillStyle = pal.inkMuted;
      ctx.fillText(String(Math.round(val)), padLeft - 8, y);
    }

    // Main Y-axis label
    ctx.save();
    ctx.fillStyle = pal.inkSecondary;
    ctx.font = `600 9.5px ${fonts.sans}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("SPEED (RPM)", padLeft + 6, mainTop + 5);
    ctx.restore();

    // 5. Sub-pane Y-axis ticks (PWM or Error)
    ctx.font = `10px ${fonts.mono}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    if (st === "pwm") {
      for (const v of [0, 128, 255]) {
        const y = Math.round(yPwmOf(v)) + 0.5;
        ctx.strokeStyle = v === 0 ? pal.axis : pal.grid;
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(padLeft + plotW, y);
        ctx.stroke();
        ctx.fillStyle = pal.inkMuted;
        ctx.fillText(String(v), padLeft - 8, y);
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
        ctx.fillText(v > 0 ? `+${v}` : String(v), padLeft - 8, y);
      }
    }

    // Sub-pane label
    ctx.fillStyle = pal.inkSecondary;
    ctx.font = `600 9.5px ${fonts.sans}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(
      st === "pwm" ? "ACTUATOR EFFORT (PWM 0–255)" : "TRACKING ERROR (SP − RPM)",
      padLeft + 6,
      subTop + 4
    );

    if (visibleCount > 0) {
      const latest = source[endIdx - 1];

      // 6. Optional ±2% Settling Tolerance Band around active Setpoint
      if (sb && latest.mode === 1 && latest.setpoint >= 5) {
        const tol = Math.max(latest.setpoint * 0.02, 1.0);
        const yHi = yRpmOf(latest.setpoint + tol);
        const yLo = yRpmOf(latest.setpoint - tol);
        ctx.fillStyle = pal.bandFill;
        ctx.fillRect(padLeft, yHi, plotW, Math.max(2, yLo - yHi));
      }

      // 7. Step Start Marker (t0) & Settling Time Marker (Ts)
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

        ctx.fillStyle = pal.inkSecondary;
        ctx.font = `600 9.5px ${fonts.mono}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText("STEP t₀", sx + 4, mainTop + 19);
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
          ctx.font = `600 9.5px ${fonts.mono}`;
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
          ctx.fillText(`Ts ${m.settlingTimeSec.toFixed(1)}s`, tx + 4, mainTop + 32);
        }
      }

      // 8. Sub-trace Plot (PWM or Error)
      ctx.save();
      ctx.beginPath();
      ctx.rect(padLeft, subTop, plotW, subH);
      ctx.clip();

      if (st === "pwm") {
        ctx.beginPath();
        for (let i = startIdx; i < endIdx; i++) {
          const s = source[i];
          const x = xOf(s.elapsedSec);
          const y = yPwmOf(s.pwm);
          if (i === startIdx) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        const lastX = xOf(source[endIdx - 1].elapsedSec);
        const firstX = xOf(source[startIdx].elapsedSec);
        ctx.lineTo(lastX, subTop + subH);
        ctx.lineTo(firstX, subTop + subH);
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

      // 9. Main Plot: Setpoint (Step curve, Signal Orange dashed)
      ctx.save();
      ctx.beginPath();
      ctx.rect(padLeft, mainTop, plotW, mainH);
      ctx.clip();

      ctx.beginPath();
      for (let i = startIdx; i < endIdx; i++) {
        const s = source[i];
        const x = xOf(s.elapsedSec);
        const y = yRpmOf(s.setpoint);
        if (i === startIdx) {
          ctx.moveTo(x, y);
        } else {
          const prevY = yRpmOf(source[i - 1].setpoint);
          ctx.lineTo(x, prevY);
          ctx.lineTo(x, y);
        }
      }
      ctx.strokeStyle = pal.sp;
      ctx.lineWidth = 1.75;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // 10. Main Plot: Actual RPM (Precision Blue solid)
      ctx.beginPath();
      for (let i = startIdx; i < endIdx; i++) {
        const s = source[i];
        const x = xOf(s.elapsedSec);
        const y = yRpmOf(s.rpm);
        if (i === startIdx) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = pal.rpm;
      ctx.lineWidth = 2.1;
      ctx.lineJoin = "round";
      ctx.stroke();

      // 11. Peak Overshoot Marker
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

      // 12. Interactive Hover Crosshair
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
        "MENUNGGU DATA TELEMETRI SERIAL...",
        padLeft + plotW / 2,
        mainTop + mainH / 2
      );
    }

    // Crisp outer borders for both plot frames
    ctx.strokeStyle = pal.axis;
    ctx.lineWidth = 1;
    ctx.strokeRect(padLeft + 0.5, mainTop + 0.5, plotW, mainH);
    ctx.strokeRect(padLeft + 0.5, subTop + 0.5, plotW, subH);
  }, [samplesRef]);

  // rAF loop ringan: hanya menggambar ulang jika telemetryVersion atau UI/tema berubah
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

    const { tMin, tMax } = computeDomains(source, startIdx, endIdx, timeWindowRef.current);
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
    const headerH = 44;
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
    ctx.fillText("PENS SPK — STEP RESPONSE (SETPOINT vs ACTUAL RPM)", 16, 18);

    ctx.fillStyle = pal.inkSecondary;
    ctx.font = `11px ${fonts.mono}`;
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
    onExportPngSuccess?.();
  };

  const chartSummary = metrics.hasStep
    ? `Grafik respon step dari ${metrics.initialRpm.toFixed(0)} ke ${metrics.targetSetpoint.toFixed(0)} RPM. Rise time ${metrics.riseTimeSec != null ? metrics.riseTimeSec.toFixed(2) + " detik" : "belum tercapai"}, overshoot ${metrics.overshootPct != null ? metrics.overshootPct.toFixed(1) + "%" : "belum terukur"}, settling time ${metrics.settlingTimeSec != null ? metrics.settlingTimeSec.toFixed(2) + " detik" : "belum stabil"}.`
    : "Grafik osiloskop real-time perbandingan Setpoint dan Actual RPM motor DC 24V beserta effort PWM dan tracking error.";

  return (
    <section
      aria-labelledby="step-response-heading"
      className="panel-isolated overflow-hidden border border-[var(--border-hairline)] bg-[var(--bg-surface)]"
    >
      {/* Chart Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-hairline)] px-4 py-2.5">
        <div className="flex items-center gap-4">
          <div>
            <h2
              id="step-response-heading"
              className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--ink-primary)]"
            >
              TRANSIENT STEP RESPONSE
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="inline-flex items-center gap-1.5 text-[var(--ink-secondary)]">
                <span
                  aria-hidden="true"
                  className="inline-block h-0.5 w-3.5 border-t-2 border-dashed border-[var(--accent-sp-bright)]"
                />
                Setpoint (SP)
              </span>
              <span className="inline-flex items-center gap-1.5 text-[var(--ink-secondary)]">
                <span
                  aria-hidden="true"
                  className="inline-block h-0.5 w-3.5 bg-[var(--accent-rpm)]"
                />
                Actual RPM
              </span>
              <button
                type="button"
                aria-pressed={showBand}
                onClick={() => setShowBand((v) => !v)}
                className={`inline-flex min-h-7 items-center gap-1.5 px-1.5 py-0.5 text-xs font-medium transition-colors ${
                  showBand
                    ? "text-[var(--accent-ok)] hover:bg-[var(--accent-ok-bg)]"
                    : "text-[var(--ink-muted)] line-through hover:text-[var(--ink-primary)]"
                }`}
              >
                <span
                  aria-hidden="true"
                  className="inline-block h-2.5 w-2.5 border border-[var(--accent-ok-border)] bg-[var(--accent-ok-bg)]"
                />
                ±2% Band
              </button>
            </div>
          </div>
        </div>

        {/* Plot Controls */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Sub-trace toggle */}
          <div
            role="group"
            aria-label="Jenis sub-grafik bawah"
            className="flex border border-[var(--border-control)] bg-[var(--bg-subtle)] p-0.5 font-mono text-[0.6875rem]"
          >
            <button
              type="button"
              aria-pressed={subTrace === "pwm"}
              onClick={() => setSubTrace("pwm")}
              className={`min-h-7 px-2.5 py-1 transition-colors ${
                subTrace === "pwm"
                  ? "bg-[var(--bg-surface)] font-semibold text-[var(--ink-primary)] shadow-[inset_0_0_0_1px_var(--border-control)]"
                  : "text-[var(--ink-muted)] hover:text-[var(--ink-primary)]"
              }`}
            >
              PWM
            </button>
            <button
              type="button"
              aria-pressed={subTrace === "error"}
              onClick={() => setSubTrace("error")}
              className={`min-h-7 px-2.5 py-1 transition-colors ${
                subTrace === "error"
                  ? "bg-[var(--bg-surface)] font-semibold text-[var(--ink-primary)] shadow-[inset_0_0_0_1px_var(--border-control)]"
                  : "text-[var(--ink-muted)] hover:text-[var(--ink-primary)]"
              }`}
            >
              ERROR
            </button>
          </div>

          {/* Time Window */}
          <div
            role="group"
            aria-label="Jendela waktu grafik"
            className="flex border border-[var(--border-control)] bg-[var(--bg-subtle)] p-0.5 font-mono text-[0.6875rem]"
          >
            {([10, 20, 30, 60, 0] as TimeWindow[]).map((w) => (
              <button
                key={w}
                type="button"
                aria-pressed={timeWindow === w}
                onClick={() => setTimeWindow(w)}
                className={`min-h-7 min-w-8 px-2 py-1 transition-colors ${
                  timeWindow === w
                    ? "bg-[var(--bg-surface)] font-semibold text-[var(--ink-primary)] shadow-[inset_0_0_0_1px_var(--border-control)]"
                    : "text-[var(--ink-muted)] hover:text-[var(--ink-primary)]"
                }`}
              >
                {w === 0 ? "ALL" : `${w}s`}
              </button>
            ))}
          </div>

          {/* Freeze / Resume */}
          <button
            type="button"
            onClick={toggleFreeze}
            className={`flex min-h-8 items-center gap-1.5 border px-2.5 py-1 font-mono text-[0.6875rem] font-semibold transition-colors ${
              isFrozen
                ? "border-[var(--accent-warn-border)] bg-[var(--accent-warn-bg)] text-[var(--accent-warn)]"
                : "border-[var(--border-control)] bg-[var(--bg-surface)] text-[var(--ink-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--ink-primary)]"
            }`}
            title="Bekukan grafik untuk inspeksi tanpa menghentikan motor"
          >
            {isFrozen ? (
              <Play aria-hidden="true" className="h-3.5 w-3.5" />
            ) : (
              <Pause aria-hidden="true" className="h-3.5 w-3.5" />
            )}
            <span>{isFrozen ? "RESUME" : "FREEZE"}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              hoverIdxRef.current = null;
              setHoveredSample(null);
              if (isFrozenRef.current) {
                frozenSamplesRef.current = [];
              }
              onClearPlot();
              needsRedrawRef.current = true;
            }}
            className="flex min-h-8 items-center gap-1.5 border border-[var(--border-control)] bg-[var(--bg-surface)] px-2.5 py-1 font-mono text-[0.6875rem] font-medium text-[var(--ink-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--ink-primary)]"
            title="Bersihkan grafik"
          >
            <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
            <span>CLEAR</span>
          </button>

          <button
            type="button"
            onClick={handleExportPng}
            className="flex min-h-8 items-center gap-1.5 border border-[var(--border-control)] bg-[var(--bg-surface)] px-2.5 py-1 font-mono text-[0.6875rem] font-semibold text-[var(--ink-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]"
            title="Simpan grafik PNG beranotasi untuk Laporan Praktikum"
          >
            <Camera aria-hidden="true" className="h-3.5 w-3.5" />
            <span>PNG</span>
          </button>
        </div>
      </div>

      {/* Canvas Container */}
      <figure className="m-0 p-2">
        <div ref={canvasWrapRef} className="relative w-full select-none">
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={chartSummary}
            style={{ width: canvasSize.width, height: canvasSize.height }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            className="block max-w-full cursor-crosshair"
          />

          {/* Floating Cursor Inspector */}
          {hoveredSample ? (
            <div className="pointer-events-none absolute right-3 top-2 border border-[var(--border-strong)] bg-[var(--bg-surface)]/95 px-2.5 py-1.5 font-mono text-xs tabular-nums shadow-sm">
              <div className="mb-0.5 flex items-center justify-between gap-4 border-b border-[var(--border-hairline)] pb-0.5 text-[0.6875rem] text-[var(--ink-muted)]">
                <span>t = {hoveredSample.elapsedSec.toFixed(2)} s</span>
                <span>{hoveredSample.voltage.toFixed(1)} V</span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                <span className="text-[var(--accent-sp)]">SP: {hoveredSample.setpoint.toFixed(1)}</span>
                <span className="text-[var(--accent-rpm)]">RPM: {hoveredSample.rpm.toFixed(1)}</span>
                <span className="text-[var(--ink-secondary)]">
                  ERR: {hoveredSample.error >= 0 ? "+" : ""}
                  {hoveredSample.error.toFixed(1)}
                </span>
                <span className="text-[var(--ink-primary)]">PWM: {hoveredSample.pwm}</span>
              </div>
            </div>
          ) : null}
        </div>
        <figcaption className="visually-hidden">{chartSummary}</figcaption>
      </figure>
    </section>
  );
});
