#!/usr/bin/env node
/**
 * Optional Serial-to-WebSocket Bridge untuk browser tanpa Web Serial API (mis. Firefox/Safari)
 *
 * Cara pakai:
 *   npm install -D serialport ws @serialport/parser-readline
 *   node scripts/serial-bridge.mjs --port /dev/ttyUSB0 --baud 115200 --ws-port 8080
 *   (Windows: --port COM3)
 *
 * Lalu pada Web Dashboard, pilih mode koneksi "WS Bridge" -> ws://localhost:8080
 */

import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    port: { type: "string", short: "p", default: "" },
    baud: { type: "string", short: "b", default: "115200" },
    "ws-port": { type: "string", short: "w", default: "8080" },
    list: { type: "boolean", short: "l", default: false },
  },
});

async function main() {
  let SerialPort, ReadlineParser, WebSocketServer;
  try {
    ({ SerialPort } = await import("serialport"));
    ({ ReadlineParser } = await import("@serialport/parser-readline"));
    ({ WebSocketServer } = await import("ws"));
  } catch {
    console.error(
      "[Bridge] Paket opsional belum terpasang.\n" +
        "Jalankan: npm install --no-save serialport @serialport/parser-readline ws"
    );
    process.exit(1);
  }

  if (values.list || !values.port) {
    const ports = await SerialPort.list();
    console.log("Port Serial tersedia:");
    if (ports.length === 0) {
      console.log("  (tidak ada port terdeteksi)");
    } else {
      for (const p of ports) {
        console.log(`  - ${p.path}  ${p.manufacturer ?? ""} ${p.friendlyName ?? ""}`);
      }
    }
    if (!values.port) {
      console.log("\nContoh: node scripts/serial-bridge.mjs --port /dev/ttyACM0 --baud 115200");
      process.exit(0);
    }
  }

  const baudRate = Number.parseInt(values.baud, 10) || 115200;
  const wsPort = Number.parseInt(values["ws-port"], 10) || 8080;

  const serial = new SerialPort({ path: values.port, baudRate });
  const parser = serial.pipe(new ReadlineParser({ delimiter: "\n" }));
  const wss = new WebSocketServer({ port: wsPort });

  const clients = new Set();

  serial.on("open", () => {
    console.log(`[Bridge] Serial terbuka: ${values.port} @ ${baudRate} baud`);
    console.log(`[Bridge] WebSocket aktif: ws://localhost:${wsPort}`);
  });

  serial.on("error", (err) => {
    console.error("[Bridge] Serial error:", err.message);
  });

  parser.on("data", (line) => {
    const trimmed = String(line).trim();
    if (!trimmed) return;
    for (const ws of clients) {
      if (ws.readyState === 1) {
        ws.send(trimmed);
      }
    }
  });

  wss.on("connection", (ws) => {
    clients.add(ws);
    console.log(`[Bridge] Client dashboard terhubung (total: ${clients.size})`);
    ws.on("message", (msg) => {
      const cmd = String(msg).trim();
      if (cmd && serial.isOpen) {
        serial.write(`${cmd}\n`);
      }
    });
    ws.on("close", () => {
      clients.delete(ws);
      console.log(`[Bridge] Client terputus (total: ${clients.size})`);
    });
  });
}

main().catch((err) => {
  console.error("[Bridge] Fatal:", err);
  process.exit(1);
});
