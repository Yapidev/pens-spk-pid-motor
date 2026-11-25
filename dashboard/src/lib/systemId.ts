import type {
  AutoTuneCandidate,
  FopdtModel,
  TelemetrySample,
} from "@/types/telemetry";

/**
 * Identifikasi Model Plant FOPDT (First-Order Plus Dead Time):
 *   G(s) = K * exp(-theta * s) / (tau * s + 1)
 *
 * Menggunakan Metode Dua Titik Smith (t_28.3% dan t_63.2%) pada respon
 * Open-Loop Step Test (PWM: 0 -> stepPwm), diikuti perhitungan Goodness-of-Fit (R²).
 */
export function identifyFopdt(
  samples: TelemetrySample[],
  stepStartSec: number,
  stepPwm: number
): FopdtModel | null {
  if (samples.length < 15 || Math.abs(stepPwm) < 20) {
    return null;
  }

  // Ambil sampel dari saat step diterapkan ke depan
  const postStep = samples.filter((s) => s.elapsedSec >= stepStartSec - 0.001);
  if (postStep.length < 15) {
    return null;
  }

  const preStep = samples.filter(
    (s) => s.elapsedSec < stepStartSec && s.elapsedSec >= stepStartSec - 0.5
  );
  const y0Rpm =
    preStep.length > 0
      ? preStep.reduce((sum, s) => sum + s.rpm, 0) / preStep.length
      : postStep[0].rpm;

  // Estimasi nilai steady-state (y_inf) dari 25% sampel terakhir (minimal 6 sampel)
  const tailCount = Math.max(6, Math.floor(postStep.length * 0.25));
  const tailSlice = postStep.slice(postStep.length - tailCount);
  const yInfRpm =
    tailSlice.reduce((sum, s) => sum + s.rpm, 0) / tailSlice.length;

  const deltaY = yInfRpm - y0Rpm;
  if (Math.abs(deltaY) < 25) {
    return null;
  }

  const dir = Math.sign(deltaY);
  const absDeltaY = Math.abs(deltaY);
  const t0 = postStep[0].elapsedSec;

  const findCrossingRelSec = (fraction: number): number | null => {
    for (let i = 1; i < postStep.length; i++) {
      const prevNorm = ((postStep[i - 1].rpm - y0Rpm) * dir) / absDeltaY;
      const currNorm = ((postStep[i].rpm - y0Rpm) * dir) / absDeltaY;
      if (currNorm >= fraction) {
        const denom = currNorm - prevNorm;
        const frac = denom > 1e-6 ? (fraction - prevNorm) / denom : 0;
        const clamped = Math.max(0, Math.min(1, frac));
        const tCross =
          postStep[i - 1].elapsedSec +
          clamped * (postStep[i].elapsedSec - postStep[i - 1].elapsedSec);
        return Math.max(0, tCross - t0);
      }
    }
    return null;
  };

  const t28Sec = findCrossingRelSec(0.283);
  const t63Sec = findCrossingRelSec(0.632);
  if (t28Sec === null || t63Sec === null || t63Sec <= t28Sec) {
    return null;
  }

  // Persamaan Smith Two-Point Method
  const tauSec = Math.max(0.05, 1.5 * (t63Sec - t28Sec));
  const thetaSec = Math.max(0.02, t63Sec - tauSec);
  const gainK = Math.abs(deltaY / stepPwm);

  // Hitung kurva prediksi FOPDT & Koefisien Determinasi R²
  const meanY = postStep.reduce((sum, s) => sum + s.rpm, 0) / postStep.length;
  let ssRes = 0;
  let ssTot = 0;
  const predictedPoints: { relSec: number; rpm: number }[] = [];

  for (let i = 0; i < postStep.length; i++) {
    const s = postStep[i];
    const relSec = Math.max(0, s.elapsedSec - t0);
    const effT = Math.max(0, relSec - thetaSec);
    const yPred = y0Rpm + deltaY * (1 - Math.exp(-effT / tauSec));
    predictedPoints.push({ relSec, rpm: yPred });
    const diff = s.rpm - yPred;
    ssRes += diff * diff;
    const totDiff = s.rpm - meanY;
    ssTot += totDiff * totDiff;
  }

  const rSquared =
    ssTot > 1e-6 ? Math.max(0, Math.min(1, 1 - ssRes / ssTot)) : 0;

  return {
    gainK,
    tauSec,
    thetaSec,
    rSquared,
    stepPwm,
    y0Rpm,
    yInfRpm,
    t28Sec,
    t63Sec,
    stepStartSec: t0,
    predictedPoints,
  };
}

function round3(v: number): number {
  return Math.max(0, Math.round(v * 1000) / 1000);
}

/**
 * Menghitung 3 strategi tuning PID analitis dari model FOPDT (K, tau, theta)
 * + estimasi gain Feedforward 2-DOF (Kff ≈ 1 / K).
 */
export function computeAutoTunings(model: FopdtModel): AutoTuneCandidate[] {
  const { gainK: K, tauSec: tau, thetaSec: theta } = model;
  const safeK = Math.max(0.05, K);
  const recommendedKff = round3(Math.min(2.5, 0.9 / safeK));
  const recommendedDeadzone = 6;

  // 1. IMC / Lambda Tuning (Rivera-Morari-Skogestad) — halus, minim overshoot
  const lambda = Math.max(0.65 * tau, 1.8 * theta);
  const imcKp = (tau + 0.5 * theta) / (safeK * (lambda + 0.5 * theta));
  const imcTi = tau + 0.5 * theta;
  const imcTd = (tau * theta) / (2 * tau + theta);

  // 2. Cohen-Coon — kompromi respon cepat & disturbance rejection
  // Guard rasio r = theta/tau agar aman pada motor DC dengan deadtime kecil & sampling 20 Hz
  const effThetaCC = Math.max(theta, 0.22 * tau);
  const rCC = effThetaCC / tau;
  const ccKp = (1 / (safeK * rCC)) * (4 / 3 + rCC / 4) * 0.65;
  const ccTi = effThetaCC * ((32 + 6 * rCC) / (13 + 8 * rCC));
  const ccTd = effThetaCC * (4 / (11 + 2 * rCC));

  // 3. Ziegler-Nichols Open-Loop — agresif (rise time cepat, overshoot khas ZN)
  const effThetaZN = Math.max(theta, 0.22 * tau);
  const znKp = (1.2 * tau) / (safeK * effThetaZN);
  const znTi = 2.0 * effThetaZN;
  const znTd = 0.5 * effThetaZN;

  return [
    {
      id: "imc",
      name: "IMC / Lambda",
      tag: "Halus",
      kp: round3(Math.min(10, imcKp)),
      ki: round3(Math.min(15, imcKp / Math.max(0.05, imcTi))),
      kd: round3(Math.min(1.0, imcKp * imcTd)),
      recommendedKff,
      recommendedDeadzone,
    },
    {
      id: "cohen-coon",
      name: "Cohen-Coon",
      tag: "Seimbang",
      kp: round3(Math.min(10, ccKp)),
      ki: round3(Math.min(15, ccKp / Math.max(0.05, ccTi))),
      kd: round3(Math.min(1.0, ccKp * ccTd)),
      recommendedKff,
      recommendedDeadzone,
    },
    {
      id: "ziegler-nichols",
      name: "Ziegler-Nichols",
      tag: "Agresif",
      kp: round3(Math.min(10, znKp)),
      ki: round3(Math.min(15, znKp / Math.max(0.05, znTi))),
      kd: round3(Math.min(1.0, znKp * znTd)),
      recommendedKff,
      recommendedDeadzone,
    },
  ];
}
