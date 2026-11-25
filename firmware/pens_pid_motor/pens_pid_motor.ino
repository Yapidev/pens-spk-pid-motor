// ============================================================================
// PENS - Sistem Pengaturan Komputer (SPK)
// Firmware Kontrol Kecepatan (RPM) Motor DC 24V Berbasis PID Diskrit
// Target Utama: Arduino DUE (SAM3X8E 32-bit ARM Cortex-M3 — Modul Praktikum 4)
// Kompatibel juga: Arduino Uno (ATmega328P) / Arduino Mega 2560 (ATmega2560)
//
// Fitur:
//   - Pembacaan Encoder Motor DC & Potensio Rotary Encoder berbasis Interrupt
//   - Kontroler PID Diskrit (Anti-Windup, Derivative-on-Measurement, Clamp 0-255)
//   - Mode Operasi: Closed-Loop PID & Open-Loop Manual PWM (Driver IBT-2 BTN7960B)
//   - Display LCD 16x2 Keypad Shield responsif (PWM, V, RPM, SP + menu lokal)
//   - Komunikasi Serial R/W 115200 baud (CSV terstruktur + parser non-blocking)
// ============================================================================

#include <LiquidCrystal.h>
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

// --- Variabel Volatile Interrupt ---
volatile long g_motorPulses = 0;
volatile int16_t g_rotaryDelta = 0;
volatile uint32_t g_lastRotaryUs = 0;

// --- State Kontrol & Telemetri ---
ControlMode g_mode = MODE_CLOSED_PID;
bool g_running = false;
bool g_estopLatched = false;

float g_setpointRpm = 120.0f;
float g_actualRpm = 0.0f;
float g_filteredRpm = 0.0f;
float g_supplyVoltage = VOLTAGE_NOMINAL_24V;
float g_motorCurrentAmp = 0.0f;
float g_motorPpr = DEFAULT_MOTOR_PPR;
int16_t g_manualPwm = 100;
int16_t g_currentPwm = 0;

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
#if MOTOR_ENC_QUADRATURE
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

// ============================================================================
// FUNGSI AKTUATOR MOTOR & SENSOR TEGANGAN
// ============================================================================

void applyMotorPwm(int16_t pwmValue) {
  const int16_t clamped = constrain(pwmValue, (int16_t)PWM_MIN, (int16_t)PWM_MAX);
  g_currentPwm = clamped;

#if MOTOR_DRIVER_MODE == 0
  // H-Bridge 3-pin (L298N / L293D / TB6612)
  if (clamped == 0) {
    digitalWrite(PIN_MOTOR_IN1, LOW);
    digitalWrite(PIN_MOTOR_IN2, LOW);
    analogWrite(PIN_MOTOR_PWM, 0);
  } else {
    digitalWrite(PIN_MOTOR_IN1, HIGH);
    digitalWrite(PIN_MOTOR_IN2, LOW);
    analogWrite(PIN_MOTOR_PWM, clamped);
  }
#elif MOTOR_DRIVER_MODE == 1
  // Single DIR + PWM (Cytron MD10C)
  digitalWrite(PIN_MOTOR_IN1, HIGH);
  analogWrite(PIN_MOTOR_PWM, clamped);
#elif MOTOR_DRIVER_MODE == 2
  // Dual PWM (BTS7960 / IBT-2): RPWM = PIN_MOTOR_PWM, LPWM = PIN_MOTOR_IN1
  digitalWrite(PIN_MOTOR_IN1, LOW);
  analogWrite(PIN_MOTOR_PWM, clamped);
#endif
}

void stopMotorImmediate(bool isEstop) {
  g_running = false;
  if (isEstop) {
    g_estopLatched = true;
  }
  applyMotorPwm(0);
  pid.reset(g_filteredRpm);
}

void startMotor() {
  g_estopLatched = false;
  g_running = true;
  if (g_mode == MODE_CLOSED_PID) {
    pid.bumplessInit((float)g_currentPwm, g_filteredRpm);
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
// KOMUNIKASI SERIAL R/W (Protokol CSV Terstruktur)
// ============================================================================

void sendTelemetryFrame(uint32_t nowMs) {
  // Format:
  // T,<timestamp_ms>,<sp>,<rpm>,<error>,<pwm>,<volt>,<kp>,<ki>,<kd>,<mode>,<run>,<current_a>
  char spS[10], rpmS[10], errS[10], voltS[8], kpS[10], kiS[10], kdS[10], curS[8];

  const float errorVal = (g_mode == MODE_CLOSED_PID) ? (g_setpointRpm - g_filteredRpm) : 0.0f;

  dtostrf(g_setpointRpm, 1, 2, spS);
  dtostrf(g_filteredRpm, 1, 2, rpmS);
  dtostrf(errorVal, 1, 2, errS);
  dtostrf(g_supplyVoltage, 1, 2, voltS);
  dtostrf(pid.getKp(), 1, 3, kpS);
  dtostrf(pid.getKi(), 1, 3, kiS);
  dtostrf(pid.getKd(), 1, 3, kdS);
  dtostrf(g_motorCurrentAmp, 1, 2, curS);

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
  Serial.print(g_running ? 1 : (g_estopLatched ? 2 : 0));
  Serial.print(',');
  Serial.println(curS);
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
  Serial.print(F("INFO,PENS-SPK-PID,v1.0,PPR="));
  Serial.println(pprS);
}

void processSerialCommand(char* line) {
  // Trim trailing whitespace/CR/LF
  size_t len = strlen(line);
  while (len > 0 && (line[len - 1] == '\r' || line[len - 1] == '\n' || line[len - 1] == ' ')) {
    line[--len] = '\0';
  }
  if (len == 0) return;

  // Format perintah: KEY:VALUE
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
    g_setpointRpm = constrain((float)atof(val), SP_MIN_RPM, SP_MAX_RPM);
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
    // Atomic update: PID:<kp>,<ki>,<kd>
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
  } else if (strcmp(key, "PWM") == 0) {
    g_manualPwm = constrain((int16_t)atoi(val), (int16_t)PWM_MIN, (int16_t)PWM_MAX);
    sendAck(F("PWM"), val);
  } else if (strcmp(key, "MODE") == 0) {
    const int modeVal = atoi(val);
    const ControlMode newMode = (modeVal == 0) ? MODE_OPEN_LOOP : MODE_CLOSED_PID;
    if (newMode != g_mode) {
      g_mode = newMode;
      if (g_mode == MODE_CLOSED_PID) {
        pid.bumplessInit((float)g_currentPwm, g_filteredRpm);
      } else {
        g_manualPwm = g_currentPwm;
      }
    }
    sendAck(F("MODE"), (g_mode == MODE_CLOSED_PID) ? "PID" : "OPEN");
  } else if (strcmp(key, "PPR") == 0) {
    const float newPpr = (float)atof(val);
    if (newPpr >= 1.0f && newPpr <= 10000.0f) {
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
    } else if (strcmp(val, "RESET") == 0) {
      stopMotorImmediate(false);
      g_estopLatched = false;
      noInterrupts();
      g_motorPulses = 0;
      interrupts();
      g_actualRpm = 0.0f;
      g_filteredRpm = 0.0f;
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
      // Overflow protection: reset buffer
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
      g_setpointRpm = constrain(g_setpointRpm + (steps * SP_STEP_RPM), SP_MIN_RPM, SP_MAX_RPM);
    } else {
      g_manualPwm = constrain((int16_t)(g_manualPwm + (steps * PWM_STEP_MANUAL)), (int16_t)PWM_MIN, (int16_t)PWM_MAX);
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
      pid.bumplessInit((float)g_currentPwm, g_filteredRpm);
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
  // 1. Ambil delta dari Rotary Encoder secara atomik
  int16_t rotDelta = 0;
  noInterrupts();
  rotDelta = g_rotaryDelta;
  g_rotaryDelta = 0;
  interrupts();

  if (rotDelta != 0) {
    applyLocalAdjustment(rotDelta);
  }

  // 2. Baca Push Button Rotary Encoder (Short press = Select/Start-Stop, Long press = E-STOP)
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

  // 3. Baca LCD Keypad Shield Buttons
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
    // Baris 0 (16 kar): "PWM:185 24.4V CL"  (CL=Closed-Loop, OL=Open-Loop, ST=Stop, !!=ESTOP)
    const char* badge = "ST";
    if (g_estopLatched) {
      badge = "!!";
    } else if (g_running) {
      badge = (g_mode == MODE_CLOSED_PID) ? "CL" : "OL";
    }
    snprintf(line0, sizeof(line0), "PWM:%3d %sV %s", g_currentPwm, vStr, badge);

    // Baris 1 (16 kar): "RPM:148  SP:150 " atau "RPM:148  PW:180 "
    const int rpmInt = (int)(g_filteredRpm + 0.5f);
    if (g_mode == MODE_CLOSED_PID) {
      const int spInt = (int)(g_setpointRpm + 0.5f);
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
    // PAGE_MODE
    snprintf(line0, sizeof(line0), "MODE: %-10s",
             (g_mode == MODE_CLOSED_PID) ? "PID CLOSED" : "OPEN LOOP");
    snprintf(line1, sizeof(line1), "RUN : %-10s",
             g_estopLatched ? "E-STOP!" : (g_running ? "ACTIVE" : "STOPPED"));
  }

  // Pastikan tepat 16 karakter agar tidak ada sisa karakter sebelumnya
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

  // Pasang Hardware External Interrupts
  attachInterrupt(digitalPinToInterrupt(PIN_MOTOR_ENC_A), isrMotorEncoder, RISING);
  attachInterrupt(digitalPinToInterrupt(PIN_ROT_ENC_CLK), isrRotaryEncoder, FALLING);

  // Inisialisasi LCD 16x2 & Backlight PWM (Pin 10 pada Modul PENS)
#if defined(PIN_LCD_BACKLIGHT)
  pinMode(PIN_LCD_BACKLIGHT, OUTPUT);
  analogWrite(PIN_LCD_BACKLIGHT, LCD_BACKLIGHT_PWM);
#endif
  lcd.begin(16, 2);
  lcd.setCursor(0, 0);
  lcd.print(F("PENS SPK PID v1 "));
  lcd.setCursor(0, 1);
  lcd.print(F("DC Motor 24V... "));

  // Pre-sample tegangan supply & arus motor agar stabil saat boot
  for (uint8_t i = 0; i < 8; i++) {
    updateSupplyVoltage();
    updateMotorCurrent();
    delay(15);
  }

  g_sessionStartMs = millis();
  g_lastPidMs = g_sessionStartMs;
  g_lastLcdMs = g_sessionStartMs;

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
  if ((nowMs - g_lastPidMs) >= PID_SAMPLE_TIME_MS) {
    const uint32_t elapsedMs = nowMs - g_lastPidMs;
    g_lastPidMs = nowMs;
    const float dtSec = (float)elapsedMs / 1000.0f;

    // Baca & reset pulsa encoder secara atomik
    long pulses = 0;
    noInterrupts();
    pulses = g_motorPulses;
    g_motorPulses = 0;
    interrupts();

    // Hitung RPM aktual & filter EMA
    const float rawRpm = ((float)pulses / g_motorPpr) * (60.0f / dtSec);
    g_actualRpm = (rawRpm < 0.0f) ? 0.0f : rawRpm;
    g_filteredRpm = (RPM_EMA_ALPHA * g_actualRpm) + ((1.0f - RPM_EMA_ALPHA) * g_filteredRpm);
    if (g_filteredRpm < 0.25f && pulses == 0) {
      g_filteredRpm = 0.0f;
    }

    // Update pembacaan tegangan supply 24V & arus motor (ACS712 5A)
    updateSupplyVoltage();
    updateMotorCurrent();

    // Hitung output aktuator (PWM)
    if (!g_running || g_estopLatched) {
      applyMotorPwm(0);
      pid.reset(g_filteredRpm);
    } else if (g_mode == MODE_CLOSED_PID) {
      const float uPwm = pid.compute(g_setpointRpm, g_filteredRpm, dtSec);
      applyMotorPwm((int16_t)(uPwm + 0.5f));
    } else {
      // MODE_OPEN_LOOP
      applyMotorPwm(g_manualPwm);
    }

    // Kirim frame telemetri real-time ke Dashboard
    sendTelemetryFrame(nowMs);
  }

  // 4. Refresh LCD 16x2 secara periodik (non-blocking)
  if ((nowMs - g_lastLcdMs) >= LCD_REFRESH_MS) {
    g_lastLcdMs = nowMs;
    renderLcd();
  }
}
