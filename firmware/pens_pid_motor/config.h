#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>

// ============================================================================
// PENS - Modul Sistem Pengaturan Komputer (SPK)
// Konfigurasi Pin & Parameter Hardware (Kompatibel Arduino Uno & Mega 2560)
// ============================================================================

// --- Komunikasi Serial ---
#define SERIAL_BAUD_RATE       115200UL
#define TELEMETRY_INTERVAL_MS  50UL      // 20 Hz (sinkron dengan sampling PID)
#define LCD_REFRESH_MS         150UL     // Refresh LCD non-blocking (~6.6 Hz)

// --- LCD Keypad Shield 16x2 (Standard DFRobot / Sainsmart Pinout) ---
#define PIN_LCD_RS             8
#define PIN_LCD_EN             9
#define PIN_LCD_D4             4
#define PIN_LCD_D5             5
#define PIN_LCD_D6             6
#define PIN_LCD_D7             7
// Catatan: PIN D10 adalah Backlight LCD Shield. Dibiarkan INPUT agar aman
// pada shield clone yang memiliki bug transistor backlight pada D10.
#define PIN_KEYPAD_ADC         A0

// Threshold ADC tombol LCD Keypad Shield (dapat disesuaikan per unit shield)
#define KEY_RIGHT_MAX          60
#define KEY_UP_MAX             200
#define KEY_DOWN_MAX           400
#define KEY_LEFT_MAX           600
#define KEY_SELECT_MAX         800
#define KEY_DEBOUNCE_MS        160UL

// --- Motor DC Encoder (Feedback RPM - Hardware Interrupt) ---
// D2 = INT0 (Uno) / INT4 (Mega) -> hardware interrupt prioritas tinggi
#define PIN_MOTOR_ENC_A        2
#define PIN_MOTOR_ENC_B        12        // Dibaca di ISR Ch A untuk arah (quadrature)
// Set 1 jika motor memiliki encoder 2-channel (A & B), set 0 jika 1-channel optik/hall
#define MOTOR_ENC_QUADRATURE   1
// Set 1 untuk membalik polaritas pembacaan RPM jika kabel Ch A/B terbalik
#define MOTOR_ENC_INVERT_DIR   0
// Pulses Per Revolution (PPR) pada poros OUTPUT gearbox (edge RISING pada Ch A).
// Contoh umum motor DC geared 24V:
//   - Hall 11 PPR x rasio gearbox 30:1  = 330.0
//   - Optical 360 PPR (langsung poros)  = 360.0
//   - Disk 20 slot (langsung poros)     = 20.0
// Dapat diubah live via Serial: PPR:<nilai>
#define DEFAULT_MOTOR_PPR      330.0f

// Filter EMA untuk pembacaan RPM (0.0 < alpha <= 1.0; 1.0 = tanpa filter)
#define RPM_EMA_ALPHA          0.40f

// --- Rotary Encoder Eksternal + Push Button (Input Lokal Setpoint/Menu) ---
// D3 = INT1 (Uno) / INT5 (Mega) -> hardware interrupt responsif
#define PIN_ROT_ENC_CLK        3
#define PIN_ROT_ENC_DT         A2
#define PIN_ROT_ENC_SW         A3        // Active LOW (INPUT_PULLUP)
#define ROT_ENC_DEBOUNCE_US    2500UL    // 2.5 ms debounce mekanis KY-040 / EC11
#define ROT_BTN_DEBOUNCE_MS    45UL
#define ROT_BTN_LONGPRESS_MS   800UL     // Tekan tahan > 800ms -> Emergency Stop

// --- Driver Motor DC (24V Power Supply) ---
// Mode Driver:
//   0 = H-Bridge 3-pin (L298N / L293D / TB6612): PWM + IN1 + IN2
//   1 = Single DIR + PWM (Cytron MD10C / MD20A): PWM + IN1 (DIR)
//   2 = Dual PWM (BTS7960 / IBT-2): PWM -> RPWM, IN1 -> LPWM (LOW saat maju)
#define MOTOR_DRIVER_MODE      0
#define PIN_MOTOR_PWM          11        // Timer2 Hardware PWM (bebas konflik LCD)
#define PIN_MOTOR_IN1          13        // Arah maju (HIGH saat CW)
#define PIN_MOTOR_IN2          A4        // Arah mundur (LOW saat CW, dipakai di mode 0)

// --- Sensor Tegangan Supply Motor (24V -> tampil V:24.4 pada LCD) ---
// Gunakan modul voltage divider 0-25V (R1=30k, R2=7.5k -> rasio 5.0)
// atau custom divider (R1=47k, R2=10k -> rasio 5.7, aman hingga 28.5V).
#define PIN_VOLTAGE_ADC        A1
#define ADC_VREF               5.0f
#define VOLTAGE_DIVIDER_RATIO  5.70f     // Kalibrasi: (R1 + R2) / R2
#define VOLTAGE_EMA_ALPHA      0.15f
// Jika sensor tegangan belum dipasang saat uji awal, set 1 untuk nilai nominal 24.4V
// saat pembacaan ADC < 10 (floating/GND). Set 0 untuk pembacaan mentah penuh.
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
