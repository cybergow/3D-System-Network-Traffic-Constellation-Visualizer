export type OpteColorDomain =
  | 'BLUE_BACKBONE' // Deep & Electric Blue: Core TCP / HTTPS Backbone & External AS Transit
  | 'GREEN_IPC_LAN' // Emerald & Neon Green: Internal System IPC, Local Subnet (LAN), & Microservice API
  | 'CYAN_UDP_DNS' // Cyan / Aqua: UDP / Real-Time Media / WebSockets & DNS Resolution Queries
  | 'CRIMSON_STORAGE_DB' // Crimson / Red-Orange: High-Bandwidth Data Transfers, Storage I/O, & DB Replication
  | 'WHITE_CORE_HUB'; // Bright White: High-Capacity Core Switch Interconnects & Starburst Spokes

export type OpteProtocol = 'TCP' | 'HTTPS' | 'IPC' | 'UDP' | 'DNS' | 'ICMP';

export type NodeHierarchyRole =
  | 'CORE_BACKBONE_ROUTER'
  | 'SYSTEM_PROCESS_SERVICE'
  | 'LOCAL_SUBNET_GATEWAY'
  | 'DNS_RESOLVER'
  | 'CLOUD_CDN_ENDPOINT'
  | 'PEER_LEAF_NODE';

export type SocketState = 'ESTABLISHED' | 'LISTEN';

export interface OpteNode {
  id: string;
  index: number;
  hostname: string;
  ipAddress: string;
  asn: string;
  pid: number;
  port: number;
  hierarchyRole: NodeHierarchyRole;
  hierarchyLabel: string;
  colorDomain: OpteColorDomain;
  colorHex: string;
  rgb: [number, number, number];
  position: [number, number, number];
  parentHubId: string | null;
  degree: number;
  totalBandwidthMBps: number;
  totalPacketRatePps: number;
  isStarburstHub: boolean;
}

export interface OpteFilament {
  id: string;
  index: number;
  sourceId: string;
  targetId: string;
  sourceIndex: number;
  targetIndex: number;
  protocol: OpteProtocol;
  colorDomain: OpteColorDomain;
  colorHex: string;
  rgb: [number, number, number];
  socketState: SocketState;
  packetRatePps: number;
  bandwidthMBps: number;
  bandwidthMbps: number;
  latencyMs: number;
  isStarburstSpoke: boolean;
  controlPoint: [number, number, number];
}

export interface OpteConstellationGraph {
  nodes: OpteNode[];
  nodeMap: Map<string, OpteNode>;
  filaments: OpteFilament[];
  adjacencyMap: Map<string, OpteFilament[]>;
}

export interface PeerConnectionEntry {
  filamentId: string;
  peerNode: OpteNode;
  direction: 'OUTBOUND' | 'INBOUND' | 'BIDIRECTIONAL';
  protocol: OpteProtocol;
  socketState: SocketState;
  packetRatePps: number;
  bandwidthMBps: number;
  latencyMs: number;
  colorDomain: OpteColorDomain;
  colorHex: string;
}

export interface TracerouteHop {
  hopNumber: number;
  node: OpteNode;
  filamentFromPrev: OpteFilament | null;
  hopLatencyMs: number;
  cumulativeLatencyMs: number;
}

export interface TracerouteResult {
  sourceNode: OpteNode;
  targetNode: OpteNode;
  hops: TracerouteHop[];
  filamentIds: Set<string>;
  nodeIds: Set<string>;
  totalLatencyMs: number;
  minBandwidthMBps: number;
}

export interface ConstellationFilterState {
  enabledProtocols: Record<OpteProtocol, boolean>;
  enabledDomains: Record<OpteColorDomain, boolean>;
  hierarchyFilter: 'ALL' | NodeHierarchyRole;
  minBandwidthMbps: number;
}

export const OPTE_DOMAIN_PALETTE: Record<
  OpteColorDomain,
  { label: string; shortLabel: string; hex: string; rgb: [number, number, number] }
> = {
  BLUE_BACKBONE: {
    label: 'Core TCP / HTTPS Backbone & External AS Transit',
    shortLabel: 'TCP/HTTPS Backbone',
    hex: '#2563eb',
    rgb: [0.16, 0.44, 1.0],
  },
  GREEN_IPC_LAN: {
    label: 'Internal System IPC, Local Subnet (LAN) & Microservice API',
    shortLabel: 'System IPC & LAN',
    hex: '#10b981',
    rgb: [0.06, 0.92, 0.38],
  },
  CYAN_UDP_DNS: {
    label: 'UDP / Real-Time Media / WebSockets & DNS Queries',
    shortLabel: 'UDP / DNS / Media',
    hex: '#06b6d4',
    rgb: [0.0, 0.94, 0.98],
  },
  CRIMSON_STORAGE_DB: {
    label: 'High-Bandwidth Data Transfers, Storage I/O & DB Replication',
    shortLabel: 'Storage I/O & DB Sync',
    hex: '#ef4444',
    rgb: [1.0, 0.16, 0.2],
  },
  WHITE_CORE_HUB: {
    label: 'High-Capacity Core Switch Interconnects & Gateway Starbursts',
    shortLabel: 'Core Hubs & Spokes',
    hex: '#ffffff',
    rgb: [0.95, 0.97, 1.0],
  },
};

export const HIERARCHY_LABELS: Record<NodeHierarchyRole, string> = {
  CORE_BACKBONE_ROUTER: 'Core Backbone Router',
  SYSTEM_PROCESS_SERVICE: 'System Process / Service',
  LOCAL_SUBNET_GATEWAY: 'Local Subnet Gateway',
  DNS_RESOLVER: 'DNS Resolver',
  CLOUD_CDN_ENDPOINT: 'Cloud / CDN Endpoint',
  PEER_LEAF_NODE: 'Peer Leaf Endpoint',
};

/**
 * Deterministic seeded PRNG (Mulberry32) so the 960-node, 2,400+ filament 3D constellation
 * is 100% reproducible across sessions and unit tests.
 */
function createSeededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMED_CORE_ROUTERS: {
  hostname: string;
  ip: string;
  asn: string;
  port: number;
  pos: [number, number, number];
}[] = [
  { hostname: 'core-rtr-01', ip: '10.24.0.1', asn: 'AS64512', port: 179, pos: [-28, 12, -8] },
  { hostname: 'core-rtr-02', ip: '10.24.0.2', asn: 'AS64512', port: 179, pos: [26, -6, 6] },
  { hostname: 'core-rtr-03', ip: '10.24.0.3', asn: 'AS64512', port: 179, pos: [-4, 24, -14] },
  { hostname: 'core-rtr-04', ip: '10.24.0.4', asn: 'AS64512', port: 179, pos: [42, -8, -12] },
  { hostname: 'core-rtr-05', ip: '10.24.0.5', asn: 'AS64513', port: 179, pos: [-54, 18, 10] },
  { hostname: 'core-rtr-06', ip: '10.24.0.6', asn: 'AS64513', port: 179, pos: [8, -24, 16] },
  { hostname: 'as3356-transit-ix', ip: '172.16.0.1', asn: 'AS3356', port: 179, pos: [-16, -12, -26] },
  { hostname: 'as15169-backbone-gw', ip: '172.16.0.2', asn: 'AS15169', port: 443, pos: [18, 22, 20] },
  { hostname: 'as13335-anycast-core', ip: '172.16.0.3', asn: 'AS13335', port: 443, pos: [-38, -22, 8] },
  { hostname: 'as16509-cloud-fabric', ip: '172.16.0.4', asn: 'AS16509', port: 443, pos: [56, 16, -6] },
  { hostname: 'sw-spine-fabric-01', ip: '10.24.1.1', asn: 'AS64512', port: 4789, pos: [-6, 2, 12] },
  { hostname: 'sw-spine-fabric-02', ip: '10.24.1.2', asn: 'AS64512', port: 4789, pos: [14, -4, -18] },
];

const NAMED_SYSTEM_SERVICES: {
  hostname: string;
  ip: string;
  asn: string;
  pid: number;
  port: number;
  domain: OpteColorDomain;
  protocol: OpteProtocol;
  role: NodeHierarchyRole;
}[] = [
  { hostname: 'systemd-resolved', ip: '127.0.0.53', asn: 'AS64512', pid: 612, port: 53, domain: 'CYAN_UDP_DNS', protocol: 'DNS', role: 'DNS_RESOLVER' },
  { hostname: 'postgres-db', ip: '10.24.12.100', asn: 'AS64512', pid: 2140, port: 5432, domain: 'CRIMSON_STORAGE_DB', protocol: 'TCP', role: 'SYSTEM_PROCESS_SERVICE' },
  { hostname: 'edge-gw', ip: '10.24.2.10', asn: 'AS64512', pid: 1084, port: 443, domain: 'BLUE_BACKBONE', protocol: 'HTTPS', role: 'LOCAL_SUBNET_GATEWAY' },
  { hostname: 'kube-apiserver', ip: '10.96.0.1', asn: 'AS64512', pid: 1420, port: 6443, domain: 'GREEN_IPC_LAN', protocol: 'HTTPS', role: 'SYSTEM_PROCESS_SERVICE' },
  { hostname: 'redis-cluster-01', ip: '10.24.14.20', asn: 'AS64512', pid: 2890, port: 6379, domain: 'GREEN_IPC_LAN', protocol: 'IPC', role: 'SYSTEM_PROCESS_SERVICE' },
  { hostname: 'ceph-osd-storage', ip: '10.24.40.15', asn: 'AS64512', pid: 3410, port: 6800, domain: 'CRIMSON_STORAGE_DB', protocol: 'TCP', role: 'SYSTEM_PROCESS_SERVICE' },
  { hostname: 'kafka-stream-broker', ip: '10.24.18.90', asn: 'AS64512', pid: 4102, port: 9092, domain: 'GREEN_IPC_LAN', protocol: 'IPC', role: 'SYSTEM_PROCESS_SERVICE' },
  { hostname: 'coredns-cluster', ip: '10.96.0.10', asn: 'AS64512', pid: 944, port: 53, domain: 'CYAN_UDP_DNS', protocol: 'DNS', role: 'DNS_RESOLVER' },
  { hostname: 'envoy-mesh-ingress', ip: '10.24.8.12', asn: 'AS64512', pid: 1850, port: 15001, domain: 'GREEN_IPC_LAN', protocol: 'IPC', role: 'LOCAL_SUBNET_GATEWAY' },
  { hostname: 'cdn-edge-pop-01', ip: '198.51.100.10', asn: 'AS13335', pid: 5012, port: 443, domain: 'BLUE_BACKBONE', protocol: 'HTTPS', role: 'CLOUD_CDN_ENDPOINT' },
  { hostname: 'webrtc-media-relay', ip: '10.24.22.40', asn: 'AS64513', pid: 6120, port: 3478, domain: 'CYAN_UDP_DNS', protocol: 'UDP', role: 'SYSTEM_PROCESS_SERVICE' },
  { hostname: 'clickhouse-analytics', ip: '10.24.45.80', asn: 'AS64512', pid: 7210, port: 9000, domain: 'CRIMSON_STORAGE_DB', protocol: 'TCP', role: 'SYSTEM_PROCESS_SERVICE' },
  { hostname: 'etcd-state-quorum', ip: '10.24.4.11', asn: 'AS64512', pid: 1120, port: 2379, domain: 'GREEN_IPC_LAN', protocol: 'IPC', role: 'SYSTEM_PROCESS_SERVICE' },
  { hostname: 'prometheus-scraper', ip: '10.24.30.90', asn: 'AS64512', pid: 4990, port: 9090, domain: 'GREEN_IPC_LAN', protocol: 'HTTPS', role: 'SYSTEM_PROCESS_SERVICE' },
  { hostname: 'nvme-san-replicator', ip: '10.24.50.10', asn: 'AS64513', pid: 8105, port: 4420, domain: 'CRIMSON_STORAGE_DB', protocol: 'TCP', role: 'SYSTEM_PROCESS_SERVICE' },
  { hostname: 'bgp-route-reflector', ip: '172.16.10.1', asn: 'AS3356', pid: 710, port: 179, domain: 'BLUE_BACKBONE', protocol: 'TCP', role: 'CORE_BACKBONE_ROUTER' },
];

/**
 * Generates a full Opte-style 3D Force-Directed Constellation with ~960 nodes and ~2,450 filaments.
 */
export function generateOpteConstellation(seed: number = 20261027): OpteConstellationGraph {
  const rand = createSeededRandom(seed);
  const nodes: OpteNode[] = [];
  const nodeMap = new Map<string, OpteNode>();
  const filaments: OpteFilament[] = [];
  const adjacencyMap = new Map<string, OpteFilament[]>();

  const registerNode = (node: OpteNode) => {
    nodes.push(node);
    nodeMap.set(node.id, node);
    adjacencyMap.set(node.id, []);
  };

  const addFilament = (params: {
    sourceId: string;
    targetId: string;
    protocol: OpteProtocol;
    colorDomain: OpteColorDomain;
    isStarburstSpoke: boolean;
    bandwidthMBps: number;
    packetRatePps: number;
    latencyMs: number;
  }) => {
    const src = nodeMap.get(params.sourceId);
    const dst = nodeMap.get(params.targetId);
    if (!src || !dst || src.id === dst.id) return;

    const palette = OPTE_DOMAIN_PALETTE[params.colorDomain];
    const midX =
      (src.position[0] + dst.position[0]) * 0.5 + (rand() - 0.5) * (params.isStarburstSpoke ? 1.8 : 9.5);
    const midY =
      (src.position[1] + dst.position[1]) * 0.5 + (rand() - 0.5) * (params.isStarburstSpoke ? 1.8 : 9.5);
    const midZ =
      (src.position[2] + dst.position[2]) * 0.5 + (rand() - 0.5) * (params.isStarburstSpoke ? 1.8 : 9.5);

    const fil: OpteFilament = {
      id: `FIL-${filaments.length + 1}`,
      index: filaments.length,
      sourceId: src.id,
      targetId: dst.id,
      sourceIndex: src.index,
      targetIndex: dst.index,
      protocol: params.protocol,
      colorDomain: params.colorDomain,
      colorHex: palette.hex,
      rgb: palette.rgb,
      socketState: rand() > 0.12 ? 'ESTABLISHED' : 'LISTEN',
      packetRatePps: Math.round(params.packetRatePps),
      bandwidthMBps: Number(params.bandwidthMBps.toFixed(2)),
      bandwidthMbps: Math.round(params.bandwidthMBps * 8),
      latencyMs: Number(params.latencyMs.toFixed(2)),
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

  // ---------------------------------------------------------------------------
  // 1. Create 12 Core Backbone Router Super-Starburst Hubs
  // ---------------------------------------------------------------------------
  const coreHubIds: string[] = [];
  NAMED_CORE_ROUTERS.forEach((router, idx) => {
    const id = router.hostname;
    const domain: OpteColorDomain = idx % 3 === 0 ? 'WHITE_CORE_HUB' : 'BLUE_BACKBONE';
    const pal = OPTE_DOMAIN_PALETTE[domain];
    registerNode({
      id,
      index: nodes.length,
      hostname: router.hostname,
      ipAddress: router.ip,
      asn: router.asn,
      pid: 400 + idx * 17,
      port: router.port,
      hierarchyRole: 'CORE_BACKBONE_ROUTER',
      hierarchyLabel: HIERARCHY_LABELS.CORE_BACKBONE_ROUTER,
      colorDomain: domain,
      colorHex: pal.hex,
      rgb: pal.rgb,
      position: router.pos,
      parentHubId: null,
      degree: 0,
      totalBandwidthMBps: 0,
      totalPacketRatePps: 0,
      isStarburstHub: true,
    });
    coreHubIds.push(id);
  });

  // ---------------------------------------------------------------------------
  // 2. Create 64 Regional / System Process / Subnet / DNS / Cloud Starburst Hubs
  // ---------------------------------------------------------------------------
  const clusterHubIds: string[] = [];
  const totalClusterHubs = 68;

  for (let c = 0; c < totalClusterHubs; c++) {
    const namedService = NAMED_SYSTEM_SERVICES[c];
    const parentCoreId = coreHubIds[c % coreHubIds.length];
    const parentCore = nodeMap.get(parentCoreId)!;

    // Distribute cluster hubs across a wide 3D volume (-82..+82 X, -48..+48 Y, -55..+55 Z)
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(2 * rand() - 1);
    const radius = 14 + rand() * 36;

    const px = parentCore.position[0] + Math.sin(phi) * Math.cos(theta) * radius * 1.25;
    const py = parentCore.position[1] + Math.sin(phi) * Math.sin(theta) * radius * 0.85;
    const pz = parentCore.position[2] + Math.cos(phi) * radius * 1.05;

    let domain: OpteColorDomain;
    let role: NodeHierarchyRole;
    let protocol: OpteProtocol;
    let hostname: string;
    let ipAddress: string;
    let asn: string;
    let pid: number;
    let port: number;

    if (namedService) {
      domain = namedService.domain;
      role = namedService.role;
      protocol = namedService.protocol;
      hostname = namedService.hostname;
      ipAddress = namedService.ip;
      asn = namedService.asn;
      pid = namedService.pid;
      port = namedService.port;
    } else {
      const roll = rand();
      if (roll < 0.28) {
        domain = 'GREEN_IPC_LAN';
        role = c % 2 === 0 ? 'LOCAL_SUBNET_GATEWAY' : 'SYSTEM_PROCESS_SERVICE';
        protocol = 'IPC';
        port = 8080 + (c % 20);
        hostname = `lan-svc-gw-${String(c).padStart(2, '0')}`;
        ipAddress = `10.24.${10 + (c % 40)}.${1 + (c % 120)}`;
        asn = 'AS64512';
      } else if (roll < 0.54) {
        domain = 'BLUE_BACKBONE';
        role = 'CLOUD_CDN_ENDPOINT';
        protocol = 'HTTPS';
        port = 443;
        hostname = `as-transit-pop-${String(c).padStart(2, '0')}`;
        ipAddress = `172.16.${20 + (c % 60)}.${10 + c}`;
        asn = c % 2 === 0 ? 'AS3356' : 'AS15169';
      } else if (roll < 0.78) {
        domain = 'CYAN_UDP_DNS';
        role = c % 3 === 0 ? 'DNS_RESOLVER' : 'SYSTEM_PROCESS_SERVICE';
        protocol = c % 3 === 0 ? 'DNS' : 'UDP';
        port = c % 3 === 0 ? 53 : 5004;
        hostname = c % 3 === 0 ? `dns-resolver-${String(c).padStart(2, '0')}` : `udp-stream-mux-${c}`;
        ipAddress = `10.96.${c % 30}.${53 + (c % 100)}`;
        asn = 'AS13335';
      } else {
        domain = 'CRIMSON_STORAGE_DB';
        role = 'SYSTEM_PROCESS_SERVICE';
        protocol = 'TCP';
        port = c % 2 === 0 ? 5432 : 6800;
        hostname = `storage-shard-${String(c).padStart(2, '0')}`;
        ipAddress = `10.24.${60 + (c % 30)}.${100 + c}`;
        asn = 'AS16509';
      }
      pid = 1200 + c * 43;
    }

    const pal = OPTE_DOMAIN_PALETTE[domain];
    registerNode({
      id: hostname,
      index: nodes.length,
      hostname,
      ipAddress,
      asn,
      pid,
      port,
      hierarchyRole: role,
      hierarchyLabel: HIERARCHY_LABELS[role],
      colorDomain: domain,
      colorHex: pal.hex,
      rgb: pal.rgb,
      position: [px, py, pz],
      parentHubId: parentCoreId,
      degree: 0,
      totalBandwidthMBps: 0,
      totalPacketRatePps: 0,
      isStarburstHub: true,
    });
    clusterHubIds.push(hostname);

    // Connect cluster hub to its parent Core Backbone Router + 2 cross-cluster backbone routes
    addFilament({
      sourceId: parentCoreId,
      targetId: hostname,
      protocol,
      colorDomain: domain,
      isStarburstSpoke: false,
      bandwidthMBps: 24 + rand() * 58,
      packetRatePps: 2800 + rand() * 8200,
      latencyMs: 1.8 + rand() * 6.4,
    });
  }

  // ---------------------------------------------------------------------------
  // 3. Dense Inter-Core & Cross-Cluster Backbone Web (Blue, Green, Cyan, Crimson, White)
  // ---------------------------------------------------------------------------
  for (let i = 0; i < coreHubIds.length; i++) {
    for (let j = i + 1; j < coreHubIds.length; j++) {
      if (rand() < 0.72) {
        const domain: OpteColorDomain =
          (i + j) % 4 === 0
            ? 'WHITE_CORE_HUB'
            : (i + j) % 3 === 0
            ? 'CYAN_UDP_DNS'
            : 'BLUE_BACKBONE';
        addFilament({
          sourceId: coreHubIds[i],
          targetId: coreHubIds[j],
          protocol: domain === 'CYAN_UDP_DNS' ? 'UDP' : 'HTTPS',
          colorDomain: domain,
          isStarburstSpoke: false,
          bandwidthMBps: 45 + rand() * 95,
          packetRatePps: 6500 + rand() * 14000,
          latencyMs: 2.2 + rand() * 8.5,
        });
      }
    }
  }

  // Add 620 long-range cross-constellation filaments weaving between cluster hubs
  for (let k = 0; k < 620; k++) {
    const hubA = clusterHubIds[Math.floor(rand() * clusterHubIds.length)];
    const hubB = clusterHubIds[Math.floor(rand() * clusterHubIds.length)];
    if (hubA === hubB) continue;
    const nodeA = nodeMap.get(hubA)!;

    const protoByDomain: Record<OpteColorDomain, OpteProtocol> = {
      BLUE_BACKBONE: rand() > 0.4 ? 'HTTPS' : 'TCP',
      GREEN_IPC_LAN: 'IPC',
      CYAN_UDP_DNS: rand() > 0.45 ? 'UDP' : 'DNS',
      CRIMSON_STORAGE_DB: 'TCP',
      WHITE_CORE_HUB: 'TCP',
    };

    addFilament({
      sourceId: hubA,
      targetId: hubB,
      protocol: protoByDomain[nodeA.colorDomain],
      colorDomain: nodeA.colorDomain,
      isStarburstSpoke: false,
      bandwidthMBps: 8 + rand() * 48,
      packetRatePps: 900 + rand() * 6400,
      latencyMs: 3.1 + rand() * 14.0,
    });
  }

  // ---------------------------------------------------------------------------
  // 4. Generate 1,050+ Radial Starburst Spoke Leaf Nodes & Dandelion Sub-Twigs
  // ---------------------------------------------------------------------------
  const allStarburstHubs = [...coreHubIds, ...clusterHubIds];
  let leafCounter = 1;

  for (let h = 0; h < allStarburstHubs.length; h++) {
    const hubId = allStarburstHubs[h];
    const hub = nodeMap.get(hubId)!;
    const isCore = hub.hierarchyRole === 'CORE_BACKBONE_ROUTER';
    const spokeCount = isCore ? 24 + Math.floor(rand() * 12) : 12 + Math.floor(rand() * 8);
    const burstRadiusBase = isCore ? 6.5 + rand() * 4.5 : 4.0 + rand() * 3.5;

    for (let s = 0; s < spokeCount; s++) {
      // Uniform spherical radial burst around the hub
      const u = rand();
      const v = rand();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);
      const r = burstRadiusBase * (0.65 + rand() * 0.65);

      const lx = hub.position[0] + r * Math.sin(phi) * Math.cos(theta);
      const ly = hub.position[1] + r * Math.sin(phi) * Math.sin(theta);
      const lz = hub.position[2] + r * Math.cos(phi);

      const leafId = `node-${leafCounter++}`;
      // In Opte maps, many starburst spokes glow bright white or match their cluster's domain color
      const spokeDomain: OpteColorDomain =
        isCore || rand() < 0.48 ? 'WHITE_CORE_HUB' : hub.colorDomain;
      const pal = OPTE_DOMAIN_PALETTE[spokeDomain];

      const protocolMap: Record<OpteColorDomain, OpteProtocol> = {
        BLUE_BACKBONE: 'HTTPS',
        GREEN_IPC_LAN: 'IPC',
        CYAN_UDP_DNS: s % 2 === 0 ? 'DNS' : 'UDP',
        CRIMSON_STORAGE_DB: 'TCP',
        WHITE_CORE_HUB: s % 5 === 0 ? 'ICMP' : 'TCP',
      };

      const oct3 = (h + 10) % 254;
      const oct4 = (s + 20) % 254;

      registerNode({
        id: leafId,
        index: nodes.length,
        hostname: `${hub.hostname}-ep-${String(s + 1).padStart(2, '0')}`,
        ipAddress: `10.${24 + (h % 16)}.${oct3}.${oct4}`,
        asn: hub.asn,
        pid: 10000 + leafCounter * 3,
        port: hub.port,
        hierarchyRole: 'PEER_LEAF_NODE',
        hierarchyLabel: HIERARCHY_LABELS.PEER_LEAF_NODE,
        colorDomain: spokeDomain,
        colorHex: pal.hex,
        rgb: pal.rgb,
        position: [lx, ly, lz],
        parentHubId: hubId,
        degree: 0,
        totalBandwidthMBps: 0,
        totalPacketRatePps: 0,
        isStarburstHub: false,
      });

      addFilament({
        sourceId: hubId,
        targetId: leafId,
        protocol: protocolMap[spokeDomain],
        colorDomain: spokeDomain,
        isStarburstSpoke: true,
        bandwidthMBps: 1.5 + rand() * 18.0,
        packetRatePps: 180 + rand() * 2100,
        latencyMs: 0.4 + rand() * 2.2,
      });

      // Occasional cross-tie between leaf and a neighboring cluster for extra filament density
      if (rand() < 0.22 && clusterHubIds.length > 0) {
        const neighborHub = clusterHubIds[(h + s + 3) % clusterHubIds.length];
        addFilament({
          sourceId: leafId,
          targetId: neighborHub,
          protocol: protocolMap[hub.colorDomain],
          colorDomain: hub.colorDomain,
          isStarburstSpoke: false,
          bandwidthMBps: 2.0 + rand() * 14.0,
          packetRatePps: 240 + rand() * 1600,
          latencyMs: 1.9 + rand() * 4.5,
        });
      }
    }
  }

  return {
    nodes,
    nodeMap,
    filaments,
    adjacencyMap,
  };
}

/**
 * Returns the Live Intercommunication Matrix for a given node ID, sorted by bandwidth descending.
 */
export function getNodePeerMatrix(
  graph: OpteConstellationGraph,
  nodeId: string
): PeerConnectionEntry[] {
  const connectedFilaments = graph.adjacencyMap.get(nodeId) ?? [];
  const entries: PeerConnectionEntry[] = [];

  for (const fil of connectedFilaments) {
    const isOutbound = fil.sourceId === nodeId;
    const peerId = isOutbound ? fil.targetId : fil.sourceId;
    const peerNode = graph.nodeMap.get(peerId);
    if (!peerNode) continue;

    entries.push({
      filamentId: fil.id,
      peerNode,
      direction: fil.socketState === 'ESTABLISHED' ? 'BIDIRECTIONAL' : isOutbound ? 'OUTBOUND' : 'INBOUND',
      protocol: fil.protocol,
      socketState: fil.socketState,
      packetRatePps: fil.packetRatePps,
      bandwidthMBps: fil.bandwidthMBps,
      latencyMs: fil.latencyMs,
      colorDomain: fil.colorDomain,
      colorHex: fil.colorHex,
    });
  }

  return entries.sort((a, b) => b.bandwidthMBps - a.bandwidthMBps);
}

/**
 * Computes the shortest-hop / lowest-latency multi-hop 3D Traceroute path between any two nodes.
 */
export function findMultiHopTraceroute(
  graph: OpteConstellationGraph,
  sourceNodeId: string,
  targetNodeId: string
): TracerouteResult | null {
  const srcNode = graph.nodeMap.get(sourceNodeId);
  const dstNode = graph.nodeMap.get(targetNodeId);
  if (!srcNode || !dstNode) return null;

  if (sourceNodeId === targetNodeId) {
    return {
      sourceNode: srcNode,
      targetNode: dstNode,
      hops: [
        {
          hopNumber: 1,
          node: srcNode,
          filamentFromPrev: null,
          hopLatencyMs: 0,
          cumulativeLatencyMs: 0,
        },
      ],
      filamentIds: new Set(),
      nodeIds: new Set([srcNode.id]),
      totalLatencyMs: 0,
      minBandwidthMBps: srcNode.totalBandwidthMBps,
    };
  }

  // Dijkstra / BFS over adjacencyMap
  const prevNode = new Map<string, string>();
  const prevFilament = new Map<string, OpteFilament>();
  const distLatency = new Map<string, number>();
  const visited = new Set<string>();

  distLatency.set(sourceNodeId, 0);
  const queue: string[] = [sourceNodeId];

  while (queue.length > 0) {
    // Pick unvisited node with minimum cumulative latency
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < queue.length; i++) {
      const d = distLatency.get(queue[i]) ?? Infinity;
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }

    const currentId = queue.splice(bestIdx, 1)[0];
    if (currentId === targetNodeId) break;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const links = graph.adjacencyMap.get(currentId) ?? [];
    for (const fil of links) {
      const neighborId = fil.sourceId === currentId ? fil.targetId : fil.sourceId;
      if (visited.has(neighborId)) continue;

      const candidateDist = bestDist + fil.latencyMs + 1.0; // Slight hop count penalty for realistic router hops
      if (candidateDist < (distLatency.get(neighborId) ?? Infinity)) {
        distLatency.set(neighborId, candidateDist);
        prevNode.set(neighborId, currentId);
        prevFilament.set(neighborId, fil);
        if (!queue.includes(neighborId)) {
          queue.push(neighborId);
        }
      }
    }
  }

  if (!prevNode.has(targetNodeId)) {
    return null;
  }

  // Reconstruct hop chain
  const chainNodeIds: string[] = [];
  let cursor: string | undefined = targetNodeId;
  while (cursor) {
    chainNodeIds.unshift(cursor);
    cursor = prevNode.get(cursor);
  }

  const hops: TracerouteHop[] = [];
  const filamentIds = new Set<string>();
  const nodeIds = new Set<string>();
  let cumulativeMs = 0;
  let minBw = Infinity;

  chainNodeIds.forEach((nId, idx) => {
    const node = graph.nodeMap.get(nId)!;
    nodeIds.add(nId);
    const fil = idx === 0 ? null : prevFilament.get(nId) ?? null;
    if (fil) {
      filamentIds.add(fil.id);
      cumulativeMs = Number((cumulativeMs + fil.latencyMs).toFixed(2));
      minBw = Math.min(minBw, fil.bandwidthMBps);
    }
    hops.push({
      hopNumber: idx + 1,
      node,
      filamentFromPrev: fil,
      hopLatencyMs: fil ? fil.latencyMs : 0,
      cumulativeLatencyMs: cumulativeMs,
    });
  });

  return {
    sourceNode: srcNode,
    targetNode: dstNode,
    hops,
    filamentIds,
    nodeIds,
    totalLatencyMs: cumulativeMs,
    minBandwidthMBps: Number.isFinite(minBw) ? minBw : 0,
  };
}

/**
 * Filters filaments by protocol, Opte color domain, hierarchy role, and minimum bandwidth threshold (Mbps).
 */
export function filterConstellationFilaments(
  graph: OpteConstellationGraph,
  filter: ConstellationFilterState
): OpteFilament[] {
  return graph.filaments.filter((fil) => {
    if (!filter.enabledProtocols[fil.protocol]) return false;
    if (!filter.enabledDomains[fil.colorDomain]) return false;
    if (fil.bandwidthMbps < filter.minBandwidthMbps) return false;

    if (filter.hierarchyFilter !== 'ALL') {
      const src = graph.nodeMap.get(fil.sourceId);
      const dst = graph.nodeMap.get(fil.targetId);
      if (
        src?.hierarchyRole !== filter.hierarchyFilter &&
        dst?.hierarchyRole !== filter.hierarchyFilter
      ) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Searches nodes by hostname, IP address, ASN, PID, or port number.
 */
export function searchNodesByQuery(
  graph: OpteConstellationGraph,
  query: string,
  limit: number = 12
): OpteNode[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return graph.nodes.filter((n) => n.isStarburstHub).slice(0, limit);
  }

  const matches: OpteNode[] = [];
  for (const node of graph.nodes) {
    const portStr = `:${node.port}`;
    const pidStr = `pid ${node.pid}`;
    if (
      node.hostname.toLowerCase().includes(q) ||
      node.ipAddress.toLowerCase().includes(q) ||
      node.asn.toLowerCase().includes(q) ||
      portStr.includes(q) ||
      String(node.port) === q ||
      pidStr.includes(q) ||
      node.hierarchyLabel.toLowerCase().includes(q)
    ) {
      matches.push(node);
      if (matches.length >= limit) break;
    }
  }
  return matches;
}
