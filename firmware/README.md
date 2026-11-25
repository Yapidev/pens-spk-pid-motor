# Firmware Arduino — PENS Modul Sistem Pengaturan Komputer (2-DOF PID Motor DC v2.0)

Firmware C++ v2.0 yang disesuaikan penuh dengan **Modul Praktikum 4 — Kontrol Digital Motor DC (D4 Teknik Komputer PENS)** berbasis **Arduino DUE (32-bit ARM Cortex-M3)** dan driver **IBT-2 (BTN7960B)**, tanpa dependensi library pihak ketiga (hanya menggunakan `LiquidCrystal.h` bawaan Arduino IDE).

### Fitur Teknis Utama (v2.0)
- **Hard Real-Time Sampling 20 Hz (`50.000 ms`)** via Hardware Timer Interrupt **SAM3X8E `TC1 Ch0` (`TC3_IRQn`)** — tidak bentrok dengan PWM Pin 2 (`TC0`), Pin 3 (`TC7`), dan Pin 10 (`TC7`). Pulsa encoder dikunci atomik di dalam `TC3_Handler()` (`jitter < 2 µs`).
- **4× Quadrature Gray-Code LUT** (`CHANGE` interrupt pada Pin 50 & 52) — resolusi 4× lebih halus (setara `Encoder.h`), anti-glitch, dan membaca putaran dua arah (**CW `+RPM` / CCW `-RPM`**).
- **Arsitektur 2-DOF PID + Kompensasi Tegangan 24V (`A10`)** — mendukung Feedforward ($K_{\text{ff}}\cdot\text{SP} + u_{\text{dz}}$), scaling tegangan $V_{\text{nom}}/V_{\text{aktual}}$, Anti-Windup 2-DOF, Derivative-on-Measurement + LPF, dan Bumpless Transfer.
- **Bidirectional IBT-2 Dual-PWM (`-255..+255`) + Trapezoidal Ramp Slew-Rate Limiter** (`RPWM` Pin 2 untuk CW, `LPWM` Pin 3 untuk CCW, `0/0` Active Stop Brake).
- **Proteksi Aktif ACS712 5A (`A11`)** — Soft Current Limiter (derating PWM proporsional saat $I > I_{\text{limit}}$) + **Stall Fault Guard** (memutus PWM jika `|PWM| ≥ 45` & `|RPM| < 5` selama `> 1.5 s`, kode `FL`).

> Untuk board Arduino Uno / Mega 2560 (5V), cukup ubah `#define BOARD_PROFILE_PENS_DUE 0` di `config.h` (otomatis fallback ke `millis()` & 1× encoder).

---

## 1. Mapping Pin — Modul Praktikum 4 SPK PENS (Arduino DUE)

| Periferal | Pin Sinyal | Pin Arduino DUE | Keterangan Teknis (Sesuai Modul Praktikum) |
| :--- | :--- | :---: | :--- |
| **USB Serial** | Programming / Native USB | USB | Komunikasi PC/Dashboard (`115200 baud`) |
| **Driver Motor IBT-2 (BTN7960B)** | `RPWM` (`dirMotor`) | **`D2`** | Hardware PWM arah **CW** (`RPWM=PWM, LPWM=0`) |
| **Driver Motor IBT-2 (BTN7960B)** | `LPWM` (`pwmMotor`) | **`D3`** | Hardware PWM arah **CCW** (`RPWM=0, LPWM=|PWM|`; `0/0` = Brake) |
| **LCD Keypad Shield 16×2** | `D4`–`D7` | `D4`, `D5`, `D6`, `D7` | Bus data 4-bit LCD 16×2 |
| **LCD Keypad Shield 16×2** | `RS` / `EN` | `D8` / `D9` | Kontrol LCD 16×2 |
| **LCD Keypad Shield 16×2** | Backlight PWM | **`D10`** | Pengaturan kecerahan (`analogWrite(10, 50)`) |
| **LCD Keypad Shield 16×2** | 5 Push Buttons | **`A0`** | Ladder ADC: `<50` RIGHT, `<250` UP, `<450` DOWN, `<650` LEFT, `<950` SELECT |
| **Motor DC Encoder (Built-in)** | Channel A / B | **`D50`** / **`D52`** | 4× Quadrature Gray-Code LUT (`CHANGE` interrupt pada `D50` & `D52`) |
| **Potensio / Module Encoder** | CLK (A) / DT (B) | **`D24`** / **`D25`** | Knob putar input lokal (increment / decrement) |
| **Potensio / Module Encoder** | Push Switch | **`D26`** | Active `LOW` (`INPUT_PULLUP`; Short=Start/Stop, Hold 0.8s=E-STOP) |
| **Sensor Tegangan (0–25V)** | Vout Divider | **`A10`** | `R1 = 30kΩ`, `R2 = 3.3kΩ`, `Vref = 3.3V` (rasio `10.0909`) + Voltage Comp |
| **Sensor Arus (ACS712 5A)** | Vout | **`A11`** | Sensitivitas `185 mV/A`, offset `1650 mV` (`3.3V / 2`) + Current Limit & Stall Guard |

---

## 2. Navigasi Lokal pada Modul (LCD 16×2 + Keypad + Potensio Encoder)

Layar LCD memiliki 3 halaman yang dapat digeser menggunakan tombol **LEFT / RIGHT** pada LCD Keypad Shield:

1. **Halaman 0 — Monitor Utama**
   ```text
   PWM:129 24.2V CL
   RPM:350  SP:350 
   ```
   (Saat putar balik CCW: `PW:-129 24.2V CL` / `RPM:-350 SP:-350`)
   - Indikator kanan atas: `CL` (Closed-Loop), `OL` (Open-Loop), `ST` (Stop), `!!` (E-Stop), `FL` (Stall Fault).
   - **Putar Potensio Encoder / UP-DOWN**: Ubah Setpoint RPM (`±10 RPM`) atau PWM manual Open-Loop (`±5`).
   - **Tekan Potensio Encoder / SELECT**: Start / Stop motor.
   - **Tahan Potensio Encoder (> 0.8 detik)**: **Emergency Stop** segera.
2. **Halaman 1 — PID Tuning Lokal** (`>P:0.55  I:1.35` / ` D:0.02  [SEL]`)
3. **Halaman 2 — Mode Operasi** (`MODE: PID 2-DOF` / `OPEN LOOP`, `RUN: ACTIVE / STOPPED / E-STOP! / STALL FLT`)

---

## 3. Protokol Komunikasi Serial R/W (`115200 baud`, `\n`)

### Read (`MC -> Dashboard`, 20 Hz via `TC3`)
```text
T,<timestamp_ms>,<sp_rpm>,<actual_rpm>,<error_rpm>,<pwm_signed>,<voltage_v>,<kp>,<ki>,<kd>,<mode>,<run_state>,<current_a>,<u_ff_pwm>,<flags>
```
- `mode`: `0` = Open-Loop, `1` = Closed-Loop 2-DOF PID
- `run_state`: `0` = Stopped, `1` = Running, `2` = E-Stop Latched, `3` = Stall Fault
- `flags` bitmask: `bit0` = Feedforward ON, `bit1` = V-Comp ON, `bit2` = Current Limited, `bit3` = Ramp ON, `bit4` = HW Timer TC3 ON

### Write (`Dashboard -> MC`)
| Perintah | Deskripsi | Contoh |
| :--- | :--- | :--- |
| `SP:<rpm>` | Ubah Setpoint Bidirectional (`-750..+750 RPM`) | `SP:350.0` / `SP:-350.0` |
| `KP:<val>` / `KI:<val>` / `KD:<val>` | Ubah gain PID individual | `KP:0.55` |
| `PID:<kp>,<ki>,<kd>` | Update atomik ketiga gain PID sekaligus | `PID:0.55,1.35,0.015` |
| `FF:<0\|1>,<kff>,<dz>` | Atur 2-DOF Feedforward + kompensasi deadzone | `FF:1,0.330,6.0` |
| `VCOMP:<0\|1>` | Aktifkan/matikan kompensasi tegangan 24V (`A10`) | `VCOMP:1` |
| `ILIM:<amp>` | Atur batas arus aman ACS712 (`0` = nonaktif) | `ILIM:3.50` |
| `RAMP:<rpm_per_s>` | Trapezoidal ramp (`0` = step instan) | `RAMP:250` |
| `PWM:<-255..255>` | Set PWM manual bidirectional (Open-Loop) | `PWM:160` / `PWM:-160` |
| `MODE:<0\|1>` | `0` = Open-Loop, `1` = Closed-Loop 2-DOF PID | `MODE:1` |
| `CMD:START\|STOP\|ESTOP\|RESET\|SYNC\|CLEARFAULT` | Kontrol eksekusi, reset fault & sinkronisasi | `CMD:CLEARFAULT` |
| `PPR:<val>` | Kalibrasi PPR encoder output tanpa re-upload | `PPR:1320` |

---

## 4. Cara Upload ke Arduino DUE

1. Install **Arduino SAM Boards (32-bits ARM Cortex-M3)** melalui **Tools → Board → Boards Manager** di Arduino IDE.
2. Buka `firmware/pens_pid_motor/pens_pid_motor.ino`.
3. Pilih **Tools → Board → Arduino Due (Programming Port)** (atau **Native USB Port** sesuai kabel USB) dan port COM-nya, lalu klik **Upload**.
4. Tutup Arduino Serial Monitor sebelum menghubungkan Web Dashboard.
