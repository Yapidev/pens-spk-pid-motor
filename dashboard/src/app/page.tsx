"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ControlPanel } from "@/components/ControlPanel";
import { LcdMirror } from "@/components/LcdMirror";
import { MetricsPanel } from "@/components/MetricsPanel";
import { SerialConsole } from "@/components/SerialConsole";
import { StepResponseChart } from "@/components/StepResponseChart";
import { TopBar } from "@/components/TopBar";
import { exportTelemetryCsv } from "@/lib/csvExport";
import { computeStepMetrics } from "@/lib/metrics";
import { MotorPlantSimulator } from "@/lib/motorSimulator";
import {
  encodeCommand,
  encodeManualPwm,
  encodeMode,
  encodePID,
  encodePpr,
  encodeSetpoint,
  parseSerialLine,
} from "@/lib/protocol";
import { isWebSerialSupported, SerialTransport } from "@/lib/webSerial";
import type {
  ConnectionMode,
  ConnectionStatus,
  ControlMode,
  DeviceInfo,
  PIDParams,
  SerialLogEntry,
  TelemetrySample,
} from "@/types/telemetry";

const MAX_PLOT_SAMPLES = 2400; // 120 detik @ 20 Hz
const MAX_RECORD_SAMPLES = 50000;
const MAX_LOG_ENTRIES = 300;

function formatClock(): string {
  const now = new Date();
  return now.toTimeString().slice(0, 8);
}

export default function DashboardPage() {
  // Connection state
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("simulator");
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("disconnected");
  const [connectionLabel, setConnectionLabel] = useState("Belum terhubung");
  const [baudRate, setBaudRate] = useState(115200);
  const [wsUrl, setWsUrl] = useState("ws://localhost:8080");
  const [webSerialSupported, setWebSerialSupported] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);

  // Live telemetry & logging buffers
  const [plotSamples, setPlotSamples] = useState<TelemetrySample[]>([]);
  const [latestSample, setLatestSample] = useState<TelemetrySample | null>(null);
  const [sampleRateHz, setSampleRateHz] = useState(0);
  const [isRecording, setIsRecording] = useState(true);
  const [recordedCount, setRecordedCount] = useState(0);
  const [logs, setLogs] = useState<SerialLogEntry[]>([]);

  // Draft control inputs (Write -> MC)
  const [draftPid, setDraftPid] = useState<PIDParams>({ kp: 1.2, ki: 0.85, kd: 0.05 });
  const [draftSetpoint, setDraftSetpoint] = useState(150);
  const [draftManualPwm, setDraftManualPwm] = useState(110);
  const [autoSendPid, setAutoSendPid] = useState(true);
  const [pprValue, setPprValue] = useState(330);

  // Refs for transport, simulator, throttling, and high-frequency data
  const transportRef = useRef<SerialTransport | null>(null);
  const simulatorRef = useRef<MotorPlantSimulator | null>(null);
  const sessionOriginMsRef = useRef<number | null>(null);
  const initialSyncedRef = useRef(false);
  const lastRemoteSpRef = useRef<number | null>(null);
  const lastLocalEditMsRef = useRef(0);
  const recordedSamplesRef = useRef<TelemetrySample[]>([]);
  const isRecordingRef = useRef(true);
  const rxTimestampsRef = useRef<number[]>([]);
  const logIdRef = useRef(1);
  const pidThrottleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spThrottleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pwmThrottleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectionModeRef = useRef<ConnectionMode>("simulator");

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    connectionModeRef.current = connectionMode;
  }, [connectionMode]);

  const appendLog = useCallback((dir: "RX" | "TX" | "SYS", text: string) => {
    setLogs((prev) => {
      const next: SerialLogEntry = {
        id: logIdRef.current++,
        dir,
        text,
        time: formatClock(),
      };
      const updated = [...prev, next];
      return updated.length > MAX_LOG_ENTRIES
        ? updated.slice(updated.length - MAX_LOG_ENTRIES)
        : updated;
    });
  }, []);

  const handleIncomingLine = useCallback(
    (rawLine: string) => {
      const parsed = parseSerialLine(rawLine, sessionOriginMsRef.current);

      if (parsed.type === "telemetry") {
        const s = parsed.sample;

        // Tangani reset timestamp dari Arduino (CMD:RESET)
        if (
          sessionOriginMsRef.current === null ||
          s.timestampMs < sessionOriginMsRef.current
        ) {
          sessionOriginMsRef.current = s.timestampMs;
          s.elapsedSec = 0;
        }

        // Hitung sample rate aktual (jendela 1 detik)
        const now = Date.now();
        const rxWindow = rxTimestampsRef.current;
        rxWindow.push(now);
        while (rxWindow.length > 0 && now - rxWindow[0] > 1000) {
          rxWindow.shift();
        }
        setSampleRateHz(rxWindow.length);

        // Sinkronisasi awal atau perubahan lokal dari Rotary Encoder/Keypad modul
        if (!initialSyncedRef.current) {
          initialSyncedRef.current = true;
          setDraftPid({ kp: s.kp, ki: s.ki, kd: s.kd });
          setDraftSetpoint(Math.round(s.setpoint));
          setDraftManualPwm(s.pwm);
          lastRemoteSpRef.current = s.setpoint;
        } else if (
          lastRemoteSpRef.current !== null &&
          Math.abs(s.setpoint - lastRemoteSpRef.current) >= 1 &&
          now - lastLocalEditMsRef.current > 600
        ) {
          setDraftSetpoint(Math.round(s.setpoint));
        }
        lastRemoteSpRef.current = s.setpoint;

        setLatestSample(s);
        setPlotSamples((prev) => {
          const next = [...prev, s];
          return next.length > MAX_PLOT_SAMPLES
            ? next.slice(next.length - MAX_PLOT_SAMPLES)
            : next;
        });

        if (isRecordingRef.current && recordedSamplesRef.current.length < MAX_RECORD_SAMPLES) {
          recordedSamplesRef.current.push(s);
          setRecordedCount(recordedSamplesRef.current.length);
        }

        appendLog("RX", rawLine);
      } else if (parsed.type === "ack") {
        appendLog("RX", `ACK,${parsed.key},${parsed.value}`);
      } else if (parsed.type === "info") {
        setDeviceInfo(parsed.info);
        if (parsed.info.ppr !== null) {
          setPprValue(parsed.info.ppr);
        }
        appendLog("RX", rawLine);
      } else if (parsed.raw) {
        appendLog("RX", parsed.raw);
      }
    },
    [appendLog]
  );

  const sendRawCommand = useCallback(
    (cmd: string) => {
      const clean = cmd.trim();
      if (!clean) return;
      appendLog("TX", clean);

      if (connectionModeRef.current === "simulator" && simulatorRef.current) {
        simulatorRef.current.sendCommand(clean);
      } else if (transportRef.current) {
        void transportRef.current.sendLine(clean);
      }
    },
    [appendLog]
  );

  const disconnectAll = useCallback(
    async (silent = false) => {
      if (simulatorRef.current) {
        simulatorRef.current.stop();
        simulatorRef.current = null;
      }
      if (transportRef.current) {
        await transportRef.current.disconnect();
      }
      setConnectionStatus("disconnected");
      setConnectionLabel("Terputus");
      setSampleRateHz(0);
      rxTimestampsRef.current = [];
      if (!silent) {
        appendLog("SYS", "Koneksi ditutup.");
      }
    },
    [appendLog]
  );

  const startSimulator = useCallback(async () => {
    await disconnectAll(true);
    setErrorMessage(null);
    sessionOriginMsRef.current = null;
    initialSyncedRef.current = false;
    setPlotSamples([]);
    recordedSamplesRef.current = [];
    setRecordedCount(0);

    const sim = new MotorPlantSimulator();
    simulatorRef.current = sim;
    setConnectionMode("simulator");
    connectionModeRef.current = "simulator";
    setConnectionStatus("connected");
    setConnectionLabel("Plant 24V Digital Twin @ 20 Hz");
    appendLog("SYS", "Digital Twin Simulator 24V aktif (PID 1.20 / 0.85 / 0.05, SP=150 RPM).");
    sim.start(handleIncomingLine);
  }, [appendLog, disconnectAll, handleIncomingLine]);

  const handleConnect = useCallback(async () => {
    setErrorMessage(null);

    if (connectionMode === "simulator") {
      await startSimulator();
      return;
    }

    await disconnectAll(true);
    setConnectionStatus("connecting");
    sessionOriginMsRef.current = null;
    initialSyncedRef.current = false;
    setPlotSamples([]);
    recordedSamplesRef.current = [];
    setRecordedCount(0);

    if (!transportRef.current) {
      transportRef.current = new SerialTransport();
    }

    const callbacks = {
      onLine: handleIncomingLine,
      onDisconnect: (reason?: string) => {
        setConnectionStatus("disconnected");
        setConnectionLabel(reason ?? "Terputus");
        setSampleRateHz(0);
        appendLog("SYS", reason ?? "Perangkat terputus.");
      },
      onError: (msg: string) => {
        setErrorMessage(msg);
        setConnectionStatus("error");
        appendLog("SYS", `ERROR: ${msg}`);
      },
    };

    try {
      const label =
        connectionMode === "serial"
          ? await transportRef.current.connectWebSerial(baudRate, callbacks)
          : await transportRef.current.connectWebSocket(wsUrl, callbacks);

      setConnectionStatus("connected");
      setConnectionLabel(label);
      appendLog("SYS", `Terhubung: ${label}`);

      // Tunggu bootloader Arduino Uno/Mega sesaat lalu minta sinkronisasi status
      setTimeout(() => {
        sendRawCommand(encodeCommand("SYNC"));
      }, 1500);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Gagal membuka koneksi serial.";
      // Jangan tampilkan error keras jika pengguna membatalkan dialog COM port
      if (msg.toLowerCase().includes("no port selected")) {
        setConnectionStatus("disconnected");
        setConnectionLabel("Pemilihan port dibatalkan");
      } else {
        setErrorMessage(msg);
        setConnectionStatus("error");
        setConnectionLabel("Koneksi gagal");
        appendLog("SYS", `ERROR: ${msg}`);
      }
    }
  }, [
    appendLog,
    baudRate,
    connectionMode,
    disconnectAll,
    handleIncomingLine,
    sendRawCommand,
    startSimulator,
    wsUrl,
  ]);

  // Cek dukungan Web Serial & aktifkan Digital Twin Simulator saat halaman dibuka
  useEffect(() => {
    setWebSerialSupported(isWebSerialSupported());
    void startSimulator();

    return () => {
      if (simulatorRef.current) {
        simulatorRef.current.stop();
      }
      if (transportRef.current) {
        void transportRef.current.disconnect();
      }
      if (pidThrottleTimerRef.current) clearTimeout(pidThrottleTimerRef.current);
      if (spThrottleTimerRef.current) clearTimeout(spThrottleTimerRef.current);
      if (pwmThrottleTimerRef.current) clearTimeout(pwmThrottleTimerRef.current);
    };
  }, [startSimulator]);

  // Pintasan keyboard Escape -> Emergency Stop instan
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && connectionStatus === "connected") {
        e.preventDefault();
        sendRawCommand(encodeCommand("ESTOP"));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [connectionStatus, sendRawCommand]);

  const handleChangeConnectionMode = (nextMode: ConnectionMode) => {
    if (nextMode === connectionMode) return;
    void disconnectAll(true).then(() => {
      setErrorMessage(null);
      setConnectionMode(nextMode);
      connectionModeRef.current = nextMode;
      if (nextMode === "simulator") {
        void startSimulator();
      } else {
        setConnectionLabel(
          nextMode === "serial"
            ? "Klik 'Select COM Port' untuk menghubungkan Arduino"
            : `Siap terhubung ke ${wsUrl}`
        );
      }
    });
  };

  // --- Handlers Control Panel (Write -> MC) ---

  const handleChangeDraftPid = (next: PIDParams, immediate = false) => {
    setDraftPid(next);
    if (!autoSendPid && !immediate) return;

    if (pidThrottleTimerRef.current) clearTimeout(pidThrottleTimerRef.current);
    if (immediate) {
      sendRawCommand(encodePID(next));
    } else {
      pidThrottleTimerRef.current = setTimeout(() => {
        sendRawCommand(encodePID(next));
      }, 80);
    }
  };

  const handleApplyPid = () => {
    sendRawCommand(encodePID(draftPid));
  };

  const handleChangeSetpoint = (sp: number) => {
    lastLocalEditMsRef.current = Date.now();
    setDraftSetpoint(sp);
    if (spThrottleTimerRef.current) clearTimeout(spThrottleTimerRef.current);
    spThrottleTimerRef.current = setTimeout(() => {
      sendRawCommand(encodeSetpoint(sp));
    }, 65);
  };

  const handleTriggerStepTest = (targetSp: number) => {
    lastLocalEditMsRef.current = Date.now();
    setDraftSetpoint(targetSp);
    setPlotSamples([]);
    sessionOriginMsRef.current = null;
    sendRawCommand(encodeCommand("RESET"));
    setTimeout(() => {
      sendRawCommand(encodeMode(1));
      sendRawCommand(encodePID(draftPid));
      sendRawCommand(encodeSetpoint(targetSp));
      sendRawCommand(encodeCommand("START"));
    }, 120);
  };

  const handleChangeManualPwm = (pwm: number) => {
    lastLocalEditMsRef.current = Date.now();
    setDraftManualPwm(pwm);
    if (pwmThrottleTimerRef.current) clearTimeout(pwmThrottleTimerRef.current);
    pwmThrottleTimerRef.current = setTimeout(() => {
      sendRawCommand(encodeManualPwm(pwm));
    }, 65);
  };

  const handleSwitchMode = (mode: ControlMode) => {
    sendRawCommand(encodeMode(mode));
    if (mode === 0 && latestSample) {
      setDraftManualPwm(latestSample.pwm);
    }
  };

  const handleCommand = (cmd: "START" | "STOP" | "ESTOP" | "RESET" | "SYNC") => {
    sendRawCommand(encodeCommand(cmd));
    if (cmd === "RESET") {
      setPlotSamples([]);
      sessionOriginMsRef.current = null;
    }
  };

  const handleApplyPpr = (ppr: number) => {
    setPprValue(ppr);
    sendRawCommand(encodePpr(ppr));
  };

  const handleInjectDisturbance = () => {
    if (simulatorRef.current) {
      simulatorRef.current.injectLoadDisturbance(50);
    }
  };

  const handleClearPlot = () => {
    setPlotSamples([]);
  };

  const handleClearRecording = () => {
    recordedSamplesRef.current = [];
    setRecordedCount(0);
  };

  const metrics = useMemo(() => computeStepMetrics(plotSamples), [plotSamples]);

  const handleExportCsv = () => {
    exportTelemetryCsv(recordedSamplesRef.current, metrics);
  };

  const connected = connectionStatus === "connected";
  const activeMode: ControlMode = latestSample?.mode ?? 1;
  const runState = latestSample?.runState ?? 0;
  const activePid: PIDParams = latestSample
    ? { kp: latestSample.kp, ki: latestSample.ki, kd: latestSample.kd }
    : draftPid;

  return (
    <div className="flex min-h-screen flex-col bg-[#f5f5f3]">
      <TopBar
        connectionMode={connectionMode}
        connectionStatus={connectionStatus}
        connectionLabel={connectionLabel}
        baudRate={baudRate}
        wsUrl={wsUrl}
        webSerialSupported={webSerialSupported}
        sampleRateHz={sampleRateHz}
        deviceInfo={deviceInfo}
        isRecording={isRecording}
        recordedCount={recordedCount}
        errorMessage={errorMessage}
        onChangeMode={handleChangeConnectionMode}
        onChangeBaudRate={setBaudRate}
        onChangeWsUrl={setWsUrl}
        onConnect={() => void handleConnect()}
        onDisconnect={() => void disconnectAll(false)}
        onToggleRecording={() => setIsRecording((v) => !v)}
        onClearRecording={handleClearRecording}
        onExportCsv={handleExportCsv}
      />

      <main className="mx-auto flex w-full max-w-[1640px] flex-1 flex-col gap-4 px-4 py-4 lg:px-6">
        {/* Top Row: Virtual 16x2 LCD Mirror + Real-Time Telemetry KPIs */}
        <LcdMirror latest={latestSample} />

        {/* Main Asymmetric Engineering Grid: Oscilloscope & Metrics (Left) + PID Control Deck (Right) */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <div className="flex flex-col gap-4 xl:col-span-8 2xl:col-span-9">
            <StepResponseChart
              samples={plotSamples}
              metrics={metrics}
              onClearPlot={handleClearPlot}
            />
            <MetricsPanel metrics={metrics} />
            <SerialConsole
              logs={logs}
              connected={connected}
              onSendRaw={sendRawCommand}
              onClearLogs={() => setLogs([])}
            />
          </div>

          <div className="xl:col-span-4 2xl:col-span-3">
            <ControlPanel
              connected={connected}
              connectionMode={connectionMode}
              activeMode={activeMode}
              runState={runState}
              activePid={activePid}
              activeSetpoint={latestSample?.setpoint ?? draftSetpoint}
              activePwm={latestSample?.pwm ?? 0}
              draftPid={draftPid}
              draftSetpoint={draftSetpoint}
              draftManualPwm={draftManualPwm}
              autoSendPid={autoSendPid}
              pprValue={pprValue}
              onChangeDraftPid={handleChangeDraftPid}
              onApplyPid={handleApplyPid}
              onToggleAutoSendPid={setAutoSendPid}
              onChangeSetpoint={handleChangeSetpoint}
              onTriggerStepTest={handleTriggerStepTest}
              onChangeManualPwm={handleChangeManualPwm}
              onSwitchMode={handleSwitchMode}
              onCommand={handleCommand}
              onApplyPpr={handleApplyPpr}
              onInjectDisturbance={
                connectionMode === "simulator" ? handleInjectDisturbance : undefined
              }
            />
          </div>
        </div>
      </main>

      {/* Minimal Swiss Technical Architecture Footer */}
      <footer className="mt-auto border-t border-[#dfe2e8] bg-white">
        <div className="mx-auto flex max-w-[1640px] flex-wrap items-center justify-between gap-2 px-4 py-2 font-mono text-[10px] text-[#64748b] lg:px-6">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold text-[#0f172a]">SIGNAL FLOW:</span>
            <span>[Button, Enc]</span>
            <span>→</span>
            <span className="text-[#0f172a]">[MC: Arduino PID Ts=50ms]</span>
            <span>→</span>
            <span>[Driver + Motor DC 24V]</span>
            <span>→</span>
            <span className="text-[#1d4ed8]">[INT0 Encoder RPM]</span>
            <span className="mx-1 text-[#cbd5e1]">|</span>
            <span className="text-[#059669]">MC ⇄ Laptop ⇄ Dashboard [R/W 115200]</span>
          </div>
          <div>PENS · Sistem Pengaturan Komputer</div>
        </div>
      </footer>
    </div>
  );
}
