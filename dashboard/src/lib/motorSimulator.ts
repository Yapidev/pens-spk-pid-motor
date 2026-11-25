import type { ControlMode } from "@/types/telemetry";

/**
 * Digital Twin / Simulator Plant Motor DC 24V Lab PENS (~701 RPM @ PWM 255)
 * + Arsitektur 2-DOF PID, Bidirectional CW/CCW, Trapezoidal Ramp,
 *   Kompensasi Tegangan 24V, Soft Current Limiter, dan Stall Guard.
 *
 * Menggunakan protokol Serial CSV 15-kolom yang 100% identik dengan
 * firmware Arduino DUE `pens_pid_motor.ino` v2.0.
 */
export class MotorPlantSimulator {
  private timerId: ReturnType<typeof setInterval> | null = null;
  private onLine: ((line: string) => void) | null = null;

  // Parameter Kontroler 2-DOF PID (identik dengan DiscretePID di firmware)
  private kp = 0.55;
  private ki = 1.35;
  private kd = 0.015;
  private integral = 0;
  private prevMeasurement = 0;
  private filteredDeriv = 0;
  private pidInitialized = false;
  private readonly derivAlpha = 0.25;

  // 2-DOF Feedforward, Voltage Comp, Ramp & Safety
  private ffEnabled = false;
  private kff = 0.35;
  private deadzonePwm = 10;
  private lastFfPwm = 0;
  private vcompEnabled = true;
  private rampRate = 0; // 0 = instant step, >0 = RPM/s
  private currentLimitAmp = 3.5;
  private pwmCurrentCap = 255;
  private currentLimited = false;
  private stallTimerMs = 0;
  private stallFault = false;
  private stallLockTicks = 0; // Simulasi rotor tertahan penuh (demo Stall Guard)

  // State Kontrol & Plant
  private mode: ControlMode = 1;
  private running = true;
  private estopLatched = false;
  private targetSetpoint = 350;
  private rampedSetpoint = 350;
  private manualPwm = 120;
  private currentPwm = 0;
  private ppr = 1320;

  // Model Fisika Motor DC 24V Orde-2 Bidirectional (~701 RPM @ PWM 255)
  private simTimeMs = 0;
  private omegaRpm = 0;
  private currentNorm = 0;
  private filteredRpm = 0;
  private supplyVoltage = 24.4;
  private voltageDipOffset = 0; // Opsional simulasi voltage sag PSU
  private motorCurrentAmp = 0;
  private loadTorqueRpm = 0;
  private loadDecayTicks = 0;

  start(onLine: (line: string) => void): void {
    this.stop();
    this.onLine = onLine;
    this.simTimeMs = 0;
    this.emit(`INFO,PENS-SPK-SIM,v2.0,PPR=${this.ppr.toFixed(1)},ENC=4X,TIMER=TC3`);

    // Loop deterministik 50 ms (20 Hz), sama dengan Hardware Timer TC3 di Arduino DUE
    this.timerId = setInterval(() => {
      this.stepControl(0.05);
    }, 50);
  }

  stop(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.onLine = null;
  }

  /**
   * Simulasikan gangguan beban torsi sesaat pada poros motor (2.5 detik)
   * untuk menguji disturbance rejection & respon arus ACS712.
   */
  injectLoadDisturbance(magnitudeRpm = 140): void {
    this.loadTorqueRpm = magnitudeRpm;
    this.loadDecayTicks = 50; // 2.5 detik
    this.emit(`ACK,SIM,LOAD_DISTURBANCE_${magnitudeRpm}`);
  }

  /**
   * Simulasikan rotor terkunci (stall) selama 2.2 detik untuk menguji
   * Soft Current Limiter dan Stall Fault Guard tanpa membahayakan motor fisik.
   */
  injectStallTest(): void {
    this.stallLockTicks = 44; // 2.2 detik -> melewati threshold STALL 1.5 detik
    this.emit("ACK,SIM,STALL_LOCK_TEST");
  }

  /**
   * Simulasikan tegangan PSU drop sesaat (-3.0 V selama 3 detik)
   * untuk mendemokan efektivitas Voltage Compensation A10.
   */
  injectVoltageSag(dropVolts = 3.0): void {
    this.voltageDipOffset = dropVolts;
    setTimeout(() => {
      this.voltageDipOffset = 0;
    }, 3000);
    this.emit(`ACK,SIM,VSAG_${dropVolts.toFixed(1)}V`);
  }

  sendCommand(raw: string): void {
    const line = raw.trim();
    if (!line) return;

    if (line === "PING") {
      this.emit(`INFO,PENS-SPK-SIM,v2.0,PPR=${this.ppr.toFixed(1)},ENC=4X,TIMER=TC3`);
      return;
    }

    const idx = line.indexOf(":");
    if (idx < 0) return;

    const key = line.slice(0, idx);
    const val = line.slice(idx + 1);

    switch (key) {
      case "SP": {
        const sp = Number.parseFloat(val);
        if (Number.isFinite(sp)) {
          this.targetSetpoint = Math.max(-750, Math.min(750, sp));
          if (this.rampRate <= 0) {
            this.rampedSetpoint = this.targetSetpoint;
          }
          this.emit(`ACK,SP,${this.targetSetpoint.toFixed(1)}`);
        }
        break;
      }
      case "KP": {
        const v = Number.parseFloat(val);
        if (Number.isFinite(v)) {
          this.kp = Math.max(0, v);
          this.emit(`ACK,KP,${this.kp.toFixed(3)}`);
        }
        break;
      }
      case "KI": {
        const v = Number.parseFloat(val);
        if (Number.isFinite(v)) {
          this.ki = Math.max(0, v);
          if (this.ki === 0) this.integral = 0;
          this.emit(`ACK,KI,${this.ki.toFixed(3)}`);
        }
        break;
      }
      case "KD": {
        const v = Number.parseFloat(val);
        if (Number.isFinite(v)) {
          this.kd = Math.max(0, v);
          this.emit(`ACK,KD,${this.kd.toFixed(3)}`);
        }
        break;
      }
      case "PID": {
        const parts = val.split(",").map((p) => Number.parseFloat(p));
        if (parts.length === 3 && parts.every(Number.isFinite)) {
          this.kp = Math.max(0, parts[0]);
          this.ki = Math.max(0, parts[1]);
          this.kd = Math.max(0, parts[2]);
          if (this.ki === 0) this.integral = 0;
          this.emit("ACK,PID,OK");
        }
        break;
      }
      case "FF": {
        const parts = val.split(",");
        this.ffEnabled = Number.parseInt(parts[0] ?? "0", 10) !== 0;
        if (parts[1] !== undefined) {
          const k = Number.parseFloat(parts[1]);
          if (Number.isFinite(k)) this.kff = Math.max(0, Math.min(5, k));
        }
        if (parts[2] !== undefined) {
          const dz = Number.parseFloat(parts[2]);
          if (Number.isFinite(dz)) this.deadzonePwm = Math.max(0, Math.min(60, dz));
        }
        this.emit(`ACK,FF,${this.ffEnabled ? "ON" : "OFF"}`);
        break;
      }
      case "VCOMP": {
        this.vcompEnabled = Number.parseInt(val, 10) !== 0;
        this.emit(`ACK,VCOMP,${this.vcompEnabled ? "ON" : "OFF"}`);
        break;
      }
      case "ILIM": {
        const v = Number.parseFloat(val);
        if (Number.isFinite(v)) {
          this.currentLimitAmp = Math.max(0, Math.min(5, v));
          if (this.currentLimitAmp <= 0.05) {
            this.pwmCurrentCap = 255;
            this.currentLimited = false;
          }
          this.emit(`ACK,ILIM,${this.currentLimitAmp.toFixed(2)}`);
        }
        break;
      }
      case "RAMP": {
        const v = Number.parseFloat(val);
        if (Number.isFinite(v)) {
          this.rampRate = Math.max(0, Math.min(3000, v));
          if (this.rampRate <= 0) {
            this.rampedSetpoint = this.targetSetpoint;
          }
          this.emit(`ACK,RAMP,${this.rampRate.toFixed(0)}`);
        }
        break;
      }
      case "PWM": {
        const v = Number.parseInt(val, 10);
        if (Number.isFinite(v)) {
          this.manualPwm = Math.max(-255, Math.min(255, v));
          this.emit(`ACK,PWM,${this.manualPwm}`);
        }
        break;
      }
      case "MODE": {
        const nextMode: ControlMode = Number.parseInt(val, 10) === 0 ? 0 : 1;
        if (nextMode !== this.mode) {
          this.mode = nextMode;
          if (this.mode === 1) {
            if (this.currentPwm !== 0) {
              const uFf = this.computeFeedforward(this.rampedSetpoint);
              const vScale = this.computeVoltageScale();
              this.integral = Math.max(
                -255,
                Math.min(255, this.currentPwm / vScale - uFf)
              );
              this.prevMeasurement = this.filteredRpm;
              this.filteredDeriv = 0;
              this.pidInitialized = true;
            } else {
              // Cold start dari berhenti: integral = 0 agar Feedforward 2-DOF bekerja penuh
              this.resetPid();
            }
          } else {
            this.manualPwm = this.currentPwm;
          }
        }
        this.emit(`ACK,MODE,${this.mode === 1 ? "PID" : "OPEN"}`);
        break;
      }
      case "PPR": {
        const v = Number.parseFloat(val);
        if (Number.isFinite(v) && v >= 1) {
          this.ppr = Math.min(20000, v);
          this.emit(`ACK,PPR,${this.ppr.toFixed(1)}`);
        }
        break;
      }
      case "CMD": {
        if (val === "START") {
          this.estopLatched = false;
          this.stallFault = false;
          this.stallLockTicks = 0;
          this.stallTimerMs = 0;
          this.pwmCurrentCap = 255;
          this.currentLimited = false;
          this.running = true;
          this.rampedSetpoint =
            this.rampRate > 0 ? this.filteredRpm : this.targetSetpoint;
          if (this.mode === 1) {
            if (this.currentPwm !== 0) {
              const uFf = this.computeFeedforward(this.rampedSetpoint);
              const vScale = this.computeVoltageScale();
              this.integral = Math.max(
                -255,
                Math.min(255, this.currentPwm / vScale - uFf)
              );
              this.prevMeasurement = this.filteredRpm;
              this.filteredDeriv = 0;
              this.pidInitialized = true;
            } else {
              // Cold start dari berhenti: integral = 0 agar Feedforward 2-DOF bekerja penuh
              this.resetPid();
            }
          }
          this.emit("ACK,CMD,START");
        } else if (val === "STOP") {
          this.running = false;
          this.currentPwm = 0;
          this.lastFfPwm = 0;
          this.pwmCurrentCap = 255;
          this.currentLimited = false;
          this.stallTimerMs = 0;
          this.resetPid();
          this.emit("ACK,CMD,STOP");
        } else if (val === "ESTOP") {
          this.running = false;
          this.estopLatched = true;
          this.currentPwm = 0;
          this.lastFfPwm = 0;
          this.pwmCurrentCap = 255;
          this.currentLimited = false;
          this.stallTimerMs = 0;
          this.resetPid();
          this.emit("ACK,CMD,ESTOP");
        } else if (val === "CLEARFAULT") {
          this.stallFault = false;
          this.estopLatched = false;
          this.stallLockTicks = 0;
          this.stallTimerMs = 0;
          this.pwmCurrentCap = 255;
          this.currentLimited = false;
          this.emit("ACK,CMD,CLEARFAULT");
        } else if (val === "RESET") {
          this.running = false;
          this.estopLatched = false;
          this.stallFault = false;
          this.stallLockTicks = 0;
          this.stallTimerMs = 0;
          this.pwmCurrentCap = 255;
          this.currentLimited = false;
          this.currentPwm = 0;
          this.lastFfPwm = 0;
          this.omegaRpm = 0;
          this.currentNorm = 0;
          this.filteredRpm = 0;
          this.motorCurrentAmp = 0;
          this.rampedSetpoint = this.targetSetpoint;
          this.simTimeMs = 0;
          this.resetPid();
          this.emit("ACK,CMD,RESET");
        } else if (val === "SYNC") {
          this.emit(`INFO,PENS-SPK-SIM,v2.0,PPR=${this.ppr.toFixed(1)},ENC=4X,TIMER=TC3`);
          this.emitTelemetry();
        }
        break;
      }
    }
  }

  private resetPid(): void {
    this.integral = 0;
    this.prevMeasurement = this.filteredRpm;
    this.filteredDeriv = 0;
    this.pidInitialized = false;
  }

  private computeFeedforward(sp: number): number {
    if (!this.ffEnabled || Math.abs(sp) < 1) return 0;
    const dir = sp >= 0 ? 1 : -1;
    return this.kff * sp + dir * this.deadzonePwm;
  }

  private computeVoltageScale(): number {
    if (!this.vcompEnabled || this.supplyVoltage < 12) return 1;
    return Math.max(0.8, Math.min(1.35, 24.4 / this.supplyVoltage));
  }

  private computePid(
    sp: number,
    meas: number,
    dtSec: number,
    ffPwm: number,
    vScale: number
  ): number {
    if (!this.pidInitialized) {
      this.prevMeasurement = meas;
      this.filteredDeriv = 0;
      this.pidInitialized = true;
    }

    if (Math.abs(sp) <= 0.5 && Math.abs(meas) < 1.5) {
      this.integral = 0;
      this.filteredDeriv = 0;
      this.prevMeasurement = meas;
      return 0;
    }

    const error = sp - meas;
    const pTerm = this.kp * error;

    const rawDeriv = -(meas - this.prevMeasurement) / dtSec;
    this.filteredDeriv =
      this.derivAlpha * rawDeriv + (1 - this.derivAlpha) * this.filteredDeriv;
    const dTerm = this.kd * this.filteredDeriv;
    this.prevMeasurement = meas;

    let candidateIntegral = this.integral;
    if (this.ki > 0) {
      candidateIntegral += this.ki * error * dtSec;
    } else {
      candidateIntegral = 0;
    }

    const rawOutput = (ffPwm + pTerm + candidateIntegral + dTerm) * vScale;
    const saturatingHigh = rawOutput > 255 && error > 0;
    const saturatingLow = rawOutput < -255 && error < 0;

    if (!saturatingHigh && !saturatingLow) {
      this.integral = Math.max(-255, Math.min(255, candidateIntegral));
    }

    return Math.max(
      -255,
      Math.min(255, (ffPwm + pTerm + this.integral + dTerm) * vScale)
    );
  }

  /**
   * Jalankan 1 tick simulasi deterministik (juga dapat dipanggil langsung pada unit test).
   */
  stepControl(dtSec: number): void {
    this.simTimeMs += Math.round(dtSec * 1000);

    // Sub-stepping fisika motor DC 24V lab PENS (~701 RPM @ PWM 255, bidirectional)
    const subSteps = 10;
    const subDt = dtSec / subSteps;

    const tauElec = 0.055; // Konstanta waktu elektrik/driver (s)
    const tauMech = 0.34;  // Konstanta waktu inersia mekanik (s)
    const motorGainRpmPerPwm = 738 / 255; // @ PWM 255 (effective ~248.5, V~23.8V) -> ~701 RPM
    const deadbandPwm = 10;

    if (this.loadDecayTicks > 0) {
      this.loadDecayTicks--;
      if (this.loadDecayTicks === 0) {
        this.loadTorqueRpm = 0;
      }
    }

    const isStallLocked = this.stallLockTicks > 0;
    if (this.stallLockTicks > 0) {
      this.stallLockTicks--;
    }

    const absPwm = Math.abs(this.currentPwm);
    const pwmSign = this.currentPwm >= 0 ? 1 : -1;
    const effectivePwmMag =
      absPwm > deadbandPwm
        ? absPwm - deadbandPwm * 0.65
        : Math.abs(this.omegaRpm) > 8
          ? absPwm * 0.4
          : 0;
    const effectivePwm = pwmSign * effectivePwmMag;

    const busSag =
      0.0022 * absPwm +
      0.004 * Math.abs(this.loadTorqueRpm) +
      (isStallLocked ? 1.1 : 0) +
      this.voltageDipOffset;
    const targetVoltage = 24.42 - busSag + (Math.random() - 0.5) * 0.04;
    this.supplyVoltage = 0.25 * targetVoltage + 0.75 * this.supplyVoltage;

    const voltageScalePlant = this.supplyVoltage / 24.4;
    const driveInput = effectivePwm * motorGainRpmPerPwm * voltageScalePlant;

    // Beban torsi selalu melawan arah gerak motor
    const loadDir =
      Math.abs(this.omegaRpm) > 2 ? Math.sign(this.omegaRpm) : pwmSign;

    for (let i = 0; i < subSteps; i++) {
      const dI = (driveInput - this.currentNorm) / tauElec;
      this.currentNorm += dI * subDt;

      if (isStallLocked) {
        this.omegaRpm *= 0.6;
        if (Math.abs(this.omegaRpm) < 0.5) this.omegaRpm = 0;
      } else {
        const netTorque = this.currentNorm - loadDir * this.loadTorqueRpm;
        const dOmega = (netTorque - this.omegaRpm) / tauMech;
        this.omegaRpm += dOmega * subDt;
        // Jika drive 0 & sudah sangat pelan, gesekan statis menghentikan rotor
        if (absPwm === 0 && Math.abs(this.omegaRpm) < 1.2) {
          this.omegaRpm = 0;
        }
      }
    }

    // Simulasi arus jangkar ACS712 5A (no-load + inrush akselerasi + beban + stall)
    const noLoadAmp = absPwm > 0 ? 0.18 + 0.0032 * absPwm : 0;
    const backEmfDiff = Math.abs(driveInput - this.omegaRpm);
    const accelAmp = backEmfDiff * 0.0052;
    const loadAmp = Math.abs(this.loadTorqueRpm) * 0.011;
    const stallAmp = isStallLocked && absPwm > 20 ? 0.022 * absPwm : 0;
    const targetCurrent =
      absPwm > 0
        ? Math.max(
            0,
            Math.min(
              5.0,
              noLoadAmp + accelAmp + loadAmp + stallAmp + (Math.random() - 0.5) * 0.03
            )
          )
        : 0;
    this.motorCurrentAmp = 0.25 * targetCurrent + 0.75 * this.motorCurrentAmp;
    if (absPwm === 0 && this.motorCurrentAmp < 0.02) {
      this.motorCurrentAmp = 0;
    }

    // Kuantisasi & jitter kecil encoder 4x quadrature (±0.4 RPM)
    const encoderNoise =
      Math.abs(this.omegaRpm) > 0.5 ? (Math.random() - 0.5) * 0.8 : 0;
    const measuredRpm = this.omegaRpm + encoderNoise;
    this.filteredRpm = 0.4 * measuredRpm + 0.6 * this.filteredRpm;
    if (Math.abs(this.filteredRpm) < 0.35 && Math.abs(this.omegaRpm) < 0.35) {
      this.filteredRpm = 0;
    }

    // Trapezoidal Ramp Slew-Rate Limiter
    if (this.rampRate > 0) {
      const maxStep = this.rampRate * dtSec;
      const diff = this.targetSetpoint - this.rampedSetpoint;
      if (Math.abs(diff) <= maxStep) {
        this.rampedSetpoint = this.targetSetpoint;
      } else {
        this.rampedSetpoint += diff > 0 ? maxStep : -maxStep;
      }
    } else {
      this.rampedSetpoint = this.targetSetpoint;
    }

    // Hitung perintah PWM baru
    let desiredPwm = 0;
    if (!this.running || this.estopLatched || this.stallFault) {
      desiredPwm = 0;
      this.lastFfPwm = 0;
      this.resetPid();
    } else if (this.mode === 1) {
      const uFf = this.computeFeedforward(this.rampedSetpoint);
      const vScale = this.computeVoltageScale();
      this.lastFfPwm = uFf;
      const u = this.computePid(
        this.rampedSetpoint,
        this.filteredRpm,
        dtSec,
        uFf,
        vScale
      );
      desiredPwm = Math.round(u);
    } else {
      this.lastFfPwm = 0;
      desiredPwm = this.manualPwm;
    }

    // Soft Current Limiter (ACS712)
    if (
      this.running &&
      !this.estopLatched &&
      !this.stallFault &&
      this.currentLimitAmp > 0.05
    ) {
      if (this.motorCurrentAmp > this.currentLimitAmp) {
        this.pwmCurrentCap = Math.max(
          45,
          this.pwmCurrentCap - 35 * (this.motorCurrentAmp - this.currentLimitAmp)
        );
        this.currentLimited = true;
      } else {
        this.pwmCurrentCap = Math.min(255, this.pwmCurrentCap + 12);
        this.currentLimited = this.pwmCurrentCap < 254.5;
      }
      const capInt = Math.round(this.pwmCurrentCap);
      desiredPwm = Math.max(-capInt, Math.min(capInt, desiredPwm));
    } else {
      this.pwmCurrentCap = 255;
      this.currentLimited = false;
    }

    // Stall Fault Guard (tetap aktif meski PWM sedang di-derate oleh Current Limiter)
    if (this.running && !this.estopLatched && !this.stallFault) {
      if (
        (Math.abs(desiredPwm) >= 45 || this.currentLimited) &&
        Math.abs(this.filteredRpm) < 5.0
      ) {
        this.stallTimerMs += Math.round(dtSec * 1000);
        if (this.stallTimerMs >= 1500) {
          this.stallFault = true;
          this.running = false;
          desiredPwm = 0;
          this.lastFfPwm = 0;
          this.resetPid();
          this.emit("ACK,FAULT,STALL");
        }
      } else {
        this.stallTimerMs = 0;
      }
    } else {
      this.stallTimerMs = 0;
    }

    this.currentPwm = desiredPwm;
    this.emitTelemetry();
  }

  private emitTelemetry(): void {
    const activeSp =
      this.rampRate > 0 ? this.rampedSetpoint : this.targetSetpoint;
    const err = this.mode === 1 ? activeSp - this.filteredRpm : 0;
    const runState = this.estopLatched
      ? 2
      : this.stallFault
        ? 3
        : this.running
          ? 1
          : 0;

    let flags = 1 << 4; // hwTimerActive (simulating TC3 20Hz)
    if (this.ffEnabled) flags |= 1 << 0;
    if (this.vcompEnabled) flags |= 1 << 1;
    if (this.currentLimited) flags |= 1 << 2;
    if (this.rampRate > 0) flags |= 1 << 3;

    const line = [
      "T",
      this.simTimeMs,
      activeSp.toFixed(2),
      this.filteredRpm.toFixed(2),
      err.toFixed(2),
      this.currentPwm,
      this.supplyVoltage.toFixed(2),
      this.kp.toFixed(3),
      this.ki.toFixed(3),
      this.kd.toFixed(3),
      this.mode,
      runState,
      this.motorCurrentAmp.toFixed(2),
      this.lastFfPwm.toFixed(1),
      flags,
    ].join(",");

    this.emit(line);
  }

  private emit(line: string): void {
    if (this.onLine) {
      this.onLine(line);
    }
  }
}
