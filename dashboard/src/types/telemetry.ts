export type ControlMode = 0 | 1; // 0 = Open-Loop PWM, 1 = Closed-Loop PID
export type RunState = 0 | 1 | 2; // 0 = Stopped, 1 = Running, 2 = E-Stop Latched

export type ConnectionMode = "serial" | "ws" | "simulator";
export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export interface TelemetrySample {
  timestampMs: number;
  receivedAt: number;
  elapsedSec: number;
  setpoint: number;
  rpm: number;
  error: number;
  pwm: number;
  voltage: number;
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
}
