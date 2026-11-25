# Firmware Arduino — PENS Modul Sistem Pengaturan Komputer (PID Motor DC)

Firmware C++ untuk **Arduino Uno (ATmega328P)** dan **Arduino Mega 2560 (ATmega2560)** tanpa dependensi library pihak ketiga (hanya menggunakan `LiquidCrystal.h` bawaan Arduino IDE).

---

## 1. Mapping Pin Standar (Bebas Konflik LCD Keypad Shield)

Pinout berikut dirancang agar **100% bebas konflik** saat **LCD Keypad Shield 16x2** terpasang langsung di atas Arduino Uno maupun Arduino Mega 2560:

| Periferal | Pin Sinyal | Pin Arduino (Uno / Mega) | Keterangan Teknis |
| :--- | :--- | :---: | :--- |
| **USB Serial** | RX / TX | `D0` / `D1` | Komunikasi PC/Dashboard (`115200 baud`) |
| **Motor Encoder** | Channel A | **`D2`** | Hardware Interrupt (`INT0` Uno / `INT4` Mega) |
| **Motor Encoder** | Channel B | `D12` | Deteksi arah quadrature di dalam ISR |
| **Rotary Encoder** | CLK (A) | **`D3`** | Hardware Interrupt (`INT1` Uno / `INT5` Mega) |
| **Rotary Encoder** | DT (B) | `A2` | Arah putaran CW/CCW |
| **Rotary Encoder** | SW (Button) | `A3` | `INPUT_PULLUP` (Short=Start/Stop, Hold 0.8s=E-STOP) |
| **LCD Keypad Shield** | D4–D7 | `D4`, `D5`, `D6`, `D7` | Bus data 4-bit LCD 16x2 |
| **LCD Keypad Shield** | RS / EN | `D8` / `D9` | Kontrol LCD 16x2 |
| **LCD Keypad Shield** | Backlight | `D10` | Dibiarkan `INPUT` (aman dari bug transistor shield) |
| **LCD Keypad Shield** | Keypad ADC | `A0` | Ladder 5 tombol (RIGHT/UP/DOWN/LEFT/SELECT) |
| **Driver Motor DC** | PWM (`ENA`) | **`D11`** | Timer2 Hardware PWM (0–255) |
| **Driver Motor DC** | `IN1` / `DIR` | `D13` | Arah maju (atau `LPWM` untuk BTS7960) |
| **Driver Motor DC** | `IN2` | `A4` | Arah mundur (mode H-Bridge L298N/L293D) |
| **Sensor Tegangan 24V** | Vout Divider | `A1` | Pembagi tegangan 24V → 0–5V (tampil `V:24.4`) |

> **Catatan Sensor Tegangan 24V:** Gunakan pembagi tegangan `R1 = 47kΩ`, `R2 = 10kΩ` (`VOLTAGE_DIVIDER_RATIO = 5.70`, aman hingga 28.5V) atau modul sensor 0–25V (`R1 = 30kΩ`, `R2 = 7.5kΩ` → ubah `VOLTAGE_DIVIDER_RATIO` menjadi `5.00f` di `config.h`).

---

## 2. Navigasi Lokal pada Modul (LCD 16x2 + Keypad + Rotary Encoder)

Layar LCD memiliki 3 halaman yang dapat digeser menggunakan tombol **LEFT / RIGHT** pada LCD Keypad Shield:

1. **Halaman 0 — Monitor Utama**
   ```text
   PWM:185 V:24.4 P
   RPM:148  SP:150 
   ```
   - Indikator kanan atas: `P` (PID Aktif), `O` (Open-Loop Aktif), `S` (Stop), `!` (E-Stop).
   - **Putar Rotary / UP-DOWN**: Ubah Setpoint RPM (atau PWM manual pada mode Open-Loop).
   - **Tekan Rotary / SELECT**: Start / Stop motor.
   - **Tahan Rotary (> 0.8 detik)**: **Emergency Stop** segera.
2. **Halaman 1 — PID Tuning Lokal**
   ```text
   >P:1.20  I:0.85 
    D:0.05  [SEL]  
   ```
   - **Tekan Rotary / SELECT**: Pindah kursor antar `Kp` → `Ki` → `Kd`.
   - **Putar Rotary / UP-DOWN**: Ubah nilai gain langsung.
3. **Halaman 2 — Mode Operasi**
   - **Putar Rotary / UP-DOWN**: Toggle `PID CLOSED` ↔ `OPEN LOOP`.
   - **Tekan Rotary / SELECT**: Start / Stop motor.

---

## 3. Protokol Komunikasi Serial R/W (`115200 baud`, `\n`)

### Read (`MC -> Dashboard`, 20 Hz / setiap 50 ms)
```text
T,<timestamp_ms>,<sp_rpm>,<actual_rpm>,<error_rpm>,<pwm>,<voltage_v>,<kp>,<ki>,<kd>,<mode>,<run_state>
```
- `mode`: `0` = Open-Loop, `1` = Closed-Loop PID
- `run_state`: `0` = Stopped, `1` = Running, `2` = E-Stop Latched

Contoh frame:
```text
T,12450,150.00,148.62,1.38,184,24.40,1.200,0.850,0.050,1,1
```

### Write (`Dashboard -> MC`)
| Perintah | Deskripsi | Contoh |
| :--- | :--- | :--- |
| `SP:<rpm>` | Ubah Setpoint RPM | `SP:180.0` |
| `KP:<val>` | Ubah gain Proporsional | `KP:1.50` |
| `KI:<val>` | Ubah gain Integral | `KI:0.90` |
| `KD:<val>` | Ubah gain Derivatif | `KD:0.06` |
| `PID:<kp>,<ki>,<kd>` | Update atomik ketiga gain PID sekaligus | `PID:1.50,0.90,0.06` |
| `PWM:<0-255>` | Set PWM manual (mode Open-Loop) | `PWM:140` |
| `MODE:<0\|1>` | `0` = Open-Loop, `1` = Closed-Loop PID | `MODE:1` |
| `CMD:START` | Jalankan kontrol motor | `CMD:START` |
| `CMD:STOP` | Hentikan motor secara halus | `CMD:STOP` |
| `CMD:ESTOP` | Emergency Stop (PWM=0 instan + reset integral) | `CMD:ESTOP` |
| `CMD:RESET` | Reset state PID, pulsa encoder, dan timer | `CMD:RESET` |
| `CMD:SYNC` | Minta banner info & frame telemetri segera | `CMD:SYNC` |
| `PPR:<val>` | Kalibrasi PPR encoder output tanpa re-upload | `PPR:360` |

---

## 4. Cara Upload & Kalibrasi PPR

1. Buka `firmware/pens_pid_motor/pens_pid_motor.ino` di **Arduino IDE**.
2. Sesuaikan `DEFAULT_MOTOR_PPR`, `MOTOR_DRIVER_MODE`, dan `VOLTAGE_DIVIDER_RATIO` di `config.h` sesuai unit motor/driver praktikum Anda.
3. Pilih Board **Arduino Uno** atau **Arduino Mega 2560** dan Port USB yang sesuai, lalu klik **Upload**.
4. Tutup Arduino Serial Monitor sebelum menghubungkan Web Dashboard (karena port Serial hanya bisa dibuka oleh satu aplikasi pada satu waktu).
