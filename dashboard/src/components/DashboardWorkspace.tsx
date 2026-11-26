"use client";

import React, {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AutoTunePanel } from "@/components/AutoTunePanel";
import { ComparePanel } from "@/components/ComparePanel";
import { ControlPanel } from "@/components/ControlPanel";
import { PhoenixBentoRow } from "@/components/PhoenixBentoRow";
import { SerialConsole } from "@/components/SerialConsole";
import { StepResponseChart } from "@/components/StepResponseChart";
import { TopBar, type WorkspaceView } from "@/components/TopBar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { computeStepMetrics, EMPTY_METRICS } from "@/lib/metrics";
import { MotorPlantSimulator } from "@/lib/motorSimulator";
import {
  encodeCommand,
  encodeCurrentLimit,
  encodeFeedforward,
  encodeManualPwm,
  encodeMode,
  encodePID,
  encodePpr,
  encodeRampRate,
  encodeSetpoint,
  encodeVoltageComp,
  parseSerialLine,
} from "@/lib/protocol";
import { computeAutoTunings, identifyFopdt } from "@/lib/systemId";
import { toggleColorScheme } from "@/lib/theme";
import type { SerialTransport } from "@/lib/webSerial";
import type {
  AdvancedControlConfig,
  AutoTuneCandidate,
  ConnectionMode,
  ConnectionStatus,
  ControlMode,
  FopdtModel,
  PIDParams,
  SavedRunSnapshot,
  SerialLogEntry,
  StepMetrics,
  TelemetrySample,
} from "@/types/telemetry";

const MAX_PLOT_SAMPLES = 2400; // 120 detik @ 20 Hz
const PLOT_COMPACT_THRESHOLD = MAX_PLOT_SAMPLES + 200;
const MAX_RECORD_SAMPLES = 50000;
const MAX_LOG_ENTRIES = 300;
const HUD_FLUSH_INTERVAL_MS = 100;
const METRICS_FLUSH_INTERVAL_MS = 250;
const IDENTIFY_DURATION_MS = 3400;
const GHOST_COLORS = ["#a855f7", "#14b8a6", "#eab308"] as const;

function formatClock(): string {
  const now = new Date();
  return now.toTimeString().slice(0, 8);
}

function detectWebSerialSupport(): boolean {
  if (typeof navigator === "undefined") return false;
  return "serial" in navigator && Boolean((navigator as { serial?: unknown }).serial);
}

export function DashboardWorkspace() {
  const [isHydrated, setIsHydrated] = useState(false);

  // Connection state
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("simulator");
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("disconnected");
  const [baudRate, setBaudRate] = useState(115200);
  const [wsUrl, setWsUrl] = useState("ws://localhost:8080");
  const [webSerialSupported, setWebSerialSupported] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  // Active Phoenix top-nav view
  const [activeView, setActiveView] = useState<WorkspaceView>("dashboard");

  // Throttled HUD state
  const [latestSample, setLatestSample] = useState<TelemetrySample | null>(null);
  const [metrics, setMetrics] = useState<StepMetrics>(EMPTY_METRICS);
  const [sampleRateHz, setSampleRateHz] = useState(0);
  const [isRecording, setIsRecording] = useState(true);
  const [recordedCount, setRecordedCount] = useState(0);
  const [logs, setLogs] = useState<SerialLogEntry[]>([]);

  // Draft control inputs (recalibrated for ~701 RPM lab motor)
  const [draftPid, setDraftPid] = useState<PIDParams>({ kp: 0.55, ki: 1.35, kd: 0.015 });
  const [draftSetpoint, setDraftSetpoint] = useState(350);
  const [draftManualPwm, setDraftManualPwm] = useState(120);
  const [autoSendPid, setAutoSendPid] = useState(true);
  const [pprValue, setPprValue] = useState(1320);

  // 2-DOF Feedforward, Voltage Comp, Ramp & Current Safety
  const [advancedConfig, setAdvancedConfig] = useState<AdvancedControlConfig>({
    ffEnabled: false,
    kff: 0.35,
    deadzonePwm: 10,
    vcompEnabled: true,
    currentLimitAmp: 3.5,
    rampRate: 0,
  });

  // Auto System Identification (FOPDT) & Auto-Tune state
  const [isIdentifying, setIsIdentifying] = useState(false);
  const [identifyProgressPct, setIdentifyProgressPct] = useState(0);
  const [fopdtModel, setFopdtModel] = useState<FopdtModel | null>(null);
  const [autoTuneCandidates, setAutoTuneCandidates] = useState<AutoTuneCandidate[]>([]);
  const [showFopdtOverlay, setShowFopdtOverlay] = useState(true);

  // A/B Experiment Overlay (Ghost Runs, max 3)
  const [ghostRuns, setGhostRuns] = useState<SavedRunSnapshot[]>([]);
  const runCounterRef = useRef(1);

  // High-frequency refs
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
    ffEnabled: boolean;
    vcompEnabled: boolean;
    currentLimited: boolean;
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

  const pidThrottleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spThrottleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pwmThrottleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepTestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const identifyStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const identifyFinishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const identifyTickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const connectionModeRef = useRef<ConnectionMode>("simulator");
  const connectionStatusRef = useRef<ConnectionStatus>("disconnected");
  const draftPidRef = useRef<PIDParams>(draftPid);
  const autoSendPidRef = useRef<boolean>(autoSendPid);
  const advancedConfigRef = useRef<AdvancedControlConfig>(advancedConfig);
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
        ffEnabled: sample.flags.ffEnabled,
        vcompEnabled: sample.flags.vcompEnabled,
        currentLimited: sample.flags.currentLimited,
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

    if (urgent) {
      commit();
    } else {
      startTransition(commit);
    }
  }, []);

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
          Math.abs(s.setpoint - lastRemoteSpRef.current) >= 2 &&
          !s.flags.rampEnabled &&
          now - lastLocalEditMsRef.current > 600
        ) {
          setDraftSetpoint(Math.round(s.setpoint));
        }
        lastRemoteSpRef.current = s.setpoint;

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
          Math.abs(prevSnap.kd - s.kd) > 0.001 ||
          prevSnap.ffEnabled !== s.flags.ffEnabled ||
          prevSnap.vcompEnabled !== s.flags.vcompEnabled ||
          prevSnap.currentLimited !== s.flags.currentLimited
        ) {
          flushHudState(true);
        }
      } else if (parsed.type === "ack") {
        appendLog("RX", `ACK,${parsed.key},${parsed.value}`);
        if (parsed.key === "FAULT" && parsed.value === "STALL") {
          showNotice("STALL FAULT: Proteksi arus/rotor aktif");
        }
      } else if (parsed.type === "info") {
        if (parsed.info.ppr !== null) {
          setPprValue(parsed.info.ppr);
        }
        appendLog("RX", rawLine);
      } else if (parsed.raw) {
        appendLog("RX", parsed.raw);
      }
    },
    [appendLog, flushHudState, showNotice]
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

  const clearIdentifyTimers = useCallback(() => {
    if (identifyStartTimerRef.current) {
      clearTimeout(identifyStartTimerRef.current);
      identifyStartTimerRef.current = null;
    }
    if (identifyFinishTimerRef.current) {
      clearTimeout(identifyFinishTimerRef.current);
      identifyFinishTimerRef.current = null;
    }
    if (identifyTickRef.current) {
      clearInterval(identifyTickRef.current);
      identifyTickRef.current = null;
    }
  }, []);

  const clearPendingTimers = useCallback(() => {
    clearIdentifyTimers();
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
  }, [clearIdentifyTimers]);

  const disconnectAll = useCallback(
    async (silent = false) => {
      clearPendingTimers();
      setIsIdentifying(false);
      setIdentifyProgressPct(0);
      if (simulatorRef.current) {
        simulatorRef.current.stop();
        simulatorRef.current = null;
      }
      if (transportRef.current) {
        await transportRef.current.disconnect();
      }
      updateConnectionStatus("disconnected");
      setSampleRateHz(0);
      rxTimestampsRef.current = [];
      if (!silent) {
        appendLog("SYS", "Koneksi ditutup.");
        showNotice("Koneksi terputus");
      }
    },
    [appendLog, clearPendingTimers, showNotice, updateConnectionStatus]
  );

  const startSimulator = useCallback(async () => {
    if (simulatorRef.current || transportRef.current) {
      await disconnectAll(true);
    }
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
    appendLog("SYS", "Simulator 24V Lab 701 RPM aktif (SP=350, 2-DOF + TC3 20Hz).");
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
      appendLog("SYS", `Terhubung: ${label}`);
      showNotice(`Terhubung (${label})`);

      syncTimerRef.current = setTimeout(() => {
        sendRawCommand(encodeCommand("SYNC"));
      }, 1500);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Gagal membuka koneksi serial.";
      if (msg.toLowerCase().includes("no port selected")) {
        updateConnectionStatus("disconnected");
      } else {
        setErrorMessage(msg);
        updateConnectionStatus("error");
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

  useEffect(() => {
    setIsHydrated(true);
    setWebSerialSupported(detectWebSerialSupport());
    void startSimulator();

    return () => {
      clearPendingTimers();
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      if (simulatorRef.current) simulatorRef.current.stop();
      if (transportRef.current) void transportRef.current.disconnect();
    };
  }, [clearPendingTimers, startSimulator]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (
        document.querySelector(
          '[data-radix-popper-content-wrapper], [role="listbox"], [role="dialog"]'
        )
      ) {
        return;
      }
      if (connectionStatusRef.current === "connected") {
        e.preventDefault();
        sendRawCommand(encodeCommand("ESTOP"));
        showNotice("E-STOP aktif (ESC)");
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
    showNotice("PID terkirim");
  }, [sendRawCommand, showNotice]);

  const handleUpdateAdvancedConfig = useCallback(
    (patch: Partial<AdvancedControlConfig>) => {
      const prev = advancedConfigRef.current;
      const next = { ...prev, ...patch };
      advancedConfigRef.current = next;
      setAdvancedConfig(next);

      if (
        patch.ffEnabled !== undefined ||
        patch.kff !== undefined ||
        patch.deadzonePwm !== undefined
      ) {
        sendRawCommand(encodeFeedforward(next.ffEnabled, next.kff, next.deadzonePwm));
      }
      if (patch.vcompEnabled !== undefined) {
        sendRawCommand(encodeVoltageComp(next.vcompEnabled));
      }
      if (patch.currentLimitAmp !== undefined) {
        sendRawCommand(encodeCurrentLimit(next.currentLimitAmp));
      }
      if (patch.rampRate !== undefined) {
        sendRawCommand(encodeRampRate(next.rampRate));
      }
    },
    [sendRawCommand]
  );

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
      setShowFopdtOverlay(false);
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
        const adv = advancedConfigRef.current;
        sendRawCommand(encodeFeedforward(adv.ffEnabled, adv.kff, adv.deadzonePwm));
        sendRawCommand(encodeVoltageComp(adv.vcompEnabled));
        sendRawCommand(encodeRampRate(adv.rampRate));
        sendRawCommand(encodeSetpoint(targetSp));
        sendRawCommand(encodeCommand("START"));
      }, 120);
      showNotice(`Step Test → ${targetSp} RPM`);
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
    },
    [sendRawCommand]
  );

  const handleCommand = useCallback(
    (cmd: "START" | "STOP" | "ESTOP" | "RESET" | "SYNC" | "CLEARFAULT") => {
      sendRawCommand(encodeCommand(cmd));
      if (cmd === "RESET") {
        plotSamplesRef.current = [];
        telemetryVersionRef.current++;
        sessionOriginMsRef.current = null;
        metricsRef.current = EMPTY_METRICS;
        setMetrics(EMPTY_METRICS);
      } else if (cmd === "ESTOP") {
        clearIdentifyTimers();
        setIsIdentifying(false);
        showNotice("E-STOP aktif");
      } else if (cmd === "CLEARFAULT") {
        showNotice("Status fault dibersihkan");
      }
    },
    [clearIdentifyTimers, sendRawCommand, showNotice]
  );

  const handleEstop = useCallback(() => {
    handleCommand("ESTOP");
  }, [handleCommand]);

  const handleApplyPpr = useCallback(
    (ppr: number) => {
      setPprValue(ppr);
      sendRawCommand(encodePpr(ppr));
      showNotice(`PPR = ${ppr}`);
    },
    [sendRawCommand, showNotice]
  );

  // --- Auto System Identification (FOPDT) ---
  const handleCancelIdentify = useCallback(() => {
    clearIdentifyTimers();
    setIsIdentifying(false);
    setIdentifyProgressPct(0);
    sendRawCommand(encodeCommand("STOP"));
    showNotice("Identifikasi FOPDT dibatalkan");
  }, [clearIdentifyTimers, sendRawCommand, showNotice]);

  const handleStartIdentify = useCallback(
    (stepPwm: number) => {
      clearIdentifyTimers();
      setIsIdentifying(true);
      setIdentifyProgressPct(5);
      setFopdtModel(null);
      setAutoTuneCandidates([]);
      setShowFopdtOverlay(false);

      plotSamplesRef.current = [];
      telemetryVersionRef.current++;
      sessionOriginMsRef.current = null;
      metricsRef.current = EMPTY_METRICS;
      setMetrics(EMPTY_METRICS);

      sendRawCommand(encodeCommand("RESET"));
      appendLog("SYS", `Auto-ID FOPDT dimulai (Open-Loop Step PWM=${stepPwm}, 3.4s)...`);

      identifyStartTimerRef.current = setTimeout(() => {
        const startWallMs = Date.now();
        sendRawCommand(encodeMode(0));
        sendRawCommand(encodeManualPwm(stepPwm));
        sendRawCommand(encodeCommand("START"));

        const stepStartSec =
          plotSamplesRef.current.length > 0
            ? plotSamplesRef.current[plotSamplesRef.current.length - 1].elapsedSec
            : 0;

        identifyTickRef.current = setInterval(() => {
          const pct = Math.min(
            98,
            Math.round(((Date.now() - startWallMs) / IDENTIFY_DURATION_MS) * 100)
          );
          setIdentifyProgressPct(pct);
        }, 120);

        identifyFinishTimerRef.current = setTimeout(() => {
          clearIdentifyTimers();
          sendRawCommand(encodeCommand("STOP"));
          setIsIdentifying(false);
          setIdentifyProgressPct(100);

          const identified = identifyFopdt(
            plotSamplesRef.current,
            stepStartSec,
            stepPwm
          );
          if (identified) {
            const tunings = computeAutoTunings(identified);
            setFopdtModel(identified);
            setAutoTuneCandidates(tunings);
            setShowFopdtOverlay(true);
            appendLog(
              "SYS",
              `FOPDT selesai: K=${identified.gainK.toFixed(2)}, tau=${identified.tauSec.toFixed(2)}s, theta=${identified.thetaSec.toFixed(2)}s (R2=${(identified.rSquared * 100).toFixed(1)}%)`
            );
            showNotice(
              `FOPDT selesai (K=${identified.gainK.toFixed(2)}, τ=${identified.tauSec.toFixed(2)}s)`
            );
          } else {
            appendLog("SYS", "FOPDT gagal: respon motor tidak cukup besar atau terpotong.");
            showNotice("Identifikasi gagal — cek koneksi & motor");
          }
        }, IDENTIFY_DURATION_MS);
      }, 220);
    },
    [appendLog, clearIdentifyTimers, sendRawCommand, showNotice]
  );

  const handleApplyAutoTune = useCallback(
    (candidate: AutoTuneCandidate, withFeedforward: boolean) => {
      // Pada 2-DOF (Feedforward aktif), kontribusi steady-state sudah ditanggung u_ff,
      // sehingga Ki direlaksasi (0.35x) agar Rise Time cepat tanpa overshoot berlebih.
      const nextPid = {
        kp: candidate.kp,
        ki: withFeedforward
          ? Math.round(candidate.ki * 0.35 * 1000) / 1000
          : candidate.ki,
        kd: candidate.kd,
      };
      draftPidRef.current = nextPid;
      setDraftPid(nextPid);
      sendRawCommand(encodeMode(1));
      sendRawCommand(encodePID(nextPid));

      const nextAdv: AdvancedControlConfig = {
        ...advancedConfigRef.current,
        ffEnabled: withFeedforward,
        kff: withFeedforward ? candidate.recommendedKff : advancedConfigRef.current.kff,
        deadzonePwm: withFeedforward
          ? candidate.recommendedDeadzone
          : advancedConfigRef.current.deadzonePwm,
      };
      advancedConfigRef.current = nextAdv;
      setAdvancedConfig(nextAdv);
      sendRawCommand(
        encodeFeedforward(nextAdv.ffEnabled, nextAdv.kff, nextAdv.deadzonePwm)
      );
      setShowFopdtOverlay(false);

      showNotice(
        withFeedforward
          ? `${candidate.name} + 2-DOF FF diterapkan`
          : `${candidate.name} diterapkan`
      );
    },
    [sendRawCommand, showNotice]
  );

  // --- A/B Ghost Run Pinning ---
  const handlePinRun = useCallback(() => {
    const m = metricsRef.current;
    const samples = plotSamplesRef.current;
    if (!m.hasStep || m.stepStartTimeSec === null || samples.length < 5) {
      showNotice("Jalankan Step Test dulu sebelum Pin");
      return;
    }

    const t0 = m.stepStartTimeSec;
    const pts: { relSec: number; rpm: number; sp: number }[] = [];
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      if (s.elapsedSec < t0) continue;
      const relSec = s.elapsedSec - t0;
      if (relSec > 15) break;
      pts.push({ relSec, rpm: s.rpm, sp: s.setpoint });
    }
    if (pts.length < 3) return;

    const latest = latestSampleRef.current;
    const runNum = runCounterRef.current++;
    const color = GHOST_COLORS[(runNum - 1) % GHOST_COLORS.length];
    const ffOn = latest?.flags.ffEnabled ?? advancedConfigRef.current.ffEnabled;
    const vcOn = latest?.flags.vcompEnabled ?? advancedConfigRef.current.vcompEnabled;
    const snap: SavedRunSnapshot = {
      id: `run-${runNum}`,
      label: `Run #${runNum}${ffOn ? " · 2-DOF" : " · 1-DOF"}`,
      color,
      visible: true,
      pid: {
        kp: latest?.kp ?? draftPidRef.current.kp,
        ki: latest?.ki ?? draftPidRef.current.ki,
        kd: latest?.kd ?? draftPidRef.current.kd,
      },
      ffEnabled: ffOn,
      vcompEnabled: vcOn,
      rampRate: advancedConfigRef.current.rampRate,
      targetSetpoint: m.targetSetpoint,
      initialRpm: m.initialRpm,
      metrics: { ...m },
      points: pts,
    };

    setGhostRuns((prev) => {
      const next = [...prev, snap];
      return next.length > 3 ? next.slice(next.length - 3) : next;
    });
    showNotice(`Tersimpan di Bandingkan (${snap.label})`);
  }, [showNotice]);

  const handleToggleRunVisible = useCallback((id: string, visible: boolean) => {
    setGhostRuns((prev) =>
      prev.map((r) => (r.id === id ? { ...r, visible } : r))
    );
  }, []);

  const handleRemoveRun = useCallback((id: string) => {
    setGhostRuns((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const handleClearRuns = useCallback(() => {
    setGhostRuns([]);
    showNotice("Overlay A/B dibersihkan");
  }, [showNotice]);

  // --- Simulator Stress Tests ---
  const handleInjectDisturbance = useCallback(() => {
    if (simulatorRef.current) {
      simulatorRef.current.injectLoadDisturbance(140);
      showNotice("Gangguan torsi 2.5s");
    }
  }, [showNotice]);

  const handleInjectVoltageSag = useCallback(() => {
    if (simulatorRef.current) {
      simulatorRef.current.injectVoltageSag(3.0);
      showNotice("Simulasi PSU drop -3.0V (3s)");
    }
  }, [showNotice]);

  const handleInjectStallTest = useCallback(() => {
    if (simulatorRef.current) {
      simulatorRef.current.injectStallTest();
      showNotice("Simulasi rotor terkunci (uji Stall Guard)");
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
    showNotice("Rekaman dihapus");
  }, [showNotice]);

  const handleExportCsv = useCallback(() => {
    const samples = recordedSamplesRef.current;
    if (samples.length === 0 || typeof window === "undefined") return;
    void import("@/lib/csvExport").then(({ exportTelemetryCsv }) => {
      exportTelemetryCsv(samples, metricsRef.current);
      showNotice(`CSV diekspor (${samples.length})`);
    });
  }, [showNotice]);

  const handleExportPngSuccess = useCallback(() => {
    showNotice("PNG tersimpan");
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

  const handleChangeView = useCallback((view: WorkspaceView) => {
    setActiveView(view);
    if (view !== "serial") {
      showTelemetryLogsRef.current = false;
      pendingRxLogsRef.current = [];
    }
  }, []);

  const handleToggleTheme = useCallback(() => {
    const { resolved, followingSystem } = toggleColorScheme();
    showNotice(
      followingSystem
        ? `Tema sistem (${resolved === "dark" ? "gelap" : "terang"})`
        : resolved === "dark"
          ? "Mode gelap"
          : "Mode terang"
    );
  }, [showNotice]);

  const handleToggleModelOverlay = useCallback(() => {
    setShowFopdtOverlay((v) => !v);
  }, []);

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
    <TooltipProvider delayDuration={300}>
      <TopBar
        hydrated={isHydrated}
        activeView={activeView}
        onChangeView={handleChangeView}
        fopdtRSquared={fopdtModel?.rSquared ?? null}
        ghostRunCount={ghostRuns.length}
        serialLogCount={logs.length}
        connectionMode={connectionMode}
        connectionStatus={connectionStatus}
        baudRate={baudRate}
        wsUrl={wsUrl}
        webSerialSupported={webSerialSupported}
        sampleRateHz={sampleRateHz}
        runState={runState}
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
        onEstop={handleEstop}
      />

      {/* Full-Viewport Modern 2-Column Asymmetric Bento Grid */}
      <main
        id="main-content"
        tabIndex={-1}
        className="flex min-h-0 flex-1 flex-col gap-3 px-3 py-3 outline-none lg:px-5 lg:py-3.5 xl:flex-row"
      >
        {/* Left/Center Bento (~68%): Hero Step Response Oscilloscope + Bottom Bento Row / Active Tool */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          <StepResponseChart
            samplesRef={plotSamplesRef}
            telemetryVersionRef={telemetryVersionRef}
            latestSample={latestSample}
            metrics={metrics}
            ghostRuns={ghostRuns}
            fopdtModel={fopdtModel}
            showFopdtOverlay={showFopdtOverlay}
            onPinRun={handlePinRun}
            onClearPlot={handleClearPlot}
            onExportPngSuccess={handleExportPngSuccess}
          />

          {activeView === "dashboard" ? (
            <PhoenixBentoRow
              hydrated={isHydrated}
              connected={connected}
              connectionMode={connectionMode}
              activeMode={activeMode}
              latest={latestSample}
              metrics={metrics}
              advancedConfig={advancedConfig}
              onUpdateAdvancedConfig={handleUpdateAdvancedConfig}
              onInjectDisturbance={
                connectionMode === "simulator" ? handleInjectDisturbance : undefined
              }
              onInjectVoltageSag={
                connectionMode === "simulator" ? handleInjectVoltageSag : undefined
              }
              onInjectStallTest={
                connectionMode === "simulator" ? handleInjectStallTest : undefined
              }
              onSync={() => handleCommand("SYNC")}
            />
          ) : activeView === "autotune" ? (
            <div className="phoenix-card shrink-0 overflow-hidden rounded-xl">
              <AutoTunePanel
                hydrated={isHydrated}
                connected={connected}
                isIdentifying={isIdentifying}
                identifyProgressPct={identifyProgressPct}
                model={fopdtModel}
                candidates={autoTuneCandidates}
                showModelOverlay={showFopdtOverlay}
                onStartIdentify={handleStartIdentify}
                onCancelIdentify={handleCancelIdentify}
                onToggleModelOverlay={handleToggleModelOverlay}
                onApplyCandidate={handleApplyAutoTune}
              />
            </div>
          ) : activeView === "compare" ? (
            <div className="phoenix-card shrink-0 overflow-hidden rounded-xl">
              <ComparePanel
                runs={ghostRuns}
                canPinCurrent={metrics.hasStep}
                onPinCurrent={handlePinRun}
                onToggleRunVisible={handleToggleRunVisible}
                onRemoveRun={handleRemoveRun}
                onClearAll={handleClearRuns}
              />
            </div>
          ) : (
            <div className="phoenix-card shrink-0 overflow-hidden rounded-xl">
              <SerialConsole
                hydrated={isHydrated}
                logs={logs}
                connected={connected}
                onSendRaw={sendRawCommand}
                onClearLogs={handleClearLogs}
                onTelemetryVisibilityChange={handleTelemetryVisibilityChange}
              />
            </div>
          )}
        </div>

        {/* Right Bento Column (~32%): Drive Control Power Dial + 180° Arc Gauge & PID Gains */}
        <ControlPanel
          hydrated={isHydrated}
          connected={connected}
          latestSample={latestSample}
          activeMode={activeMode}
          runState={runState}
          activePid={activePid}
          activeSetpoint={activeSetpoint}
          draftPid={draftPid}
          draftSetpoint={draftSetpoint}
          draftManualPwm={draftManualPwm}
          autoSendPid={autoSendPid}
          pprValue={pprValue}
          advancedConfig={advancedConfig}
          onChangeDraftPid={handleChangeDraftPid}
          onApplyPid={handleApplyPid}
          onToggleAutoSendPid={handleToggleAutoSendPid}
          onChangeSetpoint={handleChangeSetpoint}
          onTriggerStepTest={handleTriggerStepTest}
          onChangeManualPwm={handleChangeManualPwm}
          onSwitchMode={handleSwitchMode}
          onCommand={handleCommand}
          onApplyPpr={handleApplyPpr}
          onUpdateAdvancedConfig={handleUpdateAdvancedConfig}
        />
      </main>
    </TooltipProvider>
  );
}
