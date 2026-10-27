import React, { useMemo, useState } from 'react';
import {
  LiveSystemTelemetrySnapshot,
  TelemetryMode,
} from '../opte/liveSystemTelemetry';
import {
  ConstellationFilterState,
  NodeHierarchyRole,
  OPTE_DOMAIN_PALETTE,
  OpteColorDomain,
  OpteConstellationGraph,
  OpteNode,
  OpteProtocol,
  PeerConnectionEntry,
  TracerouteResult,
  searchNodesByQuery,
} from '../opte/opteGraphGenerator';

interface OpteTelemetryHudProps {
  graph: OpteConstellationGraph;
  liveSnapshot: LiveSystemTelemetrySnapshot | null;
  telemetryMode: TelemetryMode;
  onChangeTelemetryMode: (mode: TelemetryMode) => void;
  onIngestHostSockets: (rawOutput: string, hostLabel: string) => Promise<{ ok: boolean; message: string }>;
  onResetHostIngest: () => Promise<void>;
  selectedNode: OpteNode | null;
  hoveredNode: OpteNode | null;
  peerMatrix: PeerConnectionEntry[];
  activeTraceroute: TracerouteResult | null;
  filterState: ConstellationFilterState;
  visibleFilamentCount: number;
  simSpeed: number;
  onSelectNode: (nodeId: string, flyCamera?: boolean) => void;
  onClearSelection: () => void;
  onRunTraceroute: (sourceId: string, targetId: string) => void;
  onClearTraceroute: () => void;
  onUpdateFilter: (next: ConstellationFilterState) => void;
  onResetFilters: () => void;
  onChangeSimSpeed: (speed: number) => void;
  onResetCameraOverview: () => void;
}

const ALL_PROTOCOLS: OpteProtocol[] = ['TCP', 'HTTPS', 'IPC', 'UDP', 'DNS', 'ICMP'];

const ALL_DOMAINS: OpteColorDomain[] = [
  'BLUE_BACKBONE',
  'GREEN_IPC_LAN',
  'CYAN_UDP_DNS',
  'CRIMSON_STORAGE_DB',
  'WHITE_CORE_HUB',
];

const HIERARCHY_OPTIONS: { value: 'ALL' | NodeHierarchyRole; label: string }[] = [
  { value: 'ALL', label: 'All Cluster Hierarchies' },
  { value: 'CORE_BACKBONE_ROUTER', label: 'Core Backbone / Kernel Core' },
  { value: 'SYSTEM_PROCESS_SERVICE', label: 'Live OS Processes & Services' },
  { value: 'LOCAL_SUBNET_GATEWAY', label: 'Network Interfaces & Gateways' },
  { value: 'DNS_RESOLVER', label: 'DNS Resolvers' },
  { value: 'CLOUD_CDN_ENDPOINT', label: 'Cloud / Remote Peers' },
  { value: 'PEER_LEAF_NODE', label: 'Socket & FD Leaf Endpoints' },
];

export const OpteTelemetryHud: React.FC<OpteTelemetryHudProps> = ({
  graph,
  liveSnapshot,
  telemetryMode,
  onChangeTelemetryMode,
  onIngestHostSockets,
  onResetHostIngest,
  selectedNode,
  hoveredNode,
  peerMatrix,
  activeTraceroute,
  filterState,
  visibleFilamentCount,
  simSpeed,
  onSelectNode,
  onClearSelection,
  onRunTraceroute,
  onClearTraceroute,
  onUpdateFilter,
  onResetFilters,
  onChangeSimSpeed,
  onResetCameraOverview,
}) => {
  const [hudHidden, setHudHidden] = useState(false);
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);

  // Host Netstat / SS / LSOF Ingestion Modal state
  const [ingestModalOpen, setIngestModalOpen] = useState(false);
  const [ingestHostLabel, setIngestHostLabel] = useState('MY-WORKSTATION');
  const [ingestRawText, setIngestRawText] = useState('');
  const [ingestStatus, setIngestStatus] = useState<string | null>(null);

  const starburstHubs = useMemo(
    () => graph.nodes.filter((n) => n.isStarburstHub),
    [graph.nodes]
  );

  // Traceroute source & destination selectors (default to live OS nodes if present)
  const defaultSourceId = useMemo(() => {
    const liveKernel = graph.nodes.find((n) => n.id.startsWith('host-kernel-'));
    return liveKernel?.id ?? starburstHubs[0]?.id ?? 'core-rtr-01';
  }, [graph.nodes, starburstHubs]);

  const defaultTargetId = useMemo(() => {
    const liveProc = graph.nodes.find((n) => n.id.startsWith('pid-'));
    if (liveProc && liveProc.id !== defaultSourceId) return liveProc.id;
    return graph.nodeMap.has('postgres-db')
      ? 'postgres-db'
      : starburstHubs[Math.min(2, starburstHubs.length - 1)]?.id ?? 'core-rtr-02';
  }, [graph.nodes, graph.nodeMap, starburstHubs, defaultSourceId]);

  const [traceSourceId, setTraceSourceId] = useState<string>('');
  const [traceTargetId, setTraceTargetId] = useState<string>('');

  const effectiveSourceId =
    traceSourceId && graph.nodeMap.has(traceSourceId) ? traceSourceId : defaultSourceId;
  const effectiveTargetId =
    traceTargetId && graph.nodeMap.has(traceTargetId) ? traceTargetId : defaultTargetId;

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return searchNodesByQuery(graph, searchQuery, 10);
  }, [graph, searchQuery]);

  const toggleProtocol = (proto: OpteProtocol) => {
    onUpdateFilter({
      ...filterState,
      enabledProtocols: {
        ...filterState.enabledProtocols,
        [proto]: !filterState.enabledProtocols[proto],
      },
    });
  };

  const toggleDomain = (domain: OpteColorDomain) => {
    onUpdateFilter({
      ...filterState,
      enabledDomains: {
        ...filterState.enabledDomains,
        [domain]: !filterState.enabledDomains[domain],
      },
    });
  };

  const handleLoadSampleHostNetstat = () => {
    setIngestHostLabel('DEV-WORKSTATION-LIVE');
    setIngestRawText(
      [
        'tcp   ESTAB   0   0   192.168.1.42:54310   142.250.190.46:443   users:(("chrome",pid=4120,fd=38))',
        'tcp   ESTAB   0   0   192.168.1.42:54318   140.82.112.4:443     users:(("code",pid=3812,fd=24))',
        'tcp   ESTAB   0   0   192.168.1.42:54390   104.16.132.229:443   users:(("node",pid=5210,fd=19))',
        'tcp   ESTAB   0   0   127.0.0.1:51244      127.0.0.1:5432       users:(("postgres",pid=2190,fd=12))',
        'tcp   ESTAB   0   0   127.0.0.1:51280      127.0.0.1:6379       users:(("redis-server",pid=2410,fd=9))',
        'udp   UNCONN  0   0   192.168.1.42:58122   1.1.1.1:53           users:(("systemd-resolve",pid=612,fd=14))',
        'udp   UNCONN  0   0   192.168.1.42:59401   8.8.8.8:53           users:(("systemd-resolve",pid=612,fd=15))',
        'tcp   LISTEN  0   128 0.0.0.0:3000         0.0.0.0:*            users:(("tsx",pid=5001,fd=21))',
        'tcp   LISTEN  0   128 127.0.0.1:5432       0.0.0.0:*            users:(("postgres",pid=2190,fd=6))',
      ].join('\n')
    );
  };

  const inspectedNode = selectedNode;

  if (hudHidden) {
    return (
      <div className="pointer-events-none fixed inset-0 z-20 flex items-start justify-end p-4">
        <button
          type="button"
          onClick={() => setHudHidden(false)}
          className="pointer-events-auto border border-slate-700 bg-[#05080f]/95 px-3.5 py-2 font-mono text-xs font-medium tracking-wider text-cyan-300 uppercase transition hover:border-cyan-400 hover:text-white"
        >
          Show Live Telemetry HUD ({graph.nodes.length.toLocaleString()} Nodes)
        </button>
      </div>
    );
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between p-2.5 select-none">
      {/* TOP BAR: Live Kernel Status, Telemetry Mode Selector, Search & Controls */}
      <header className="pointer-events-auto flex items-center justify-between gap-1.5 border border-slate-800/90 bg-[#05080f]/95 px-2.5 py-1.5">
        {/* Left Brand & Live OS Telemetry Status */}
        <div className="flex items-center gap-2 shrink-0">
          <div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 bg-emerald-400" />
              <h1 className="font-mono text-[11px] font-bold tracking-wider text-white uppercase">
                OPTE // LIVE KERNEL &amp; SOCKET CONSTELLATION
              </h1>
            </div>
            <div className="flex items-center gap-1.5 font-mono text-[10px] text-slate-400 tabular-nums">
              <span className="text-emerald-400 font-semibold">
                ● LIVE /proc/net
              </span>
              {liveSnapshot && (
                <>
                  <span>• {liveSnapshot.hostname}</span>
                  <span>• {liveSnapshot.processes.length} Procs</span>
                  <span>• {liveSnapshot.sockets.length} Sockets</span>
                </>
              )}
            </div>
          </div>

          {/* Telemetry Mode Switcher */}
          <div className="flex items-center border border-slate-800 bg-[#020408] p-0.5 font-mono text-[10px]">
            <button
              type="button"
              onClick={() => onChangeTelemetryMode('LIVE_HYBRID_OPTE')}
              className={`px-2 py-1 transition ${
                telemetryMode === 'LIVE_HYBRID_OPTE'
                  ? 'border border-emerald-500/60 bg-emerald-500/20 text-emerald-300 font-semibold'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Anchors real live /proc/net sockets & OS processes at the center of the full Opte starburst topology"
            >
              LIVE OS + OPTE
            </button>
            <button
              type="button"
              onClick={() => onChangeTelemetryMode('LIVE_STRICT_OS')}
              className={`px-2 py-1 transition ${
                telemetryMode === 'LIVE_STRICT_OS'
                  ? 'border border-cyan-500/60 bg-cyan-500/20 text-cyan-200 font-semibold'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Shows strictly 100% real OS processes, /proc/net kernel sockets, and live network interfaces"
            >
              STRICT LIVE OS
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              setIngestStatus(null);
              setIngestModalOpen(true);
            }}
            className="border border-cyan-500/60 bg-cyan-500/15 px-2 py-1 font-mono text-[10px] font-semibold text-cyan-200 transition hover:bg-cyan-500/25 hover:text-white"
          >
            + Stream My PC (netstat/ss)
          </button>
        </div>

        {/* Center Live Node / IP / Port / Service Search */}
        <div className="relative w-48 shrink-0">
          <div className="flex items-center border border-slate-700/90 bg-[#020408]">
            <span className="px-2 font-mono text-[10px] text-slate-500">LOCATE</span>
            <input
              type="text"
              value={searchQuery}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 180)}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="IP, Host, :Port, PID (e.g. node, :3000)..."
              aria-label="Search network nodes by IP, hostname, port, PID, or ASN"
              className="w-full bg-transparent px-1.5 py-1 font-mono text-xs text-white placeholder-slate-500 focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="px-2 font-mono text-xs text-slate-400 hover:text-white"
              >
                ×
              </button>
            )}
          </div>

          {/* Search Dropdown Results */}
          {(searchFocused || searchQuery.trim().length > 0) && searchResults.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-64 overflow-y-auto border border-slate-700 bg-[#05080f] shadow-2xl">
              {searchResults.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  onMouseDown={() => {
                    onSelectNode(node.id, true);
                    setRightPanelOpen(true);
                    setSearchQuery('');
                    setSearchFocused(false);
                  }}
                  className="flex w-full items-center justify-between border-b border-slate-800/80 px-3 py-2 text-left font-mono text-xs transition hover:bg-slate-800/80"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="inline-block h-2 w-2 shrink-0"
                      style={{ backgroundColor: node.colorHex }}
                    />
                    <span className="truncate font-semibold text-white">{node.hostname}</span>
                    <span className="shrink-0 text-slate-400">
                      [{node.ipAddress}:{node.port}]
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 text-[10px] text-slate-400 tabular-nums">
                    <span className="text-cyan-300">PID {node.pid}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right Speed & View Controls */}
        <div className="flex items-center gap-1.5 shrink-0 font-mono text-xs">
          <div className="flex items-center border border-slate-800 bg-[#020408] p-0.5">
            {[
              { label: 'PAUSE', val: 0 },
              { label: '0.2x', val: 0.2 },
              { label: '1x', val: 1 },
              { label: '2x', val: 2 },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => onChangeSimSpeed(item.val)}
                className={`px-1.5 py-1 text-[10px] transition ${
                  simSpeed === item.val
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onResetCameraOverview}
            className="border border-slate-700 bg-[#0a0f1c] px-2 py-1 text-[11px] text-slate-200 transition hover:border-cyan-400 hover:text-white"
          >
            Macro View
          </button>

          <button
            type="button"
            onClick={() => setHudHidden(true)}
            className="border border-slate-800 bg-[#0a0f1c] px-2 py-1 text-[11px] text-slate-400 transition hover:border-slate-600 hover:text-white"
          >
            Hide HUD
          </button>
        </div>
      </header>

      {/* MIDDLE WORKSPACE: Left Live Kernel & 3D Traceroute Panel | Right Node/Socket Matrix Inspector */}
      <div className="my-2 flex flex-1 items-start justify-between gap-3 overflow-hidden">
        {/* LEFT PANEL: Live Kernel Socket Feed & End-to-End 3D Path Tracer */}
        <aside className="pointer-events-auto flex max-h-full w-80 shrink-0 flex-col border border-slate-800/90 bg-[#05080f]/95">
          <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 bg-emerald-400" />
              <h2 className="font-mono text-xs font-bold tracking-wider text-white uppercase">
                Live Kernel &amp; 3D Path Tracer
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setLeftPanelOpen(!leftPanelOpen)}
              className="font-mono text-[11px] text-slate-400 hover:text-white"
            >
              {leftPanelOpen ? '[Collapse]' : '[Expand]'}
            </button>
          </div>

          {leftPanelOpen && (
            <div className="flex flex-col gap-2.5 overflow-y-auto p-3 font-mono text-xs">
              {/* Real-Time Kernel & Interface Hardware Readout */}
              {liveSnapshot && (
                <div className="border border-emerald-500/30 bg-[#040b14] p-2">
                  <div className="flex items-center justify-between text-[10px] text-emerald-300 uppercase">
                    <span>Kernel {liveSnapshot.kernelRelease}</span>
                    <span>
                      RAM {liveSnapshot.usedMemMB}/{liveSnapshot.totalMemMB} MB
                    </span>
                  </div>
                  <div className="mt-1.5 space-y-1">
                    {liveSnapshot.interfaces.slice(0, 3).map((nic) => (
                      <button
                        key={nic.name}
                        type="button"
                        onClick={() => onSelectNode(`iface-${nic.name}`, true)}
                        className="flex w-full items-center justify-between border border-slate-800/80 bg-[#020408] px-2 py-1 text-left text-[10px] hover:border-cyan-400"
                      >
                        <div>
                          <span className="font-bold text-white">{nic.name}</span>{' '}
                          <span className="text-slate-400">[{nic.ipv4}]</span>
                        </div>
                        <div className="text-right tabular-nums">
                          <span className="text-emerald-400">
                            RX {(nic.rxBytes / (1024 * 1024)).toFixed(1)}MB
                          </span>{' '}
                          <span className="text-cyan-300">
                            TX {(nic.txBytes / (1024 * 1024)).toFixed(1)}MB
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Source & Target Selectors */}
              <div className="grid grid-cols-1 gap-2">
                <div>
                  <label className="mb-1 block text-[10px] text-slate-400 uppercase">
                    Source Node (Origin Host / Process)
                  </label>
                  <select
                    aria-label="Traceroute Source Node"
                    value={effectiveSourceId}
                    onChange={(e) => setTraceSourceId(e.target.value)}
                    className="w-full border border-slate-700 bg-[#020408] px-2 py-1.5 text-xs text-white focus:border-cyan-400 focus:outline-none"
                  >
                    {starburstHubs.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.hostname} [{h.ipAddress}:{h.port}]
                      </option>
                    ))}
                    {selectedNode && !selectedNode.isStarburstHub && (
                      <option value={selectedNode.id}>
                        {selectedNode.hostname} [{selectedNode.ipAddress}:{selectedNode.port}]
                      </option>
                    )}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-[10px] text-slate-400 uppercase">
                    Destination Node (Target Endpoint)
                  </label>
                  <select
                    aria-label="Traceroute Destination Node"
                    value={effectiveTargetId}
                    onChange={(e) => setTraceTargetId(e.target.value)}
                    className="w-full border border-slate-700 bg-[#020408] px-2 py-1.5 text-xs text-white focus:border-cyan-400 focus:outline-none"
                  >
                    {starburstHubs.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.hostname} [{h.ipAddress}:{h.port}]
                      </option>
                    ))}
                    {selectedNode && !selectedNode.isStarburstHub && (
                      <option value={selectedNode.id}>
                        {selectedNode.hostname} [{selectedNode.ipAddress}:{selectedNode.port}]
                      </option>
                    )}
                  </select>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onRunTraceroute(effectiveSourceId, effectiveTargetId)}
                  className="flex-1 border border-cyan-500/70 bg-cyan-500/15 px-3 py-1.5 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-500/25 hover:text-white"
                >
                  Illuminate 3D Route
                </button>
                {activeTraceroute && (
                  <button
                    type="button"
                    onClick={onClearTraceroute}
                    className="border border-slate-700 bg-[#0a0f1c] px-2.5 py-1.5 text-xs text-slate-300 hover:border-slate-500 hover:text-white"
                  >
                    Clear
                  </button>
                )}
              </div>

              {/* Quick Live OS & Constellation Stream Presets */}
              <div className="border-t border-slate-800/80 pt-2">
                <span className="mb-1.5 block text-[10px] text-slate-500 uppercase">
                  Quick Live OS &amp; Hop Presets
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const src = defaultSourceId;
                      const dst = defaultTargetId;
                      setTraceSourceId(src);
                      setTraceTargetId(dst);
                      onRunTraceroute(src, dst);
                    }}
                    className="border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-300 hover:border-emerald-400 hover:text-white"
                  >
                    Live Kernel → Active PID
                  </button>
                  {graph.nodeMap.has('kube-apiserver') && graph.nodeMap.has('postgres-db') && (
                    <button
                      type="button"
                      onClick={() => {
                        setTraceSourceId('kube-apiserver');
                        setTraceTargetId('postgres-db');
                        onRunTraceroute('kube-apiserver', 'postgres-db');
                      }}
                      className="border border-slate-800 bg-[#0a0f1c] px-2 py-1 text-[10px] text-slate-300 hover:border-cyan-500/50 hover:text-white"
                    >
                      kube-api → postgres:5432
                    </button>
                  )}
                  {graph.nodeMap.has('systemd-resolved') && graph.nodeMap.has('cdn-edge-pop-01') && (
                    <button
                      type="button"
                      onClick={() => {
                        setTraceSourceId('systemd-resolved');
                        setTraceTargetId('cdn-edge-pop-01');
                        onRunTraceroute('systemd-resolved', 'cdn-edge-pop-01');
                      }}
                      className="border border-slate-800 bg-[#0a0f1c] px-2 py-1 text-[10px] text-slate-300 hover:border-cyan-500/50 hover:text-white"
                    >
                      systemd-dns:53 → cdn-edge:443
                    </button>
                  )}
                </div>
              </div>

              {/* Active Traceroute Breakdown */}
              {activeTraceroute ? (
                <div className="border-t border-slate-800 pt-2.5">
                  <div className="mb-2 flex items-center justify-between border border-cyan-500/40 bg-[#0a1324] px-2.5 py-1.5">
                    <div>
                      <div className="text-[10px] text-cyan-300 uppercase">
                        Isolated Path ({activeTraceroute.hops.length} Hops)
                      </div>
                      <div className="text-xs font-bold text-white tabular-nums">
                        Total RTT: {activeTraceroute.totalLatencyMs.toFixed(2)} ms
                      </div>
                    </div>
                    <div className="text-right tabular-nums">
                      <div className="text-[10px] text-slate-400">Min Pipe</div>
                      <div className="text-xs font-semibold text-emerald-400">
                        {activeTraceroute.minBandwidthMBps.toFixed(1)} MB/s
                      </div>
                    </div>
                  </div>

                  <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
                    {activeTraceroute.hops.map((hop) => (
                      <button
                        key={hop.node.id}
                        type="button"
                        onClick={() => onSelectNode(hop.node.id, true)}
                        className="flex w-full items-start justify-between border border-slate-800/90 bg-[#020408] p-2 text-left transition hover:border-cyan-400"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="bg-cyan-500/20 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300 tabular-nums">
                              #{hop.hopNumber}
                            </span>
                            <span
                              className="inline-block h-2 w-2 shrink-0"
                              style={{ backgroundColor: hop.node.colorHex }}
                            />
                            <span className="truncate font-semibold text-white">
                              {hop.node.hostname}
                            </span>
                          </div>
                          <div className="mt-0.5 text-[10px] text-slate-400 tabular-nums">
                            {hop.node.ipAddress}:{hop.node.port} • {hop.node.asn}
                          </div>
                        </div>

                        <div className="shrink-0 text-right tabular-nums">
                          {hop.filamentFromPrev ? (
                            <>
                              <div className="text-[10px] font-semibold text-emerald-400">
                                +{hop.hopLatencyMs.toFixed(2)} ms
                              </div>
                              <div className="text-[10px] text-slate-400">
                                Σ {hop.cumulativeLatencyMs.toFixed(2)} ms (
                                {hop.filamentFromPrev.protocol})
                              </div>
                            </>
                          ) : (
                            <span className="text-[10px] text-cyan-300 uppercase">ORIGIN</span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="border border-slate-800/70 bg-[#020408] p-2 text-[11px] text-slate-400">
                  Click <span className="text-emerald-300">Live Kernel → Active PID</span> or{' '}
                  <span className="text-cyan-300">Trace</span> on any live socket in the matrix to
                  illuminate its multi-hop route in 3D.
                </div>
              )}
            </div>
          )}
        </aside>

        {/* CENTER HOVER BADGE */}
        {hoveredNode && (!selectedNode || hoveredNode.id !== selectedNode.id) && (
          <div className="pointer-events-none mx-auto mt-1 border border-slate-700 bg-[#05080f]/95 px-3 py-1.5 font-mono text-xs shadow-lg">
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-2 w-2"
                style={{ backgroundColor: hoveredNode.colorHex }}
              />
              <span className="font-bold text-white">{hoveredNode.hostname}</span>
              <span className="text-cyan-300 tabular-nums">
                [{hoveredNode.ipAddress}:{hoveredNode.port}]
              </span>
              <span className="text-slate-400">{hoveredNode.hierarchyLabel}</span>
              <span className="text-emerald-400 tabular-nums">
                {hoveredNode.totalBandwidthMBps.toFixed(1)} MB/s
              </span>
            </div>
          </div>
        )}

        {/* RIGHT PANEL: Node & Cluster Inspector + Live Intercommunication Matrix */}
        <aside className="pointer-events-auto flex max-h-full w-[442px] shrink-0 flex-col border border-slate-800/90 bg-[#05080f]/95">
          <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-2 w-2"
                style={{ backgroundColor: inspectedNode?.colorHex ?? '#38bdf8' }}
              />
              <h2 className="font-mono text-xs font-bold tracking-wider text-white uppercase">
                Node &amp; Socket Matrix Inspector
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {selectedNode && (
                <button
                  type="button"
                  onClick={onClearSelection}
                  className="font-mono text-[11px] text-cyan-300 hover:text-white"
                >
                  [Unfocus]
                </button>
              )}
              <button
                type="button"
                onClick={() => setRightPanelOpen(!rightPanelOpen)}
                className="font-mono text-[11px] text-slate-400 hover:text-white"
              >
                {rightPanelOpen ? '[Collapse]' : '[Expand]'}
              </button>
            </div>
          </div>

          {rightPanelOpen && inspectedNode && (
            <div className="flex flex-col gap-2.5 overflow-y-auto p-3 font-mono text-xs">
              {/* Node Identity Metadata Block */}
              <div className="border border-slate-800 bg-[#020408] p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white">{inspectedNode.hostname}</span>
                      <span className="border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[10px] text-cyan-300">
                        {inspectedNode.asn}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      {inspectedNode.hierarchyLabel}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelectNode(inspectedNode.id, true)}
                    className="border border-cyan-500/50 bg-cyan-500/10 px-2 py-1 text-[10px] text-cyan-300 hover:bg-cyan-500/20 hover:text-white"
                  >
                    Fly To Cluster
                  </button>
                </div>

                <div className="mt-2 grid grid-cols-3 gap-2 border-t border-slate-800/80 pt-2 tabular-nums">
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase">IP : Port</div>
                    <div className="font-semibold text-white">
                      {inspectedNode.ipAddress}:{inspectedNode.port}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase">Process PID</div>
                    <div className="font-semibold text-cyan-300">
                      PID {inspectedNode.pid} (:{inspectedNode.port})
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase">Active Spokes</div>
                    <div className="font-semibold text-white">{inspectedNode.degree} peers</div>
                  </div>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-2 border-t border-slate-800/80 pt-2 tabular-nums">
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase">Aggregate I/O</div>
                    <div className="font-bold text-emerald-400">
                      {inspectedNode.totalBandwidthMBps.toFixed(2)} MB/s
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase">Packet Throughput</div>
                    <div className="font-bold text-blue-400">
                      {inspectedNode.totalPacketRatePps.toLocaleString()} pkt/s
                    </div>
                  </div>
                </div>

                {/* Quick Traceroute Bindings */}
                <div className="mt-2 flex items-center gap-1.5 border-t border-slate-800/80 pt-2">
                  <button
                    type="button"
                    onClick={() => setTraceSourceId(inspectedNode.id)}
                    className="flex-1 border border-slate-700 bg-[#0a0f1c] py-1 text-[10px] text-slate-300 hover:border-cyan-400 hover:text-white"
                  >
                    Set Trace Origin
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTraceTargetId(inspectedNode.id);
                      onRunTraceroute(effectiveSourceId, inspectedNode.id);
                      setLeftPanelOpen(true);
                    }}
                    className="flex-1 border border-slate-700 bg-[#0a0f1c] py-1 text-[10px] text-cyan-300 hover:border-cyan-400 hover:text-white"
                  >
                    Trace From Origin → Here
                  </button>
                </div>
              </div>

              {/* Live Intercommunication Matrix Table */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[10px] font-bold tracking-wider text-slate-300 uppercase">
                    Live Intercommunication Matrix ({peerMatrix.length} Sockets)
                  </span>
                  <span className="text-[10px] text-slate-500">Click Peer or Trace</span>
                </div>

                <div className="max-h-72 overflow-y-auto border border-slate-800 bg-[#020408]">
                  <table className="w-full table-fixed border-collapse text-left font-mono text-[10px] tabular-nums">
                    <thead>
                      <tr className="border-b border-slate-800 bg-[#080d1a] text-[9px] text-slate-400 uppercase">
                        <th className="w-[138px] py-1.5 pl-2">Peer Host / IP:Port</th>
                        <th className="w-[46px] px-1 py-1.5">Proto</th>
                        <th className="w-[78px] px-1 py-1.5">Socket</th>
                        <th className="w-[46px] px-1 py-1.5 text-right">MB/s</th>
                        <th className="w-[46px] px-1 py-1.5 text-right">RTT</th>
                        <th className="w-[52px] py-1.5 pr-2 text-right">Path</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {peerMatrix.slice(0, 45).map((entry) => (
                        <tr
                          key={entry.filamentId}
                          className="transition hover:bg-slate-800/60"
                        >
                          <td className="py-1.5 pl-2">
                            <button
                              type="button"
                              onClick={() => onSelectNode(entry.peerNode.id, true)}
                              className="w-full text-left hover:text-cyan-300"
                            >
                              <div className="flex items-center gap-1 font-semibold text-white">
                                <span
                                  className="inline-block h-1.5 w-1.5 shrink-0"
                                  style={{ backgroundColor: entry.colorHex }}
                                />
                                <span className="truncate">{entry.peerNode.hostname}</span>
                              </div>
                              <div className="truncate text-[9px] text-slate-400">
                                {entry.peerNode.ipAddress}:{entry.peerNode.port}
                              </div>
                            </button>
                          </td>
                          <td className="px-1 py-1.5">
                            <span className="border border-slate-700 px-1 py-0.5 text-[9px] text-cyan-200">
                              {entry.protocol}
                            </span>
                          </td>
                          <td className="px-1 py-1.5">
                            <span
                              className={`text-[9px] font-medium ${
                                entry.socketState === 'ESTABLISHED'
                                  ? 'text-emerald-400'
                                  : 'text-amber-300'
                              }`}
                            >
                              {entry.socketState}
                            </span>
                            <div className="text-[9px] text-slate-500">
                              {entry.packetRatePps.toLocaleString()} pps
                            </div>
                          </td>
                          <td className="px-1 py-1.5 text-right font-semibold text-white">
                            {entry.bandwidthMBps.toFixed(1)}
                          </td>
                          <td className="px-1 py-1.5 text-right text-slate-300">
                            {entry.latencyMs.toFixed(1)}ms
                          </td>
                          <td className="py-1.5 pr-2 text-right">
                            <button
                              type="button"
                              onClick={() => {
                                setTraceSourceId(inspectedNode.id);
                                setTraceTargetId(entry.peerNode.id);
                                onRunTraceroute(inspectedNode.id, entry.peerNode.id);
                                setLeftPanelOpen(true);
                              }}
                              className="border border-cyan-500/40 bg-cyan-500/10 px-1.5 py-0.5 text-[9px] text-cyan-300 hover:bg-cyan-500/25 hover:text-white"
                            >
                              Trace
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* HOST PC NETSTAT / SS / LSOF STREAM & INGESTION MODAL */}
      {ingestModalOpen && (
        <div className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-2xl border border-slate-700 bg-[#05080f] p-4 font-mono text-xs shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <div>
                <h3 className="text-sm font-bold text-white uppercase">
                  Stream or Paste Your Local Machine&apos;s Live Socket Table
                </h3>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  Pipe live output from Linux <span className="text-cyan-300">ss -tupn</span>,
                  Windows <span className="text-cyan-300">netstat -ano</span>, or macOS{' '}
                  <span className="text-cyan-300">lsof -i -n -P</span> directly into the 3D
                  constellation.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIngestModalOpen(false)}
                className="border border-slate-700 px-2 py-1 text-slate-400 hover:text-white"
              >
                Close [×]
              </button>
            </div>

            <div className="mt-3 space-y-3">
              <div className="border border-slate-800 bg-[#020408] p-2.5 text-[11px] text-slate-300">
                <div className="mb-1 text-[10px] font-bold text-cyan-300 uppercase">
                  Option 1 — Run in your terminal &amp; paste output below:
                </div>
                <div className="grid grid-cols-3 gap-2 text-[10px]">
                  <div className="border border-slate-800 p-1.5">
                    <span className="text-slate-500">Linux:</span>{' '}
                    <code className="text-emerald-300">ss -tupn</code>
                  </div>
                  <div className="border border-slate-800 p-1.5">
                    <span className="text-slate-500">Windows:</span>{' '}
                    <code className="text-emerald-300">netstat -ano</code>
                  </div>
                  <div className="border border-slate-800 p-1.5">
                    <span className="text-slate-500">macOS:</span>{' '}
                    <code className="text-emerald-300">lsof -i -n -P</code>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-1">
                  <label className="text-[10px] text-slate-400 uppercase">Host Label:</label>
                  <input
                    type="text"
                    value={ingestHostLabel}
                    onChange={(e) => setIngestHostLabel(e.target.value)}
                    className="border border-slate-700 bg-[#020408] px-2 py-1 text-xs text-white focus:border-cyan-400 focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleLoadSampleHostNetstat}
                  className="border border-slate-700 bg-[#0a0f1c] px-2.5 py-1 text-[11px] text-cyan-300 hover:border-cyan-400 hover:text-white"
                >
                  Load Example Workstation Output
                </button>
              </div>

              <textarea
                rows={7}
                value={ingestRawText}
                onChange={(e) => setIngestRawText(e.target.value)}
                placeholder="Paste output from `ss -tupn`, `netstat -ano`, or `lsof -i -n -P` here..."
                className="w-full border border-slate-700 bg-[#020408] p-2.5 font-mono text-[11px] text-emerald-300 placeholder-slate-600 focus:border-cyan-400 focus:outline-none"
              />

              {ingestStatus && (
                <div className="border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200">
                  {ingestStatus}
                </div>
              )}

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={async () => {
                    await onResetHostIngest();
                    setIngestStatus('Reset to server kernel /proc/net telemetry.');
                  }}
                  className="border border-slate-700 bg-[#0a0f1c] px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 hover:text-white"
                >
                  Reset to Default Kernel Telemetry
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIngestModalOpen(false)}
                    className="border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const res = await onIngestHostSockets(ingestRawText, ingestHostLabel);
                      setIngestStatus(res.message);
                      if (res.ok) {
                        setTimeout(() => setIngestModalOpen(false), 600);
                      }
                    }}
                    className="border border-emerald-500/70 bg-emerald-500/20 px-4 py-1.5 text-xs font-bold text-emerald-200 hover:bg-emerald-500/30 hover:text-white"
                  >
                    Project Live Sockets in 3D
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* BOTTOM BAR: Opte Domain Color Key, Protocol Toggles, Cluster Hierarchy & Volume Filter */}
      <footer className="pointer-events-auto flex flex-wrap items-center justify-between gap-2 border border-slate-800/90 bg-[#05080f]/95 px-3 py-1.5 font-mono text-xs">
        {/* Opte Network Domain Color Toggles */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[10px] text-slate-400 uppercase">Opte Domains:</span>
          {ALL_DOMAINS.map((domain) => {
            const info = OPTE_DOMAIN_PALETTE[domain];
            const active = filterState.enabledDomains[domain];
            return (
              <button
                key={domain}
                type="button"
                onClick={() => toggleDomain(domain)}
                title={info.label}
                className={`flex items-center gap-1.5 border px-2 py-1 text-[11px] transition ${
                  active
                    ? 'border-slate-600 bg-[#0c1424] text-white'
                    : 'border-slate-800/70 bg-[#020408] text-slate-500 opacity-55'
                }`}
              >
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0"
                  style={{ backgroundColor: info.hex }}
                />
                <span>{info.shortLabel}</span>
              </button>
            );
          })}
        </div>

        {/* Protocol Filter Toggles */}
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-[10px] text-slate-400 uppercase">Protocols:</span>
          {ALL_PROTOCOLS.map((proto) => {
            const active = filterState.enabledProtocols[proto];
            return (
              <button
                key={proto}
                type="button"
                onClick={() => toggleProtocol(proto)}
                className={`border px-2 py-1 text-[11px] transition ${
                  active
                    ? 'border-cyan-500/60 bg-cyan-500/15 text-cyan-200'
                    : 'border-slate-800 bg-[#020408] text-slate-500'
                }`}
              >
                {proto}
              </button>
            );
          })}
        </div>

        {/* Cluster Hierarchy Selector & Bandwidth Volume Slider */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <label htmlFor="hierarchy-select" className="text-[10px] text-slate-400 uppercase">
              Cluster:
            </label>
            <select
              id="hierarchy-select"
              value={filterState.hierarchyFilter}
              onChange={(e) =>
                onUpdateFilter({
                  ...filterState,
                  hierarchyFilter: e.target.value as 'ALL' | NodeHierarchyRole,
                })
              }
              className="border border-slate-700 bg-[#020408] px-2 py-1 text-[11px] text-white focus:border-cyan-400 focus:outline-none"
            >
              {HIERARCHY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 tabular-nums">
            <label htmlFor="volume-slider" className="text-[10px] text-slate-400 uppercase">
              Min Volume: {filterState.minBandwidthMbps} Mbps
            </label>
            <input
              id="volume-slider"
              type="range"
              min={0}
              max={400}
              step={20}
              value={filterState.minBandwidthMbps}
              onChange={(e) =>
                onUpdateFilter({
                  ...filterState,
                  minBandwidthMbps: Number(e.target.value),
                })
              }
              className="w-24 accent-cyan-400"
            />
          </div>

          <button
            type="button"
            onClick={onResetFilters}
            className="border border-slate-700 bg-[#0a0f1c] px-2 py-1 text-[11px] text-slate-300 hover:border-cyan-400 hover:text-white"
          >
            Reset Filters
          </button>
        </div>
      </footer>
    </div>
  );
};
