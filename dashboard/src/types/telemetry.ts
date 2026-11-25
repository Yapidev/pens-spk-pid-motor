export type ControlMode = 0 | 1; // 0 = Open-Loop PWM, 1 = Closed-Loop PID
export type RunState = 0 | 1 | 2 | 3; // 0 = Stopped, 1 = Running, 2 = E-Stop, 3 = Stall Fault

export type ConnectionMode = "serial" | "ws" | "simulator";
export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export interface TelemetryFlags {
  ffEnabled: boolean;
  vcompEnabled: boolean;
  currentLimited: boolean;
  rampEnabled: boolean;
  hwTimerActive: boolean;
}

export interface TelemetrySample {
  timestampMs: number;
  receivedAt: number;
  elapsedSec: number;
  setpoint: number;
  rpm: number;
  error: number;
  pwm: number; // Signed [-255 .. +255]: + = CW, - = CCW
  voltage: number;
  currentAmp: number;
  ffPwm: number;
  flags: TelemetryFlags;
  kp: number;
  ki: number;
  kd: number;
  mode: ControlMode;
  runState: RunState;
}

export interface PIDParams {
  kp: number;
  ki: number;
  kd: number;
}

export interface AdvancedControlConfig {
  ffEnabled: boolean;
  kff: number;
  deadzonePwm: number;
  vcompEnabled: boolean;
  currentLimitAmp: number;
  rampRate: number; // 0 = instant step, >0 = RPM/s trapezoidal ramp
}

export interface StepMetrics {
  hasStep: boolean;
  stepStartTimeSec: number | null;
  initialRpm: number;
  targetSetpoint: number;
  stepDelta: number;
  riseTimeSec: number | null;
  peakTimeSec: number | null;
  peakRpm: number | null;
  overshootPct: number | null;
  settlingTimeSec: number | null;
  isSettled: boolean;
  steadyStateErrorRpm: number | null;
  steadyStateErrorPct: number | null;
  iae: number | null;
  sampleCountSinceStep: number;
}

export interface FopdtModel {
  gainK: number;          // Static gain K (RPM / PWM)
  tauSec: number;         // Time constant tau (s)
  thetaSec: number;       // Dead time theta (s)
  rSquared: number;       // Goodness of fit R^2 (0..1)
  stepPwm: number;        // Applied Open-Loop PWM step
  y0Rpm: number;          // Baseline RPM before step
  yInfRpm: number;        // Steady-state RPM after step
  t28Sec: number;         // Time to 28.3% response (relative to t0)
  t63Sec: number;         // Time to 63.2% response (relative to t0)
  stepStartSec: number;   // Absolute elapsedSec of step start
  predictedPoints: { relSec: number; rpm: number }[];
}

export interface AutoTuneCandidate {
  id: "imc" | "cohen-coon" | "ziegler-nichols";
  name: string;
  tag: string;
  kp: number;
  ki: number;
  kd: number;
  recommendedKff: number;
  recommendedDeadzone: number;
}

export interface SavedRunSnapshot {
  id: string;
  label: string;
  color: string;
  visible: boolean;
  pid: PIDParams;
  ffEnabled: boolean;
  vcompEnabled: boolean;
  rampRate: number;
  targetSetpoint: number;
  initialRpm: number;
  metrics: StepMetrics;
  points: { relSec: number; rpm: number; sp: number }[];
}

export interface SerialLogEntry {
  id: number;
  dir: "RX" | "TX" | "SYS";
  text: string;
  time: string;
}

export interface DeviceInfo {
  firmware: string;
  version: string;
  ppr: number | null;
  encMode?: string | null;
  timerMode?: string | null;
}
