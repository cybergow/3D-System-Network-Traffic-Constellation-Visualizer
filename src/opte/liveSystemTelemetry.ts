import {
  ConstellationFilterState,
  HIERARCHY_LABELS,
  NodeHierarchyRole,
  OPTE_DOMAIN_PALETTE,
  OpteColorDomain,
  OpteConstellationGraph,
  OpteFilament,
  OpteNode,
  OpteProtocol,
  SocketState,
  generateOpteConstellation,
} from './opteGraphGenerator';

export type TelemetryMode = 'LIVE_HYBRID_OPTE' | 'LIVE_STRICT_OS' | 'SIMULATED_OPTE';

export interface LiveKernelSocket {
  id: string;
  protocol: OpteProtocol;
  localIp: string;
  localPort: number;
  remoteIp: string;
  remotePort: number;
  state: SocketState;
  rawStateLabel: string;
  txQueueBytes: number;
  rxQueueBytes: number;
  inode: string;
  pid: number;
  processName: string;
  sourceOrigin: 'KERNEL_PROC_NET' | 'HOST_INGEST' | 'BROWSER_PERF';
}

export interface LiveSystemProcess {
  pid: number;
  ppid: number;
  name: string;
  cmdline: string;
  rssMB: number;
  threads: number;
  openFds: number;
}

export interface LiveNetInterfaceStat {
  name: string;
  ipv4: string;
  rxBytes: number;
  rxPackets: number;
  txBytes: number;
  txPackets: number;
  rxRateMBps: number;
  txRateMBps: number;
  packetRatePps: number;
}

export interface LiveSystemTelemetrySnapshot {
  timestamp: number;
  hostname: string;
  platform: string;
  kernelRelease: string;
  uptimeSeconds: number;
  loadAvg: [number, number, number];
  totalMemMB: number;
  usedMemMB: number;
  interfaces: LiveNetInterfaceStat[];
  processes: LiveSystemProcess[];
  sockets: LiveKernelSocket[];
  dnsServers: string[];
  ingestedHostLabel: string | null;
}

/**
 * Decodes a Linux /proc/net/tcp or /proc/net/udp 8-character little-endian hex IPv4 address
 * (e.g. "0100007F" -> "127.0.0.1").
 */
export function decodeProcHexIpv4(hexIp: string): string {
  const clean = hexIp.trim();
  if (clean.length === 8) {
    const b1 = parseInt(clean.slice(6, 8), 16);
    const b2 = parseInt(clean.slice(4, 6), 16);
    const b3 = parseInt(clean.slice(2, 4), 16);
    const b4 = parseInt(clean.slice(0, 2), 16);
    if (![b1, b2, b3, b4].some((n) => Number.isNaN(n))) {
      return `${b1}.${b2}.${b3}.${b4}`;
    }
  }
  // IPv6 loopback or IPv4-mapped IPv6 in /proc/net/tcp6
  if (clean.length === 32) {
    if (clean === '00000000000000000000000001000000') return '::1';
    if (clean === '00000000000000000000000000000000') return '::';
    // Check IPv4-mapped ::ffff:a.b.c.d
    if (clean.startsWith('0000000000000000FFFF0000') || clean.startsWith('0000000000000000ffff0000')) {
      return decodeProcHexIpv4(clean.slice(24, 32));
    }
    return '::1';
  }
  return '0.0.0.0';
}

const PROC_TCP_STATE_MAP: Record<string, { state: SocketState; label: string }> = {
  '01': { state: 'ESTABLISHED', label: 'ESTABLISHED' },
  '02': { state: 'ESTABLISHED', label: 'SYN_SENT' },
  '03': { state: 'ESTABLISHED', label: 'SYN_RECV' },
  '04': { state: 'ESTABLISHED', label: 'FIN_WAIT1' },
  '05': { state: 'ESTABLISHED', label: 'FIN_WAIT2' },
  '06': { state: 'ESTABLISHED', label: 'TIME_WAIT' },
  '07': { state: 'LISTEN', label: 'CLOSE' },
  '08': { state: 'ESTABLISHED', label: 'CLOSE_WAIT' },
  '09': { state: 'ESTABLISHED', label: 'LAST_ACK' },
  '0A': { state: 'LISTEN', label: 'LISTEN' },
  '0B': { state: 'ESTABLISHED', label: 'CLOSING' },
};

/**
 * Parses raw contents of Linux /proc/net/tcp, /proc/net/tcp6, /proc/net/udp, or /proc/net/udp6.
 */
export function parseProcNetSockets(
  content: string,
  baseProto: 'TCP' | 'UDP',
  inodeToProcess?: Map<string, { pid: number; name: string }>
): LiveKernelSocket[] {
  const lines = content.split(/\r?\n/);
  const results: LiveKernelSocket[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(/\s+/);
    if (cols.length < 10) continue;

    const [localHex, localPortHex] = cols[1].split(':');
    const [remoteHex, remotePortHex] = cols[2].split(':');
    const stateHex = cols[3].toUpperCase();
    const [txHex, rxHex] = (cols[4] || '0:0').split(':');
    const inode = cols[9] || '0';

    if (!localHex || !localPortHex || !remoteHex || !remotePortHex) continue;

    const localIp = decodeProcHexIpv4(localHex);
    const localPort = parseInt(localPortHex, 16) || 0;
    const remoteIp = decodeProcHexIpv4(remoteHex);
    const remotePort = parseInt(remotePortHex, 16) || 0;

    const mappedState = PROC_TCP_STATE_MAP[stateHex] ?? {
      state: remotePort > 0 ? 'ESTABLISHED' : 'LISTEN',
      label: remotePort > 0 ? 'ESTABLISHED' : 'LISTEN',
    };

    let protocol: OpteProtocol = baseProto;
    if (localPort === 53 || remotePort === 53) protocol = 'DNS';
    else if (localPort === 443 || remotePort === 443 || localPort === 3000 || remotePort === 3000) {
      protocol = 'HTTPS';
    } else if (localIp === '127.0.0.1' && remoteIp === '127.0.0.1') {
      protocol = 'IPC';
    }

    const procMatch = inodeToProcess?.get(inode);

    results.push({
      id: `${baseProto}-${localIp}:${localPort}-${remoteIp}:${remotePort}-${inode}-${i}`,
      protocol,
      localIp,
      localPort,
      remoteIp,
      remotePort,
      state: mappedState.state,
      rawStateLabel: mappedState.label,
      txQueueBytes: parseInt(txHex, 16) || 0,
      rxQueueBytes: parseInt(rxHex, 16) || 0,
      inode,
      pid: procMatch?.pid ?? (100 + (localPort % 900)),
      processName: procMatch?.name ?? inferProcessNameFromPort(localPort, remotePort, baseProto),
      sourceOrigin: 'KERNEL_PROC_NET',
    });
  }

  return results;
}

function inferProcessNameFromPort(localPort: number, remotePort: number, proto: string): string {
  const p = localPort || remotePort;
  if (p === 3000 || p === 24678) return 'node-vite-server';
  if (p === 53) return 'systemd-resolved';
  if (p === 443 || p === 80) return 'https-edge-client';
  if (p === 5432) return 'postgres-backend';
  if (p === 6379) return 'redis-server';
  if (p === 22) return 'sshd-daemon';
  if (p === 9222) return 'chromium-devtools';
  return `${proto.toLowerCase()}-socket-${p}`;
}

/**
 * Parses raw contents of Linux /proc/net/dev into interface counters.
 */
export function parseProcNetDev(content: string): Omit<
  LiveNetInterfaceStat,
  'ipv4' | 'rxRateMBps' | 'txRateMBps' | 'packetRatePps'
>[] {
  const lines = content.split(/\r?\n/);
  const stats: Omit<
    LiveNetInterfaceStat,
    'ipv4' | 'rxRateMBps' | 'txRateMBps' | 'packetRatePps'
  >[] = [];

  for (let i = 2; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || !line.includes(':')) continue;
    const [ifacePart, rest] = line.split(':');
    const name = ifacePart.trim();
    const nums = rest
      .trim()
      .split(/\s+/)
      .map((n) => parseInt(n, 10) || 0);
    if (nums.length >= 10) {
      stats.push({
        name,
        rxBytes: nums[0],
        rxPackets: nums[1],
        txBytes: nums[8],
        txPackets: nums[9],
      });
    }
  }
  return stats;
}

/**
 * Parses raw terminal output from `ss -tupn`, `netstat -ano` (Windows/Linux), or `lsof -i -n -P` (macOS/Linux)
 * so users can paste or stream their own host machine's live socket table directly into the 3D visualizer.
 */
export function parseRawSocketCommandOutput(rawText: string): LiveKernelSocket[] {
  const lines = rawText.split(/\r?\n/);
  const sockets: LiveKernelSocket[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || /^(Netid|Proto|Active|COMMAND)/i.test(line)) continue;

    // 1. Match `ss -tupn` or `netstat -antup` or Windows `netstat -ano`
    // Example Windows netstat: TCP    192.168.1.15:52413     142.250.190.46:443     ESTABLISHED     4812
    // Example Linux ss: tcp   ESTAB   0   0   10.0.2.15:44210   1.1.1.1:443   users:(("chrome",pid=2190,fd=42))
    const addrMatch = line.match(
      /((?:\d{1,3}\.){3}\d{1,3}|\[?[a-fA-F0-9:]+\]?|\*):(\d+|\*)\s+((?:\d{1,3}\.){3}\d{1,3}|\[?[a-fA-F0-9:]+\]?|\*):(\d+|\*)/
    );

    if (addrMatch) {
      const localIp = addrMatch[1].replace(/^\[|\]$/g, '') === '*' ? '0.0.0.0' : addrMatch[1].replace(/^\[|\]$/g, '');
      const localPort = parseInt(addrMatch[2], 10) || 0;
      const remoteIp = addrMatch[3].replace(/^\[|\]$/g, '') === '*' ? '0.0.0.0' : addrMatch[3].replace(/^\[|\]$/g, '');
      const remotePort = parseInt(addrMatch[4], 10) || 0;

      const isUdp = /\budp\b/i.test(line);
      const isListen = /\b(LISTEN|LISTENING|UNCONN)\b/i.test(line) || remotePort === 0;

      let protocol: OpteProtocol = isUdp ? 'UDP' : 'TCP';
      if (localPort === 53 || remotePort === 53) protocol = 'DNS';
      else if (localPort === 443 || remotePort === 443) protocol = 'HTTPS';
      else if (localIp === '127.0.0.1' && remoteIp === '127.0.0.1') protocol = 'IPC';

      // Extract PID & process name if present
      const ssProcMatch = line.match(/\("([^"]+)",pid=(\d+)/);
      const trailingPidMatch = line.match(/\s(\d{2,7})$/);
      const slashPidMatch = line.match(/\s(\d{2,7})\/([a-zA-Z0-9_.-]+)/);

      const pid = ssProcMatch
        ? parseInt(ssProcMatch[2], 10)
        : slashPidMatch
          ? parseInt(slashPidMatch[1], 10)
          : trailingPidMatch
            ? parseInt(trailingPidMatch[1], 10)
            : 1000 + (i % 500);

      const processName = ssProcMatch
        ? ssProcMatch[1]
        : slashPidMatch
          ? slashPidMatch[2]
          : inferProcessNameFromPort(localPort, remotePort, protocol);

      sockets.push({
        id: `INGEST-${i}-${localIp}:${localPort}-${remoteIp}:${remotePort}`,
        protocol,
        localIp,
        localPort,
        remoteIp,
        remotePort,
        state: isListen ? 'LISTEN' : 'ESTABLISHED',
        rawStateLabel: isListen ? 'LISTEN' : 'ESTABLISHED',
        txQueueBytes: 0,
        rxQueueBytes: 0,
        inode: String(10000 + i),
        pid,
        processName,
        sourceOrigin: 'HOST_INGEST',
      });
      continue;
    }

    // 2. Match `lsof -i -n -P` format:
    // chrome  1842 user  45u  IPv4 0x...  0t0  TCP 192.168.1.5:54122->172.217.14.206:443 (ESTABLISHED)
    const lsofMatch = line.match(
      /^(\S+)\s+(\d+)\s+\S+\s+\S+\s+IPv[46]\s+\S+\s+\S+\s+(TCP|UDP)\s+([^->\s]+)(?:->([^\s(]+))?/i
    );
    if (lsofMatch) {
      const processName = lsofMatch[1];
      const pid = parseInt(lsofMatch[2], 10) || 1000;
      const protoRaw = lsofMatch[3].toUpperCase();
      const localPart = lsofMatch[4];
      const remotePart = lsofMatch[5] || '0.0.0.0:0';

      const [localIp, localPortStr] = localPart.split(':');
      const [remoteIp, remotePortStr] = remotePart.split(':');
      const localPort = parseInt(localPortStr, 10) || 0;
      const remotePort = parseInt(remotePortStr, 10) || 0;

      let protocol: OpteProtocol = protoRaw === 'UDP' ? 'UDP' : 'TCP';
      if (localPort === 53 || remotePort === 53) protocol = 'DNS';
      else if (localPort === 443 || remotePort === 443) protocol = 'HTTPS';

      const isListen = /\bLISTEN\b/i.test(line) || remotePort === 0;

      sockets.push({
        id: `LSOF-${i}-${localIp}:${localPort}-${remoteIp}:${remotePort}`,
        protocol,
        localIp: localIp === '*' ? '0.0.0.0' : localIp,
        localPort,
        remoteIp: remoteIp === '*' ? '0.0.0.0' : remoteIp,
        remotePort,
        state: isListen ? 'LISTEN' : 'ESTABLISHED',
        rawStateLabel: isListen ? 'LISTEN' : 'ESTABLISHED',
        txQueueBytes: 0,
        rxQueueBytes: 0,
        inode: String(20000 + i),
        pid,
        processName,
        sourceOrigin: 'HOST_INGEST',
      });
    }
  }

  return sockets;
}

function deterministicHash(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function posFromHash(seedKey: string, radiusMin: number, radiusMax: number): [number, number, number] {
  const h1 = deterministicHash(seedKey + ':a') / 4294967296;
  const h2 = deterministicHash(seedKey + ':b') / 4294967296;
  const h3 = deterministicHash(seedKey + ':c') / 4294967296;

  const theta = h1 * Math.PI * 2;
  const phi = Math.acos(2 * h2 - 1);
  const r = radiusMin + h3 * (radiusMax - radiusMin);

  return [
    Number((Math.sin(phi) * Math.cos(theta) * r * 1.35).toFixed(2)),
    Number((Math.sin(phi) * Math.sin(theta) * r * 0.85).toFixed(2)),
    Number((Math.cos(phi) * r * 1.05).toFixed(2)),
  ];
}

/**
 * Projects a real LiveSystemTelemetrySnapshot (+ optional Browser Performance resource entries)
 * into a 3D OpteConstellationGraph.
 *
 * - In 'LIVE_STRICT_OS' mode: renders strictly the real kernel/host processes, interfaces, DNS resolvers,
 *   and open sockets with radial micro-spokes representing open file descriptors / socket buffers.
 * - In 'LIVE_HYBRID_OPTE' mode: anchors all real OS processes, interfaces, and sockets at the core of the
 *   3D constellation and surrounds them with the full 1,100+ node Opte starburst topology so the user
 *   gets both 100% real live system sockets AND the dense Opte Project visual constellation.
 */
export function buildLiveSystemConstellation(
  snapshot: LiveSystemTelemetrySnapshot,
  browserSockets: LiveKernelSocket[] = [],
  mode: TelemetryMode = 'LIVE_HYBRID_OPTE'
): OpteConstellationGraph {
  if (mode === 'SIMULATED_OPTE') {
    return generateOpteConstellation(20261027);
  }

  const nodes: OpteNode[] = [];
  const nodeMap = new Map<string, OpteNode>();
  const filaments: OpteFilament[] = [];
  const adjacencyMap = new Map<string, OpteFilament[]>();

  const registerNode = (node: OpteNode) => {
    if (nodeMap.has(node.id)) return nodeMap.get(node.id)!;
    node.index = nodes.length;
    nodes.push(node);
    nodeMap.set(node.id, node);
    adjacencyMap.set(node.id, []);
    return node;
  };

  const addFilament = (params: {
    sourceId: string;
    targetId: string;
    protocol: OpteProtocol;
    colorDomain: OpteColorDomain;
    socketState: SocketState;
    isStarburstSpoke: boolean;
    bandwidthMBps: number;
    packetRatePps: number;
    latencyMs: number;
  }) => {
    const src = nodeMap.get(params.sourceId);
    const dst = nodeMap.get(params.targetId);
    if (!src || !dst || src.id === dst.id) return;

    const palette = OPTE_DOMAIN_PALETTE[params.colorDomain];
    const h = (deterministicHash(`${src.id}->${dst.id}-${filaments.length}`) / 4294967296) - 0.5;
    const spread = params.isStarburstSpoke ? 1.8 : 7.5;
    const midX = (src.position[0] + dst.position[0]) * 0.5 + h * spread;
    const midY = (src.position[1] + dst.position[1]) * 0.5 - h * spread * 0.8;
    const midZ = (src.position[2] + dst.position[2]) * 0.5 + h * spread * 0.6;

    const fil: OpteFilament = {
      id: `LIVE-FIL-${filaments.length + 1}`,
      index: filaments.length,
      sourceId: src.id,
      targetId: dst.id,
      sourceIndex: src.index,
      targetIndex: dst.index,
      protocol: params.protocol,
      colorDomain: params.colorDomain,
      colorHex: palette.hex,
      rgb: palette.rgb,
      socketState: params.socketState,
      packetRatePps: Math.max(1, Math.round(params.packetRatePps)),
      bandwidthMBps: Number(Math.max(0.05, params.bandwidthMBps).toFixed(2)),
      bandwidthMbps: Math.max(1, Math.round(params.bandwidthMBps * 8)),
      latencyMs: Number(Math.max(0.08, params.latencyMs).toFixed(2)),
      isStarburstSpoke: params.isStarburstSpoke,
      controlPoint: [midX, midY, midZ],
    };

    filaments.push(fil);
    adjacencyMap.get(src.id)!.push(fil);
    adjacencyMap.get(dst.id)!.push(fil);

    src.degree++;
    dst.degree++;
    src.totalBandwidthMBps = Number((src.totalBandwidthMBps + fil.bandwidthMBps).toFixed(2));
    dst.totalBandwidthMBps = Number((dst.totalBandwidthMBps + fil.bandwidthMBps).toFixed(2));
    src.totalPacketRatePps += fil.packetRatePps;
    dst.totalPacketRatePps += fil.packetRatePps;
  };

  // 1. Register Root Host Kernel Core Starburst Hub
  const hostHubId = `host-kernel-${snapshot.hostname}`;
  const hostHub = registerNode({
    id: hostHubId,
    index: 0,
    hostname: `${snapshot.hostname} [LIVE-KERNEL]`,
    ipAddress: snapshot.interfaces.find((i) => i.name !== 'lo')?.ipv4 || '127.0.0.1',
    asn: 'LIVE-OS',
    pid: 1,
    port: 0,
    hierarchyRole: 'CORE_BACKBONE_ROUTER',
    hierarchyLabel: 'Live Host Kernel Core',
    colorDomain: 'WHITE_CORE_HUB',
    colorHex: OPTE_DOMAIN_PALETTE.WHITE_CORE_HUB.hex,
    rgb: OPTE_DOMAIN_PALETTE.WHITE_CORE_HUB.rgb,
    position: [0, 0, 0],
    parentHubId: null,
    degree: 0,
    totalBandwidthMBps: 0,
    totalPacketRatePps: 0,
    isStarburstHub: true,
  });

  // 2. Register Live Network Interfaces (/proc/net/dev) as Gateway Starburst Hubs
  const ifaceNodeMap = new Map<string, OpteNode>();
  snapshot.interfaces.forEach((iface, idx) => {
    const angle = (idx / Math.max(1, snapshot.interfaces.length)) * Math.PI * 2;
    const pos: [number, number, number] = [
      Math.cos(angle) * 18,
      Math.sin(angle) * 12,
      (idx % 2 === 0 ? 1 : -1) * 8,
    ];
    const domain: OpteColorDomain =
      iface.name === 'lo' ? 'GREEN_IPC_LAN' : 'BLUE_BACKBONE';
    const pal = OPTE_DOMAIN_PALETTE[domain];
    const node = registerNode({
      id: `iface-${iface.name}`,
      index: nodes.length,
      hostname: `nic-${iface.name} [LIVE-NIC]`,
      ipAddress: iface.ipv4 || (iface.name === 'lo' ? '127.0.0.1' : '10.0.0.1'),
      asn: 'KERNEL-NIC',
      pid: 2 + idx,
      port: 0,
      hierarchyRole: 'LOCAL_SUBNET_GATEWAY',
      hierarchyLabel: 'Live Network Interface (/proc/net/dev)',
      colorDomain: domain,
      colorHex: pal.hex,
      rgb: pal.rgb,
      position: pos,
      parentHubId: hostHub.id,
      degree: 0,
      totalBandwidthMBps: Number((iface.rxRateMBps + iface.txRateMBps).toFixed(2)),
      totalPacketRatePps: iface.packetRatePps,
      isStarburstHub: true,
    });
    ifaceNodeMap.set(iface.name, node);

    addFilament({
      sourceId: hostHub.id,
      targetId: node.id,
      protocol: iface.name === 'lo' ? 'IPC' : 'TCP',
      colorDomain: 'WHITE_CORE_HUB',
      socketState: 'ESTABLISHED',
      isStarburstSpoke: false,
      bandwidthMBps: Math.max(12.5, iface.rxRateMBps + iface.txRateMBps),
      packetRatePps: Math.max(450, iface.packetRatePps),
      latencyMs: iface.name === 'lo' ? 0.08 : 0.45,
    });
  });

  // 3. Register Live DNS Servers (/etc/resolv.conf)
  snapshot.dnsServers.forEach((dnsIp, idx) => {
    const dnsNode = registerNode({
      id: `dns-live-${dnsIp}`,
      index: nodes.length,
      hostname: `dns-resolver-${idx + 1} [LIVE-DNS]`,
      ipAddress: dnsIp,
      asn: 'RESOLV-CONF',
      pid: 53,
      port: 53,
      hierarchyRole: 'DNS_RESOLVER',
      hierarchyLabel: 'Live System DNS Resolver',
      colorDomain: 'CYAN_UDP_DNS',
      colorHex: OPTE_DOMAIN_PALETTE.CYAN_UDP_DNS.hex,
      rgb: OPTE_DOMAIN_PALETTE.CYAN_UDP_DNS.rgb,
      position: posFromHash(`dns-${dnsIp}`, 22, 34),
      parentHubId: hostHub.id,
      degree: 0,
      totalBandwidthMBps: 0,
      totalPacketRatePps: 0,
      isStarburstHub: true,
    });

    addFilament({
      sourceId: hostHub.id,
      targetId: dnsNode.id,
      protocol: 'DNS',
      colorDomain: 'CYAN_UDP_DNS',
      socketState: 'ESTABLISHED',
      isStarburstSpoke: false,
      bandwidthMBps: 4.8,
      packetRatePps: 920,
      latencyMs: 1.85,
    });
  });

  // 4. Register Real Running OS Processes (/proc/[pid]) as Starburst Hubs
  const pidNodeMap = new Map<number, OpteNode>();
  snapshot.processes.forEach((proc) => {
    const isDbOrStorage = /(postgres|redis|sql|mongo|ceph|clickhouse|fs|log)/i.test(proc.name);
    const isNetOrWeb = /(node|vite|tsx|nginx|envoy|http|chrome|playwright)/i.test(proc.name);
    const domain: OpteColorDomain = isDbOrStorage
      ? 'CRIMSON_STORAGE_DB'
      : isNetOrWeb
        ? 'BLUE_BACKBONE'
        : 'GREEN_IPC_LAN';
    const pal = OPTE_DOMAIN_PALETTE[domain];
    const pos = posFromHash(`proc-${proc.pid}-${proc.name}`, 18, 46);

    const pNode = registerNode({
      id: `pid-${proc.pid}`,
      index: nodes.length,
      hostname: `${proc.name} [PID:${proc.pid}]`,
      ipAddress: '127.0.0.1',
      asn: `RSS:${proc.rssMB}MB`,
      pid: proc.pid,
      port: proc.pid,
      hierarchyRole: 'SYSTEM_PROCESS_SERVICE',
      hierarchyLabel: `Live OS Process (${proc.threads} threads, ${proc.openFds} FDs)`,
      colorDomain: domain,
      colorHex: pal.hex,
      rgb: pal.rgb,
      position: pos,
      parentHubId: hostHub.id,
      degree: 0,
      totalBandwidthMBps: 0,
      totalPacketRatePps: 0,
      isStarburstHub: true,
    });
    pidNodeMap.set(proc.pid, pNode);

    // Connect process to its parent process or host kernel
    const parentNode = pidNodeMap.get(proc.ppid) ?? hostHub;
    addFilament({
      sourceId: parentNode.id,
      targetId: pNode.id,
      protocol: 'IPC',
      colorDomain: domain,
      socketState: 'ESTABLISHED',
      isStarburstSpoke: false,
      bandwidthMBps: Math.max(2.4, proc.rssMB * 0.18),
      packetRatePps: Math.max(180, proc.openFds * 42),
      latencyMs: 0.15,
    });

    // Add radial starburst spokes for the process's open file descriptors / threads
    const spokeCount = Math.min(18, Math.max(6, Math.round(proc.openFds / 4)));
    for (let s = 0; s < spokeCount; s++) {
      const th = (s / spokeCount) * Math.PI * 2 + (proc.pid % 7) * 0.3;
      const ph = ((s * 0.618) % 1) * Math.PI - Math.PI / 2;
      const dist = 3.2 + (s % 4) * 1.1;
      const leafId = `fd-${proc.pid}-${s}`;
      const leaf = registerNode({
        id: leafId,
        index: nodes.length,
        hostname: `${proc.name}-fd-${s}`,
        ipAddress: `127.0.0.${(proc.pid + s) % 250 + 1}`,
        asn: `FD:${s + 3}`,
        pid: proc.pid,
        port: 10000 + ((proc.pid * 13 + s) % 50000),
        hierarchyRole: 'PEER_LEAF_NODE',
        hierarchyLabel: 'Process File Descriptor / IPC Pipe',
        colorDomain: domain,
        colorHex: pal.hex,
        rgb: pal.rgb,
        position: [
          Number((pos[0] + Math.cos(ph) * Math.cos(th) * dist).toFixed(2)),
          Number((pos[1] + Math.sin(ph) * dist).toFixed(2)),
          Number((pos[2] + Math.cos(ph) * Math.sin(th) * dist).toFixed(2)),
        ],
        parentHubId: pNode.id,
        degree: 0,
        totalBandwidthMBps: 0,
        totalPacketRatePps: 0,
        isStarburstHub: false,
      });

      addFilament({
        sourceId: pNode.id,
        targetId: leaf.id,
        protocol: 'IPC',
        colorDomain: domain,
        socketState: 'ESTABLISHED',
        isStarburstSpoke: true,
        bandwidthMBps: 1.2 + (s % 5) * 0.8,
        packetRatePps: 120 + s * 35,
        latencyMs: 0.12,
      });
    }
  });

  // 5. Register All Real Kernel Sockets (/proc/net/tcp, /proc/net/udp, Host Ingest, & Browser Performance API)
  const allLiveSockets = [...snapshot.sockets, ...browserSockets];
  allLiveSockets.forEach((sock, idx) => {
    const isLoopback =
      sock.localIp === '127.0.0.1' ||
      sock.localIp === '::1' ||
      sock.remoteIp === '127.0.0.1' ||
      sock.remoteIp === '::1';

    const domain: OpteColorDomain =
      sock.protocol === 'DNS' || sock.protocol === 'UDP'
        ? 'CYAN_UDP_DNS'
        : sock.protocol === 'HTTPS'
          ? 'BLUE_BACKBONE'
          : isLoopback
            ? 'GREEN_IPC_LAN'
            : sock.localPort === 5432 || sock.remotePort === 5432
              ? 'CRIMSON_STORAGE_DB'
              : 'BLUE_BACKBONE';

    const pal = OPTE_DOMAIN_PALETTE[domain];

    // Source node: either matched PID node, or interface node, or a dedicated local socket hub
    let srcNode = pidNodeMap.get(sock.pid);
    if (!srcNode) {
      const localHubId = `sock-local-${sock.localIp}-${sock.localPort}`;
      srcNode = registerNode({
        id: localHubId,
        index: nodes.length,
        hostname: `${sock.processName} [:${sock.localPort}]`,
        ipAddress: sock.localIp,
        asn: sock.sourceOrigin === 'HOST_INGEST' ? 'HOST-LIVE' : 'KERNEL-SOCK',
        pid: sock.pid,
        port: sock.localPort,
        hierarchyRole: 'SYSTEM_PROCESS_SERVICE',
        hierarchyLabel: `Live ${sock.protocol} Socket (${sock.rawStateLabel})`,
        colorDomain: domain,
        colorHex: pal.hex,
        rgb: pal.rgb,
        position: posFromHash(localHubId, 16, 44),
        parentHubId: hostHub.id,
        degree: 0,
        totalBandwidthMBps: 0,
        totalPacketRatePps: 0,
        isStarburstHub: true,
      });

      const nicNode = isLoopback
        ? ifaceNodeMap.get('lo') ?? hostHub
        : snapshot.interfaces.find((i) => i.name !== 'lo')
          ? ifaceNodeMap.get(snapshot.interfaces.find((i) => i.name !== 'lo')!.name) ?? hostHub
          : hostHub;

      addFilament({
        sourceId: nicNode.id,
        targetId: srcNode.id,
        protocol: sock.protocol,
        colorDomain: domain,
        socketState: sock.state,
        isStarburstSpoke: false,
        bandwidthMBps: 8.5,
        packetRatePps: 640,
        latencyMs: isLoopback ? 0.15 : 1.1,
      });
    }

    // Target node: remote peer endpoint (or listening port endpoint)
    const remoteKey =
      sock.remotePort > 0
        ? `peer-${sock.remoteIp}-${sock.remotePort}`
        : `listen-${sock.localIp}-${sock.localPort}-${idx}`;

    const dstPos = posFromHash(remoteKey, 24, 58);
    const dstNode = registerNode({
      id: remoteKey,
      index: nodes.length,
      hostname:
        sock.remotePort > 0
          ? `peer-${sock.remoteIp}:${sock.remotePort}`
          : `listen-${sock.processName}:${sock.localPort}`,
      ipAddress: sock.remotePort > 0 ? sock.remoteIp : sock.localIp,
      asn: sock.sourceOrigin === 'BROWSER_PERF' ? 'BROWSER-NET' : 'LIVE-SOCKET',
      pid: sock.pid,
      port: sock.remotePort > 0 ? sock.remotePort : sock.localPort,
      hierarchyRole:
        sock.remotePort === 443 || sock.sourceOrigin === 'BROWSER_PERF'
          ? 'CLOUD_CDN_ENDPOINT'
          : 'PEER_LEAF_NODE',
      hierarchyLabel:
        sock.remotePort > 0
          ? `Active Remote Peer (${sock.rawStateLabel})`
          : `Listening Kernel Socket (:${sock.localPort})`,
      colorDomain: domain,
      colorHex: pal.hex,
      rgb: pal.rgb,
      position: dstPos,
      parentHubId: srcNode.id,
      degree: 0,
      totalBandwidthMBps: 0,
      totalPacketRatePps: 0,
      isStarburstHub: sock.state === 'LISTEN' || sock.remotePort === 443,
    });

    const queueBytes = sock.txQueueBytes + sock.rxQueueBytes;
    const estBw = Math.max(
      1.8,
      queueBytes > 0 ? queueBytes / 1024 : sock.state === 'ESTABLISHED' ? 14.5 : 3.2
    );

    addFilament({
      sourceId: srcNode.id,
      targetId: dstNode.id,
      protocol: sock.protocol,
      colorDomain: domain,
      socketState: sock.state,
      isStarburstSpoke: true,
      bandwidthMBps: estBw,
      packetRatePps: sock.state === 'ESTABLISHED' ? 1450 + (idx % 900) : 220,
      latencyMs: isLoopback ? 0.22 : 4.2 + (idx % 12) * 0.9,
    });
  });

  // 6. If in LIVE_HYBRID_OPTE mode, merge the Opte background starburst clusters around our live OS core
  // so the 3D scene maintains 1,100+ nodes & 2,300+ filaments while every real OS node is inspectable & bridged!
  if (mode === 'LIVE_HYBRID_OPTE') {
    const baseOpte = generateOpteConstellation(20261027);
    for (const bNode of baseOpte.nodes) {
      if (!nodeMap.has(bNode.id)) {
        registerNode({ ...bNode, degree: 0, totalBandwidthMBps: 0, totalPacketRatePps: 0 });
      }
    }
    for (const bFil of baseOpte.filaments) {
      addFilament({
        sourceId: bFil.sourceId,
        targetId: bFil.targetId,
        protocol: bFil.protocol,
        colorDomain: bFil.colorDomain,
        socketState: bFil.socketState,
        isStarburstSpoke: bFil.isStarburstSpoke,
        bandwidthMBps: bFil.bandwidthMBps,
        packetRatePps: bFil.packetRatePps,
        latencyMs: bFil.latencyMs,
      });
    }
    // Bridge the Live Host Kernel Core & Live NICs to the primary Opte Core Routers
    ['core-rtr-01', 'core-rtr-02', 'core-rtr-04', 'systemd-resolved', 'postgres-db'].forEach(
      (targetId) => {
        if (nodeMap.has(targetId)) {
          addFilament({
            sourceId: hostHub.id,
            targetId,
            protocol: 'TCP',
            colorDomain: 'WHITE_CORE_HUB',
            socketState: 'ESTABLISHED',
            isStarburstSpoke: false,
            bandwidthMBps: 88.5,
            packetRatePps: 14200,
            latencyMs: 0.65,
          });
        }
      }
    );
  }

  return {
    nodes,
    nodeMap,
    filaments,
    adjacencyMap,
  };
}
