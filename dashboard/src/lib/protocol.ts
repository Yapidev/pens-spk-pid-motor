import type {
  ControlMode,
  DeviceInfo,
  PIDParams,
  RunState,
  TelemetryFlags,
  TelemetrySample,
} from "@/types/telemetry";

export type ParsedMessage =
  | { type: "telemetry"; sample: TelemetrySample }
  | { type: "ack"; key: string; value: string }
  | { type: "info"; info: DeviceInfo }
  | { type: "unknown"; raw: string };

export const EMPTY_FLAGS: TelemetryFlags = {
  ffEnabled: false,
  vcompEnabled: false,
  currentLimited: false,
  rampEnabled: false,
  hwTimerActive: false,
};

function decodeFlags(mask: number): TelemetryFlags {
  if (!Number.isFinite(mask) || mask <= 0) return EMPTY_FLAGS;
  return {
    ffEnabled: (mask & (1 << 0)) !== 0,
    vcompEnabled: (mask & (1 << 1)) !== 0,
    currentLimited: (mask & (1 << 2)) !== 0,
    rampEnabled: (mask & (1 << 3)) !== 0,
    hwTimerActive: (mask & (1 << 4)) !== 0,
  };
}

function decodeRunState(val: number): RunState {
  if (val === 1) return 1;
  if (val === 2) return 2;
  if (val === 3) return 3;
  return 0;
}

/**
 * Parse satu baris output Serial dari Arduino (mendukung CSV `T,...` 12–15 kolom dan JSON).
 */
export function parseSerialLine(
  rawLine: string,
  sessionOriginMs: number | null
): ParsedMessage {
  const line = rawLine.trim();
  if (!line) {
    return { type: "unknown", raw: "" };
  }

  // 1. Format CSV Terstruktur:
  // T,<timestamp_ms>,<sp>,<rpm>,<err>,<pwm>,<volt>,<kp>,<ki>,<kd>,<mode>,<run>[,<cur>[,<u_ff>[,<flags>]]]
  if (line.startsWith("T,")) {
    const parts = line.split(",");
    if (parts.length >= 12) {
      const timestampMs = Number.parseFloat(parts[1]);
      const setpoint = Number.parseFloat(parts[2]);
      const rpm = Number.parseFloat(parts[3]);
      const error = Number.parseFloat(parts[4]);
      const pwm = Math.round(Number.parseFloat(parts[5]));
      const voltage = Number.parseFloat(parts[6]);
      const kp = Number.parseFloat(parts[7]);
      const ki = Number.parseFloat(parts[8]);
      const kd = Number.parseFloat(parts[9]);
      const modeVal = Number.parseInt(parts[10], 10);
      const runVal = Number.parseInt(parts[11], 10);
      const currentAmp = parts.length >= 13 ? Number.parseFloat(parts[12]) : 0;
      const ffPwm = parts.length >= 14 ? Number.parseFloat(parts[13]) : 0;
      const flagMask = parts.length >= 15 ? Number.parseInt(parts[14], 10) : 0;

      if (
        Number.isFinite(timestampMs) &&
        Number.isFinite(setpoint) &&
        Number.isFinite(rpm) &&
        Number.isFinite(pwm)
      ) {
        const origin = sessionOriginMs ?? timestampMs;
        const elapsedSec = Math.max(0, (timestampMs - origin) / 1000);
        const mode: ControlMode = modeVal === 0 ? 0 : 1;
        const runState = decodeRunState(runVal);

        return {
          type: "telemetry",
          sample: {
            timestampMs,
            receivedAt: Date.now(),
            elapsedSec,
            setpoint,
            rpm,
            error: Number.isFinite(error) ? error : setpoint - rpm,
            pwm: Math.max(-255, Math.min(255, pwm)),
            voltage: Number.isFinite(voltage) ? voltage : 0,
            currentAmp: Number.isFinite(currentAmp) ? Math.max(0, currentAmp) : 0,
            ffPwm: Number.isFinite(ffPwm) ? ffPwm : 0,
            flags: decodeFlags(flagMask),
            kp: Number.isFinite(kp) ? kp : 0,
            ki: Number.isFinite(ki) ? ki : 0,
            kd: Number.isFinite(kd) ? kd : 0,
            mode,
            runState,
          },
        };
      }
    }
  }

  // 2. Format ACK,<key>,<val>
  if (line.startsWith("ACK,")) {
    const parts = line.split(",");
    return {
      type: "ack",
      key: parts[1] ?? "",
      value: parts.length <= 3 ? (parts[2] ?? "") : parts.slice(2).join(","),
    };
  }

  // 3. Format INFO,PENS-SPK-PID,v2.0,PPR=1320.0,ENC=4X,TIMER=TC3
  if (line.startsWith("INFO,")) {
    const parts = line.split(",");
    const pprPart = parts.find((p) => p.startsWith("PPR="));
    const encPart = parts.find((p) => p.startsWith("ENC="));
    const timerPart = parts.find((p) => p.startsWith("TIMER="));
    const ppr = pprPart ? Number.parseFloat(pprPart.slice(4)) : null;
    return {
      type: "info",
      info: {
        firmware: parts[1] ?? "PENS-SPK-PID",
        version: parts[2] ?? "v2.0",
        ppr: Number.isFinite(ppr) ? ppr : null,
        encMode: encPart ? encPart.slice(4) : null,
        timerMode: timerPart ? timerPart.slice(6) : null,
      },
    };
  }

  // 4. Fallback JSON
  if (line.startsWith("{") && line.endsWith("}")) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      const timestampMs = Number(obj.t ?? obj.ts ?? obj.timestamp ?? Date.now());
      const setpoint = Number(obj.sp ?? obj.setpoint ?? 0);
      const rpm = Number(obj.rpm ?? obj.actual ?? 0);
      const pwm = Math.round(Number(obj.pwm ?? 0));
      const voltage = Number(obj.v ?? obj.volt ?? obj.voltage ?? 24.4);
      const currentAmp = Number(obj.i ?? obj.cur ?? obj.current ?? 0);
      const ffPwm = Number(obj.ff ?? obj.uff ?? 0);
      const flagMask = Number(obj.flags ?? 0);
      const kp = Number(obj.kp ?? 0);
      const ki = Number(obj.ki ?? 0);
      const kd = Number(obj.kd ?? 0);
      const mode: ControlMode = Number(obj.mode ?? 1) === 0 ? 0 : 1;
      const runState = decodeRunState(Number(obj.run ?? obj.runState ?? 1));

      if (Number.isFinite(setpoint) && Number.isFinite(rpm)) {
        const origin = sessionOriginMs ?? timestampMs;
        return {
          type: "telemetry",
          sample: {
            timestampMs,
            receivedAt: Date.now(),
            elapsedSec: Math.max(0, (timestampMs - origin) / 1000),
            setpoint,
            rpm,
            error: Number.isFinite(Number(obj.err)) ? Number(obj.err) : setpoint - rpm,
            pwm: Math.max(-255, Math.min(255, pwm)),
            voltage,
            currentAmp: Number.isFinite(currentAmp) ? Math.max(0, currentAmp) : 0,
            ffPwm: Number.isFinite(ffPwm) ? ffPwm : 0,
            flags: decodeFlags(flagMask),
            kp,
            ki,
            kd,
            mode,
            runState,
          },
        };
      }
    } catch {
      // Ignore malformed JSON
    }
  }

  return { type: "unknown", raw: line };
}

// --- Command Encoders (Dashboard -> Mikrokontroler) ---

export function encodeSetpoint(rpm: number): string {
  return `SP:${Math.max(-750, Math.min(750, rpm)).toFixed(1)}`;
}

export function encodePID(params: PIDParams): string {
  return `PID:${Math.max(0, params.kp).toFixed(3)},${Math.max(0, params.ki).toFixed(3)},${Math.max(0, params.kd).toFixed(3)}`;
}

export function encodeFeedforward(
  enabled: boolean,
  kff: number,
  deadzonePwm: number
): string {
  return `FF:${enabled ? 1 : 0},${Math.max(0, Math.min(5, kff)).toFixed(3)},${Math.max(0, Math.min(60, deadzonePwm)).toFixed(1)}`;
}

export function encodeVoltageComp(enabled: boolean): string {
  return `VCOMP:${enabled ? 1 : 0}`;
}

export function encodeCurrentLimit(amp: number): string {
  return `ILIM:${Math.max(0, Math.min(5, amp)).toFixed(2)}`;
}

export function encodeRampRate(rpmPerSec: number): string {
  return `RAMP:${Math.max(0, Math.min(3000, rpmPerSec)).toFixed(0)}`;
}

export function encodeManualPwm(pwm: number): string {
  return `PWM:${Math.round(Math.max(-255, Math.min(255, pwm)))}`;
}

export function encodeMode(mode: ControlMode): string {
  return `MODE:${mode}`;
}

export function encodePpr(ppr: number): string {
  return `PPR:${Math.max(1, Math.min(20000, ppr)).toFixed(1)}`;
}

export function encodeCommand(
  cmd: "START" | "STOP" | "ESTOP" | "RESET" | "SYNC" | "CLEARFAULT"
): string {
  return `CMD:${cmd}`;
}
