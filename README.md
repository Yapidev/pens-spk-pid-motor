# Sistem Kontrol Kecepatan (RPM) Motor DC 24V — PID Controller (PENS SPK)

Proyek lengkap **Firmware Mikrokontroler (Arduino Uno / Mega)** + **Real-Time Web Dashboard (Next.js + Tailwind CSS)** untuk praktikum **Modul Sistem Pengaturan Komputer (SPK) — PENS**.

## Struktur Direktori

```text
Final SPK/
├── firmware/
│   ├── README.md                      # Pinout, wiring, navigasi LCD, & protokol Serial
│   ├── platformio.ini                 # Konfigurasi opsional PlatformIO (Uno & Mega 2560)
│   └── pens_pid_motor/
│       ├── pens_pid_motor.ino         # Sketch utama Arduino (Interrupt, PID 20 Hz, LCD, Serial R/W)
│       ├── config.h                   # Mapping pin bebas konflik LCD Shield & parameter hardware
│       └── pid_controller.h           # Kelas Discrete PID (anti-windup, derivative filter, clamp)
└── dashboard/
    ├── package.json
    ├── scripts/
    │   └── serial-bridge.mjs          # Opsional: Node.js Serial ↔ WebSocket bridge (Firefox/Safari)
    └── src/
        ├── app/page.tsx               # Halaman utama dashboard (Swiss Technical UI)
        ├── components/                # TopBar, LcdMirror, StepResponseChart, MetricsPanel, ControlPanel, SerialConsole
        ├── lib/                       # protocol.ts, metrics.ts, motorSimulator.ts, webSerial.ts, csvExport.ts
        └── types/telemetry.ts         # Definisi tipe data telemetri & metrik
```

---

## Arsitektur Alur Data (`R/W`)

```text
[Button, Rotary Enc] ──▶ [MC: Arduino Uno/Mega + PID (Ts = 50 ms)] ──▶ [Driver Motor DC 24V]
                               ▲           │         ▲                        │
                               │  R/W      ▼         │ Feedback (INT0 D2)     ▼
                         [LCD 16x2]   [USB Serial]   └────────── [Encoder Motor DC → RPM]
                                           │
                                           ▼ (Web Serial API / WS Bridge)
                               [Laptop · Next.js Dashboard]
                       (Step Response Plot · Metrics · Tuning · CSV)
```

---

## Panduan Cepat Menjalankan Proyek

### 1. Upload Firmware ke Arduino Uno / Mega
1. Buka `firmware/pens_pid_motor/pens_pid_motor.ino` di **Arduino IDE**.
2. Cek `config.h` untuk menyesuaikan:
   - `DEFAULT_MOTOR_PPR` (pulsa encoder per putaran poros output, default `330.0f`).
   - `MOTOR_DRIVER_MODE` (`0` = L298N/H-Bridge, `1` = PWM+DIR, `2` = BTS7960).
   - `VOLTAGE_DIVIDER_RATIO` (default `5.70f` untuk pembagi 47k/10k, atau `5.00f` untuk modul sensor 0–25V).
3. Upload ke board **Arduino Uno** atau **Arduino Mega 2560** (tanpa perlu install library tambahan; `LiquidCrystal.h` sudah bawaan).
4. Pastikan **Arduino Serial Monitor ditutup** sebelum menghubungkan dashboard.

Detail tabel pinout lengkap ada di [`firmware/README.md`](firmware/README.md).

### 2. Jalankan Web Dashboard Secara Lokal
```bash
cd dashboard
npm install
npm run dev
```
Buka **`http://localhost:3000`** menggunakan **Google Chrome** atau **Microsoft Edge** (untuk dukungan Web Serial API langsung).

- **Mode Simulator (Default saat dibuka):** Dashboard langsung menjalankan *Digital Twin* Motor DC 24V sehingga Anda dapat menguji grafik *Step Response*, metrik performa ($T_r$, $\%OS$, $T_s$, $e_{ss}$), gangguan beban, dan ekspor `.csv` sebelum modul fisik dipasang.
- **Mode Web Serial (Modul Fisik):** Pilih tab **Web Serial** → pilih baud rate **`115200`** → klik **Select COM Port** → pilih port Arduino Anda.
- **Mode WS Bridge (Opsional untuk Firefox / Safari):**
  ```bash
  cd dashboard
  npm install --no-save serialport @serialport/parser-readline ws
  node scripts/serial-bridge.mjs --port /dev/ttyACM0 --baud 115200
  ```
  *(Pada Windows gunakan `--port COM3`)*, lalu pilih tab **WS Bridge** (`ws://localhost:8080`) di dashboard.

---

## Fitur Utama Dashboard
- **Virtual LCD 16x2 Mirror:** Mereplikasi persis tampilan LCD Shield (`PWM`, `V`, `RPM`, `SP`, indikator mode `P/O/S/!`) secara real-time.
- **Oscilloscope Step Response Interaktif:** Grafik HiDPI 60 FPS (*Setpoint* vs *Actual RPM* + sub-grafik *PWM* / *Error*), pita toleransi ±2%, crosshair inspeksi, *Freeze/Resume*, dan ekspor gambar **`.png`** beranotasi.
- **Kalkulasi Metrik Otomatis:** Menghitung *Rise Time ($T_r$)*, *Overshoot ($\%OS$)*, *Settling Time ($T_s$)*, *Steady-State Error ($e_{ss}$)*, dan *IAE* secara otomatis setiap terjadi perubahan step Setpoint.
- **Live PID Tuning & Safety:** Slider & input presisi untuk $K_p, K_i, K_d$, Setpoint, Open-Loop PWM, preset praktikum (`P-Only`, `PI Smooth`, `PID Balanced`, `PID Fast`), tombol **Trigger Step Test**, serta **Emergency Stop** (tombol + shortcut `ESC`).
- **Data Logger & Export `.csv`:** Merekam seluruh frame telemetri dan mengekspornya ke `.csv` siap pakai untuk Excel, MATLAB, atau Python pada laporan praktikum.
