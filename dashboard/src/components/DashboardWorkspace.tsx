"use client";

import React, {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ControlPanel } from "@/components/ControlPanel";
import { LcdMirror } from "@/components/LcdMirror";
import { MetricsPanel } from "@/components/MetricsPanel";
import { SerialConsole } from "@/components/SerialConsole";
import { StepResponseChart } from "@/components/StepResponseChart";
import { TopBar } from "@/components/TopBar";
import { computeStepMetrics, EMPTY_METRICS } from "@/lib/metrics";
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
import { toggleColorScheme } from "@/lib/theme";
import type { SerialTransport } from "@/lib/webSerial";
import type {
  ConnectionMode,
  ConnectionStatus,
  ControlMode,
  DeviceInfo,
  PIDParams,
  SerialLogEntry,
  StepMetrics,
  TelemetrySample,
} from "@/types/telemetry";

const MAX_PLOT_SAMPLES = 2400; // 120 detik @ 20 Hz
const PLOT_COMPACT_THRESHOLD = MAX_PLOT_SAMPLES + 200;
const MAX_RECORD_SAMPLES = 50000;
const MAX_LOG_ENTRIES = 300;
const HUD_FLUSH_INTERVAL_MS = 100; // ~10 Hz untuk KPI & LCD (hemat re-render)
const METRICS_FLUSH_INTERVAL_MS = 250; // ~4 Hz untuk komputasi metrik step

function formatClock(): string {
  const now = new Date();
  return now.toTimeString().slice(0, 8);
}

function detectWebSerialSupport(): boolean {
  if (typeof navigator === "undefined") return false;
  return "serial" in navigator && Boolean((navigator as { serial?: unknown }).serial);
}

export function DashboardWorkspace() {
  // Hydration guard: cegah mismatch jika ekstensi browser memodifikasi atribut [disabled] sebelum hidrasi
  const [isHydrated, setIsHydrated] = useState(false);

  // Connection state
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("simulator");
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("disconnected");
  const [connectionLabel, setConnectionLabel] = useState("Belum terhubung");
  const [baudRate, setBaudRate] = useState(115200);
  const [wsUrl, setWsUrl] = useState("ws://localhost:8080");
  const [webSerialSupported, setWebSerialSupported] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);

  // Throttled HUD state (LCD, KPI, Metrics, Logger count, Serial Console logs)
  const [latestSample, setLatestSample] = useState<TelemetrySample | null>(null);
  const [metrics, setMetrics] = useState<StepMetrics>(EMPTY_METRICS);
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

  // High-frequency & event-synced refs (tanpa 8 useEffect mirror yang boros)
  const plotSamplesRef = useRef<TelemetrySample[]>([]);
  const telemetryVersionRef = useRef(0);
  const latestSampleRef = useRef<TelemetrySample | null>(null);
  const hudDirtyRef = useRef(false);
  const lastMetricsFlushRef = useRef(0);
  const lastHudSnapshotRef = useRef<{
    mode: ControlMode;
    runState: number;
    setpoint: number;
    kp: number;
    ki: number;
    kd: number;
  } | null>(null);

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
  const showTelemetryLogsRef = useRef(false);
  const pendingRxLogsRef = useRef<SerialLogEntry[]>([]);

  // Tracked timers for clean cancellation
  const pidThrottleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spThrottleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pwmThrottleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepTestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connectionModeRef = useRef<ConnectionMode>("simulator");
  const connectionStatusRef = useRef<ConnectionStatus>("disconnected");
  const draftPidRef = useRef<PIDParams>(draftPid);
  const autoSendPidRef = useRef<boolean>(autoSendPid);
  const wsUrlRef = useRef<string>(wsUrl);
  const baudRateRef = useRef<number>(baudRate);
  const metricsRef = useRef<StepMetrics>(metrics);

  const updateConnectionStatus = useCallback((next: ConnectionStatus) => {
    connectionStatusRef.current = next;
    setConnectionStatus(next);
  }, []);

  const showNotice = useCallback((message: string) => {
    setStatusNotice(message);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => {
      setStatusNotice(null);
    }, 3200);
  }, []);

  const appendLog = useCallback((dir: "RX" | "TX" | "SYS", text: string) => {
    const entry: SerialLogEntry = {
      id: logIdRef.current++,
      dir,
      text,
      time: formatClock(),
    };
    setLogs((prev) => {
      const updated = [...prev, entry];
      return updated.length > MAX_LOG_ENTRIES
        ? updated.slice(updated.length - MAX_LOG_ENTRIES)
        : updated;
    });
  }, []);

  const flushHudState = useCallback((urgent = false) => {
    const sample = latestSampleRef.current;
    const now = Date.now();

    const rxWindow = rxTimestampsRef.current;
    while (rxWindow.length > 0 && now - rxWindow[0] > 1000) {
      rxWindow.shift();
    }
    const nextHz = rxWindow.length;
    const recLen = recordedSamplesRef.current.length;
    const shouldComputeMetrics =
      urgent || now - lastMetricsFlushRef.current >= METRICS_FLUSH_INTERVAL_MS;
    const nextMetrics = shouldComputeMetrics
      ? computeStepMetrics(plotSamplesRef.current)
      : null;

    if (shouldComputeMetrics && nextMetrics) {
      lastMetricsFlushRef.current = now;
      metricsRef.current = nextMetrics;
    }

    const rxBatch =
      pendingRxLogsRef.current.length > 0 ? pendingRxLogsRef.current : null;
    if (rxBatch) {
      pendingRxLogsRef.current = [];
    }

    if (sample) {
      lastHudSnapshotRef.current = {
        mode: sample.mode,
        runState: sample.runState,
        setpoint: sample.setpoint,
        kp: sample.kp,
        ki: sample.ki,
        kd: sample.kd,
      };
    }

    hudDirtyRef.current = false;

    const commit = () => {
      setSampleRateHz((prev) => (prev === nextHz ? prev : nextHz));
      if (sample) setLatestSample(sample);
      setRecordedCount((prev) => (prev === recLen ? prev : recLen));
      if (nextMetrics) setMetrics(nextMetrics);
      if (rxBatch) {
        setLogs((prev) => {
          const merged = prev.concat(rxBatch);
          return merged.length > MAX_LOG_ENTRIES
            ? merged.slice(merged.length - MAX_LOG_ENTRIES)
            : merged;
        });
      }
    };

    // Tandai pembaruan telemetri periodik sebagai non-urgent (rerender-transitions)
    // agar input slider/ketikan user tidak pernah tersendat
    if (urgent) {
      commit();
    } else {
      startTransition(commit);
    }
  }, []);

  // Periodic HUD flush timer (~10 Hz) — menjaga responsivitas UI saat Canvas berjalan 60 FPS
  useEffect(() => {
    const id = setInterval(() => {
      if (hudDirtyRef.current || pendingRxLogsRef.current.length > 0) {
        flushHudState(false);
      }
    }, HUD_FLUSH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [flushHudState]);

  const handleIncomingLine = useCallback(
    (rawLine: string) => {
      const parsed = parseSerialLine(rawLine, sessionOriginMsRef.current);

      if (parsed.type === "telemetry") {
        const s = parsed.sample;

        if (
          sessionOriginMsRef.current === null ||
          s.timestampMs < sessionOriginMsRef.current
        ) {
          sessionOriginMsRef.current = s.timestampMs;
          s.elapsedSec = 0;
        }

        const now = Date.now();
        const rxWindow = rxTimestampsRef.current;
        rxWindow.push(now);
        while (rxWindow.length > 0 && now - rxWindow[0] > 1000) {
          rxWindow.shift();
        }

        if (!initialSyncedRef.current) {
          initialSyncedRef.current = true;
          const syncedPid = { kp: s.kp, ki: s.ki, kd: s.kd };
          draftPidRef.current = syncedPid;
          setDraftPid(syncedPid);
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

        // O(1) amortized in-place append (tanpa cloning 2400 objek setiap 50ms)
        const buf = plotSamplesRef.current;
        buf.push(s);
        if (buf.length > PLOT_COMPACT_THRESHOLD) {
          buf.splice(0, buf.length - MAX_PLOT_SAMPLES);
        }
        telemetryVersionRef.current++;
        latestSampleRef.current = s;
        hudDirtyRef.current = true;

        if (
          isRecordingRef.current &&
          recordedSamplesRef.current.length < MAX_RECORD_SAMPLES
        ) {
          recordedSamplesRef.current.push(s);
        }

        if (showTelemetryLogsRef.current) {
          pendingRxLogsRef.current.push({
            id: logIdRef.current++,
            dir: "RX",
            text: rawLine,
            time: formatClock(),
          });
          if (pendingRxLogsRef.current.length > 60) {
            pendingRxLogsRef.current.splice(0, pendingRxLogsRef.current.length - 60);
          }
        }

        const prevSnap = lastHudSnapshotRef.current;
        if (
          prevSnap === null ||
          prevSnap.mode !== s.mode ||
          prevSnap.runState !== s.runState ||
          Math.abs(prevSnap.setpoint - s.setpoint) >= 0.5 ||
          Math.abs(prevSnap.kp - s.kp) > 0.001 ||
          Math.abs(prevSnap.ki - s.ki) > 0.001 ||
          Math.abs(prevSnap.kd - s.kd) > 0.001
        ) {
          flushHudState(true);
        }
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
    [appendLog, flushHudState]
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

  const clearPendingTimers = useCallback(() => {
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    if (stepTestTimerRef.current) {
      clearTimeout(stepTestTimerRef.current);
      stepTestTimerRef.current = null;
    }
    if (pidThrottleTimerRef.current) {
      clearTimeout(pidThrottleTimerRef.current);
      pidThrottleTimerRef.current = null;
    }
    if (spThrottleTimerRef.current) {
      clearTimeout(spThrottleTimerRef.current);
      spThrottleTimerRef.current = null;
    }
    if (pwmThrottleTimerRef.current) {
      clearTimeout(pwmThrottleTimerRef.current);
      pwmThrottleTimerRef.current = null;
    }
  }, []);

  const disconnectAll = useCallback(
    async (silent = false) => {
      clearPendingTimers();
      if (simulatorRef.current) {
        simulatorRef.current.stop();
        simulatorRef.current = null;
      }
      if (transportRef.current) {
        await transportRef.current.disconnect();
      }
      updateConnectionStatus("disconnected");
      setConnectionLabel("Terputus");
      setSampleRateHz(0);
      rxTimestampsRef.current = [];
      if (!silent) {
        appendLog("SYS", "Koneksi ditutup.");
        showNotice("Koneksi terputus.");
      }
    },
    [appendLog, clearPendingTimers, showNotice, updateConnectionStatus]
  );

  const startSimulator = useCallback(async () => {
    await disconnectAll(true);
    setErrorMessage(null);
    sessionOriginMsRef.current = null;
    initialSyncedRef.current = false;
    lastHudSnapshotRef.current = null;
    plotSamplesRef.current = [];
    telemetryVersionRef.current++;
    latestSampleRef.current = null;
    recordedSamplesRef.current = [];
    metricsRef.current = EMPTY_METRICS;
    setLatestSample(null);
    setMetrics(EMPTY_METRICS);
    setRecordedCount(0);

    const sim = new MotorPlantSimulator();
    simulatorRef.current = sim;
    connectionModeRef.current = "simulator";
    setConnectionMode("simulator");
    updateConnectionStatus("connected");
    setConnectionLabel("Plant 24V Digital Twin @ 20 Hz");
    appendLog(
      "SYS",
      "Digital Twin Simulator 24V aktif (PID 1.20 / 0.85 / 0.05, SP=150 RPM)."
    );
    sim.start(handleIncomingLine);
  }, [appendLog, disconnectAll, handleIncomingLine, updateConnectionStatus]);

  const handleConnect = useCallback(async () => {
    setErrorMessage(null);
    const mode = connectionModeRef.current;

    if (mode === "simulator") {
      await startSimulator();
      return;
    }

    await disconnectAll(true);
    updateConnectionStatus("connecting");
    sessionOriginMsRef.current = null;
    initialSyncedRef.current = false;
    lastHudSnapshotRef.current = null;
    plotSamplesRef.current = [];
    telemetryVersionRef.current++;
    latestSampleRef.current = null;
    recordedSamplesRef.current = [];
    metricsRef.current = EMPTY_METRICS;
    setLatestSample(null);
    setMetrics(EMPTY_METRICS);
    setRecordedCount(0);

    // Conditional module loading (bundle-conditional): load SerialTransport only when connecting hardware/WS
    if (!transportRef.current && typeof window !== "undefined") {
      const { SerialTransport: SerialTransportCtor } = await import("@/lib/webSerial");
      transportRef.current = new SerialTransportCtor();
    }

    const transport = transportRef.current;
    if (!transport) return;

    const callbacks = {
      onLine: handleIncomingLine,
      onDisconnect: (reason?: string) => {
        updateConnectionStatus("disconnected");
        setConnectionLabel(reason ?? "Terputus");
        setSampleRateHz(0);
        appendLog("SYS", reason ?? "Perangkat terputus.");
      },
      onError: (msg: string) => {
        setErrorMessage(msg);
        updateConnectionStatus("error");
        appendLog("SYS", `ERROR: ${msg}`);
      },
    };

    try {
      const label =
        mode === "serial"
          ? await transport.connectWebSerial(baudRateRef.current, callbacks)
          : await transport.connectWebSocket(wsUrlRef.current, callbacks);

      updateConnectionStatus("connected");
      setConnectionLabel(label);
      appendLog("SYS", `Terhubung: ${label}`);
      showNotice(`Terhubung ke ${label}`);

      syncTimerRef.current = setTimeout(() => {
        sendRawCommand(encodeCommand("SYNC"));
      }, 1500);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Gagal membuka koneksi serial.";
      if (msg.toLowerCase().includes("no port selected")) {
        updateConnectionStatus("disconnected");
        setConnectionLabel("Pemilihan port dibatalkan");
      } else {
        setErrorMessage(msg);
        updateConnectionStatus("error");
        setConnectionLabel("Koneksi gagal");
        appendLog("SYS", `ERROR: ${msg}`);
      }
    }
  }, [
    appendLog,
    disconnectAll,
    handleIncomingLine,
    sendRawCommand,
    showNotice,
    startSimulator,
    updateConnectionStatus,
  ]);

  // Cek dukungan Web Serial & aktifkan Digital Twin Simulator saat halaman dibuka
  useEffect(() => {
    setIsHydrated(true);
    setWebSerialSupported(detectWebSerialSupport());
    void startSimulator();

    return () => {
      clearPendingTimers();
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      if (simulatorRef.current) {
        simulatorRef.current.stop();
      }
      if (transportRef.current) {
        void transportRef.current.disconnect();
      }
    };
  }, [clearPendingTimers, startSimulator]);

  // Pintasan keyboard Escape -> Emergency Stop instan
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && connectionStatusRef.current === "connected") {
        e.preventDefault();
        sendRawCommand(encodeCommand("ESTOP"));
        showNotice("EMERGENCY STOP diaktifkan (ESC).");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sendRawCommand, showNotice]);

  const handleChangeConnectionMode = useCallback(
    (nextMode: ConnectionMode) => {
      if (nextMode === connectionModeRef.current) return;
      void disconnectAll(true).then(() => {
        setErrorMessage(null);
        connectionModeRef.current = nextMode;
        setConnectionMode(nextMode);
        if (nextMode === "simulator") {
          void startSimulator();
        } else {
          setConnectionLabel(
            nextMode === "serial"
              ? "Klik 'Select COM Port' untuk menghubungkan Arduino"
              : `Siap terhubung ke ${wsUrlRef.current}`
          );
        }
      });
    },
    [disconnectAll, startSimulator]
  );

  const handleChangeBaudRate = useCallback((baud: number) => {
    baudRateRef.current = baud;
    setBaudRate(baud);
  }, []);

  const handleChangeWsUrl = useCallback((url: string) => {
    wsUrlRef.current = url;
    setWsUrl(url);
  }, []);

  const handleToggleAutoSendPid = useCallback((enabled: boolean) => {
    autoSendPidRef.current = enabled;
    setAutoSendPid(enabled);
  }, []);

  // --- Handlers Control Panel ---

  const handleChangeDraftPid = useCallback(
    (next: PIDParams, immediate = false) => {
      draftPidRef.current = next;
      setDraftPid(next);
      if (!autoSendPidRef.current && !immediate) return;

      if (pidThrottleTimerRef.current) clearTimeout(pidThrottleTimerRef.current);
      if (immediate) {
        sendRawCommand(encodePID(next));
      } else {
        pidThrottleTimerRef.current = setTimeout(() => {
          sendRawCommand(encodePID(next));
        }, 80);
      }
    },
    [sendRawCommand]
  );

  const handleApplyPid = useCallback(() => {
    sendRawCommand(encodePID(draftPidRef.current));
    showNotice("Parameter PID dikirim ke mikrokontroler.");
  }, [sendRawCommand, showNotice]);

  const handleChangeSetpoint = useCallback(
    (sp: number) => {
      lastLocalEditMsRef.current = Date.now();
      setDraftSetpoint(sp);
      if (spThrottleTimerRef.current) clearTimeout(spThrottleTimerRef.current);
      spThrottleTimerRef.current = setTimeout(() => {
        sendRawCommand(encodeSetpoint(sp));
      }, 65);
    },
    [sendRawCommand]
  );

  const handleTriggerStepTest = useCallback(
    (targetSp: number) => {
      lastLocalEditMsRef.current = Date.now();
      setDraftSetpoint(targetSp);
      plotSamplesRef.current = [];
      telemetryVersionRef.current++;
      sessionOriginMsRef.current = null;
      metricsRef.current = EMPTY_METRICS;
      setMetrics(EMPTY_METRICS);
      sendRawCommand(encodeCommand("RESET"));
      if (stepTestTimerRef.current) clearTimeout(stepTestTimerRef.current);
      stepTestTimerRef.current = setTimeout(() => {
        sendRawCommand(encodeMode(1));
        sendRawCommand(encodePID(draftPidRef.current));
        sendRawCommand(encodeSetpoint(targetSp));
        sendRawCommand(encodeCommand("START"));
      }, 120);
      showNotice(`Step Test dimulai menuju ${targetSp} RPM.`);
    },
    [sendRawCommand, showNotice]
  );

  const handleChangeManualPwm = useCallback(
    (pwm: number) => {
      lastLocalEditMsRef.current = Date.now();
      setDraftManualPwm(pwm);
      if (pwmThrottleTimerRef.current) clearTimeout(pwmThrottleTimerRef.current);
      pwmThrottleTimerRef.current = setTimeout(() => {
        sendRawCommand(encodeManualPwm(pwm));
      }, 65);
    },
    [sendRawCommand]
  );

  const handleSwitchMode = useCallback(
    (mode: ControlMode) => {
      sendRawCommand(encodeMode(mode));
      if (mode === 0 && latestSampleRef.current) {
        setDraftManualPwm(latestSampleRef.current.pwm);
      }
      showNotice(
        mode === 1
          ? "Mode berpindah ke Closed-Loop PID."
          : "Mode berpindah ke Open-Loop PWM."
      );
    },
    [sendRawCommand, showNotice]
  );

  const handleCommand = useCallback(
    (cmd: "START" | "STOP" | "ESTOP" | "RESET" | "SYNC") => {
      sendRawCommand(encodeCommand(cmd));
      if (cmd === "RESET") {
        plotSamplesRef.current = [];
        telemetryVersionRef.current++;
        sessionOriginMsRef.current = null;
        metricsRef.current = EMPTY_METRICS;
        setMetrics(EMPTY_METRICS);
        showNotice("Buffer grafik & state PID direset.");
      } else if (cmd === "ESTOP") {
        showNotice("EMERGENCY STOP diaktifkan.");
      }
    },
    [sendRawCommand, showNotice]
  );

  const handleApplyPpr = useCallback(
    (ppr: number) => {
      setPprValue(ppr);
      sendRawCommand(encodePpr(ppr));
      showNotice(`Kalibrasi encoder PPR diset ke ${ppr}.`);
    },
    [sendRawCommand, showNotice]
  );

  const handleInjectDisturbance = useCallback(() => {
    if (simulatorRef.current) {
      simulatorRef.current.injectLoadDisturbance(50);
      showNotice("Gangguan beban mekanis (+torsi 2.5s) disuntikkan.");
    }
  }, [showNotice]);

  const handleClearPlot = useCallback(() => {
    plotSamplesRef.current = [];
    telemetryVersionRef.current++;
    metricsRef.current = EMPTY_METRICS;
    setMetrics(EMPTY_METRICS);
  }, []);

  const handleClearRecording = useCallback(() => {
    recordedSamplesRef.current = [];
    setRecordedCount(0);
    showNotice("Buffer rekaman CSV dikosongkan.");
  }, [showNotice]);

  // Conditional module loading (bundle-conditional): load csvExport only on click
  const handleExportCsv = useCallback(() => {
    const samples = recordedSamplesRef.current;
    if (samples.length === 0 || typeof window === "undefined") return;
    void import("@/lib/csvExport").then(({ exportTelemetryCsv }) => {
      exportTelemetryCsv(samples, metricsRef.current);
      showNotice(`CSV diekspor (${samples.length} sampel).`);
    });
  }, [showNotice]);

  const handleExportPngSuccess = useCallback(() => {
    showNotice("Grafik Step Response (.png) berhasil disimpan.");
  }, [showNotice]);

  const handleConnectClick = useCallback(() => {
    void handleConnect();
  }, [handleConnect]);

  const handleDisconnectClick = useCallback(() => {
    void disconnectAll(false);
  }, [disconnectAll]);

  const handleToggleRecording = useCallback(() => {
    setIsRecording((prev) => {
      const next = !prev;
      isRecordingRef.current = next;
      return next;
    });
  }, []);

  const handleClearLogs = useCallback(() => {
    pendingRxLogsRef.current = [];
    setLogs([]);
  }, []);

  const handleTelemetryVisibilityChange = useCallback((visible: boolean) => {
    showTelemetryLogsRef.current = visible;
    if (!visible) {
      pendingRxLogsRef.current = [];
    }
  }, []);

  const handleToggleTheme = useCallback(() => {
    const { resolved, followingSystem } = toggleColorScheme();
    showNotice(
      followingSystem
        ? `Mengikuti tema sistem (${resolved === "dark" ? "gelap" : "terang"}).`
        : resolved === "dark"
          ? "Mode gelap diaktifkan."
          : "Mode terang diaktifkan."
    );
  }, [showNotice]);

  const connected = connectionStatus === "connected";
  const activeMode: ControlMode = latestSample?.mode ?? 1;
  const runState = latestSample?.runState ?? 0;

  const activeKp = latestSample?.kp ?? draftPid.kp;
  const activeKi = latestSample?.ki ?? draftPid.ki;
  const activeKd = latestSample?.kd ?? draftPid.kd;
  const activePid = useMemo<PIDParams>(
    () => ({ kp: activeKp, ki: activeKi, kd: activeKd }),
    [activeKp, activeKi, activeKd]
  );

  const activeSetpoint = latestSample?.setpoint ?? draftSetpoint;

  return (
    <>
      <TopBar
        hydrated={isHydrated}
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
        statusNotice={statusNotice}
        onChangeMode={handleChangeConnectionMode}
        onChangeBaudRate={handleChangeBaudRate}
        onChangeWsUrl={handleChangeWsUrl}
        onConnect={handleConnectClick}
        onDisconnect={handleDisconnectClick}
        onToggleRecording={handleToggleRecording}
        onClearRecording={handleClearRecording}
        onExportCsv={handleExportCsv}
        onToggleTheme={handleToggleTheme}
      />

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-[1640px] flex-1 flex-col gap-4 px-4 py-4 outline-none lg:px-6"
      >
        <LcdMirror latest={latestSample} />

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <div className="flex flex-col gap-4 xl:col-span-8 2xl:col-span-9">
            <StepResponseChart
              samplesRef={plotSamplesRef}
              telemetryVersionRef={telemetryVersionRef}
              metrics={metrics}
              onClearPlot={handleClearPlot}
              onExportPngSuccess={handleExportPngSuccess}
            />
            <MetricsPanel metrics={metrics} />
            <SerialConsole
              hydrated={isHydrated}
              logs={logs}
              connected={connected}
              onSendRaw={sendRawCommand}
              onClearLogs={handleClearLogs}
              onTelemetryVisibilityChange={handleTelemetryVisibilityChange}
            />
          </div>

          <div className="xl:col-span-4 2xl:col-span-3">
            <ControlPanel
              hydrated={isHydrated}
              connected={connected}
              connectionMode={connectionMode}
              activeMode={activeMode}
              runState={runState}
              activePid={activePid}
              activeSetpoint={activeSetpoint}
              draftPid={draftPid}
              draftSetpoint={draftSetpoint}
              draftManualPwm={draftManualPwm}
              autoSendPid={autoSendPid}
              pprValue={pprValue}
              onChangeDraftPid={handleChangeDraftPid}
              onApplyPid={handleApplyPid}
              onToggleAutoSendPid={handleToggleAutoSendPid}
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
    </>
  );
}
