# Panduan Presentasi & Defense Teknis — PENS SPK PID Motor DC 24V (v2.0)

Dokumen ini disusun khusus untuk menjawab **2 kriteria penilaian dosen Sistem Pengaturan Komputer (SPK)**:
1. **Perbedaan Teknis** (bukan tampilan/UI) dibanding implementasi PID standar kelompok lain.
2. **Penguasaan Teknis** — rumus inti, arsitektur embedded, skenario live demo 5 menit, dan jawaban atas pertanyaan kritis dosen.

---

## 1. Ringkasan 6 Pembeda Teknis Utama

| # | Fitur Teknis | Kelompok Umum | Project Kita (v2.0) | File Implementasi |
| :-: | :--- | :--- | :--- | :--- |
| 1 | **Hard Real-Time Sampling (`TC3`)** | Polling `millis()` / `delay()` (rawan jitter saat `lcd.print()`) | Hardware Timer Interrupt **SAM3X8E `TC1 Ch0` (`TC3_IRQn`)** tepat **20 Hz (50.000 ms)** yang mengunci pulsa encoder langsung di ISR (`jitter < 2 µs`) | `firmware/pens_pid_motor/pens_pid_motor.ino` |
| 2 | **4× Quadrature Gray-Code LUT** | Interrupt `RISING` 1× satu arah | Interrupt `CHANGE` pada Pin 50 & 52 + tabel Gray-Code 16-state (anti-glitch, resolusi 4× lebih halus, membaca arah CW `+RPM` & CCW `-RPM`) | `firmware/pens_pid_motor/pens_pid_motor.ino` |
| 3 | **Auto System ID (FOPDT) & Auto-Tune** | Menebak `Kp, Ki, Kd` (*trial & error*) | Open-Loop Step Test otomatis → identifikasi model **$G(s) = \frac{K e^{-\theta s}}{\tau s + 1}$** (Metode 2-Titik Smith + $R^2$) → hitung analitis **IMC, Cohen-Coon, Ziegler-Nichols, dan $K_{\text{ff}}$** | `dashboard/src/lib/systemId.ts` |
| 4 | **Arsitektur 2-DOF PID + Kompensasi Tegangan 24V (`A10`)** | 1-DOF PID murni; sensor tegangan hanya pajangan LCD | **Feedforward ($K_{\text{ff}}\cdot\text{SP} + u_{\text{dz}}$)** + **Voltage Scaling ($V_{\text{nom}}/V_{\text{aktual}}$)** aktif di dalam *control loop*, lengkap dengan Anti-Windup 2-DOF & Bumpless Transfer | `firmware/pens_pid_motor/pid_controller.h` |
| 5 | **Proteksi Aktif Arus ACS712 (`A11`) & Stall Guard** | Sensor arus hanya tampil angka; driver IBT-2 rawan panas saat poros ditahan | **Soft Current Limiter** (derating PWM halus jika $I > I_{\text{limit}}$) + **Stall Fault Guard** (cutoff otomatis jika `|PWM| ≥ 90` & `|RPM| < 5` selama `> 1.5 s`, kode `FL` di LCD) | `firmware/pens_pid_motor/pens_pid_motor.ino` |
| 6 | **Bidirectional CW/CCW ($\pm 700$ RPM), Ramp & A/B Ghost Overlay** | Putar 1 arah, step mendadak, tidak bisa bandingkan run | Dual-PWM IBT-2 (`RPWM` Pin 2 / `LPWM` Pin 3) $\pm 255$, **Trapezoidal Ramp Slew-Rate Limiter**, dan **Overlay A/B** hingga 3 kurva pada sumbu $t - t_0$ yang sama | `StepResponseChart.tsx`, `ComparePanel.tsx` |

---

## 2. Lima Rumus Inti yang Wajib Dikuasai Tim

### A. Pembacaan Kecepatan 4× Quadrature
$$\text{RPM}(k) = \frac{\Delta N_{\text{4x}}}{\text{PPR}_{\text{4x}}} \cdot \frac{60}{T_s}$$
- $\Delta N_{\text{4x}}$ dikunci atomik di dalam `TC3_Handler()` tepat setiap $T_s = 0.05\text{ s}$, lalu dihaluskan dengan filter EMA ($\alpha = 0.40$) untuk menekan *quantization noise* encoder.
- Tanda $\Delta N_{\text{4x}}$ menentukan arah putaran (`+` = CW, `-` = CCW).

### B. Identifikasi Model Plant FOPDT (Metode 2-Titik Smith)
Dari respon Open-Loop Step $\Delta u = \text{PWM}_{\text{step}}$ (misal $0 \to 160$), dicari waktu saat respon mencapai $28.3\%$ ($t_{28.3}$) dan $63.2\%$ ($t_{63.2}$) dari perubahan *steady-state* $\Delta y = y_\infty - y_0$:
$$K = \frac{\Delta y}{\Delta u}, \qquad \tau = 1.5\,(t_{63.2} - t_{28.3}), \qquad \theta = \max\!\left(0.02,\; t_{63.2} - \tau\right)$$
Model plant orde-1 dengan *dead time*:
$$G(s) = \frac{K \cdot e^{-\theta s}}{\tau s + 1}$$
Akurasi model dibuktikan lewat koefisien determinasi $R^2 = 1 - \frac{\sum (y_i - \hat{y}_i)^2}{\sum (y_i - \bar{y})^2}$ (umumnya $> 95\%$).

### C. Auto-Tuning Analitis IMC / Lambda (Rekomendasi Minim Overshoot)
Dengan konstanta waktu *closed-loop* yang diinginkan $\lambda = \max(0.65\tau,\; 1.8\theta)$:
$$K_p = \frac{\tau + 0.5\theta}{K\,(\lambda + 0.5\theta)}, \qquad T_i = \tau + 0.5\theta, \qquad T_d = \frac{\tau\theta}{2\tau + \theta}$$
$$K_i = \frac{K_p}{T_i}, \qquad K_d = K_p \cdot T_d, \qquad K_{\text{ff}} \approx \frac{1}{K}$$
*(Tersedia pula hasil **Cohen-Coon** untuk anti-beban dan **Ziegler-Nichols** untuk menunjukkan trade-off rise time cepat vs overshoot tinggi.)*

### D. Kontroler 2-DOF PID + Kompensasi Tegangan Supply 24V
$$u_{\text{ff}}(k) = K_{\text{ff}} \cdot \text{SP}(k) + \operatorname{sign}(\text{SP})\cdot u_{\text{deadzone}}$$
$$u_{\text{PID}}(k) = K_p e(k) + I(k) - K_d \cdot \operatorname{LPF}\!\left(\frac{y(k)-y(k-1)}{T_s}\right)$$
$$u_{\text{total}}(k) = \operatorname{clamp}\!\left(\left(u_{\text{ff}}(k) + u_{\text{PID}}(k)\right) \cdot \frac{V_{\text{nom}}}{V_{\text{aktual}}},\; -255,\; +255\right)$$
- **Derivative-on-Measurement:** suku $D$ diturunkan dari $-dy/dt$ (bukan $de/dt$) sehingga tidak ada *derivative kick* saat setpoint berubah mendadak.
- **Anti-Windup 2-DOF:** akumulator integral $I(k)$ berhenti bertambah bila $u_{\text{total}}$ sudah saturasi di $\pm 255$ searah tanda error.
- **Kompensasi Tegangan:** jika tegangan PSU turun (*voltage sag* dari $24.4\text{ V} \to 21.5\text{ V}$), faktor $V_{\text{nom}}/V_{\text{aktual}}$ otomatis menaikkan duty cycle PWM agar *loop gain* motor tetap konstan.

### E. Soft Current Limiter & Stall Guard (ACS712 5A)
- Bila $I_{\text{aktual}} > I_{\text{limit}}$ (default `3.5 A`), batas atas PWM sementara ($\text{PWM}_{\text{cap}}$) diturunkan secara proporsional per tick:
  $$\text{PWM}_{\text{cap}} \leftarrow \max\!\left(45,\; \text{PWM}_{\text{cap}} - 35\,(I_{\text{aktual}} - I_{\text{limit}})\right)$$
  dan pulih bertahap (`+12 PWM/tick`) ketika arus kembali aman.
- Bila $|\text{PWM}| \ge 90$ tetapi $|\text{RPM}| < 5$ terus-menerus selama $\ge 1.5\text{ s}$, firmware mengunci **STALL FAULT** (`PWM = 0`, LCD menampilkan `FL`) untuk melindungi motor dan H-Bridge IBT-2.

---

## 3. Skenario Live Demo 5 Menit di Depan Dosen

1. **Menit 0–1 · Identifikasi Plant Otomatis (Bukan Tebak-Tebakan):**
   - Buka tab dock **`Auto-Tune`** → klik **Identifikasi** (PWM `160`).
   - Tunjukkan kurva respon Open-Loop + garis putus-putus hijau **Model FOPDT** dan nilai **$K, \tau, \theta, R^2$**.
2. **Menit 1–2 · Pembuktian Auto-Tune vs 2-DOF Feedforward (Overlay A/B):**
   - Klik **Pakai PID** pada kartu **IMC / Lambda** → klik **Step Test → 350 RPM** → setelah stabil klik **Pin** (simpan sebagai *Run #1 · 1-DOF*).
   - Buka tab **`Auto-Tune`** lagi → klik **+ 2-DOF** (mengaktifkan `Feedforward Kff = 1/K`) → klik **Step Test → 350 RPM** lagi.
   - Buka tab **`Bandingkan`**: tunjukkan secara langsung kurva *2-DOF* lebih cepat (*Rise Time* turun) dengan *overshoot* tetap terkendali dibanding *Run #1*.
3. **Menit 2–3 · Bidirectional CW ↔ CCW & Trapezoidal Ramp:**
   - Buka panel **`2-DOF & Proteksi`** → set `Ramp = 250 RPM/s`.
   - Klik tombol balik arah **`±`** di samping Setpoint (`+350 RPM → -350 RPM`).
   - Tunjukkan grafik RPM & PWM berpindah mulus melewati nol tanpa lonjakan arus ekstrem.
4. **Menit 3–4 · Uji Beban & Proteksi Arus ACS712 / Stall Guard:**
   - Ubah sub-grafik osiloskop ke **`Arus`**.
   - Tahan poros motor perlahan dengan tangan (atau klik **`Beban`** / **`Uji Stall`** di Simulator): tunjukkan PID menaikkan PWM untuk menjaga RPM (*disturbance rejection*), arus ACS712 naik, dan saat ditahan macet `> 1.5 detik`, **Stall Fault Guard** otomatis memutus PWM (`FL` di LCD) agar driver IBT-2 aman.
5. **Menit 4–5 · Hard Real-Time Architecture:**
   - Tunjukkan status badge **`TC3 20Hz`** (Timer Counter hardware SAM3X8E yang tidak bentrok dengan PWM Pin 2/3/10) dan sinkronisasi penuh dengan **LCD 16×2** + **Rotary Encoder** modul fisik.

---

## 4. Pertanyaan yang Sering Ditanyakan Dosen & Jawabannya

- **Q: Kenapa pakai Hardware Timer `TC3` (`TC1 Ch0`) dan bukan `TC0` atau `millis()`?**
  - **A:** Di Arduino DUE (SAM3X8E), `TC0` dipakai oleh PWM Pin 2 (`RPWM` driver IBT-2), jadi menggunakan `TC0` akan merusak PWM motor. `TC1 Ch0` (`TC3_IRQn`) bebas dari seluruh pin PWM (2, 3, 10). Dengan mengunci `g_motorPulses` langsung di `TC3_Handler()`, jendela pengukuran kecepatan tepat `50.000 ms` (jitter `< 2 µs`) walau `loop()` sedang menulis ke LCD 16×2 atau Serial.
- **Q: Kenapa tidak pakai PID saja? Apa untungnya tambah Feedforward 2-DOF?**
  - **A:** PID murni bersifat *reaktif*—ia baru menghasilkan PWM setelah muncul error, sehingga untuk cepat butuh $K_p$ besar yang rawan *overshoot*. Feedforward $u_{\text{ff}} = K_{\text{ff}}\cdot\text{SP} + u_{\text{dz}}$ langsung memberi ~95% PWM yang dibutuhkan berdasarkan model plant $K$ (proaktif), sehingga PID tinggal mengoreksi sisa 5% error dan gangguan beban.
- **Q: Kenapa nilai `PPR` bisa dikalibrasi live dari dashboard?**
  - **A:** Karena motor DC geared memiliki rasio gearbox dan mode decoding (`1×` vs `4×`) yang bisa berbeda antar unit praktikum. Dengan perintah `PPR:<nilai>`, mahasiswa cukup memutar poros output 1 putaran penuh (`360°`) dan memasukkan jumlah pulsa tanpa perlu kompilasi/upload ulang firmware.
- **Q: Kenapa suku Derivatif dihitung dari pengukuran (`-dy/dt`) bukan error (`de/dt`)?**
  - **A:** Saat setpoint diubah mendadak (step), $de/dt \to \infty$ memicu lonjakan PWM sesaat (*derivative kick*). Karena $\frac{d(\text{SP}-y)}{dt} = -\frac{dy}{dt}$ saat SP konstan, *Derivative-on-Measurement* memberi redaman sama persis tanpa lonjakan saat perubahan SP.
- **Q: Apa yang terjadi jika sensor tegangan `A10` belum tersambung atau PSU 24V dimatikan?**
  - **A:** Firmware memasang *guard* `VCOMP_MIN_VOLTAGE = 12.0 V` dan batas faktor skala `[0.80 .. 1.35]`, sehingga jika PSU mati ($V < 12\text{ V}$), faktor kompensasi otomatis menjadi `1.0` (tidak terjadi pembagian nol atau ledakan gain).
