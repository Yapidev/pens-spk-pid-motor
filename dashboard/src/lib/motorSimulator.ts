import type { ControlMode } from "@/types/telemetry";

/**
 * Digital Twin / Simulator Plant Motor DC Geared 24V + Discrete PID Controller
 * Menggunakan protokol Serial CSV (`T,...`, `ACK,...`, `INFO,...`) yang 100% identik
 * dengan firmware Arduino `pens_pid_motor.ino`, sehingga dashboard dapat diuji lokal
 * tanpa modul fisik terhubung.
 */
export class MotorPlantSimulator {
  private timerId: ReturnType<typeof setInterval> | null = null;
  private onLine: ((line: string) => void) | null = null;

  // Parameter Kontroler PID (identik dengan DiscretePID di firmware)
  private kp = 1.2;
  private ki = 0.85;
  private kd = 0.05;
  private integral = 0;
  private prevMeasurement = 0;
  private filteredDeriv = 0;
  private pidInitialized = false;
  private readonly derivAlpha = 0.25;

  // State Kontrol & Plant
  private mode: ControlMode = 1;
  private running = true;
  private estopLatched = false;
  private setpoint = 150;
  private manualPwm = 110;
  private currentPwm = 0;
  private ppr = 330;

  // Model Fisika Motor DC 24V Orde-2 (Armature Current + Rotor Inertia)
  private simTimeMs = 0;
  private omegaRpm = 0;       // Kecepatan aktual poros output (RPM)
  private currentNorm = 0;    // Arus jangkar ternormalisasi
  private filteredRpm = 0;    // Hasil filter EMA (alpha = 0.40)
  private supplyVoltage = 24.4;
  private motorCurrentAmp = 0; // Simulasi sensor arus ACS712 5A (A)
  private loadTorqueRpm = 0;  // Gangguan beban mekanis eksternal sementara
  private loadDecayTicks = 0;

  start(onLine: (line: string) => void): void {
    this.stop();
    this.onLine = onLine;
    this.simTimeMs = 0;
    this.emit(`INFO,PENS-SPK-SIM,v1.0,PPR=${this.ppr.toFixed(1)}`);

    // Loop deterministik 50 ms (20 Hz), sama dengan PID_SAMPLE_TIME_MS di Arduino
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
   * untuk menguji disturbance rejection kontroler PID.
   */
  injectLoadDisturbance(magnitudeRpm = 45): void {
    this.loadTorqueRpm = magnitudeRpm;
    this.loadDecayTicks = 50; // 50 * 50ms = 2.5 detik
    this.emit(`ACK,SIM,LOAD_DISTURBANCE_${magnitudeRpm}`);
  }

  sendCommand(raw: string): void {
    const line = raw.trim();
    if (!line) return;

    if (line === "PING") {
      this.emit(`INFO,PENS-SPK-SIM,v1.0,PPR=${this.ppr.toFixed(1)}`);
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
          this.setpoint = Math.max(0, Math.min(500, sp));
          this.emit(`ACK,SP,${this.setpoint.toFixed(1)}`);
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
      case "PWM": {
        const v = Number.parseInt(val, 10);
        if (Number.isFinite(v)) {
          this.manualPwm = Math.max(0, Math.min(255, v));
          this.emit(`ACK,PWM,${this.manualPwm}`);
        }
        break;
      }
      case "MODE": {
        const nextMode: ControlMode = Number.parseInt(val, 10) === 0 ? 0 : 1;
        if (nextMode !== this.mode) {
          this.mode = nextMode;
          if (this.mode === 1) {
            this.integral = Math.max(0, Math.min(255, this.currentPwm));
            this.prevMeasurement = this.filteredRpm;
            this.filteredDeriv = 0;
            this.pidInitialized = true;
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
          this.ppr = Math.min(10000, v);
          this.emit(`ACK,PPR,${this.ppr.toFixed(1)}`);
        }
        break;
      }
      case "CMD": {
        if (val === "START") {
          this.estopLatched = false;
          this.running = true;
          if (this.mode === 1) {
            this.integral = Math.max(0, Math.min(255, this.currentPwm));
            this.prevMeasurement = this.filteredRpm;
            this.filteredDeriv = 0;
            this.pidInitialized = true;
          }
          this.emit("ACK,CMD,START");
        } else if (val === "STOP") {
          this.running = false;
          this.currentPwm = 0;
          this.resetPid();
          this.emit("ACK,CMD,STOP");
        } else if (val === "ESTOP") {
          this.running = false;
          this.estopLatched = true;
          this.currentPwm = 0;
          this.resetPid();
          this.emit("ACK,CMD,ESTOP");
        } else if (val === "RESET") {
          this.running = false;
          this.estopLatched = false;
          this.currentPwm = 0;
          this.omegaRpm = 0;
          this.currentNorm = 0;
          this.filteredRpm = 0;
          this.motorCurrentAmp = 0;
          this.simTimeMs = 0;
          this.resetPid();
          this.emit("ACK,CMD,RESET");
        } else if (val === "SYNC") {
          this.emit(`INFO,PENS-SPK-SIM,v1.0,PPR=${this.ppr.toFixed(1)}`);
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

  private computePid(sp: number, meas: number, dtSec: number): number {
    if (!this.pidInitialized) {
      this.prevMeasurement = meas;
      this.filteredDeriv = 0;
      this.pidInitialized = true;
    }

    if (sp <= 0.01 && meas < 1.0) {
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

    const rawOutput = pTerm + candidateIntegral + dTerm;
    const saturatingHigh = rawOutput > 255 && error > 0;
    const saturatingLow = rawOutput < 0 && error < 0;

    if (!saturatingHigh && !saturatingLow) {
      this.integral = Math.max(0, Math.min(255, candidateIntegral));
    }

    return Math.max(0, Math.min(255, pTerm + this.integral + dTerm));
  }

  private stepControl(dtSec: number): void {
    this.simTimeMs += Math.round(dtSec * 1000);

    // Sub-stepping fisika motor DC (10x @ 5ms)
    const subSteps = 10;
    const subDt = dtSec / subSteps;

    // Parameter plant motor DC geared 24V (maks ~320 RPM @ PWM 255)
    const tauElec = 0.055; // konstanta waktu elektrik/driver (s)
    const tauMech = 0.32;  // konstanta waktu inersia mekanik (s)
    const motorGainRpmPerPwm = 335 / 255;
    const deadbandPwm = 10;

    if (this.loadDecayTicks > 0) {
      this.loadDecayTicks--;
      if (this.loadDecayTicks === 0) {
        this.loadTorqueRpm = 0;
      }
    }

    const effectivePwm =
      this.currentPwm > deadbandPwm
        ? this.currentPwm - deadbandPwm * 0.55
        : this.omegaRpm > 5
          ? this.currentPwm * 0.4
          : 0;

    const busSag = 0.0018 * this.currentPwm + 0.006 * this.loadTorqueRpm;
    const targetVoltage = 24.42 - busSag + (Math.random() - 0.5) * 0.04;
    this.supplyVoltage = 0.25 * targetVoltage + 0.75 * this.supplyVoltage;

    const voltageScale = this.supplyVoltage / 24.4;
    const driveInput = effectivePwm * motorGainRpmPerPwm * voltageScale;

    for (let i = 0; i < subSteps; i++) {
      const dI = (driveInput - this.currentNorm) / tauElec;
      this.currentNorm += dI * subDt;

      const netTorque = this.currentNorm - this.loadTorqueRpm;
      const dOmega = (netTorque - this.omegaRpm) / tauMech;
      this.omegaRpm = Math.max(0, this.omegaRpm + dOmega * subDt);
    }

    // Simulasi arus jangkar ACS712 5A (no-load + inrush akselerasi + beban torsi)
    const noLoadAmp = this.currentPwm > 0 ? 0.16 + 0.0028 * this.currentPwm : 0;
    const accelAmp = Math.max(0, driveInput - this.omegaRpm) * 0.0085;
    const loadAmp = this.loadTorqueRpm * 0.022;
    const targetCurrent =
      this.currentPwm > 0
        ? Math.max(0, Math.min(5.0, noLoadAmp + accelAmp + loadAmp + (Math.random() - 0.5) * 0.03))
        : 0;
    this.motorCurrentAmp = 0.25 * targetCurrent + 0.75 * this.motorCurrentAmp;
    if (this.currentPwm === 0 && this.motorCurrentAmp < 0.02) {
      this.motorCurrentAmp = 0;
    }

    // Kuantisasi & jitter kecil encoder (sekitar ±0.45 RPM)
    const encoderNoise = this.omegaRpm > 0.5 ? (Math.random() - 0.5) * 0.9 : 0;
    const measuredRpm = Math.max(0, this.omegaRpm + encoderNoise);
    this.filteredRpm = 0.4 * measuredRpm + 0.6 * this.filteredRpm;
    if (this.filteredRpm < 0.2 && this.omegaRpm < 0.2) {
      this.filteredRpm = 0;
    }

    // Hitung PWM baru berdasarkan mode & status
    if (!this.running || this.estopLatched) {
      this.currentPwm = 0;
      this.resetPid();
    } else if (this.mode === 1) {
      const u = this.computePid(this.setpoint, this.filteredRpm, dtSec);
      this.currentPwm = Math.round(u);
    } else {
      this.currentPwm = this.manualPwm;
    }

    this.emitTelemetry();
  }

  private emitTelemetry(): void {
    const err = this.mode === 1 ? this.setpoint - this.filteredRpm : 0;
    const runState = this.running ? 1 : this.estopLatched ? 2 : 0;
    const line = [
      "T",
      this.simTimeMs,
      this.setpoint.toFixed(2),
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
    ].join(",");

    this.emit(line);
  }

  private emit(line: string): void {
    if (this.onLine) {
      this.onLine(line);
    }
  }
}
