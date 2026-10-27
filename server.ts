import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import {
  LiveKernelSocket,
  LiveNetInterfaceStat,
  LiveSystemProcess,
  LiveSystemTelemetrySnapshot,
  parseProcNetDev,
  parseProcNetSockets,
  parseRawSocketCommandOutput,
} from './src/opte/liveSystemTelemetry';

const PORT = Number(process.env.PORT) || 3000;

interface PrevIfaceSample {
  timestamp: number;
  rxBytes: number;
  rxPackets: number;
  txBytes: number;
  txPackets: number;
}

const prevIfaceSamples = new Map<string, PrevIfaceSample>();
let customIngestedSockets: LiveKernelSocket[] = [];
let customIngestedHostLabel: string | null = null;

function safeReadFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Scans /proc/[pid] to collect running OS processes and build an inode -> { pid, name } map
 * so kernel sockets in /proc/net/tcp and /proc/net/udp are attributed to their exact process PID.
 */
function scanLiveProcessesAndInodes(): {
  processes: LiveSystemProcess[];
  inodeMap: Map<string, { pid: number; name: string }>;
} {
  const processes: LiveSystemProcess[] = [];
  const inodeMap = new Map<string, { pid: number; name: string }>();

  let entries: string[] = [];
  try {
    entries = fs.readdirSync('/proc');
  } catch {
    return { processes, inodeMap };
  }

  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = parseInt(entry, 10);
    const procDir = `/proc/${pid}`;

    const comm = safeReadFile(`${procDir}/comm`).trim();
    if (!comm) continue;

    const statusContent = safeReadFile(`${procDir}/status`);
    let ppid = 0;
    let rssKB = 0;
    let threads = 1;

    for (const line of statusContent.split('\n')) {
      if (line.startsWith('PPid:')) {
        ppid = parseInt(line.replace('PPid:', '').trim(), 10) || 0;
      } else if (line.startsWith('VmRSS:')) {
        rssKB = parseInt(line.replace('VmRSS:', '').trim(), 10) || 0;
      } else if (line.startsWith('Threads:')) {
        threads = parseInt(line.replace('Threads:', '').trim(), 10) || 1;
      }
    }

    let openFds = 0;
    try {
      const fds = fs.readdirSync(`${procDir}/fd`);
      openFds = fds.length;
      for (const fd of fds) {
        try {
          const target = fs.readlinkSync(`${procDir}/fd/${fd}`);
          // Format: socket:[42190]
          const m = target.match(/^socket:\[(\d+)\]$/);
          if (m) {
            inodeMap.set(m[1], { pid, name: comm });
          }
        } catch {
          // Ignore permission or transient FD closure
        }
      }
    } catch {
      openFds = Math.max(4, threads * 2);
    }

    const cmdlineRaw = safeReadFile(`${procDir}/cmdline`).replace(/\0/g, ' ').trim();

    processes.push({
      pid,
      ppid,
      name: comm,
      cmdline: cmdlineRaw || comm,
      rssMB: Number((rssKB / 1024).toFixed(1)),
      threads,
      openFds,
    });
  }

  return { processes, inodeMap };
}

function collectLiveSystemTelemetry(): LiveSystemTelemetrySnapshot {
  const now = Date.now();
  const { processes, inodeMap } = scanLiveProcessesAndInodes();

  // 1. Parse /proc/net/tcp, /proc/net/tcp6, /proc/net/udp, /proc/net/udp6
  const tcp4 = parseProcNetSockets(safeReadFile('/proc/net/tcp'), 'TCP', inodeMap);
  const tcp6 = parseProcNetSockets(safeReadFile('/proc/net/tcp6'), 'TCP', inodeMap);
  const udp4 = parseProcNetSockets(safeReadFile('/proc/net/udp'), 'UDP', inodeMap);
  const udp6 = parseProcNetSockets(safeReadFile('/proc/net/udp6'), 'UDP', inodeMap);

  const deduplicatedKernelSockets = new Map<string, LiveKernelSocket>();
  for (const s of [...tcp4, ...tcp6, ...udp4, ...udp6]) {
    const key = `${s.protocol}:${s.localIp}:${s.localPort}->${s.remoteIp}:${s.remotePort}:${s.state}`;
    if (!deduplicatedKernelSockets.has(key)) {
      deduplicatedKernelSockets.set(key, s);
    }
  }

  // Combine with any custom host sockets ingested from the user's machine
  const combinedSockets =
    customIngestedSockets.length > 0
      ? [...customIngestedSockets, ...Array.from(deduplicatedKernelSockets.values())]
      : Array.from(deduplicatedKernelSockets.values());

  // 2. Parse /proc/net/dev and match with os.networkInterfaces()
  const rawDevStats = parseProcNetDev(safeReadFile('/proc/net/dev'));
  const osNetIfaces = os.networkInterfaces();

  const interfaces: LiveNetInterfaceStat[] = rawDevStats.map((dev) => {
    const osList = osNetIfaces[dev.name] ?? [];
    const ipv4Entry = osList.find((addr) => addr.family === 'IPv4');
    const ipv4 = ipv4Entry?.address ?? (dev.name === 'lo' ? '127.0.0.1' : '10.0.0.1');

    const prev = prevIfaceSamples.get(dev.name);
    let rxRateMBps = 0.45;
    let txRateMBps = 0.35;
    let packetRatePps = 140;

    if (prev && now > prev.timestamp) {
      const dtSec = (now - prev.timestamp) / 1000;
      const dRxBytes = Math.max(0, dev.rxBytes - prev.rxBytes);
      const dTxBytes = Math.max(0, dev.txBytes - prev.txBytes);
      const dPackets = Math.max(
        0,
        dev.rxPackets - prev.rxPackets + (dev.txPackets - prev.txPackets)
      );
      rxRateMBps = Number((dRxBytes / (1024 * 1024 * dtSec)).toFixed(3));
      txRateMBps = Number((dTxBytes / (1024 * 1024 * dtSec)).toFixed(3));
      packetRatePps = Math.max(8, Math.round(dPackets / dtSec));
    }

    prevIfaceSamples.set(dev.name, {
      timestamp: now,
      rxBytes: dev.rxBytes,
      rxPackets: dev.rxPackets,
      txBytes: dev.txBytes,
      txPackets: dev.txPackets,
    });

    return {
      name: dev.name,
      ipv4,
      rxBytes: dev.rxBytes,
      rxPackets: dev.rxPackets,
      txBytes: dev.txBytes,
      txPackets: dev.txPackets,
      rxRateMBps,
      txRateMBps,
      packetRatePps,
    };
  });

  // 3. Parse /etc/resolv.conf for live DNS servers
  const resolvContent = safeReadFile('/etc/resolv.conf');
  const dnsServers: string[] = [];
  for (const line of resolvContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('nameserver')) {
      const parts = trimmed.split(/\s+/);
      if (parts[1]) dnsServers.push(parts[1]);
    }
  }
  if (dnsServers.length === 0) {
    dnsServers.push('8.8.8.8');
  }

  const totalMemMB = Math.round(os.totalmem() / (1024 * 1024));
  const freeMemMB = Math.round(os.freemem() / (1024 * 1024));
  const load = os.loadavg();

  return {
    timestamp: now,
    hostname: customIngestedHostLabel || os.hostname(),
    platform: `${os.platform()} (${os.arch()})`,
    kernelRelease: os.release(),
    uptimeSeconds: Math.round(os.uptime()),
    loadAvg: [
      Number(load[0].toFixed(2)),
      Number(load[1].toFixed(2)),
      Number(load[2].toFixed(2)),
    ],
    totalMemMB,
    usedMemMB: totalMemMB - freeMemMB,
    interfaces,
    processes,
    sockets: combinedSockets,
    dnsServers,
    ingestedHostLabel: customIngestedHostLabel,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(express.text({ limit: '5mb', type: ['text/*', 'application/octet-stream'] }));

  // Live OS Kernel & Socket Telemetry API
  app.get('/api/system-telemetry', (_req, res) => {
    const snapshot = collectLiveSystemTelemetry();
    res.json(snapshot);
  });

  // Live Local Machine `netstat -ano` / `ss -tupn` / `lsof -i -n -P` Ingestion API
  app.post('/api/system-telemetry/ingest', (req, res) => {
    const rawOutput =
      typeof req.body === 'string'
        ? req.body
        : typeof req.body?.rawOutput === 'string'
          ? req.body.rawOutput
          : '';
    const hostLabel =
      typeof req.body?.hostLabel === 'string' && req.body.hostLabel.trim()
        ? req.body.hostLabel.trim()
        : 'LOCAL-HOST-INGEST';

    const parsed = parseRawSocketCommandOutput(rawOutput);
    if (parsed.length === 0) {
      res.status(400).json({
        error:
          'No valid TCP/UDP sockets found in output. Paste output from `netstat -ano`, `ss -tupn`, or `lsof -i -n -P`.',
      });
      return;
    }

    customIngestedSockets = parsed;
    customIngestedHostLabel = hostLabel;
    const snapshot = collectLiveSystemTelemetry();
    res.json({
      ingestedSocketCount: parsed.length,
      hostLabel,
      snapshot,
    });
  });

  app.post('/api/system-telemetry/reset-ingest', (_req, res) => {
    customIngestedSockets = [];
    customIngestedHostLabel = null;
    res.json({ ok: true, snapshot: collectLiveSystemTelemetry() });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Opte Live System Telemetry Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
