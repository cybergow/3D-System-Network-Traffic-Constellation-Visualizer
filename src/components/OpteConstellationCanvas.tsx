import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  ConstellationFilterState,
  OpteConstellationGraph,
  OpteFilament,
  OpteNode,
  TracerouteResult,
} from '../opte/opteGraphGenerator';

export interface CameraTargetCommand {
  nonce: number;
  nodeId: string | 'OVERVIEW';
}

interface OpteConstellationCanvasProps {
  graph: OpteConstellationGraph;
  selectedNodeId: string | null;
  hoveredNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onHoverNode: (nodeId: string | null) => void;
  activeTraceroute: TracerouteResult | null;
  filterState: ConstellationFilterState;
  cameraCommand: CameraTargetCommand | null;
  simSpeed: number;
}

const SEGMENTS_PER_CURVED_FILAMENT = 4;
const TOTAL_DATA_IMPULSES = 3200;

/**
 * Creates a procedural radial glow sprite texture for starburst hubs and traveling packet impulses.
 */
function createRadialGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.25, 'rgba(255, 255, 255, 0.85)');
    grad.addColorStop(0.55, 'rgba(200, 240, 255, 0.32)');
    grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Evaluates a point on a 3D quadratic Bezier curve at t in [0, 1].
 */
function evalQuadraticBezier(
  t: number,
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
  out: [number, number, number]
) {
  const inv = 1 - t;
  const a = inv * inv;
  const b = 2 * inv * t;
  const c = t * t;
  out[0] = a * p0[0] + b * p1[0] + c * p2[0];
  out[1] = a * p0[1] + b * p1[1] + c * p2[1];
  out[2] = a * p0[2] + b * p1[2] + c * p2[2];
}

export const OpteConstellationCanvas: React.FC<OpteConstellationCanvasProps> = ({
  graph,
  selectedNodeId,
  hoveredNodeId,
  onSelectNode,
  onHoverNode,
  activeTraceroute,
  filterState,
  cameraCommand,
  simSpeed,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);

  // Store latest props in refs so WebGL scene never tears down on React state updates
  const selectedNodeIdRef = useRef<string | null>(selectedNodeId);
  selectedNodeIdRef.current = selectedNodeId;

  const hoveredNodeIdRef = useRef<string | null>(hoveredNodeId);
  hoveredNodeIdRef.current = hoveredNodeId;

  const activeTracerouteRef = useRef<TracerouteResult | null>(activeTraceroute);
  activeTracerouteRef.current = activeTraceroute;

  const filterStateRef = useRef<ConstellationFilterState>(filterState);
  filterStateRef.current = filterState;

  const simSpeedRef = useRef<number>(simSpeed);
  simSpeedRef.current = simSpeed;

  const onSelectNodeRef = useRef(onSelectNode);
  onSelectNodeRef.current = onSelectNode;

  const onHoverNodeRef = useRef(onHoverNode);
  onHoverNodeRef.current = onHoverNode;

  const updateVisualBuffersRef = useRef<(() => void) | null>(null);
  const flyToTargetRef = useRef<((nodeId: string | 'OVERVIEW') => void) | null>(null);

  // Trigger buffer re-coloring whenever selection, traceroute, or filters change
  useEffect(() => {
    updateVisualBuffersRef.current?.();
  }, [selectedNodeId, hoveredNodeId, activeTraceroute, filterState]);

  useEffect(() => {
    if (cameraCommand && flyToTargetRef.current) {
      flyToTargetRef.current(cameraCommand.nodeId);
    }
  }, [cameraCommand]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // 1. Software WebGL detection per threejs skill
    const isSoftwareGl = (() => {
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 1);

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // 2. Pitch-black 3D Void (#000000)
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(0x000000, 0.0022);

    // 3. Camera framed right into the dense Opte starburst constellation so it fills 100% of the viewport
    const camera = new THREE.PerspectiveCamera(58, width / height, 0.2, 420);
    camera.position.set(0, 2, 54);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, -4);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.rotateSpeed = 0.75;
    controls.zoomSpeed = 1.1;
    controls.minDistance = 3;
    controls.maxDistance = 195;
    controls.update();

    const cameraGoalPos = new THREE.Vector3(0, 2, 54);
    const cameraGoalTarget = new THREE.Vector3(0, 0, -4);
    let isCameraFlying = false;

    const onControlStart = () => {
      isCameraFlying = false;
    };
    controls.addEventListener('start', onControlStart);

    // 4. Build Dense Opte 3D Filament LineSegments BufferGeometry
    // Each graph filament is rendered as a multi-segment curve, PLUS fine starburst micro-spokes & forked twigs
    // so the visual density matches the Opte Project Internet Map reference image.
    const totalFilaments = graph.filaments.length;

    // Additional decorative micro-starburst rays & twigs tied to their parent hub's filter/selection state
    interface MicroTwigSpec {
      parentNodeId: string;
      colorDomain: OpteFilament['colorDomain'];
      protocol: OpteFilament['protocol'];
      bandwidthMbps: number;
      p0: [number, number, number];
      p1: [number, number, number];
      rgb: [number, number, number];
    }

    const microTwigs: MicroTwigSpec[] = [];
    // Deterministic decorative starburst rays around every hub + mini dandelion stars in background
    let seed = 918273;
    const nextRand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    for (const node of graph.nodes) {
      if (node.isStarburstHub) {
        const extraSpokes =
          node.hierarchyRole === 'CORE_BACKBONE_ROUTER' ? 52 : 22;
        const baseRad =
          node.hierarchyRole === 'CORE_BACKBONE_ROUTER' ? 7.5 : 4.2;

        for (let s = 0; s < extraSpokes; s++) {
          const u = nextRand();
          const v = nextRand();
          const theta = u * Math.PI * 2;
          const phi = Math.acos(2 * v - 1);
          const r = baseRad * (0.35 + nextRand() * 0.85);

          const tipX = node.position[0] + r * Math.sin(phi) * Math.cos(theta);
          const tipY = node.position[1] + r * Math.sin(phi) * Math.sin(theta);
          const tipZ = node.position[2] + r * Math.cos(phi);

          const useWhite = nextRand() < 0.62;
          const twigRgb: [number, number, number] = useWhite
            ? [0.92, 0.96, 1.0]
            : node.rgb;

          microTwigs.push({
            parentNodeId: node.id,
            colorDomain: useWhite ? 'WHITE_CORE_HUB' : node.colorDomain,
            protocol: 'TCP',
            bandwidthMbps: 120,
            p0: node.position,
            p1: [tipX, tipY, tipZ],
            rgb: twigRgb,
          });

          // Forked Y-twig at the tip of spoke (classic Opte dandelion tip)
          if (s % 2 === 0) {
            const forkLen = 0.8 + nextRand() * 1.1;
            const fx = tipX + (nextRand() - 0.5) * forkLen * 2;
            const fy = tipY + (nextRand() - 0.5) * forkLen * 2;
            const fz = tipZ + (nextRand() - 0.5) * forkLen * 2;
            microTwigs.push({
              parentNodeId: node.id,
              colorDomain: useWhite ? 'WHITE_CORE_HUB' : node.colorDomain,
              protocol: 'TCP',
              bandwidthMbps: 80,
              p0: [tipX, tipY, tipZ],
              p1: [fx, fy, fz],
              rgb: node.rgb,
            });
          }
        }
      } else if (node.index % 7 === 0) {
        // Turn every 7th leaf node into a crisp mini 9-spoke star cluster in the background field
        const miniSpokes = 9;
        for (let m = 0; m < miniSpokes; m++) {
          const u = nextRand();
          const v = nextRand();
          const theta = u * Math.PI * 2;
          const phi = Math.acos(2 * v - 1);
          const r = 1.4 + nextRand() * 1.6;
          const tx = node.position[0] + r * Math.sin(phi) * Math.cos(theta);
          const ty = node.position[1] + r * Math.sin(phi) * Math.sin(theta);
          const tz = node.position[2] + r * Math.cos(phi);
          microTwigs.push({
            parentNodeId: node.parentHubId ?? node.id,
            colorDomain: node.colorDomain,
            protocol: 'TCP',
            bandwidthMbps: 45,
            p0: node.position,
            p1: [tx, ty, tz],
            rgb: [0.85, 0.9, 0.95],
          });
        }
      }
    }

    const curvedLineSegmentCount = totalFilaments * SEGMENTS_PER_CURVED_FILAMENT;
    const totalLineSegments = curvedLineSegmentCount + microTwigs.length;
    const linePositions = new Float32Array(totalLineSegments * 2 * 3);
    const lineColors = new Float32Array(totalLineSegments * 2 * 3);

    const ptA: [number, number, number] = [0, 0, 0];
    const ptB: [number, number, number] = [0, 0, 0];

    // Populate geometry positions once
    for (let f = 0; f < totalFilaments; f++) {
      const fil = graph.filaments[f];
      const src = graph.nodes[fil.sourceIndex];
      const dst = graph.nodes[fil.targetIndex];

      for (let s = 0; s < SEGMENTS_PER_CURVED_FILAMENT; s++) {
        const t0 = s / SEGMENTS_PER_CURVED_FILAMENT;
        const t1 = (s + 1) / SEGMENTS_PER_CURVED_FILAMENT;
        evalQuadraticBezier(t0, src.position, fil.controlPoint, dst.position, ptA);
        evalQuadraticBezier(t1, src.position, fil.controlPoint, dst.position, ptB);

        const baseIdx = (f * SEGMENTS_PER_CURVED_FILAMENT + s) * 6;
        linePositions[baseIdx] = ptA[0];
        linePositions[baseIdx + 1] = ptA[1];
        linePositions[baseIdx + 2] = ptA[2];
        linePositions[baseIdx + 3] = ptB[0];
        linePositions[baseIdx + 4] = ptB[1];
        linePositions[baseIdx + 5] = ptB[2];
      }
    }

    // Populate micro-twig positions
    for (let m = 0; m < microTwigs.length; m++) {
      const twig = microTwigs[m];
      const baseIdx = (curvedLineSegmentCount + m) * 6;
      linePositions[baseIdx] = twig.p0[0];
      linePositions[baseIdx + 1] = twig.p0[1];
      linePositions[baseIdx + 2] = twig.p0[2];
      linePositions[baseIdx + 3] = twig.p1[0];
      linePositions[baseIdx + 4] = twig.p1[1];
      linePositions[baseIdx + 5] = twig.p1[2];
    }

    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    const colorAttr = new THREE.BufferAttribute(lineColors, 3);
    lineGeometry.setAttribute('color', colorAttr);

    const lineMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.86,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const filamentLinesMesh = new THREE.LineSegments(lineGeometry, lineMaterial);
    scene.add(filamentLinesMesh);

    // 5. Starburst Hub & Node Glow Points
    const glowTexture = createRadialGlowTexture();
    const nodeCount = graph.nodes.length;
    const nodePositions = new Float32Array(nodeCount * 3);
    const nodeColors = new Float32Array(nodeCount * 3);

    for (let i = 0; i < nodeCount; i++) {
      const n = graph.nodes[i];
      nodePositions[i * 3] = n.position[0];
      nodePositions[i * 3 + 1] = n.position[1];
      nodePositions[i * 3 + 2] = n.position[2];

      // Hub centers glow crisp bright white in Opte style
      if (n.isStarburstHub) {
        nodeColors[i * 3] = 1.0;
        nodeColors[i * 3 + 1] = 1.0;
        nodeColors[i * 3 + 2] = 1.0;
      } else {
        nodeColors[i * 3] = n.rgb[0];
        nodeColors[i * 3 + 1] = n.rgb[1];
        nodeColors[i * 3 + 2] = n.rgb[2];
      }
    }

    const nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute('position', new THREE.BufferAttribute(nodePositions, 3));
    const nodeColorAttr = new THREE.BufferAttribute(nodeColors, 3);
    nodeGeo.setAttribute('color', nodeColorAttr);

    const nodeMat = new THREE.PointsMaterial({
      size: 0.75,
      map: glowTexture,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const nodePointsMesh = new THREE.Points(nodeGeo, nodeMat);
    scene.add(nodePointsMesh);

    // Separate extra-bright Super-Core Starburst Halo Points for the major starburst hubs
    const hubNodes = graph.nodes.filter((n) => n.isStarburstHub);
    const hubPositions = new Float32Array(hubNodes.length * 3);
    const hubColors = new Float32Array(hubNodes.length * 3);
    hubNodes.forEach((h, idx) => {
      hubPositions[idx * 3] = h.position[0];
      hubPositions[idx * 3 + 1] = h.position[1];
      hubPositions[idx * 3 + 2] = h.position[2];
      hubColors[idx * 3] = 1.0;
      hubColors[idx * 3 + 1] = 1.0;
      hubColors[idx * 3 + 2] = 1.0;
    });
    const hubGeo = new THREE.BufferGeometry();
    hubGeo.setAttribute('position', new THREE.BufferAttribute(hubPositions, 3));
    hubGeo.setAttribute('color', new THREE.BufferAttribute(hubColors, 3));
    const hubMat = new THREE.PointsMaterial({
      size: 2.4,
      map: glowTexture,
      vertexColors: true,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const hubGlowMesh = new THREE.Points(hubGeo, hubMat);
    scene.add(hubGlowMesh);

    // 6. Real-Time Travelling Data Impulses (3,200 luminous packets streaming along filaments)
    interface DataImpulse {
      filamentIndex: number;
      t: number; // 0..1 progress along curve
      speed: number;
      direction: 1 | -1; // 1 = outbound request, -1 = returning response pulse
      isTracerouteImpulse: boolean;
    }

    const impulses: DataImpulse[] = [];
    const impulsePositions = new Float32Array(TOTAL_DATA_IMPULSES * 3);
    const impulseColors = new Float32Array(TOTAL_DATA_IMPULSES * 3);

    for (let i = 0; i < TOTAL_DATA_IMPULSES; i++) {
      const filIdx = i % totalFilaments;
      const fil = graph.filaments[filIdx];
      const speedBase = 0.22 + Math.min(0.95, fil.bandwidthMBps / 90);
      impulses.push({
        filamentIndex: filIdx,
        t: (i * 0.137) % 1.0,
        speed: speedBase * (0.75 + nextRand() * 0.5),
        direction: i % 2 === 0 ? 1 : -1,
        isTracerouteImpulse: false,
      });
    }

    const impulseGeo = new THREE.BufferGeometry();
    const impulsePosAttr = new THREE.BufferAttribute(impulsePositions, 3);
    const impulseColorAttr = new THREE.BufferAttribute(impulseColors, 3);
    impulseGeo.setAttribute('position', impulsePosAttr);
    impulseGeo.setAttribute('color', impulseColorAttr);

    const impulseMat = new THREE.PointsMaterial({
      size: 0.95,
      map: glowTexture,
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const impulsePointsMesh = new THREE.Points(impulseGeo, impulseMat);
    scene.add(impulsePointsMesh);

    // Track which filaments are currently visible according to filterState
    const filamentVisibleMask = new Uint8Array(totalFilaments);
    filamentVisibleMask.fill(1);

    // 7. Function to update filament & node vertex colors when filters, selection, or 3D traceroute change
    const updateVisualBuffers = () => {
      const filter = filterStateRef.current;
      const selNodeId = hoveredNodeIdRef.current ?? selectedNodeIdRef.current;
      const traceroute = activeTracerouteRef.current;

      // Determine connected neighbor set if a node is selected/hovered
      const connectedFilamentSet = new Set<string>();
      const connectedNodeSet = new Set<string>();
      if (selNodeId) {
        connectedNodeSet.add(selNodeId);
        const adj = graph.adjacencyMap.get(selNodeId) ?? [];
        for (const f of adj) {
          connectedFilamentSet.add(f.id);
          connectedNodeSet.add(f.sourceId);
          connectedNodeSet.add(f.targetId);
        }
      }

      const hasFocusFilter = Boolean(selNodeId) || Boolean(traceroute);

      for (let f = 0; f < totalFilaments; f++) {
        const fil = graph.filaments[f];
        const src = graph.nodes[fil.sourceIndex];
        const dst = graph.nodes[fil.targetIndex];

        // Check user filter criteria
        let passesFilter =
          filter.enabledProtocols[fil.protocol] &&
          filter.enabledDomains[fil.colorDomain] &&
          fil.bandwidthMbps >= filter.minBandwidthMbps;

        if (passesFilter && filter.hierarchyFilter !== 'ALL') {
          passesFilter =
            src.hierarchyRole === filter.hierarchyFilter ||
            dst.hierarchyRole === filter.hierarchyFilter;
        }

        filamentVisibleMask[f] = passesFilter ? 1 : 0;

        let r = fil.rgb[0];
        let g = fil.rgb[1];
        let b = fil.rgb[2];

        if (!passesFilter) {
          r = 0;
          g = 0;
          b = 0;
        } else if (traceroute && traceroute.filamentIds.has(fil.id)) {
          // Bright golden-white highlight for active End-to-End 3D Traceroute path
          r = 1.0;
          g = 0.96;
          b = 0.65;
        } else if (selNodeId && connectedFilamentSet.has(fil.id)) {
          // Boost connected upstream/downstream filaments of selected node
          r = Math.min(1.0, r * 1.35 + 0.25);
          g = Math.min(1.0, g * 1.35 + 0.25);
          b = Math.min(1.0, b * 1.35 + 0.25);
        } else if (hasFocusFilter) {
          // Keep background constellation softly visible (32% luminance) so Opte context remains rich
          r *= 0.32;
          g *= 0.32;
          b *= 0.32;
        }

        for (let s = 0; s < SEGMENTS_PER_CURVED_FILAMENT; s++) {
          const baseIdx = (f * SEGMENTS_PER_CURVED_FILAMENT + s) * 6;
          // Brighter near starburst hub ends, slightly softer at midpoint
          const endBoost = s === 0 || s === SEGMENTS_PER_CURVED_FILAMENT - 1 ? 1.15 : 0.9;
          lineColors[baseIdx] = Math.min(1, r * endBoost);
          lineColors[baseIdx + 1] = Math.min(1, g * endBoost);
          lineColors[baseIdx + 2] = Math.min(1, b * endBoost);
          lineColors[baseIdx + 3] = Math.min(1, r * endBoost);
          lineColors[baseIdx + 4] = Math.min(1, g * endBoost);
          lineColors[baseIdx + 5] = Math.min(1, b * endBoost);
        }
      }

      // Update micro-twig colors
      for (let m = 0; m < microTwigs.length; m++) {
        const twig = microTwigs[m];
        const passes =
          filter.enabledDomains[twig.colorDomain] &&
          twig.bandwidthMbps >= filter.minBandwidthMbps;

        let r = twig.rgb[0];
        let g = twig.rgb[1];
        let b = twig.rgb[2];

        if (!passes) {
          r = 0;
          g = 0;
          b = 0;
        } else if (selNodeId === twig.parentNodeId) {
          r = 1.0;
          g = 1.0;
          b = 1.0;
        } else if (hasFocusFilter) {
          r *= 0.35;
          g *= 0.35;
          b *= 0.35;
        }

        const baseIdx = (curvedLineSegmentCount + m) * 6;
        // Hub root is bright white, spoke tip fades into domain hue
        lineColors[baseIdx] = Math.min(1, r * 1.2);
        lineColors[baseIdx + 1] = Math.min(1, g * 1.2);
        lineColors[baseIdx + 2] = Math.min(1, b * 1.2);
        lineColors[baseIdx + 3] = r * 0.78;
        lineColors[baseIdx + 4] = g * 0.78;
        lineColors[baseIdx + 5] = b * 0.78;
      }

      colorAttr.needsUpdate = true;

      // Update Node Point colors
      for (let i = 0; i < nodeCount; i++) {
        const n = graph.nodes[i];
        const isTraced = traceroute?.nodeIds.has(n.id);
        const isConnected = connectedNodeSet.has(n.id);

        if (isTraced || n.id === selNodeId) {
          nodeColors[i * 3] = 1.0;
          nodeColors[i * 3 + 1] = 1.0;
          nodeColors[i * 3 + 2] = 0.85;
        } else if (isConnected) {
          nodeColors[i * 3] = 1.0;
          nodeColors[i * 3 + 1] = 1.0;
          nodeColors[i * 3 + 2] = 1.0;
        } else if (hasFocusFilter) {
          nodeColors[i * 3] = n.rgb[0] * 0.38;
          nodeColors[i * 3 + 1] = n.rgb[1] * 0.38;
          nodeColors[i * 3 + 2] = n.rgb[2] * 0.38;
        } else {
          nodeColors[i * 3] = n.isStarburstHub ? 1.0 : n.rgb[0];
          nodeColors[i * 3 + 1] = n.isStarburstHub ? 1.0 : n.rgb[1];
          nodeColors[i * 3 + 2] = n.isStarburstHub ? 1.0 : n.rgb[2];
        }
      }
      nodeColorAttr.needsUpdate = true;
    };

    updateVisualBuffersRef.current = updateVisualBuffers;
    updateVisualBuffers();

    // 8. Smooth Camera Fly-To on Node or Cluster Selection
    flyToTargetRef.current = (targetId: string | 'OVERVIEW') => {
      if (targetId === 'OVERVIEW') {
        cameraGoalPos.set(0, 2, 54);
        cameraGoalTarget.set(0, 0, -4);
        isCameraFlying = true;
        return;
      }
      const node = graph.nodeMap.get(targetId);
      if (node) {
        cameraGoalTarget.set(node.position[0], node.position[1], node.position[2]);
        const offsetDist = node.isStarburstHub ? 18 : 11;
        cameraGoalPos.set(
          node.position[0] + offsetDist * 0.45,
          node.position[1] + offsetDist * 0.3,
          node.position[2] + offsetDist
        );
        isCameraFlying = true;
      }
    };

    // 9. Raycasting against Node Points for Click & Hover Inspection
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 1.8 };
    const pointer = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };
    let lastHoverTime = 0;

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    const onPointerUp = (e: PointerEvent) => {
      const moved = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      if (moved > 6) return;

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(nodePointsMesh, false);
      if (hits.length > 0 && typeof hits[0].index === 'number') {
        const pickedNode = graph.nodes[hits[0].index];
        if (pickedNode) {
          onSelectNodeRef.current(pickedNode.id);
          flyToTargetRef.current?.(pickedNode.id);
        }
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const now = performance.now();
      if (now - lastHoverTime < 65) return; // Throttled hover raycast
      lastHoverTime = now;

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(nodePointsMesh, false);
      if (hits.length > 0 && typeof hits[0].index === 'number') {
        const hovered = graph.nodes[hits[0].index];
        renderer.domElement.style.cursor = 'pointer';
        if (hovered && hovered.id !== hoveredNodeIdRef.current) {
          onHoverNodeRef.current(hovered.id);
        }
      } else {
        renderer.domElement.style.cursor = 'grab';
        if (hoveredNodeIdRef.current !== null) {
          onHoverNodeRef.current(null);
        }
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointermove', onPointerMove);

    // 10. Animation Loop with `afterDraw` Software-WebGL Pacing
    let lastFrameMs = performance.now();
    let frameId = 0;
    const evalPos: [number, number, number] = [0, 0, 0];

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function tick() {
      const nowMs = performance.now();
      const rawDelta = Math.min((nowMs - lastFrameMs) / 1000, 0.1);
      lastFrameMs = nowMs;
      const speed = simSpeedRef.current;
      const simDelta = rawDelta * speed;

      // Smoothly damp camera when flying to a clicked starburst cluster
      if (isCameraFlying) {
        const lambda = 5.0;
        camera.position.x = THREE.MathUtils.damp(
          camera.position.x,
          cameraGoalPos.x,
          lambda,
          rawDelta
        );
        camera.position.y = THREE.MathUtils.damp(
          camera.position.y,
          cameraGoalPos.y,
          lambda,
          rawDelta
        );
        camera.position.z = THREE.MathUtils.damp(
          camera.position.z,
          cameraGoalPos.z,
          lambda,
          rawDelta
        );
        controls.target.x = THREE.MathUtils.damp(
          controls.target.x,
          cameraGoalTarget.x,
          lambda,
          rawDelta
        );
        controls.target.y = THREE.MathUtils.damp(
          controls.target.y,
          cameraGoalTarget.y,
          lambda,
          rawDelta
        );
        controls.target.z = THREE.MathUtils.damp(
          controls.target.z,
          cameraGoalTarget.z,
          lambda,
          rawDelta
        );

        if (camera.position.distanceToSquared(cameraGoalPos) < 0.2) {
          isCameraFlying = false;
        }
      }

      controls.update();

      // Animate all 3,200 luminous data impulses along the curved 3D filaments
      const traceroute = activeTracerouteRef.current;

      for (let i = 0; i < TOTAL_DATA_IMPULSES; i++) {
        const imp = impulses[i];
        const fil = graph.filaments[imp.filamentIndex];

        if (!filamentVisibleMask[imp.filamentIndex]) {
          impulsePositions[i * 3] = 0;
          impulsePositions[i * 3 + 1] = -9999;
          impulsePositions[i * 3 + 2] = 0;
          continue;
        }

        if (speed > 0) {
          imp.t += simDelta * imp.speed * imp.direction;
          // When request impulse reaches target (t >= 1), flip direction to simulate response pulse returning!
          if (imp.t >= 1.0) {
            imp.t = 1.0;
            imp.direction = -1;
          } else if (imp.t <= 0.0) {
            imp.t = 0.0;
            imp.direction = 1;
          }
        }

        const src = graph.nodes[fil.sourceIndex];
        const dst = graph.nodes[fil.targetIndex];
        evalQuadraticBezier(imp.t, src.position, fil.controlPoint, dst.position, evalPos);

        impulsePositions[i * 3] = evalPos[0];
        impulsePositions[i * 3 + 1] = evalPos[1];
        impulsePositions[i * 3 + 2] = evalPos[2];

        const isTracedLink = traceroute?.filamentIds.has(fil.id);
        if (isTracedLink) {
          impulseColors[i * 3] = 1.0;
          impulseColors[i * 3 + 1] = 1.0;
          impulseColors[i * 3 + 2] = 0.75;
        } else if (imp.direction === -1) {
          // Response pulse has a brighter white-cyan sheen
          impulseColors[i * 3] = Math.min(1, fil.rgb[0] + 0.35);
          impulseColors[i * 3 + 1] = Math.min(1, fil.rgb[1] + 0.35);
          impulseColors[i * 3 + 2] = Math.min(1, fil.rgb[2] + 0.35);
        } else {
          impulseColors[i * 3] = Math.min(1, fil.rgb[0] + 0.2);
          impulseColors[i * 3 + 1] = Math.min(1, fil.rgb[1] + 0.2);
          impulseColors[i * 3 + 2] = Math.min(1, fil.rgb[2] + 0.2);
        }
      }

      impulsePosAttr.needsUpdate = true;
      impulseColorAttr.needsUpdate = true;

      // Subtle throughput breathing on starburst hub glow size
      const pulseFactor = 2.4 + Math.sin(nowMs * 0.0035) * 0.25;
      hubMat.size = pulseFactor;

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    tick();

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', handleResize);
      controls.removeEventListener('start', onControlStart);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      lineGeometry.dispose();
      lineMaterial.dispose();
      nodeGeo.dispose();
      nodeMat.dispose();
      hubGeo.dispose();
      hubMat.dispose();
      impulseGeo.dispose();
      impulseMat.dispose();
      glowTexture.dispose();
      controls.dispose();
      renderer.dispose();
    };
  }, [graph]);

  return (
    <div
      ref={mountRef}
      data-testid="opte-constellation-canvas"
      className="fixed inset-0 w-screen h-screen overflow-hidden bg-black"
    />
  );
};
