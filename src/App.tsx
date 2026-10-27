import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CameraTargetCommand,
  OpteConstellationCanvas,
} from './components/OpteConstellationCanvas';
import { OpteTelemetryHud } from './components/OpteTelemetryHud';
import {
  LiveKernelSocket,
  LiveSystemTelemetrySnapshot,
  TelemetryMode,
  buildLiveSystemConstellation,
} from './opte/liveSystemTelemetry';
import {
  ConstellationFilterState,
  TracerouteResult,
  filterConstellationFilaments,
  findMultiHopTraceroute,
  generateOpteConstellation,
  getNodePeerMatrix,
} from './opte/opteGraphGenerator';

function createDefaultFilterState(): ConstellationFilterState {
  return {
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
}

function collectBrowserPerformanceSockets(): LiveKernelSocket[] {
  if (typeof window === 'undefined' || !window.performance?.getEntriesByType) {
    return [];
  }
  const entries = window.performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  const sockets: LiveKernelSocket[] = [];
  const seenHosts = new Set<string>();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    try {
      const url = new URL(entry.name, window.location.origin);
      const hostKey = `${url.protocol}//${url.host}`;
      if (seenHosts.has(hostKey)) continue;
      seenHosts.add(hostKey);

      const isHttps = url.protocol === 'https:';
      const port = url.port ? parseInt(url.port, 10) : isHttps ? 443 : 80;

      sockets.push({
        id: `BROWSER-RES-${i}-${url.hostname}:${port}`,
        protocol: isHttps ? 'HTTPS' : 'TCP',
        localIp: '127.0.0.1',
        localPort: 52000 + (i % 1000),
        remoteIp: url.hostname,
        remotePort: port,
        state: 'ESTABLISHED',
        rawStateLabel: 'ESTABLISHED (BROWSER)',
        txQueueBytes: Math.max(512, entry.transferSize || 2048),
        rxQueueBytes: Math.max(1024, entry.encodedBodySize || 4096),
        inode: `br-${i}`,
        pid: 1,
        processName: 'browser-network-engine',
        sourceOrigin: 'BROWSER_PERF',
      });
    } catch {
      // Ignore malformed resource URLs
    }
  }
  return sockets;
}

export function App() {
  const [liveSnapshot, setLiveSnapshot] = useState<LiveSystemTelemetrySnapshot | null>(null);
  const [topologySnapshot, setTopologySnapshot] = useState<LiveSystemTelemetrySnapshot | null>(null);
  const [telemetryMode, setTelemetryMode] = useState<TelemetryMode>('LIVE_HYBRID_OPTE');

  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [inspectorNodeId, setInspectorNodeId] = useState<string>('core-rtr-04');
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [activeTraceroute, setActiveTraceroute] = useState<TracerouteResult | null>(null);
  const [filterState, setFilterState] = useState<ConstellationFilterState>(() =>
    createDefaultFilterState()
  );
  const [simSpeed, setSimSpeed] = useState<number>(1);
  const [cameraCommand, setCameraCommand] = useState<CameraTargetCommand | null>(null);

  const hasInitializedTopologyRef = useRef(false);
  const prevSocketCountRef = useRef(0);

  const fetchLiveTelemetry = useCallback(async (forceRebuildTopology: boolean = false) => {
    try {
      const res = await fetch('/api/system-telemetry');
      if (!res.ok) return;
      const data = (await res.json()) as LiveSystemTelemetrySnapshot;
      setLiveSnapshot(data);

      const socketDiff = Math.abs(data.sockets.length - prevSocketCountRef.current);
      if (!hasInitializedTopologyRef.current || forceRebuildTopology || socketDiff >= 4) {
        hasInitializedTopologyRef.current = true;
        prevSocketCountRef.current = data.sockets.length;
        setTopologySnapshot(data);
        setInspectorNodeId((prev) =>
          prev === 'core-rtr-04' ? `host-kernel-${data.hostname}` : prev
        );
      }
    } catch {
      // Ignore transient fetch errors during server restart
    }
  }, []);

  useEffect(() => {
    fetchLiveTelemetry(true);
    const timer = window.setInterval(() => {
      fetchLiveTelemetry(false);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [fetchLiveTelemetry]);

  const graph = useMemo(() => {
    if (!topologySnapshot) {
      return generateOpteConstellation(20261027);
    }
    const browserSockets = collectBrowserPerformanceSockets();
    return buildLiveSystemConstellation(topologySnapshot, browserSockets, telemetryMode);
  }, [topologySnapshot, telemetryMode]);

  const selectedNode = useMemo(() => {
    if (graph.nodeMap.has(inspectorNodeId)) {
      return graph.nodeMap.get(inspectorNodeId)!;
    }
    const kernelHub = graph.nodes.find((n) => n.id.startsWith('host-kernel-'));
    return kernelHub ?? graph.nodes[0] ?? null;
  }, [graph, inspectorNodeId]);

  const hoveredNode = useMemo(
    () => (hoveredNodeId ? graph.nodeMap.get(hoveredNodeId) ?? null : null),
    [graph, hoveredNodeId]
  );

  const peerMatrix = useMemo(
    () => (selectedNode ? getNodePeerMatrix(graph, selectedNode.id) : []),
    [graph, selectedNode]
  );

  const visibleFilaments = useMemo(
    () => filterConstellationFilaments(graph, filterState),
    [graph, filterState]
  );

  const handleSelectNode = useCallback((nodeId: string, flyCamera: boolean = true) => {
    setInspectorNodeId(nodeId);
    setFocusedNodeId(nodeId);
    if (flyCamera) {
      setCameraCommand({ nonce: Date.now(), nodeId });
    }
  }, []);

  const handleClearSelection = useCallback(() => {
    setFocusedNodeId(null);
  }, []);

  const handleRunTraceroute = useCallback(
    (sourceId: string, targetId: string) => {
      const trace = findMultiHopTraceroute(graph, sourceId, targetId);
      setActiveTraceroute(trace);
      if (trace) {
        setInspectorNodeId(targetId);
      }
    },
    [graph]
  );

  const handleClearTraceroute = useCallback(() => {
    setActiveTraceroute(null);
  }, []);

  const handleResetFilters = useCallback(() => {
    setFilterState(createDefaultFilterState());
  }, []);

  const handleResetCameraOverview = useCallback(() => {
    setFocusedNodeId(null);
    setActiveTraceroute(null);
    setCameraCommand({ nonce: Date.now(), nodeId: 'OVERVIEW' });
  }, []);

  const handleChangeTelemetryMode = useCallback((mode: TelemetryMode) => {
    setTelemetryMode(mode);
    setFocusedNodeId(null);
    setActiveTraceroute(null);
    setCameraCommand({ nonce: Date.now(), nodeId: 'OVERVIEW' });
  }, []);

  const handleIngestHostSockets = useCallback(
    async (rawOutput: string, hostLabel: string): Promise<{ ok: boolean; message: string }> => {
      try {
        const res = await fetch('/api/system-telemetry/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rawOutput, hostLabel }),
        });
        const data = await res.json();
        if (!res.ok) {
          return { ok: false, message: data.error || 'Failed to parse socket output.' };
        }
        setLiveSnapshot(data.snapshot);
        setTopologySnapshot(data.snapshot);
        setInspectorNodeId(`host-kernel-${data.snapshot.hostname}`);
        return {
          ok: true,
          message: `Ingested ${data.ingestedSocketCount} live sockets from ${data.hostLabel}!`,
        };
      } catch {
        return { ok: false, message: 'Network error while ingesting sockets.' };
      }
    },
    []
  );

  const handleResetHostIngest = useCallback(async () => {
    try {
      const res = await fetch('/api/system-telemetry/reset-ingest', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setLiveSnapshot(data.snapshot);
        setTopologySnapshot(data.snapshot);
        setInspectorNodeId(`host-kernel-${data.snapshot.hostname}`);
      }
    } catch {
      // Ignore error
    }
  }, []);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-black text-slate-100 select-none">
      <OpteConstellationCanvas
        graph={graph}
        selectedNodeId={focusedNodeId}
        hoveredNodeId={hoveredNodeId}
        onSelectNode={(nodeId) => handleSelectNode(nodeId, true)}
        onHoverNode={setHoveredNodeId}
        activeTraceroute={activeTraceroute}
        filterState={filterState}
        cameraCommand={cameraCommand}
        simSpeed={simSpeed}
      />

      <OpteTelemetryHud
        graph={graph}
        liveSnapshot={liveSnapshot}
        telemetryMode={telemetryMode}
        onChangeTelemetryMode={handleChangeTelemetryMode}
        onIngestHostSockets={handleIngestHostSockets}
        onResetHostIngest={handleResetHostIngest}
        selectedNode={selectedNode}
        hoveredNode={hoveredNode}
        peerMatrix={peerMatrix}
        activeTraceroute={activeTraceroute}
        filterState={filterState}
        visibleFilamentCount={visibleFilaments.length}
        simSpeed={simSpeed}
        onSelectNode={handleSelectNode}
        onClearSelection={handleClearSelection}
        onRunTraceroute={handleRunTraceroute}
        onClearTraceroute={handleClearTraceroute}
        onUpdateFilter={setFilterState}
        onResetFilters={handleResetFilters}
        onChangeSimSpeed={setSimSpeed}
        onResetCameraOverview={handleResetCameraOverview}
      />
    </main>
  );
}

export default App;
