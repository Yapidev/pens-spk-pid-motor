import type { StepMetrics, TelemetrySample } from "@/types/telemetry";

export const EMPTY_METRICS: StepMetrics = {
  hasStep: false,
  stepStartTimeSec: null,
  initialRpm: 0,
  targetSetpoint: 0,
  stepDelta: 0,
  riseTimeSec: null,
  peakTimeSec: null,
  peakRpm: null,
  overshootPct: null,
  settlingTimeSec: null,
  isSettled: false,
  steadyStateErrorRpm: null,
  steadyStateErrorPct: null,
  iae: null,
  sampleCountSinceStep: 0,
};

/**
 * Menghitung metrik respon transien sistem kontrol secara real-time
 * berdasarkan perubahan step Setpoint terakhir pada mode Closed-Loop PID.
 *
 * Dioptimalkan tanpa alokasi array perantara (.slice/.filter/.reduce)
 * agar tetap hemat GC saat buffer penuh (2.400 sampel).
 */
export function computeStepMetrics(
  samples: TelemetrySample[],
  manualStepTimeSec?: number | null
): StepMetrics {
  const len = samples.length;
  if (len < 3) {
    return EMPTY_METRICS;
  }

  // 1. Temukan indeks awal step terbaru pada mode Closed-Loop PID aktif
  let stepIdx = -1;

  if (manualStepTimeSec != null) {
    for (let i = 0; i < len; i++) {
      const s = samples[i];
      if (s.elapsedSec >= manualStepTimeSec && s.mode === 1 && s.runState === 1) {
        stepIdx = i;
        break;
      }
    }
  }

  if (stepIdx < 0) {
    for (let i = len - 1; i >= 1; i--) {
      const curr = samples[i];
      if (curr.mode !== 1 || curr.runState !== 1) {
        continue;
      }
      const prev = samples[i - 1];

      const spChanged = Math.abs(curr.setpoint - prev.setpoint) >= 5.0;
      const justStarted = prev.runState !== 1 && curr.setpoint >= 5.0;
      const switchedToPid =
        prev.mode !== 1 && Math.abs(curr.setpoint - curr.rpm) >= 5.0;

      if (spChanged || justStarted || switchedToPid) {
        stepIdx = i;
        break;
      }
    }
  }

  // Jika belum ada transisi step tapi motor berjalan di PID dari awal data
  if (stepIdx < 0) {
    for (let i = 0; i < len; i++) {
      const s = samples[i];
      if (s.mode === 1 && s.runState === 1 && s.setpoint >= 5.0) {
        if (Math.abs(s.setpoint - s.rpm) >= 5.0) {
          stepIdx = i;
        }
        break;
      }
    }
    if (stepIdx < 0) {
      return EMPTY_METRICS;
    }
  }

  if (len - stepIdx < 2) {
    return EMPTY_METRICS;
  }

  const targetSetpoint = samples[len - 1].setpoint;

  // Temukan sampel valid pertama & terakhir dalam segmen tanpa alokasi array
  let firstActiveIdx = -1;
  let lastActiveIdx = -1;
  let activeCount = 0;

  for (let i = stepIdx; i < len; i++) {
    const s = samples[i];
    if (
      s.mode === 1 &&
      s.runState === 1 &&
      Math.abs(s.setpoint - targetSetpoint) < 1.0
    ) {
      if (firstActiveIdx < 0) firstActiveIdx = i;
      lastActiveIdx = i;
      activeCount++;
    }
  }

  if (activeCount < 2 || firstActiveIdx < 0 || lastActiveIdx < 0) {
    return EMPTY_METRICS;
  }

  const firstActive = samples[firstActiveIdx];
  const lastSample = samples[lastActiveIdx];
  const initialRpm = stepIdx > 0 ? samples[stepIdx - 1].rpm : firstActive.rpm;
  const stepStartTimeSec = firstActive.elapsedSec;
  const stepDelta = targetSetpoint - initialRpm;
  const absDelta = Math.abs(stepDelta);

  if (absDelta < 5.0) {
    return EMPTY_METRICS;
  }

  const dir = Math.sign(stepDelta);
  const invAbsDelta = dir / absDelta;
  const settleBand = Math.max(0.02 * absDelta, 1.0);
  const totalDuration = lastSample.elapsedSec - stepStartTimeSec;
  const computeEss = totalDuration >= 1.0;
  const tailStart = lastSample.elapsedSec - 1.0;

  // Single-pass scan untuk Rise Time, Peak/Overshoot, Settling, Steady-State Error, dan IAE
  let t10: number | null = null;
  let t90: number | null = null;
  let maxNorm = -Infinity;
  let peakRpm = initialRpm;
  let peakTimeSec: number | null = null;
  let iae = 0;
  let tailErrSum = 0;
  let tailCount = 0;

  // Settling tracker: simpan waktu sampel pertama yang tetap berada di dalam pita sejak pelanggaran terakhir
  let firstInsideAfterOutside: TelemetrySample | null = null;
  let prevActive: TelemetrySample | null = null;
  let prevNorm = 0;

  for (let i = firstActiveIdx; i <= lastActiveIdx; i++) {
    const s = samples[i];
    if (
      s.mode !== 1 ||
      s.runState !== 1 ||
      Math.abs(s.setpoint - targetSetpoint) >= 1.0
    ) {
      continue;
    }

    const nCurr = (s.rpm - initialRpm) * invAbsDelta;
    const tCurr = s.elapsedSec;

    // 1. Rise Time (10% -> 90%) dengan interpolasi linear
    if (t10 === null && nCurr >= 0.1) {
      if (prevActive !== null) {
        const denom = nCurr - prevNorm;
        const frac = denom !== 0 ? (0.1 - prevNorm) / denom : 0;
        t10 =
          prevActive.elapsedSec +
          Math.max(0, Math.min(1, frac)) * (tCurr - prevActive.elapsedSec);
      } else {
        t10 = tCurr;
      }
    }

    if (t90 === null && nCurr >= 0.9) {
      if (prevActive !== null) {
        const denom = nCurr - prevNorm;
        const frac = denom !== 0 ? (0.9 - prevNorm) / denom : 0;
        t90 =
          prevActive.elapsedSec +
          Math.max(0, Math.min(1, frac)) * (tCurr - prevActive.elapsedSec);
      } else {
        t90 = tCurr;
      }
    }

    // 2. Peak Time & Maximum Overshoot (%OS)
    if (nCurr > maxNorm) {
      maxNorm = nCurr;
      peakRpm = s.rpm;
      peakTimeSec = Math.max(0, tCurr - stepStartTimeSec);
    }

    // 3. Settling band tracker (±2%, min ±1 RPM)
    if (Math.abs(s.rpm - targetSetpoint) > settleBand) {
      firstInsideAfterOutside = null;
    } else if (firstInsideAfterOutside === null) {
      firstInsideAfterOutside = s;
    }

    // 4. Steady-State Error (1.0 s terakhir)
    if (computeEss && tCurr >= tailStart) {
      tailErrSum += targetSetpoint - s.rpm;
      tailCount++;
    }

    // 5. IAE (Integral of Absolute Error)
    if (prevActive !== null) {
      const dt = tCurr - prevActive.elapsedSec;
      if (dt > 0 && dt < 1.0) {
        const e0 = Math.abs(targetSetpoint - prevActive.rpm);
        const e1 = Math.abs(targetSetpoint - s.rpm);
        iae += 0.5 * (e0 + e1) * dt;
      }
    }

    prevActive = s;
    prevNorm = nCurr;
  }

  const riseTimeSec = t10 !== null && t90 !== null ? Math.max(0, t90 - t10) : null;

  let overshootPct: number | null = null;
  if (maxNorm > 1.0) {
    overshootPct = (maxNorm - 1.0) * 100;
  } else if (t90 !== null) {
    overshootPct = 0;
  }

  let isSettled = false;
  let settlingTimeSec: number | null = null;
  if (firstInsideAfterOutside !== null) {
    const settledDuration = lastSample.elapsedSec - firstInsideAfterOutside.elapsedSec;
    if (settledDuration >= 0.5) {
      isSettled = true;
      settlingTimeSec = Math.max(
        0,
        firstInsideAfterOutside.elapsedSec - stepStartTimeSec
      );
    }
  }

  let steadyStateErrorRpm: number | null = null;
  let steadyStateErrorPct: number | null = null;
  if (tailCount > 0) {
    const meanErr = tailErrSum / tailCount;
    steadyStateErrorRpm = meanErr;
    steadyStateErrorPct =
      (Math.abs(meanErr) / Math.max(Math.abs(targetSetpoint), 1)) * 100;
  }

  return {
    hasStep: true,
    stepStartTimeSec,
    initialRpm,
    targetSetpoint,
    stepDelta,
    riseTimeSec,
    peakTimeSec,
    peakRpm,
    overshootPct,
    settlingTimeSec,
    isSettled,
    steadyStateErrorRpm,
    steadyStateErrorPct,
    iae,
    sampleCountSinceStep: activeCount,
  };
}
