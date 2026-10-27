import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Play, RotateCcw, ShieldAlert } from 'lucide-react';
import { PACKET_SANDBOX_PRESETS, PacketPreset } from '../data/portfolioData';
import { evaluateNetworkPacket, PacketInput, ThreatVerdict } from '../utils/securityAnalyzer';

interface ThreatSandboxProps {
  externalPresetId: string | null;
}

export const ThreatSandbox: React.FC<ThreatSandboxProps> = ({ externalPresetId }) => {
  const [selectedPresetId, setSelectedPresetId] = useState<string>(PACKET_SANDBOX_PRESETS[0].id);
  const [packetForm, setPacketForm] = useState<PacketInput>({
    protocol: PACKET_SANDBOX_PRESETS[0].protocol,
    sourceIp: PACKET_SANDBOX_PRESETS[0].sourceIp,
    destinationPort: PACKET_SANDBOX_PRESETS[0].destinationPort,
    requestsPerSecond: PACKET_SANDBOX_PRESETS[0].requestsPerSecond,
    payloadSize: PACKET_SANDBOX_PRESETS[0].payloadSize,
    rawPayload: PACKET_SANDBOX_PRESETS[0].rawPayload,
  });

  const [verdict, setVerdict] = useState<ThreatVerdict>(() =>
    evaluateNetworkPacket(PACKET_SANDBOX_PRESETS[0])
  );
  const [evaluationLog, setEvaluationLog] = useState<
    { id: string; timestamp: string; sourceIp: string; classification: string; severity: string; riskScore: number }[]
  >([
    {
      id: 'init-1',
      timestamp: '10:20:04 UTC',
      sourceIp: PACKET_SANDBOX_PRESETS[0].sourceIp,
      classification: 'Application Layer Injection / Credential Extraction Attempt',
      severity: 'CRITICAL',
      riskScore: 94,
    },
  ]);

  const applyPreset = (preset: PacketPreset) => {
    setSelectedPresetId(preset.id);
    const nextInput: PacketInput = {
      protocol: preset.protocol,
      sourceIp: preset.sourceIp,
      destinationPort: preset.destinationPort,
      requestsPerSecond: preset.requestsPerSecond,
      payloadSize: preset.payloadSize,
      rawPayload: preset.rawPayload,
    };
    setPacketForm(nextInput);
    const nextVerdict = evaluateNetworkPacket(nextInput);
    setVerdict(nextVerdict);
    setEvaluationLog((prev) => [
      {
        id: `${preset.id}-${Date.now()}`,
        timestamp: new Date().toISOString().slice(11, 19) + ' UTC',
        sourceIp: nextInput.sourceIp,
        classification: nextVerdict.classification,
        severity: nextVerdict.severity,
        riskScore: nextVerdict.riskScore,
      },
      ...prev.slice(0, 4),
    ]);
  };

  useEffect(() => {
    if (!externalPresetId) return;
    const found = PACKET_SANDBOX_PRESETS.find((p) => p.id === externalPresetId);
    if (found) {
      applyPreset(found);
    }
  }, [externalPresetId]);

  const handleAnalyzeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = evaluateNetworkPacket(packetForm);
    setVerdict(result);
    setEvaluationLog((prev) => [
      {
        id: `custom-${Date.now()}`,
        timestamp: new Date().toISOString().slice(11, 19) + ' UTC',
        sourceIp: packetForm.sourceIp || '0.0.0.0',
        classification: result.classification,
        severity: result.severity,
        riskScore: result.riskScore,
      },
      ...prev.slice(0, 4),
    ]);
  };

  const renderSeverityHeader = (severity: ThreatVerdict['severity']) => {
    if (severity === 'CRITICAL' || severity === 'HIGH') {
      return (
        <div className="flex items-center gap-2 text-rose-400 font-semibold text-sm">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>Severity: {severity} (Action Required)</span>
        </div>
      );
    }
    if (severity === 'MEDIUM') {
      return (
        <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Severity: {severity} (Elevated Telemetry)</span>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
        <CheckCircle2 className="w-4 h-4 shrink-0" />
        <span>Severity: {severity} (Verified Normal Flow)</span>
      </div>
    );
  };

  return (
    <section
      id="threat-sandbox"
      className="px-6 lg:px-12 py-16 max-w-[1360px] mx-auto border-t border-zinc-900"
    >
      <div className="mb-8">
        <p className="text-xs font-medium text-blue-400 mb-2">
          02. Interactive SOC Threat &amp; Packet Sandbox
        </p>
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-100">
              Test Intrusion Detection &amp; DDoS Rules Live
            </h2>
            <p className="text-sm text-zinc-400 mt-1 max-w-[68ch]">
              Select a traffic scenario from Gowtham&apos;s security projects or customize packet parameters below to
              inspect how Snort signatures, volumetric DDoS thresholds, and Zeek DNS heuristics classify the flow.
            </p>
          </div>
        </div>
      </div>

      {/* Scenario Preset Selector Bar */}
      <div className="mb-8">
        <p className="text-xs font-medium text-zinc-400 mb-2.5">
          Load Preset Traffic Vector:
        </p>
        <div
          role="group"
          aria-label="Traffic scenario presets"
          className="flex flex-wrap items-center gap-2"
        >
          {PACKET_SANDBOX_PRESETS.map((preset) => {
            const isSelected = selectedPresetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset)}
                className={`px-3.5 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isSelected
                    ? 'bg-blue-600 text-white border-blue-500'
                    : 'bg-zinc-950 text-zinc-300 border-zinc-800 hover:border-zinc-700 hover:text-white'
                }`}
              >
                {preset.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main 2-Column Workbench: Left Packet Builder, Right IDS Verdict & Playbook */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Packet Inspector Form */}
        <form
          onSubmit={handleAnalyzeSubmit}
          className="lg:col-span-5 rounded-2xl bg-zinc-950 border border-zinc-800/90 p-6 space-y-4"
        >
          <div className="flex items-center justify-between pb-3 border-b border-zinc-900">
            <h3 className="text-base font-semibold text-zinc-100">
              Inbound Packet &amp; Stream Parameters
            </h3>
            <button
              type="button"
              onClick={() => applyPreset(PACKET_SANDBOX_PRESETS[0])}
              className="text-xs text-zinc-400 hover:text-zinc-100 inline-flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="sandbox-protocol" className="block text-xs font-medium text-zinc-300 mb-1.5">
                Protocol
              </label>
              <select
                id="sandbox-protocol"
                value={packetForm.protocol}
                onChange={(e) => {
                  setSelectedPresetId('custom');
                  setPacketForm({
                    ...packetForm,
                    protocol: e.target.value as PacketInput['protocol'],
                  });
                }}
                className="w-full px-3 py-2 text-xs bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 focus:outline-none focus:border-blue-500"
              >
                <option value="HTTP">HTTP</option>
                <option value="TCP">TCP</option>
                <option value="UDP">UDP</option>
                <option value="DNS">DNS</option>
                <option value="ICMP">ICMP</option>
              </select>
            </div>

            <div>
              <label htmlFor="sandbox-port" className="block text-xs font-medium text-zinc-300 mb-1.5">
                Destination Port
              </label>
              <input
                id="sandbox-port"
                type="number"
                min={1}
                max={65535}
                value={packetForm.destinationPort}
                onChange={(e) => {
                  setSelectedPresetId('custom');
                  setPacketForm({
                    ...packetForm,
                    destinationPort: Number(e.target.value) || 80,
                  });
                }}
                className="w-full px-3 py-2 text-xs font-mono-tabular bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="sandbox-src-ip" className="block text-xs font-medium text-zinc-300 mb-1.5">
                Source IPv4 Address
              </label>
              <input
                id="sandbox-src-ip"
                type="text"
                value={packetForm.sourceIp}
                onChange={(e) => {
                  setSelectedPresetId('custom');
                  setPacketForm({ ...packetForm, sourceIp: e.target.value });
                }}
                className="w-full px-3 py-2 text-xs font-mono-tabular bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label htmlFor="sandbox-rps" className="block text-xs font-medium text-zinc-300 mb-1.5">
                Packet Rate (pkt/sec)
              </label>
              <input
                id="sandbox-rps"
                type="number"
                min={1}
                max={100000}
                value={packetForm.requestsPerSecond}
                onChange={(e) => {
                  setSelectedPresetId('custom');
                  setPacketForm({
                    ...packetForm,
                    requestsPerSecond: Number(e.target.value) || 1,
                  });
                }}
                className="w-full px-3 py-2 text-xs font-mono-tabular bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div>
            <label htmlFor="sandbox-payload" className="block text-xs font-medium text-zinc-300 mb-1.5">
              Raw Packet Header / Application Payload
            </label>
            <textarea
              id="sandbox-payload"
              rows={3}
              value={packetForm.rawPayload}
              onChange={(e) => {
                setSelectedPresetId('custom');
                setPacketForm({ ...packetForm, rawPayload: e.target.value });
              }}
              className="w-full px-3 py-2 text-xs font-mono-tabular bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 focus:outline-none focus:border-blue-500"
            />
          </div>

          <button
            type="submit"
            className="w-full py-2.5 px-4 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5" />
            <span>Analyze Traffic in SOC Engine</span>
          </button>
        </form>

        {/* Right Column: Deterministic Threat Verdict & Matched Snort Signature */}
        <div className="lg:col-span-7 rounded-2xl bg-zinc-950 border border-zinc-800/90 p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-900">
            <div>
              {renderSeverityHeader(verdict.severity)}
              <h3 className="text-lg font-bold text-zinc-100 mt-1">
                {verdict.classification}
              </h3>
            </div>

            <div className="sm:text-right">
              <span className="text-xs text-zinc-400 block">Anomaly Risk Index</span>
              <span className="text-2xl font-bold font-mono-tabular text-zinc-100">
                {verdict.riskScore}
                <span className="text-sm font-normal text-zinc-500"> / 100</span>
              </span>
            </div>
          </div>

          {/* Matched Rule & MITRE Mapping */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
              <span>
                Rule Engine: <strong className="text-zinc-200 font-mono-tabular">{verdict.matchedRuleSid}</strong>
              </span>
              <span>
                MITRE ATT&amp;CK: <strong className="text-zinc-200">{verdict.mitreTechnique}</strong>
              </span>
            </div>

            <div className="rounded-xl bg-[#08090c] border border-zinc-800 p-4">
              <p className="text-xs text-zinc-400 mb-1.5">Triggered Snort / Filter Signature:</p>
              <pre className="text-xs font-mono-tabular text-blue-300 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                {verdict.matchedSnortRule}
              </pre>
            </div>
          </div>

          {/* Recommended SOC Response Playbook */}
          <div>
            <h4 className="text-xs font-semibold text-zinc-300 mb-2">
              Recommended SOC Analyst Playbook Actions:
            </h4>
            <ul className="space-y-1.5 text-xs text-zinc-300">
              {verdict.recommendedActions.map((action, index) => (
                <li key={action} className="font-mono-tabular leading-relaxed">
                  0{index + 1}. {action}
                </li>
              ))}
            </ul>
          </div>

          {/* Recent Inspection Audit Log */}
          <div className="pt-4 border-t border-zinc-900">
            <h4 className="text-xs font-semibold text-zinc-400 mb-2.5">
              Session Inspection Telemetry Log
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs font-mono-tabular">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-400">
                    <th className="py-2 pr-3 font-medium">Time</th>
                    <th className="py-2 pr-3 font-medium">Source IP</th>
                    <th className="py-2 pr-3 font-medium">Classification</th>
                    <th className="py-2 pr-3 font-medium">Severity</th>
                    <th className="py-2 text-right font-medium">Risk</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900 text-zinc-300">
                  {evaluationLog.map((entry) => (
                    <tr key={entry.id}>
                      <td className="py-2 pr-3 text-zinc-400 whitespace-nowrap">{entry.timestamp}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{entry.sourceIp}</td>
                      <td className="py-2 pr-3 truncate max-w-[220px]">{entry.classification}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{entry.severity}</td>
                      <td className="py-2 text-right whitespace-nowrap">{entry.riskScore}/100</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
