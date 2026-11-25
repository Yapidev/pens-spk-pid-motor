// Web Serial API TypeScript declarations (Chrome/Edge/Opera)
export interface WebSerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}

export interface WebSerialPort {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  open(options: {
    baudRate: number;
    dataBits?: 7 | 8;
    stopBits?: 1 | 2;
    parity?: "none" | "even" | "odd";
    bufferSize?: number;
    flowControl?: "none" | "hardware";
  }): Promise<void>;
  close(): Promise<void>;
  getInfo(): WebSerialPortInfo;
}

interface NavigatorWithSerial extends Navigator {
  serial?: {
    requestPort(options?: {
      filters?: Array<{ usbVendorId?: number; usbProductId?: number }>;
    }): Promise<WebSerialPort>;
    getPorts(): Promise<WebSerialPort[]>;
  };
}

const LINE_SPLIT_RE = /\r?\n/;

export function isWebSerialSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  return "serial" in navigator && Boolean((navigator as NavigatorWithSerial).serial);
}

export interface TransportCallbacks {
  onLine: (line: string) => void;
  onDisconnect: (reason?: string) => void;
  onError: (message: string) => void;
}

/**
 * Unified Serial Transport:
 *  - Mode 1: Web Serial API langsung (Chrome / Edge / Opera)
 *  - Mode 2: WebSocket Serial Bridge (ws://localhost:8080 via scripts/serial-bridge.mjs)
 */
export class SerialTransport {
  private port: WebSerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private ws: WebSocket | null = null;
  private isClosing = false;
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly encoder = new TextEncoder();

  async connectWebSerial(
    baudRate: number,
    callbacks: TransportCallbacks
  ): Promise<string> {
    if (!isWebSerialSupported()) {
      throw new Error(
        "Web Serial API tidak didukung di browser ini. Gunakan Chrome/Edge atau mode WS Bridge."
      );
    }

    await this.disconnect();
    this.isClosing = false;

    const serialApi = (navigator as NavigatorWithSerial).serial!;
    const port = await serialApi.requestPort();
    await port.open({ baudRate });

    this.port = port;
    const info = port.getInfo();
    const label =
      info.usbVendorId !== undefined
        ? `USB VID:0x${info.usbVendorId.toString(16).toUpperCase()} @ ${baudRate}`
        : `Serial Port @ ${baudRate} baud`;

    if (port.writable) {
      this.writer = port.writable.getWriter();
    }

    if (port.readable) {
      this.reader = port.readable.getReader();
      void this.readSerialLoop(callbacks);
    }

    return label;
  }

  connectWebSocket(url: string, callbacks: TransportCallbacks): Promise<string> {
    return new Promise((resolve, reject) => {
      void this.disconnect().then(() => {
        this.isClosing = false;
        try {
          const ws = new WebSocket(url);
          this.ws = ws;

          const timeout = setTimeout(() => {
            if (ws.readyState !== WebSocket.OPEN) {
              ws.close();
              reject(new Error(`Timeout koneksi ke WebSocket bridge (${url})`));
            }
          }, 5000);

          ws.onopen = () => {
            clearTimeout(timeout);
            resolve(`WS Bridge (${url})`);
          };

          ws.onmessage = (event) => {
            const payload = String(event.data ?? "");
            for (const line of payload.split(LINE_SPLIT_RE)) {
              const trimmed = line.trim();
              if (trimmed) callbacks.onLine(trimmed);
            }
          };

          ws.onerror = () => {
            clearTimeout(timeout);
            const msg = `Gagal terhubung ke WebSocket bridge di ${url}`;
            callbacks.onError(msg);
            reject(new Error(msg));
          };

          ws.onclose = () => {
            if (!this.isClosing) {
              callbacks.onDisconnect("Koneksi WebSocket bridge terputus.");
            }
          };
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    });
  }

  async sendLine(command: string): Promise<void> {
    const clean = command.trim();
    if (!clean) return;

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(clean);
      return;
    }

    if (this.writer) {
      const data = this.encoder.encode(`${clean}\n`);
      this.writeQueue = this.writeQueue
        .then(async () => {
          if (this.writer) {
            await this.writer.write(data);
          }
        })
        .catch(() => {
          // Swallow transient write error during disconnect
        });
      await this.writeQueue;
    }
  }

  async disconnect(): Promise<void> {
    this.isClosing = true;

    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }

    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch {
        // ignore
      }
      try {
        this.reader.releaseLock();
      } catch {
        // ignore
      }
      this.reader = null;
    }

    if (this.writer) {
      try {
        this.writer.releaseLock();
      } catch {
        // ignore
      }
      this.writer = null;
    }

    if (this.port) {
      try {
        await this.port.close();
      } catch {
        // ignore
      }
      this.port = null;
    }
  }

  private async readSerialLoop(callbacks: TransportCallbacks): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (this.reader && !this.isClosing) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (!value) continue;

        buffer += decoder.decode(value, { stream: true });
        let nlIndex = buffer.indexOf("\n");
        while (nlIndex >= 0) {
          const line = buffer.slice(0, nlIndex).trim();
          buffer = buffer.slice(nlIndex + 1);
          if (line) {
            callbacks.onLine(line);
          }
          nlIndex = buffer.indexOf("\n");
        }

        // Guard against unbounded buffer if noise arrives without newline
        if (buffer.length > 1024) {
          buffer = "";
        }
      }
    } catch (err) {
      if (!this.isClosing) {
        const msg = err instanceof Error ? err.message : "Serial read error";
        callbacks.onError(msg);
      }
    } finally {
      if (!this.isClosing) {
        await this.disconnect();
        callbacks.onDisconnect("Perangkat Serial terputus.");
      }
    }
  }
}
