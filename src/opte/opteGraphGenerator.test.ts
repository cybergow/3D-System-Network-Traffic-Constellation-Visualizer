import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ConstellationFilterState,
  filterConstellationFilaments,
  findMultiHopTraceroute,
  generateOpteConstellation,
  getNodePeerMatrix,
  searchNodesByQuery,
} from './opteGraphGenerator';

const graph = generateOpteConstellation(20261027);

test('generateOpteConstellation produces 800+ nodes and 2,000+ communication filaments', () => {
  assert.ok(
    graph.nodes.length >= 800,
    `Expected >= 800 nodes, got ${graph.nodes.length}`
  );
  assert.ok(
    graph.filaments.length >= 2000,
    `Expected >= 2000 filaments, got ${graph.filaments.length}`
  );

  // Verify named core routers and system services exist
  assert.ok(graph.nodeMap.has('core-rtr-04'));
  assert.ok(graph.nodeMap.has('systemd-resolved'));
  assert.ok(graph.nodeMap.has('postgres-db'));
  assert.ok(graph.nodeMap.has('edge-gw'));
});

test('getNodePeerMatrix returns real-time connected peers with socket state, packet rate, and latency', () => {
  const peers = getNodePeerMatrix(graph, 'core-rtr-04');
  assert.ok(peers.length >= 15, `Expected core-rtr-04 to have >= 15 starburst spokes/peers, got ${peers.length}`);
  assert.ok(peers[0].bandwidthMBps >= peers[peers.length - 1].bandwidthMBps);
  assert.ok(peers[0].packetRatePps > 0);
  assert.ok(peers[0].latencyMs > 0);
});

test('findMultiHopTraceroute computes end-to-end multi-hop routing path across the constellation', () => {
  const route = findMultiHopTraceroute(graph, 'systemd-resolved', 'postgres-db');
  assert.ok(route, 'Traceroute between systemd-resolved and postgres-db must succeed');
  assert.ok(route.hops.length >= 2, 'Traceroute must have at least 2 hops');
  assert.equal(route.hops[0].node.id, 'systemd-resolved');
  assert.equal(route.hops[route.hops.length - 1].node.id, 'postgres-db');
  assert.ok(route.totalLatencyMs > 0);
});

test('filterConstellationFilaments filters by protocol, domain, and bandwidth threshold', () => {
  const defaultFilter: ConstellationFilterState = {
    enabledProtocols: {
      TCP: true,
      HTTPS: true,
      IPC: true,
      UDP: true,
      DNS: true,
      ICMP: true,
    },
    enabledDomains: {
      BLUE_BACKBONE: true,
      GREEN_IPC_LAN: true,
      CYAN_UDP_DNS: true,
      CRIMSON_STORAGE_DB: true,
      WHITE_CORE_HUB: true,
    },
    hierarchyFilter: 'ALL',
    minBandwidthMbps: 0,
  };

  const allFilaments = filterConstellationFilaments(graph, defaultFilter);
  assert.equal(allFilaments.length, graph.filaments.length);

  // Filter strictly to DNS protocol
  const dnsOnlyFilter: ConstellationFilterState = {
    ...defaultFilter,
    enabledProtocols: {
      TCP: false,
      HTTPS: false,
      IPC: false,
      UDP: false,
      DNS: true,
      ICMP: false,
    },
  };
  const dnsFilaments = filterConstellationFilaments(graph, dnsOnlyFilter);
  assert.ok(dnsFilaments.length > 0 && dnsFilaments.length < allFilaments.length);
  assert.ok(dnsFilaments.every((f) => f.protocol === 'DNS'));
});

test('searchNodesByQuery locates nodes by hostname, IP address, or port', () => {
  const byHost = searchNodesByQuery(graph, 'postgres-db');
  assert.ok(byHost.some((n) => n.id === 'postgres-db'));

  const byPort = searchNodesByQuery(graph, ':53');
  assert.ok(byPort.some((n) => n.port === 53));

  const byIp = searchNodesByQuery(graph, '10.24.0.4');
  assert.ok(byIp.some((n) => n.id === 'core-rtr-04'));
});

import {
  buildLiveSystemConstellation,
  decodeProcHexIpv4,
  parseProcNetDev,
  parseProcNetSockets,
  parseRawSocketCommandOutput,
} from './liveSystemTelemetry';

test('decodeProcHexIpv4 and parseProcNetSockets decode real Linux /proc/net/tcp socket tables', () => {
  assert.equal(decodeProcHexIpv4('0100007F'), '127.0.0.1');
  assert.equal(decodeProcHexIpv4('00000000'), '0.0.0.0');

  const sampleProcTcp = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 42190 1 0000000000000000 100 0 0 10 0
   1: 0100007F:9C40 0100007F:0BB8 01 00000400:00000000 00:00000000 00000000  1000        0 42195 1 0000000000000000 20 4 30 10 -1`;

  const sockets = parseProcNetSockets(sampleProcTcp, 'TCP');
  assert.equal(sockets.length, 2);
  assert.equal(sockets[0].localIp, '127.0.0.1');
  assert.equal(sockets[0].localPort, 3000);
  assert.equal(sockets[0].state, 'LISTEN');
  assert.equal(sockets[1].state, 'ESTABLISHED');
  assert.equal(sockets[1].remotePort, 3000);
});

test('parseProcNetDev and parseRawSocketCommandOutput parse netstat/ss/lsof outputs and build live 3D constellation', () => {
  const sampleDev = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 1482910   12040    0    0    0     0          0         0  1482910   12040    0    0    0     0       0          0
  eth0: 9841200   64210    0    0    0     0          0         0  4129000   31200    0    0    0     0       0          0`;

  const devs = parseProcNetDev(sampleDev);
  assert.equal(devs.length, 2);
  assert.equal(devs[0].name, 'lo');
  assert.equal(devs[1].name, 'eth0');

  const rawNetstat = `
TCP    192.168.1.24:54312     142.250.190.46:443     ESTABLISHED     4812
tcp    ESTAB      0      0    10.0.0.15:38912        1.1.1.1:53      users:(("systemd-resolve",pid=612,fd=14))
chrome 1842 user 45u IPv4 0x11 0t0 TCP 192.168.1.24:54122->172.217.14.206:443 (ESTABLISHED)
`;
  const parsedIngest = parseRawSocketCommandOutput(rawNetstat);
  assert.equal(parsedIngest.length, 3);
  assert.equal(parsedIngest[0].remotePort, 443);
  assert.equal(parsedIngest[1].protocol, 'DNS');
  assert.equal(parsedIngest[2].processName, 'chrome');

  const liveStrictGraph = buildLiveSystemConstellation(
    {
      timestamp: Date.now(),
      hostname: 'workstation-01',
      platform: 'linux',
      kernelRelease: '6.6.0',
      uptimeSeconds: 3600,
      loadAvg: [0.4, 0.3, 0.2],
      totalMemMB: 16384,
      usedMemMB: 6120,
      interfaces: [
        {
          name: 'eth0',
          ipv4: '192.168.1.24',
          rxBytes: 9841200,
          rxPackets: 64210,
          txBytes: 4129000,
          txPackets: 31200,
          rxRateMBps: 14.2,
          txRateMBps: 6.8,
          packetRatePps: 1840,
        },
      ],
      processes: [
        { pid: 1842, ppid: 1, name: 'chrome', cmdline: 'chrome', rssMB: 412, threads: 24, openFds: 48 },
      ],
      sockets: parsedIngest,
      dnsServers: ['1.1.1.1'],
      ingestedHostLabel: 'workstation-01',
    },
    [],
    'LIVE_STRICT_OS'
  );

  assert.ok(liveStrictGraph.nodes.length >= 10);
  assert.ok(liveStrictGraph.filaments.length >= 10);
  assert.ok(liveStrictGraph.nodeMap.has('host-kernel-workstation-01'));
  assert.ok(liveStrictGraph.nodeMap.has('pid-1842'));
});
