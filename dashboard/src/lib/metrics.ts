import type { StepMetrics, TelemetrySample } from "@/types/telemetry";

const EMPTY_METRICS: StepMetrics = {
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
 * Metrik yang dihitung:
 *  - Rise Time (Tr): waktu dari 10% ke 90% perubahan step
 *  - Peak Time (Tp) & Maximum Overshoot (%OS)
 *  - Settling Time (Ts): pita toleransi ±2% (min ±1 RPM), stabil >= 0.5 s
 *  - Steady-State Error (Ess): rata-rata error pada 1.0 s terakhir
 *  - IAE: Integral of Absolute Error sejak step terjadi
 */
export function computeStepMetrics(
  samples: TelemetrySample[],
  manualStepTimeSec?: number | null
): StepMetrics {
  if (samples.length < 3) {
    return EMPTY_METRICS;
  }

  // Temukan indeks awal step terbaru pada mode Closed-Loop PID aktif
  let stepIdx = -1;

  if (manualStepTimeSec != null) {
    stepIdx = samples.findIndex(
      (s) => s.elapsedSec >= manualStepTimeSec && s.mode === 1 && s.runState === 1
    );
  }

  if (stepIdx < 0) {
    for (let i = samples.length - 1; i >= 1; i--) {
      const curr = samples[i];
      const prev = samples[i - 1];

      if (curr.mode !== 1 || curr.runState !== 1) {
        continue;
      }

      const spChanged = Math.abs(curr.setpoint - prev.setpoint) >= 5.0;
      const justStarted = prev.runState !== 1 && curr.setpoint >= 5.0;
      const switchedToPid = prev.mode !== 1 && Math.abs(curr.setpoint - curr.rpm) >= 5.0;

      if (spChanged || justStarted || switchedToPid) {
        stepIdx = i;
        break;
      }
    }
  }

  // Jika belum ada transisi step tapi motor berjalan di PID dari awal data
  if (stepIdx < 0) {
    const firstActive = samples.findIndex(
      (s) => s.mode === 1 && s.runState === 1 && s.setpoint >= 5.0
    );
    if (firstActive >= 0 && Math.abs(samples[firstActive].setpoint - samples[firstActive].rpm) >= 5.0) {
      stepIdx = firstActive;
    } else {
      return EMPTY_METRICS;
    }
  }

  const segment = samples.slice(stepIdx);
  if (segment.length < 2) {
    return EMPTY_METRICS;
  }

  // Pastikan seluruh segmen masih memiliki setpoint yang sama dan aktif
  const targetSetpoint = segment[segment.length - 1].setpoint;
  const activeSegment = segment.filter(
    (s) =>
      s.mode === 1 &&
      s.runState === 1 &&
      Math.abs(s.setpoint - targetSetpoint) < 1.0
  );

  if (activeSegment.length < 2) {
    return EMPTY_METRICS;
  }

  const initialRpm = stepIdx > 0 ? samples[stepIdx - 1].rpm : activeSegment[0].rpm;
  const stepStartTimeSec = activeSegment[0].elapsedSec;
  const stepDelta = targetSetpoint - initialRpm;
  const absDelta = Math.abs(stepDelta);

  if (absDelta < 5.0) {
    return EMPTY_METRICS;
  }

  const dir = Math.sign(stepDelta);

  // Normalisasi respon: 0 di initialRpm, 1 di targetSetpoint, >1 berarti overshoot
  const norm = (rpm: number) => ((rpm - initialRpm) * dir) / absDelta;

  // 1. Rise Time (10% -> 90%) dengan interpolasi linear
  let t10: number | null = null;
  let t90: number | null = null;

  for (let i = 0; i < activeSegment.length; i++) {
    const nCurr = norm(activeSegment[i].rpm);
    const tCurr = activeSegment[i].elapsedSec;

    if (t10 === null && nCurr >= 0.1) {
      if (i > 0) {
        const nPrev = norm(activeSegment[i - 1].rpm);
        const tPrev = activeSegment[i - 1].elapsedSec;
        const frac = nCurr !== nPrev ? (0.1 - nPrev) / (nCurr - nPrev) : 0;
        t10 = tPrev + Math.max(0, Math.min(1, frac)) * (tCurr - tPrev);
      } else {
        t10 = tCurr;
      }
    }

    if (t90 === null && nCurr >= 0.9) {
      if (i > 0) {
        const nPrev = norm(activeSegment[i - 1].rpm);
        const tPrev = activeSegment[i - 1].elapsedSec;
        const frac = nCurr !== nPrev ? (0.9 - nPrev) / (nCurr - nPrev) : 0;
        t90 = tPrev + Math.max(0, Math.min(1, frac)) * (tCurr - tPrev);
      } else {
        t90 = tCurr;
      }
      break;
    }
  }

  const riseTimeSec = t10 !== null && t90 !== null ? Math.max(0, t90 - t10) : null;

  // 2. Peak Time & Maximum Overshoot (%OS)
  let maxNorm = -Infinity;
  let peakRpm = initialRpm;
  let peakTimeSec: number | null = null;

  for (const s of activeSegment) {
    const n = norm(s.rpm);
    if (n > maxNorm) {
      maxNorm = n;
      peakRpm = s.rpm;
      peakTimeSec = Math.max(0, s.elapsedSec - stepStartTimeSec);
    }
  }

  let overshootPct: number | null = null;
  if (maxNorm > 1.0) {
    overshootPct = (maxNorm - 1.0) * 100;
  } else if (t90 !== null) {
    overshootPct = 0;
  }

  // 3. Settling Time (±2% pita toleransi, minimum ±1.0 RPM)
  const settleBand = Math.max(0.02 * absDelta, 1.0);
  let lastOutsideIdx = -1;
  for (let i = activeSegment.length - 1; i >= 0; i--) {
    if (Math.abs(activeSegment[i].rpm - targetSetpoint) > settleBand) {
      lastOutsideIdx = i;
      break;
    }
  }

  const lastSample = activeSegment[activeSegment.length - 1];
  let isSettled = false;
  let settlingTimeSec: number | null = null;

  if (lastOutsideIdx < activeSegment.length - 1) {
    const firstInsideSample = activeSegment[lastOutsideIdx + 1];
    const settledDuration = lastSample.elapsedSec - firstInsideSample.elapsedSec;
    if (settledDuration >= 0.5) {
      isSettled = true;
      settlingTimeSec = Math.max(0, firstInsideSample.elapsedSec - stepStartTimeSec);
    }
  }

  // 4. Steady-State Error (rata-rata error pada 1.0 detik terakhir jika durasi >= 1.0 s)
  const totalDuration = lastSample.elapsedSec - stepStartTimeSec;
  let steadyStateErrorRpm: number | null = null;
  let steadyStateErrorPct: number | null = null;

  if (totalDuration >= 1.0) {
    const tailStart = lastSample.elapsedSec - 1.0;
    const tail = activeSegment.filter((s) => s.elapsedSec >= tailStart);
    if (tail.length > 0) {
      const meanErr =
        tail.reduce((acc, s) => acc + (targetSetpoint - s.rpm), 0) / tail.length;
      steadyStateErrorRpm = meanErr;
      steadyStateErrorPct =
        (Math.abs(meanErr) / Math.max(Math.abs(targetSetpoint), 1)) * 100;
    }
  }

  // 5. IAE (Integral of Absolute Error)
  let iae = 0;
  for (let i = 1; i < activeSegment.length; i++) {
    const dt = activeSegment[i].elapsedSec - activeSegment[i - 1].elapsedSec;
    if (dt > 0 && dt < 1.0) {
      const e0 = Math.abs(targetSetpoint - activeSegment[i - 1].rpm);
      const e1 = Math.abs(targetSetpoint - activeSegment[i].rpm);
      iae += 0.5 * (e0 + e1) * dt;
    }
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
    sampleCountSinceStep: activeSegment.length,
  };
}
