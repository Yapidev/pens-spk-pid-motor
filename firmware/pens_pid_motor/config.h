#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>

// ============================================================================
// PENS - Modul Sistem Pengaturan Komputer (SPK) — Praktikum 4
// Konfigurasi Pin & Parameter Hardware
// Default: Modul Kontrol Digital Motor DC PENS (Arduino DUE + Driver IBT-2)
// ============================================================================

// Pilih profil board:
//   1 = Modul Praktikum SPK PENS (Arduino DUE 3.3V + IBT-2 BTN7960B) [DEFAULT]
//   0 = Wiring generik Arduino Uno / Mega 2560 (5V)
#define BOARD_PROFILE_PENS_DUE 1

// --- Komunikasi Serial ---
#define SERIAL_BAUD_RATE       115200UL
#define TELEMETRY_INTERVAL_MS  50UL      // 20 Hz (sinkron dengan sampling PID)
#define LCD_REFRESH_MS         150UL     // Refresh LCD non-blocking (~6.6 Hz)

// --- LCD Keypad Shield 16x2 (Standard Pinout Modul Praktikum PENS) ---
#define PIN_LCD_RS             8
#define PIN_LCD_EN             9
#define PIN_LCD_D4             4
#define PIN_LCD_D5             5
#define PIN_LCD_D6             6
#define PIN_LCD_D7             7
#define PIN_KEYPAD_ADC         A0

#if BOARD_PROFILE_PENS_DUE
  // Backlight LCD Shield via PWM Pin 10 (Modul Praktikum 4 PENS)
  #define PIN_LCD_BACKLIGHT    10
  #define LCD_BACKLIGHT_PWM    50        // 0-255 (sesuai kode modul praktikum)

  // Threshold ADC tombol LCD Keypad Shield (Modul Praktikum 4 PENS, 10-bit)
  #define KEY_NONE_MIN         1000
  #define KEY_RIGHT_MAX        50
  #define KEY_UP_MAX           250
  #define KEY_DOWN_MAX         450
  #define KEY_LEFT_MAX         650
  #define KEY_SELECT_MAX       950

  // --- Motor DC Built-in Quadrature Encoder (Feedback RPM) ---
  // Modul PENS: Encoder encMotor(50, 52) — di Arduino DUE semua pin digital mendukung interrupt
  #define PIN_MOTOR_ENC_A      50
  #define PIN_MOTOR_ENC_B      52

  // --- Potensio / Module Rotary Encoder + Push Switch (Input Lokal) ---
  // Modul PENS: Encoder encModule(24, 25), Push Switch pada pin 26 (active LOW)
  #define PIN_ROT_ENC_CLK      24
  #define PIN_ROT_ENC_DT       25
  #define PIN_ROT_ENC_SW       26

  // --- Driver Motor DC 24V: IBT-2 (IC BTN7960B Dual-PWM H-Bridge) ---
  // Modul PENS: dirMotor (RPWM) = Pin 2, pwmMotor (LPWM) = Pin 3
  // Tabel 1 Modul: RPWM=HIGH & LPWM=LOW -> CW, RPWM=LOW & LPWM=HIGH -> CCW
  #define MOTOR_DRIVER_MODE    2         // 2 = Dual PWM (IBT-2 / BTN7960B)
  #define PIN_MOTOR_PWM        2         // RPWM (Hardware PWM -> CW)
  #define PIN_MOTOR_IN1        3         // LPWM (LOW saat CW; tukar 2<->3 untuk CCW)
  #define PIN_MOTOR_IN2        3         // Tidak dipakai di mode 2

  // --- Sensor Tegangan Supply Motor 24V (Pembagi Tegangan 30k / 3.3k -> max 3.3V) ---
  // Modul PENS: analogRead(10) = A10, Vref = 3.3V, R1 = 30k ohm, R2 = 3.3k ohm
  #define PIN_VOLTAGE_ADC      A10
  #define ADC_VREF             3.3f
  #define VOLTAGE_R1_OHM       30000.0f
  #define VOLTAGE_R2_OHM       3300.0f
  #define VOLTAGE_DIVIDER_RATIO ((VOLTAGE_R1_OHM + VOLTAGE_R2_OHM) / VOLTAGE_R2_OHM) // ~10.0909

  // --- Sensor Arus Motor: ACS712 5A ---
  // Modul PENS: analogRead(11) = A11, sensitivitas 185 mV/A, offset 1650 mV (3.3V/2)
  #define PIN_CURRENT_ADC      A11
  #define ACS712_MV_PER_AMP    185.0f
  #define ACS712_OFFSET_MV     1650.0f
  #define CURRENT_EMA_ALPHA    0.20f
#else
  // Profil fallback: Arduino Uno / Mega 2560 (5V)
  #define KEY_NONE_MIN         1000
  #define KEY_RIGHT_MAX        60
  #define KEY_UP_MAX           200
  #define KEY_DOWN_MAX         400
  #define KEY_LEFT_MAX         600
  #define KEY_SELECT_MAX       800

  #define PIN_MOTOR_ENC_A      2         // INT0 (Uno) / INT4 (Mega)
  #define PIN_MOTOR_ENC_B      12

  #define PIN_ROT_ENC_CLK      3         // INT1 (Uno) / INT5 (Mega)
  #define PIN_ROT_ENC_DT       A2
  #define PIN_ROT_ENC_SW       A3

  #define MOTOR_DRIVER_MODE    0         // 0 = H-Bridge 3-pin (L298N), 1 = PWM+DIR, 2 = IBT-2
  #define PIN_MOTOR_PWM        11
  #define PIN_MOTOR_IN1        13
  #define PIN_MOTOR_IN2        A4

  #define PIN_VOLTAGE_ADC      A1
  #define ADC_VREF             5.0f
  #define VOLTAGE_DIVIDER_RATIO 5.70f
#endif

// --- Parameter Encoder & Debounce ---
#define KEY_DEBOUNCE_MS        160UL
// Set 1 jika motor memiliki encoder 2-channel (A & B), set 0 jika 1-channel
#define MOTOR_ENC_QUADRATURE   1
// Set 1 untuk membalik polaritas pembacaan RPM jika kabel Ch A/B terbalik
#define MOTOR_ENC_INVERT_DIR   0
// Pulses Per Revolution (PPR) pada poros OUTPUT gearbox (edge RISING pada Ch A).
// Dapat diubah live via Serial tanpa upload ulang: PPR:<nilai>
#define DEFAULT_MOTOR_PPR      330.0f
// Filter EMA untuk pembacaan RPM (0.0 < alpha <= 1.0; 1.0 = tanpa filter)
#define RPM_EMA_ALPHA          0.40f

#define ROT_ENC_DEBOUNCE_US    2500UL    // 2.5 ms debounce mekanis potensio encoder
#define ROT_BTN_DEBOUNCE_MS    45UL
#define ROT_BTN_LONGPRESS_MS   800UL     // Tekan tahan > 800ms -> Emergency Stop

// --- Filter & Fallback Sensor Tegangan ---
#define VOLTAGE_EMA_ALPHA      0.15f
// Set 1 jika ingin menampilkan nominal 24.4V saat sensor belum terhubung (ADC < 10)
#define VOLTAGE_FALLBACK_DEMO  0
#define VOLTAGE_NOMINAL_24V    24.4f

// --- Parameter Kontroler PID Diskrit ---
#define PID_SAMPLE_TIME_MS     50UL      // Ts = 0.05 detik (20 Hz)
#define DEFAULT_KP             1.20f
#define DEFAULT_KI             0.85f
#define DEFAULT_KD             0.05f
#define PID_DERIV_FILTER_ALPHA 0.25f     // Low-pass filter suku derivatif

// --- Batasan Operasi ---
#define PWM_MIN                0
#define PWM_MAX                255
#define SP_MIN_RPM             0.0f
#define SP_MAX_RPM             500.0f    // Sesuaikan dengan RPM maksimum motor DC geared
#define SP_STEP_RPM            5.0f      // Resolusi perubahan SP via rotary/tombol
#define PWM_STEP_MANUAL        5         // Resolusi perubahan PWM Open-Loop

#endif // CONFIG_H
