# Firmware Arduino — PENS Modul Sistem Pengaturan Komputer (PID Motor DC)

Firmware C++ yang telah disesuaikan dengan **Modul Praktikum 4 — Kontrol Digital Motor DC (D4 Teknik Komputer PENS)** berbasis **Arduino DUE (32-bit ARM Cortex-M3)** dan driver **IBT-2 (BTN7960B)**, tanpa dependensi library pihak ketiga (hanya menggunakan `LiquidCrystal.h` bawaan Arduino IDE).

> Untuk board Arduino Uno / Mega 2560 (5V), cukup ubah `#define BOARD_PROFILE_PENS_DUE 0` di `config.h`.

---

## 1. Mapping Pin — Modul Praktikum 4 SPK PENS (Arduino DUE)

| Periferal | Pin Sinyal | Pin Arduino DUE | Keterangan Teknis (Sesuai Modul Praktikum) |
| :--- | :--- | :---: | :--- |
| **USB Serial** | Programming / Native USB | USB | Komunikasi PC/Dashboard (`115200 baud`) |
| **Driver Motor IBT-2 (BTN7960B)** | `RPWM` (`dirMotor`) | **`D2`** | Hardware PWM arah **CW** (`RPWM=PWM, LPWM=LOW`) |
| **Driver Motor IBT-2 (BTN7960B)** | `LPWM` (`pwmMotor`) | **`D3`** | Arah **CCW** (`LOW` saat maju; `LOW/LOW` = Stop Brake) |
| **LCD Keypad Shield 16×2** | `D4`–`D7` | `D4`, `D5`, `D6`, `D7` | Bus data 4-bit LCD 16×2 |
| **LCD Keypad Shield 16×2** | `RS` / `EN` | `D8` / `D9` | Kontrol LCD 16×2 |
| **LCD Keypad Shield 16×2** | Backlight PWM | **`D10`** | Pengaturan kecerahan (`analogWrite(10, 50)`) |
| **LCD Keypad Shield 16×2** | 5 Push Buttons | **`A0`** | Ladder ADC: `<50` RIGHT, `<250` UP, `<450` DOWN, `<650` LEFT, `<950` SELECT |
| **Motor DC Encoder (Built-in)** | Channel A / B | **`D50`** / **`D52`** | Quadrature encoder motor (`attachInterrupt` pada `D50`) |
| **Potensio / Module Encoder** | CLK (A) / DT (B) | **`D24`** / **`D25`** | Knob putar input lokal (increment / decrement) |
| **Potensio / Module Encoder** | Push Switch | **`D26`** | Active `LOW` (`INPUT_PULLUP`; Short=Start/Stop, Hold 0.8s=E-STOP) |
| **Sensor Tegangan (0–25V)** | Vout Divider | **`A10`** | `R1 = 30kΩ`, `R2 = 3.3kΩ`, `Vref = 3.3V` (rasio `10.0909`) |
| **Sensor Arus (ACS712 5A)** | Vout | **`A11`** | Sensitivitas `185 mV/A`, offset `1650 mV` (`3.3V / 2`) |

---

## 2. Navigasi Lokal pada Modul (LCD 16×2 + Keypad + Potensio Encoder)

Layar LCD memiliki 3 halaman yang dapat digeser menggunakan tombol **LEFT / RIGHT** pada LCD Keypad Shield:

1. **Halaman 0 — Monitor Utama**
   ```text
   PWM:185 24.4V CL
   RPM:148  SP:150 
   ```
   - Indikator kanan atas: `CL` (Closed-Loop PID aktif), `OL` (Open-Loop aktif), `ST` (Stop), `!!` (E-Stop).
   - **Putar Potensio Encoder / UP-DOWN**: Ubah Setpoint RPM (atau PWM manual pada mode Open-Loop).
   - **Tekan Potensio Encoder / SELECT**: Start / Stop motor.
   - **Tahan Potensio Encoder (> 0.8 detik)**: **Emergency Stop** segera.
2. **Halaman 1 — PID Tuning Lokal**
   ```text
   >P:1.20  I:0.85 
    D:0.05  [SEL]  
   ```
   - **Tekan Potensio Encoder / SELECT**: Pindah kursor antar `Kp` → `Ki` → `Kd`.
   - **Putar Potensio Encoder / UP-DOWN**: Ubah nilai gain langsung.
3. **Halaman 2 — Mode Operasi**
   - **Putar Potensio Encoder / UP-DOWN**: Toggle `PID CLOSED` ↔ `OPEN LOOP`.
   - **Tekan Potensio Encoder / SELECT**: Start / Stop motor.

---

## 3. Protokol Komunikasi Serial R/W (`115200 baud`, `\n`)

### Read (`MC -> Dashboard`, 20 Hz / setiap 50 ms)
```text
T,<timestamp_ms>,<sp_rpm>,<actual_rpm>,<error_rpm>,<pwm>,<voltage_v>,<kp>,<ki>,<kd>,<mode>,<run_state>,<current_a>
```
- `mode`: `0` = Open-Loop, `1` = Closed-Loop PID
- `run_state`: `0` = Stopped, `1` = Running, `2` = E-Stop Latched

### Write (`Dashboard -> MC`)
| Perintah | Deskripsi | Contoh |
| :--- | :--- | :--- |
| `SP:<rpm>` | Ubah Setpoint RPM | `SP:180.0` |
| `KP:<val>` / `KI:<val>` / `KD:<val>` | Ubah gain PID individual | `KP:1.50` |
| `PID:<kp>,<ki>,<kd>` | Update atomik ketiga gain PID sekaligus | `PID:1.50,0.90,0.06` |
| `PWM:<0-255>` | Set PWM manual (mode Open-Loop) | `PWM:140` |
| `MODE:<0\|1>` | `0` = Open-Loop, `1` = Closed-Loop PID | `MODE:1` |
| `CMD:START` / `STOP` / `ESTOP` / `RESET` / `SYNC` | Kontrol eksekusi & sinkronisasi | `CMD:START` |
| `PPR:<val>` | Kalibrasi PPR encoder output tanpa re-upload | `PPR:330` |

---

## 4. Cara Upload ke Arduino DUE

1. Install **Arduino SAM Boards (32-bits ARM Cortex-M3)** melalui **Tools → Board → Boards Manager** di Arduino IDE.
2. Buka `firmware/pens_pid_motor/pens_pid_motor.ino`.
3. Pilih **Tools → Board → Arduino Due (Programming Port)** (atau **Native USB Port** sesuai port kabel Micro USB yang dipakai) dan pilih port COM-nya, lalu klik **Upload**.
4. Tutup Arduino Serial Monitor sebelum menghubungkan Web Dashboard (karena port Serial hanya bisa dibuka oleh satu aplikasi pada satu waktu).
