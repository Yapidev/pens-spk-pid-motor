// ============================================================================
// PENS - Sistem Pengaturan Komputer (SPK)
// Firmware Kontrol Kecepatan (RPM) Motor DC 24V Berbasis 2-DOF PID Diskrit
// Target Utama: Arduino DUE (SAM3X8E 32-bit ARM Cortex-M3 — Modul Praktikum 4)
// Kompatibel juga: Arduino Uno (ATmega328P) / Arduino Mega 2560 (ATmega2560)
//
// Keunggulan Teknis:
//   - Hard Real-Time Sampling 20 Hz via Hardware Timer TC1 Ch0 (TC3_IRQn) di DUE
//   - Full 4x Quadrature Gray-Code Decoding (CW +RPM / CCW -RPM) di Pin 50 & 52
//   - Arsitektur 2-DOF PID: Feedforward + Deadzone + Voltage Comp (A10) + Anti-Windup
//   - Bidirectional Dual-PWM Driver IBT-2 BTN7960B (RPWM Pin 2 / LPWM Pin 3)
//   - Trapezoidal Ramp Slew-Rate Limiter untuk pembalikan arah mulus
//   - Proteksi Aktif ACS712 (A11): Soft Current Limiter + Stall Fault Guard
//   - Protokol Serial R/W 115200 baud zero-heap + sinkron LCD 16x2 & Rotary Encoder
// ============================================================================

#include <LiquidCrystal.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>
#if defined(ARDUINO_ARCH_SAM)
#include <avr/dtostrf.h>
#endif
#include "config.h"
#include "pid_controller.h"

// --- Objek Hardware ---
LiquidCrystal lcd(PIN_LCD_RS, PIN_LCD_EN, PIN_LCD_D4, PIN_LCD_D5, PIN_LCD_D6, PIN_LCD_D7);
DiscretePID pid(DEFAULT_KP, DEFAULT_KI, DEFAULT_KD, PWM_MIN, PWM_MAX, PID_DERIV_FILTER_ALPHA);

// --- Enum & State Sistem ---
enum ControlMode : uint8_t {
  MODE_OPEN_LOOP = 0,
  MODE_CLOSED_PID = 1
};

enum LcdPage : uint8_t {
  PAGE_MONITOR = 0,   // PWM, V, RPM, SP
  PAGE_PID_TUNE = 1,  // Edit Kp, Ki, Kd lokal
  PAGE_MODE = 2       // Pilih PID/OPEN & START/STOP
};

enum KeypadButton : uint8_t {
  KEY_NONE = 0,
  KEY_RIGHT,
  KEY_UP,
  KEY_DOWN,
  KEY_LEFT,
  KEY_SELECT
};

// Bitmask flag telemetri (kolom ke-15 pada frame T,...)
static const uint8_t FLAG_FF_ENABLED     = (1 << 0);
static const uint8_t FLAG_VCOMP_ENABLED  = (1 << 1);
static const uint8_t FLAG_CURR_LIMITED   = (1 << 2);
static const uint8_t FLAG_RAMP_ENABLED   = (1 << 3);
static const uint8_t FLAG_HW_TIMER_ON    = (1 << 4);

// --- Gray-Code Quadrature LUT 4x (index = (prevAB << 2) | currAB) ---
static const int8_t QDEC_TABLE[16] = {
   0, -1,  1,  0,
   1,  0,  0, -1,
  -1,  0,  0,  1,
   0,  1, -1,  0
};

// --- Variabel Volatile Interrupt ---
volatile long g_motorPulses = 0;
volatile uint8_t g_prevEncAB = 0;
volatile int16_t g_rotaryDelta = 0;
volatile uint32_t g_lastRotaryUs = 0;

#if USE_DUE_HW_TIMER
volatile bool g_hwTickReady = false;
volatile long g_hwLatchedPulses = 0;
volatile uint32_t g_hwTickUs = 0;
volatile uint32_t g_hwPrevTickUs = 0;
#endif

// --- State Kontrol & Telemetri ---
ControlMode g_mode = MODE_CLOSED_PID;
bool g_running = false;
bool g_estopLatched = false;
bool g_stallFault = false;

float g_targetSetpointRpm = 350.0f;
float g_rampedSetpointRpm = 350.0f;
float g_rampRateRpmPerSec = DEFAULT_RAMP_RATE; // 0 = Step instan

float g_actualRpm = 0.0f;
float g_filteredRpm = 0.0f;
float g_supplyVoltage = VOLTAGE_NOMINAL_24V;
float g_motorCurrentAmp = 0.0f;
float g_motorPpr = DEFAULT_MOTOR_PPR;
int16_t g_manualPwm = 120;
int16_t g_currentPwm = 0;

// --- State 2-DOF Feedforward, Voltage Comp & Current Safety ---
bool g_ffEnabled = (DEFAULT_FF_ENABLED != 0);
float g_kff = DEFAULT_KFF;
float g_deadzonePwm = DEFAULT_DEADZONE_PWM;
float g_lastFfPwm = 0.0f;
bool g_vcompEnabled = (DEFAULT_VCOMP_ENABLED != 0);

float g_currentLimitAmp = DEFAULT_CURRENT_LIMIT_A;
float g_pwmCurrentCap = 255.0f;
bool g_currentLimited = false;
uint32_t g_stallTimerMs = 0;

// --- State UI LCD & Input Lokal ---
LcdPage g_lcdPage = PAGE_MONITOR;
uint8_t g_pidEditIndex = 0;  // 0=Kp, 1=Ki, 2=Kd
uint32_t g_lastKeyMs = 0;
bool g_rotBtnPressed = false;
bool g_rotBtnLongHandled = false;
uint32_t g_rotBtnPressStartMs = 0;

// --- Penjadwalan Non-Blocking ---
uint32_t g_lastPidMs = 0;
uint32_t g_lastLcdMs = 0;
uint32_t g_sessionStartMs = 0;

// --- Buffer Serial Non-Blocking (Tanpa Heap String) ---
static const uint8_t RX_BUF_SIZE = 96;
char g_rxBuf[RX_BUF_SIZE];
uint8_t g_rxIdx = 0;

// ============================================================================
// INTERRUPT SERVICE ROUTINES (ISR)
// ============================================================================

void isrMotorEncoder() {
#if MOTOR_ENC_QUADRATURE && (MOTOR_ENC_DECODE_MODE == 4)
  const uint8_t currAB =
      ((digitalRead(PIN_MOTOR_ENC_A) ? 1 : 0) << 1) |
      (digitalRead(PIN_MOTOR_ENC_B) ? 1 : 0);
  const int8_t delta = QDEC_TABLE[(g_prevEncAB << 2) | currAB];
  g_prevEncAB = currAB;
  #if MOTOR_ENC_INVERT_DIR
    g_motorPulses -= delta;
  #else
    g_motorPulses += delta;
  #endif
#elif MOTOR_ENC_QUADRATURE
  const bool bState = digitalRead(PIN_MOTOR_ENC_B);
  #if MOTOR_ENC_INVERT_DIR
    g_motorPulses += bState ? 1 : -1;
  #else
    g_motorPulses += bState ? -1 : 1;
  #endif
#else
  g_motorPulses++;
#endif
}

void isrRotaryEncoder() {
  const uint32_t nowUs = micros();
  if ((nowUs - g_lastRotaryUs) < ROT_ENC_DEBOUNCE_US) {
    return;
  }
  g_lastRotaryUs = nowUs;

  // Pada FALLING edge CLK: jika DT HIGH -> CW (+1), jika DT LOW -> CCW (-1)
  if (digitalRead(PIN_ROT_ENC_DT) == HIGH) {
    g_rotaryDelta++;
  } else {
    g_rotaryDelta--;
  }
}

#if USE_DUE_HW_TIMER
// Hardware Timer Interrupt 20 Hz (TC1 Channel 0 / TC3_IRQn) di Arduino DUE.
// Mengunci pulsa encoder tepat pada jendela 50.000 ms (jitter < 2 us)
// terlepas dari durasi lcd.print() atau Serial.print() di main loop.
void setupDueHardwareTimer20Hz() {
  pmc_set_writeprotect(false);
  pmc_enable_periph_clk(ID_TC3);

  // Waveform mode, trigger on RC compare, clock = MCK / 128 = 656,250 Hz
  TC_Configure(TC1, 0,
               TC_CMR_WAVE |
               TC_CMR_WAVSEL_UP_RC |
               TC_CMR_TCCLKS_TIMER_CLOCK4);

  const uint32_t rcTicks =
      (uint32_t)(((uint64_t)(VARIANT_MCK / 128UL) * PID_SAMPLE_TIME_MS) / 1000UL);
  TC_SetRC(TC1, 0, rcTicks);
  TC_Start(TC1, 0);

  TC1->TC_CHANNEL[0].TC_IER = TC_IER_CPCS;
  TC1->TC_CHANNEL[0].TC_IDR = ~TC_IER_CPCS;
  NVIC_ClearPendingIRQ(TC3_IRQn);
  NVIC_SetPriority(TC3_IRQn, 2);
  NVIC_EnableIRQ(TC3_IRQn);
}

void TC3_Handler() {
  TC_GetStatus(TC1, 0);
  const uint32_t nowUs = micros();
  g_hwLatchedPulses = g_motorPulses;
  g_motorPulses = 0;
  g_hwPrevTickUs = g_hwTickUs;
  g_hwTickUs = nowUs;
  g_hwTickReady = true;
}
#endif

// ============================================================================
// FUNGSI AKTUATOR MOTOR BIDIRECTIONAL & SENSOR TEGANGAN / ARUS
// ============================================================================

void applyMotorPwm(int16_t pwmValue) {
  const int16_t clamped = constrain(pwmValue, (int16_t)PWM_MIN, (int16_t)PWM_MAX);
  g_currentPwm = clamped;
  const int16_t mag = (clamped < 0) ? -clamped : clamped;

#if MOTOR_DRIVER_MODE == 0
  // H-Bridge 3-pin (L298N / L293D / TB6612)
  if (clamped == 0) {
    digitalWrite(PIN_MOTOR_IN1, LOW);
    digitalWrite(PIN_MOTOR_IN2, LOW);
    analogWrite(PIN_MOTOR_PWM, 0);
  } else if (clamped > 0) {
    digitalWrite(PIN_MOTOR_IN1, HIGH);
    digitalWrite(PIN_MOTOR_IN2, LOW);
    analogWrite(PIN_MOTOR_PWM, mag);
  } else {
    digitalWrite(PIN_MOTOR_IN1, LOW);
    digitalWrite(PIN_MOTOR_IN2, HIGH);
    analogWrite(PIN_MOTOR_PWM, mag);
  }
#elif MOTOR_DRIVER_MODE == 1
  // Single DIR + PWM (Cytron MD10C)
  digitalWrite(PIN_MOTOR_IN1, (clamped >= 0) ? HIGH : LOW);
  analogWrite(PIN_MOTOR_PWM, mag);
#elif MOTOR_DRIVER_MODE == 2
  // Dual PWM (BTS7960 / IBT-2): RPWM = PIN_MOTOR_PWM (Pin 2), LPWM = PIN_MOTOR_IN1 (Pin 3)
  if (clamped > 0) {
    analogWrite(PIN_MOTOR_IN1, 0);
    analogWrite(PIN_MOTOR_PWM, mag);
  } else if (clamped < 0) {
    analogWrite(PIN_MOTOR_PWM, 0);
    analogWrite(PIN_MOTOR_IN1, mag);
  } else {
    // Active Stop Brake (RPWM=0, LPWM=0)
    analogWrite(PIN_MOTOR_PWM, 0);
    analogWrite(PIN_MOTOR_IN1, 0);
  }
#endif
}

float computeFeedforwardPwm(float spRpm) {
  if (!g_ffEnabled || fabsf(spRpm) < 1.0f) {
    return 0.0f;
  }
  const float dir = (spRpm >= 0.0f) ? 1.0f : -1.0f;
  return (g_kff * spRpm) + (dir * g_deadzonePwm);
}

float computeVoltageScale() {
  if (!g_vcompEnabled || g_supplyVoltage < VCOMP_MIN_VOLTAGE) {
    return 1.0f;
  }
  return constrain(VOLTAGE_NOMINAL_24V / g_supplyVoltage, VCOMP_MIN_SCALE, VCOMP_MAX_SCALE);
}

void stopMotorImmediate(bool isEstop) {
  g_running = false;
  if (isEstop) {
    g_estopLatched = true;
  }
  g_stallTimerMs = 0;
  g_pwmCurrentCap = 255.0f;
  g_currentLimited = false;
  g_lastFfPwm = 0.0f;
  applyMotorPwm(0);
  pid.reset(g_filteredRpm);
}

void startMotor() {
  g_estopLatched = false;
  g_stallFault = false;
  g_stallTimerMs = 0;
  g_pwmCurrentCap = 255.0f;
  g_currentLimited = false;
  g_running = true;
  if (g_rampRateRpmPerSec > 0.0f) {
    g_rampedSetpointRpm = g_filteredRpm;
  } else {
    g_rampedSetpointRpm = g_targetSetpointRpm;
  }
  if (g_mode == MODE_CLOSED_PID) {
    if (g_currentPwm != 0) {
      const float uFf = computeFeedforwardPwm(g_rampedSetpointRpm);
      const float vScale = computeVoltageScale();
      pid.bumplessInit((float)g_currentPwm, g_filteredRpm, uFf, vScale);
    } else {
      // Cold start dari kondisi berhenti: integral mulai dari 0 agar Feedforward 2-DOF langsung bekerja
      pid.reset(g_filteredRpm);
    }
  }
}

void updateSupplyVoltage() {
  const int rawAdc = analogRead(PIN_VOLTAGE_ADC);
#if VOLTAGE_FALLBACK_DEMO
  if (rawAdc < 10) {
    g_supplyVoltage = VOLTAGE_NOMINAL_24V;
    return;
  }
#endif
  const float measuredV = ((float)rawAdc * ADC_VREF / 1024.0f) * VOLTAGE_DIVIDER_RATIO;
  g_supplyVoltage = (VOLTAGE_EMA_ALPHA * measuredV) + ((1.0f - VOLTAGE_EMA_ALPHA) * g_supplyVoltage);
}

void updateMotorCurrent() {
#if defined(PIN_CURRENT_ADC)
  const int rawAdc = analogRead(PIN_CURRENT_ADC);
  const float iReadMv = ((float)rawAdc * (ADC_VREF * 1000.0f)) / 1024.0f;
  float measuredAmp = (iReadMv - ACS712_OFFSET_MV) / ACS712_MV_PER_AMP;
  if (measuredAmp < 0.0f) measuredAmp = -measuredAmp;
  if (g_currentPwm == 0 && measuredAmp < 0.04f) {
    measuredAmp = 0.0f;
  }
  g_motorCurrentAmp =
      (CURRENT_EMA_ALPHA * measuredAmp) + ((1.0f - CURRENT_EMA_ALPHA) * g_motorCurrentAmp);
#else
  g_motorCurrentAmp = 0.0f;
#endif
}

// ============================================================================
// KOMUNIKASI SERIAL R/W (Protokol CSV Terstruktur Backward-Compatible)
// ============================================================================

uint8_t getTelemetryFlags() {
  uint8_t flags = 0;
  if (g_ffEnabled) flags |= FLAG_FF_ENABLED;
  if (g_vcompEnabled) flags |= FLAG_VCOMP_ENABLED;
  if (g_currentLimited) flags |= FLAG_CURR_LIMITED;
  if (g_rampRateRpmPerSec > 0.0f) flags |= FLAG_RAMP_ENABLED;
#if USE_DUE_HW_TIMER
  flags |= FLAG_HW_TIMER_ON;
#endif
  return flags;
}

uint8_t getRunStateCode() {
  if (g_estopLatched) return 2;
  if (g_stallFault) return 3;
  return g_running ? 1 : 0;
}

void sendTelemetryFrame(uint32_t nowMs) {
  // Format (15 kolom, backward-compatible dengan parser 12/13 kolom):
  // T,<ms>,<sp>,<rpm>,<error>,<pwm>,<volt>,<kp>,<ki>,<kd>,<mode>,<run>,<cur>,<u_ff>,<flags>
  char spS[10], rpmS[10], errS[10], voltS[8], kpS[10], kiS[10], kdS[10], curS[8], ffS[8];

  const float activeSp = (g_rampRateRpmPerSec > 0.0f) ? g_rampedSetpointRpm : g_targetSetpointRpm;
  const float errorVal = (g_mode == MODE_CLOSED_PID) ? (activeSp - g_filteredRpm) : 0.0f;

  dtostrf(activeSp, 1, 2, spS);
  dtostrf(g_filteredRpm, 1, 2, rpmS);
  dtostrf(errorVal, 1, 2, errS);
  dtostrf(g_supplyVoltage, 1, 2, voltS);
  dtostrf(pid.getKp(), 1, 3, kpS);
  dtostrf(pid.getKi(), 1, 3, kiS);
  dtostrf(pid.getKd(), 1, 3, kdS);
  dtostrf(g_motorCurrentAmp, 1, 2, curS);
  dtostrf(g_lastFfPwm, 1, 1, ffS);

  Serial.print(F("T,"));
  Serial.print(nowMs - g_sessionStartMs);
  Serial.print(',');
  Serial.print(spS);
  Serial.print(',');
  Serial.print(rpmS);
  Serial.print(',');
  Serial.print(errS);
  Serial.print(',');
  Serial.print(g_currentPwm);
  Serial.print(',');
  Serial.print(voltS);
  Serial.print(',');
  Serial.print(kpS);
  Serial.print(',');
  Serial.print(kiS);
  Serial.print(',');
  Serial.print(kdS);
  Serial.print(',');
  Serial.print((uint8_t)g_mode);
  Serial.print(',');
  Serial.print(getRunStateCode());
  Serial.print(',');
  Serial.print(curS);
  Serial.print(',');
  Serial.print(ffS);
  Serial.print(',');
  Serial.println(getTelemetryFlags());
}

void sendAck(const __FlashStringHelper* key, const char* val) {
  Serial.print(F("ACK,"));
  Serial.print(key);
  Serial.print(',');
  Serial.println(val);
}

void sendInfoBanner() {
  char pprS[10];
  dtostrf(g_motorPpr, 1, 1, pprS);
  Serial.print(F("INFO,PENS-SPK-PID,v2.0,PPR="));
  Serial.print(pprS);
  Serial.print(F(",ENC="));
  Serial.print((int)MOTOR_ENC_DECODE_MODE);
  Serial.print(F("X,TIMER="));
#if USE_DUE_HW_TIMER
  Serial.println(F("TC3"));
#else
  Serial.println(F("MILLIS"));
#endif
}

void processSerialCommand(char* line) {
  size_t len = strlen(line);
  while (len > 0 && (line[len - 1] == '\r' || line[len - 1] == '\n' || line[len - 1] == ' ')) {
    line[--len] = '\0';
  }
  if (len == 0) return;

  char* colon = strchr(line, ':');
  if (colon == nullptr) {
    if (strcmp(line, "PING") == 0) {
      sendInfoBanner();
    }
    return;
  }

  *colon = '\0';
  char* key = line;
  char* val = colon + 1;

  if (strcmp(key, "SP") == 0) {
    g_targetSetpointRpm = constrain((float)atof(val), SP_MIN_RPM, SP_MAX_RPM);
    if (g_rampRateRpmPerSec <= 0.0f) {
      g_rampedSetpointRpm = g_targetSetpointRpm;
    }
    sendAck(F("SP"), val);
  } else if (strcmp(key, "KP") == 0) {
    pid.setKp((float)atof(val));
    sendAck(F("KP"), val);
  } else if (strcmp(key, "KI") == 0) {
    pid.setKi((float)atof(val));
    sendAck(F("KI"), val);
  } else if (strcmp(key, "KD") == 0) {
    pid.setKd((float)atof(val));
    sendAck(F("KD"), val);
  } else if (strcmp(key, "PID") == 0) {
    char* c1 = strchr(val, ',');
    if (c1 != nullptr) {
      *c1 = '\0';
      char* c2 = strchr(c1 + 1, ',');
      if (c2 != nullptr) {
        *c2 = '\0';
        const float kp = (float)atof(val);
        const float ki = (float)atof(c1 + 1);
        const float kd = (float)atof(c2 + 1);
        pid.setTunings(kp, ki, kd);
        sendAck(F("PID"), "OK");
      }
    }
  } else if (strcmp(key, "FF") == 0) {
    // Format: FF:<0|1>,<kff>,<deadzone_pwm>
    char* c1 = strchr(val, ',');
    if (c1 != nullptr) {
      *c1 = '\0';
      char* c2 = strchr(c1 + 1, ',');
      g_ffEnabled = (atoi(val) != 0);
      if (c2 != nullptr) {
        *c2 = '\0';
        g_kff = constrain((float)atof(c1 + 1), 0.0f, 5.0f);
        g_deadzonePwm = constrain((float)atof(c2 + 1), 0.0f, 60.0f);
      } else {
        g_kff = constrain((float)atof(c1 + 1), 0.0f, 5.0f);
      }
    } else {
      g_ffEnabled = (atoi(val) != 0);
    }
    sendAck(F("FF"), g_ffEnabled ? "ON" : "OFF");
  } else if (strcmp(key, "VCOMP") == 0) {
    g_vcompEnabled = (atoi(val) != 0);
    sendAck(F("VCOMP"), g_vcompEnabled ? "ON" : "OFF");
  } else if (strcmp(key, "ILIM") == 0) {
    g_currentLimitAmp = constrain((float)atof(val), 0.0f, 5.0f);
    if (g_currentLimitAmp <= 0.05f) {
      g_pwmCurrentCap = 255.0f;
      g_currentLimited = false;
    }
    sendAck(F("ILIM"), val);
  } else if (strcmp(key, "RAMP") == 0) {
    g_rampRateRpmPerSec = constrain((float)atof(val), 0.0f, 3000.0f);
    if (g_rampRateRpmPerSec <= 0.0f) {
      g_rampedSetpointRpm = g_targetSetpointRpm;
    }
    sendAck(F("RAMP"), val);
  } else if (strcmp(key, "PWM") == 0) {
    g_manualPwm = constrain((int16_t)atoi(val), (int16_t)PWM_MIN, (int16_t)PWM_MAX);
    sendAck(F("PWM"), val);
  } else if (strcmp(key, "MODE") == 0) {
    const int modeVal = atoi(val);
    const ControlMode newMode = (modeVal == 0) ? MODE_OPEN_LOOP : MODE_CLOSED_PID;
    if (newMode != g_mode) {
      g_mode = newMode;
      if (g_mode == MODE_CLOSED_PID) {
        if (g_currentPwm != 0) {
          const float uFf = computeFeedforwardPwm(g_rampedSetpointRpm);
          const float vScale = computeVoltageScale();
          pid.bumplessInit((float)g_currentPwm, g_filteredRpm, uFf, vScale);
        } else {
          pid.reset(g_filteredRpm);
        }
      } else {
        g_manualPwm = g_currentPwm;
      }
    }
    sendAck(F("MODE"), (g_mode == MODE_CLOSED_PID) ? "PID" : "OPEN");
  } else if (strcmp(key, "PPR") == 0) {
    const float newPpr = (float)atof(val);
    if (newPpr >= 1.0f && newPpr <= 20000.0f) {
      g_motorPpr = newPpr;
      sendAck(F("PPR"), val);
    }
  } else if (strcmp(key, "CMD") == 0) {
    if (strcmp(val, "START") == 0) {
      startMotor();
      sendAck(F("CMD"), "START");
    } else if (strcmp(val, "STOP") == 0) {
      stopMotorImmediate(false);
      sendAck(F("CMD"), "STOP");
    } else if (strcmp(val, "ESTOP") == 0) {
      stopMotorImmediate(true);
      sendAck(F("CMD"), "ESTOP");
    } else if (strcmp(val, "CLEARFAULT") == 0) {
      g_stallFault = false;
      g_estopLatched = false;
      g_stallTimerMs = 0;
      g_pwmCurrentCap = 255.0f;
      g_currentLimited = false;
      sendAck(F("CMD"), "CLEARFAULT");
    } else if (strcmp(val, "RESET") == 0) {
      stopMotorImmediate(false);
      g_estopLatched = false;
      g_stallFault = false;
      noInterrupts();
      g_motorPulses = 0;
#if USE_DUE_HW_TIMER
      g_hwLatchedPulses = 0;
#endif
      interrupts();
      g_actualRpm = 0.0f;
      g_filteredRpm = 0.0f;
      g_rampedSetpointRpm = g_targetSetpointRpm;
      g_sessionStartMs = millis();
      sendAck(F("CMD"), "RESET");
    } else if (strcmp(val, "SYNC") == 0) {
      sendInfoBanner();
      sendTelemetryFrame(millis());
    }
  }
}

void pollSerialInput() {
  while (Serial.available() > 0) {
    const char ch = (char)Serial.read();
    if (ch == '\n' || ch == '\r') {
      if (g_rxIdx > 0) {
        g_rxBuf[g_rxIdx] = '\0';
        processSerialCommand(g_rxBuf);
        g_rxIdx = 0;
      }
    } else if (g_rxIdx < (RX_BUF_SIZE - 1)) {
      g_rxBuf[g_rxIdx++] = ch;
    } else {
      g_rxIdx = 0;
    }
  }
}

// ============================================================================
// INPUT LOKAL (LCD KEYPAD SHIELD + ROTARY ENCODER)
// ============================================================================

KeypadButton readKeypadButton() {
  const int adc = analogRead(PIN_KEYPAD_ADC);
  if (adc > KEY_NONE_MIN) return KEY_NONE;
  if (adc < KEY_RIGHT_MAX) return KEY_RIGHT;
  if (adc < KEY_UP_MAX) return KEY_UP;
  if (adc < KEY_DOWN_MAX) return KEY_DOWN;
  if (adc < KEY_LEFT_MAX) return KEY_LEFT;
  if (adc < KEY_SELECT_MAX) return KEY_SELECT;
  return KEY_NONE;
}

void applyLocalAdjustment(int16_t steps) {
  if (steps == 0) return;

  if (g_lcdPage == PAGE_MONITOR) {
    if (g_mode == MODE_CLOSED_PID) {
      g_targetSetpointRpm =
          constrain(g_targetSetpointRpm + (steps * SP_STEP_RPM), SP_MIN_RPM, SP_MAX_RPM);
      if (g_rampRateRpmPerSec <= 0.0f) {
        g_rampedSetpointRpm = g_targetSetpointRpm;
      }
    } else {
      g_manualPwm = constrain((int16_t)(g_manualPwm + (steps * PWM_STEP_MANUAL)),
                              (int16_t)PWM_MIN, (int16_t)PWM_MAX);
    }
  } else if (g_lcdPage == PAGE_PID_TUNE) {
    if (g_pidEditIndex == 0) {
      pid.setKp(constrain(pid.getKp() + (steps * 0.05f), 0.0f, 50.0f));
    } else if (g_pidEditIndex == 1) {
      pid.setKi(constrain(pid.getKi() + (steps * 0.05f), 0.0f, 50.0f));
    } else {
      pid.setKd(constrain(pid.getKd() + (steps * 0.01f), 0.0f, 20.0f));
    }
  } else if (g_lcdPage == PAGE_MODE) {
    const ControlMode nextMode = (g_mode == MODE_CLOSED_PID) ? MODE_OPEN_LOOP : MODE_CLOSED_PID;
    g_mode = nextMode;
    if (g_mode == MODE_CLOSED_PID) {
      pid.bumplessInit((float)g_currentPwm, g_filteredRpm,
                       computeFeedforwardPwm(g_rampedSetpointRpm), computeVoltageScale());
    } else {
      g_manualPwm = g_currentPwm;
    }
  }
}

void handleSelectAction() {
  if (g_lcdPage == PAGE_MONITOR || g_lcdPage == PAGE_MODE) {
    if (g_running) {
      stopMotorImmediate(false);
    } else {
      startMotor();
    }
  } else if (g_lcdPage == PAGE_PID_TUNE) {
    g_pidEditIndex = (g_pidEditIndex + 1) % 3;
  }
}

void pollLocalInputs(uint32_t nowMs) {
  int16_t rotDelta = 0;
  noInterrupts();
  rotDelta = g_rotaryDelta;
  g_rotaryDelta = 0;
  interrupts();

  if (rotDelta != 0) {
    applyLocalAdjustment(rotDelta);
  }

  const bool btnDown = (digitalRead(PIN_ROT_ENC_SW) == LOW);
  if (btnDown && !g_rotBtnPressed) {
    g_rotBtnPressed = true;
    g_rotBtnLongHandled = false;
    g_rotBtnPressStartMs = nowMs;
  } else if (btnDown && g_rotBtnPressed && !g_rotBtnLongHandled) {
    if ((nowMs - g_rotBtnPressStartMs) >= ROT_BTN_LONGPRESS_MS) {
      g_rotBtnLongHandled = true;
      stopMotorImmediate(true);
      sendAck(F("LOCAL"), "ESTOP");
    }
  } else if (!btnDown && g_rotBtnPressed) {
    if (!g_rotBtnLongHandled && (nowMs - g_rotBtnPressStartMs) >= ROT_BTN_DEBOUNCE_MS) {
      handleSelectAction();
    }
    g_rotBtnPressed = false;
  }

  if ((nowMs - g_lastKeyMs) >= KEY_DEBOUNCE_MS) {
    const KeypadButton key = readKeypadButton();
    if (key != KEY_NONE) {
      g_lastKeyMs = nowMs;
      switch (key) {
        case KEY_UP:
          applyLocalAdjustment(1);
          break;
        case KEY_DOWN:
          applyLocalAdjustment(-1);
          break;
        case KEY_RIGHT:
          g_lcdPage = (LcdPage)((g_lcdPage + 1) % 3);
          break;
        case KEY_LEFT:
          g_lcdPage = (LcdPage)((g_lcdPage + 2) % 3);
          break;
        case KEY_SELECT:
          handleSelectAction();
          break;
        default:
          break;
      }
    }
  }
}

// ============================================================================
// TAMPILAN LCD 16x2 RESPONSIF (Tanpa lcd.clear() -> Zero Flicker)
// ============================================================================

void renderLcd() {
  char line0[17];
  char line1[17];
  char vStr[8];

  dtostrf(g_supplyVoltage, 4, 1, vStr);

  if (g_lcdPage == PAGE_MONITOR) {
    // Kode 2 kar: CL=Closed-Loop, OL=Open-Loop, ST=Stop, !!=E-STOP, FL=Stall Fault
    const char* badge = "ST";
    if (g_estopLatched) {
      badge = "!!";
    } else if (g_stallFault) {
      badge = "FL";
    } else if (g_running) {
      badge = (g_mode == MODE_CLOSED_PID) ? "CL" : "OL";
    }

    if (g_currentPwm >= 0) {
      snprintf(line0, sizeof(line0), "PWM:%3d %sV %s", g_currentPwm, vStr, badge);
    } else {
      snprintf(line0, sizeof(line0), "PW:%-4d %sV %s", g_currentPwm, vStr, badge);
    }

    const int rpmInt = (int)lroundf(g_filteredRpm);
    if (g_mode == MODE_CLOSED_PID) {
      const float activeSp = (g_rampRateRpmPerSec > 0.0f) ? g_rampedSetpointRpm : g_targetSetpointRpm;
      const int spInt = (int)lroundf(activeSp);
      snprintf(line1, sizeof(line1), "RPM:%-4d SP:%-4d", rpmInt, spInt);
    } else {
      snprintf(line1, sizeof(line1), "RPM:%-4d OL:%-4d", rpmInt, g_manualPwm);
    }
  } else if (g_lcdPage == PAGE_PID_TUNE) {
    char kpS[7], kiS[7], kdS[7];
    dtostrf(pid.getKp(), 4, 2, kpS);
    dtostrf(pid.getKi(), 4, 2, kiS);
    dtostrf(pid.getKd(), 4, 2, kdS);

    snprintf(line0, sizeof(line0), "%cP:%s %cI:%s",
             (g_pidEditIndex == 0 ? '>' : ' '), kpS,
             (g_pidEditIndex == 1 ? '>' : ' '), kiS);
    snprintf(line1, sizeof(line1), "%cD:%s  [SEL]",
             (g_pidEditIndex == 2 ? '>' : ' '), kdS);
  } else {
    snprintf(line0, sizeof(line0), "MODE: %-10s",
             (g_mode == MODE_CLOSED_PID) ? "PID 2-DOF" : "OPEN LOOP");
    snprintf(line1, sizeof(line1), "RUN : %-10s",
             g_estopLatched ? "E-STOP!"
                            : (g_stallFault ? "STALL FLT" : (g_running ? "ACTIVE" : "STOPPED")));
  }

  for (uint8_t i = strlen(line0); i < 16; i++) line0[i] = ' ';
  for (uint8_t i = strlen(line1); i < 16; i++) line1[i] = ' ';
  line0[16] = '\0';
  line1[16] = '\0';

  lcd.setCursor(0, 0);
  lcd.print(line0);
  lcd.setCursor(0, 1);
  lcd.print(line1);
}

// ============================================================================
// STEP KONTROL REAL-TIME (Dipanggil setiap 50 ms oleh TC3 / millis)
// ============================================================================

void runControlStep(uint32_t nowMs, float dtSec, long pulses) {
  // 1. Hitung RPM aktual bertanda (+ CW / - CCW) & filter EMA
  const float rawRpm = ((float)pulses / g_motorPpr) * (60.0f / dtSec);
  g_actualRpm = rawRpm;
  g_filteredRpm = (RPM_EMA_ALPHA * g_actualRpm) + ((1.0f - RPM_EMA_ALPHA) * g_filteredRpm);
  if (fabsf(g_filteredRpm) < 0.35f && pulses == 0) {
    g_filteredRpm = 0.0f;
  }

  // 2. Update pembacaan tegangan supply 24V (A10) & arus motor ACS712 (A11)
  updateSupplyVoltage();
  updateMotorCurrent();

  // 3. Trapezoidal Ramp Slew-Rate Limiter untuk setpoint
  if (g_rampRateRpmPerSec > 0.0f) {
    const float maxStep = g_rampRateRpmPerSec * dtSec;
    const float diff = g_targetSetpointRpm - g_rampedSetpointRpm;
    if (fabsf(diff) <= maxStep) {
      g_rampedSetpointRpm = g_targetSetpointRpm;
    } else {
      g_rampedSetpointRpm += (diff > 0.0f) ? maxStep : -maxStep;
    }
  } else {
    g_rampedSetpointRpm = g_targetSetpointRpm;
  }

  // 4. Hitung perintah PWM mentah (2-DOF PID + V-Comp atau Open-Loop)
  int16_t desiredPwm = 0;
  if (!g_running || g_estopLatched || g_stallFault) {
    desiredPwm = 0;
    g_lastFfPwm = 0.0f;
    pid.reset(g_filteredRpm);
  } else if (g_mode == MODE_CLOSED_PID) {
    const float uFf = computeFeedforwardPwm(g_rampedSetpointRpm);
    const float vScale = computeVoltageScale();
    g_lastFfPwm = uFf;
    const float uPwm = pid.compute(g_rampedSetpointRpm, g_filteredRpm, dtSec, uFf, vScale);
    desiredPwm = (int16_t)lroundf(uPwm);
  } else {
    g_lastFfPwm = 0.0f;
    desiredPwm = g_manualPwm;
  }

  // 5. Soft Current Limiter berbasis ACS712 (A11)
  if (g_running && !g_estopLatched && !g_stallFault && g_currentLimitAmp > 0.05f) {
    if (g_motorCurrentAmp > g_currentLimitAmp) {
      const float excessAmp = g_motorCurrentAmp - g_currentLimitAmp;
      g_pwmCurrentCap -= (CURRENT_LIMIT_DERATE_K * excessAmp);
      if (g_pwmCurrentCap < CURRENT_LIMIT_MIN_CAP) {
        g_pwmCurrentCap = CURRENT_LIMIT_MIN_CAP;
      }
      g_currentLimited = true;
    } else {
      g_pwmCurrentCap += CURRENT_LIMIT_RECOVER;
      if (g_pwmCurrentCap >= 255.0f) {
        g_pwmCurrentCap = 255.0f;
        g_currentLimited = false;
      } else {
        g_currentLimited = true;
      }
    }
    const int16_t capInt = (int16_t)g_pwmCurrentCap;
    desiredPwm = constrain(desiredPwm, (int16_t)(-capInt), capInt);
  } else {
    g_pwmCurrentCap = 255.0f;
    g_currentLimited = false;
  }

  // 6. Stall Fault Guard (PWM aktif / terbatasi arus tapi rotor macet > STALL_TIMEOUT_MS)
  if (g_running && !g_estopLatched && !g_stallFault) {
    const int16_t absPwm = (desiredPwm < 0) ? -desiredPwm : desiredPwm;
    if ((absPwm >= STALL_PWM_THRESHOLD || g_currentLimited) && fabsf(g_filteredRpm) < STALL_RPM_THRESHOLD) {
      g_stallTimerMs += (uint32_t)(dtSec * 1000.0f + 0.5f);
      if (g_stallTimerMs >= STALL_TIMEOUT_MS) {
        g_stallFault = true;
        desiredPwm = 0;
        stopMotorImmediate(false);
        sendAck(F("FAULT"), "STALL");
      }
    } else {
      g_stallTimerMs = 0;
    }
  } else {
    g_stallTimerMs = 0;
  }

  // 7. Terapkan PWM ke driver IBT-2 & kirim frame telemetri real-time
  applyMotorPwm(desiredPwm);
  sendTelemetryFrame(nowMs);
}

// ============================================================================
// SETUP & LOOP UTAMA
// ============================================================================

void setup() {
  Serial.begin(SERIAL_BAUD_RATE);

  // Konfigurasi pin Motor Driver
  pinMode(PIN_MOTOR_PWM, OUTPUT);
  pinMode(PIN_MOTOR_IN1, OUTPUT);
#if MOTOR_DRIVER_MODE == 0
  pinMode(PIN_MOTOR_IN2, OUTPUT);
#endif
  applyMotorPwm(0);

  // Konfigurasi pin Encoder Motor & Rotary Encoder
  pinMode(PIN_MOTOR_ENC_A, INPUT_PULLUP);
  pinMode(PIN_MOTOR_ENC_B, INPUT_PULLUP);
  pinMode(PIN_ROT_ENC_CLK, INPUT_PULLUP);
  pinMode(PIN_ROT_ENC_DT, INPUT_PULLUP);
  pinMode(PIN_ROT_ENC_SW, INPUT_PULLUP);

  // Inisialisasi state awal quadrature 4x
  g_prevEncAB =
      ((digitalRead(PIN_MOTOR_ENC_A) ? 1 : 0) << 1) |
      (digitalRead(PIN_MOTOR_ENC_B) ? 1 : 0);

  // Pasang Hardware External Interrupts
#if MOTOR_ENC_QUADRATURE && (MOTOR_ENC_DECODE_MODE == 4)
  attachInterrupt(digitalPinToInterrupt(PIN_MOTOR_ENC_A), isrMotorEncoder, CHANGE);
  attachInterrupt(digitalPinToInterrupt(PIN_MOTOR_ENC_B), isrMotorEncoder, CHANGE);
#else
  attachInterrupt(digitalPinToInterrupt(PIN_MOTOR_ENC_A), isrMotorEncoder, RISING);
#endif
  attachInterrupt(digitalPinToInterrupt(PIN_ROT_ENC_CLK), isrRotaryEncoder, FALLING);

  // Inisialisasi LCD 16x2 & Backlight PWM (Pin 10 pada Modul PENS)
#if defined(PIN_LCD_BACKLIGHT)
  pinMode(PIN_LCD_BACKLIGHT, OUTPUT);
  analogWrite(PIN_LCD_BACKLIGHT, LCD_BACKLIGHT_PWM);
#endif
  lcd.begin(16, 2);
  lcd.setCursor(0, 0);
  lcd.print(F("PENS SPK PID v2 "));
  lcd.setCursor(0, 1);
  lcd.print(F("2-DOF + TC3 20Hz"));

  // Pre-sample tegangan supply & arus motor agar stabil saat boot
  for (uint8_t i = 0; i < 8; i++) {
    updateSupplyVoltage();
    updateMotorCurrent();
    delay(15);
  }

  g_sessionStartMs = millis();
  g_lastPidMs = g_sessionStartMs;
  g_lastLcdMs = g_sessionStartMs;

#if USE_DUE_HW_TIMER
  g_hwTickUs = micros();
  g_hwPrevTickUs = g_hwTickUs;
  setupDueHardwareTimer20Hz();
#endif

  sendInfoBanner();
  renderLcd();
}

void loop() {
  const uint32_t nowMs = millis();

  // 1. Proses perintah masuk dari Dashboard (non-blocking)
  pollSerialInput();

  // 2. Proses input lokal (Rotary Encoder + Keypad Shield)
  pollLocalInputs(nowMs);

  // 3. Loop Kontrol PID & Akuisisi RPM Deterministik (Ts = 50 ms / 20 Hz)
#if USE_DUE_HW_TIMER
  if (g_hwTickReady) {
    long pulses = 0;
    uint32_t dtUs = PID_SAMPLE_TIME_MS * 1000UL;
    noInterrupts();
    g_hwTickReady = false;
    pulses = g_hwLatchedPulses;
    if (g_hwTickUs > g_hwPrevTickUs) {
      dtUs = g_hwTickUs - g_hwPrevTickUs;
    }
    interrupts();

    float dtSec = (float)dtUs / 1000000.0f;
    if (dtSec < 0.005f || dtSec > 0.25f) {
      dtSec = (float)PID_SAMPLE_TIME_MS / 1000.0f;
    }
    runControlStep(nowMs, dtSec, pulses);
  }
#else
  if ((nowMs - g_lastPidMs) >= PID_SAMPLE_TIME_MS) {
    const uint32_t elapsedMs = nowMs - g_lastPidMs;
    g_lastPidMs = nowMs;
    const float dtSec = (float)elapsedMs / 1000.0f;

    long pulses = 0;
    noInterrupts();
    pulses = g_motorPulses;
    g_motorPulses = 0;
    interrupts();

    runControlStep(nowMs, dtSec, pulses);
  }
#endif

  // 4. Refresh LCD 16x2 secara periodik (non-blocking)
  if ((nowMs - g_lastLcdMs) >= LCD_REFRESH_MS) {
    g_lastLcdMs = nowMs;
    renderLcd();
  }
}
