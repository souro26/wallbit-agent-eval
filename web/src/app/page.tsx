'use client';

import React, { useState, useEffect } from 'react';
import type { FormattedEvaluationResult, ScenarioSummary } from 'wallbit-agent-eval';
import {
  ShieldCheck,
  Play,
  RotateCcw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Database,
  Terminal,
  ChevronDown,
  ChevronUp,
  Cpu,
  Layers,
  Info
} from 'lucide-react';

export default function Home() {
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [agentProfiles, setAgentProfiles] = useState<string[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('');
  const [selectedAgent, setSelectedAgent] = useState<string>('safe');
  const [loading, setLoading] = useState<boolean>(false);
  const [fetchingConfig, setFetchingConfig] = useState<boolean>(true);
  const [result, setResult] = useState<FormattedEvaluationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'assertions' | 'requests' | 'mutations'>('assertions');
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

  useEffect(() => {
    async function loadConfig() {
      try {
        setFetchingConfig(true);
        const res = await fetch('/api/scenarios');
        const data = await res.json();
        if (data.success) {
          setScenarios(data.scenarios || []);
          setAgentProfiles(data.agentProfiles || []);
          if (data.scenarios?.length > 0) {
            setSelectedScenarioId(data.scenarios[0].id);
          }
        } else {
          setError(data.error || 'Failed to load scenarios');
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Error connecting to web API');
      } finally {
        setFetchingConfig(false);
      }
    }
    loadConfig();
  }, []);

  const selectedScenario = scenarios.find(s => s.id === selectedScenarioId);

  const toggleExpand = (id: string) => {
    setExpandedItems(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const applyPreset = (scenarioId: string, agent: string) => {
    setSelectedScenarioId(scenarioId);
    setSelectedAgent(agent);
  };

  const runEvaluation = async () => {
    if (!selectedScenarioId || !selectedAgent) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenarioId: selectedScenarioId,
          agentProfile: selectedAgent
        })
      });
      const data = await res.json();
      if (data.success && data.result) {
        setResult(data.result);
      } else {
        setError(data.error || 'Evaluation returned an error');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Network error executing evaluation');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#080A0F] text-slate-100 flex flex-col font-sans selection:bg-blue-600/30 selection:text-white">
      {/* Top Header */}
      <header className="border-b border-[#1A202E] bg-[#0C0F17]/90 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center space-x-3.5">
            <div className="w-8 h-8 rounded border border-blue-500/30 bg-blue-500/10 flex items-center justify-center text-blue-400">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-base tracking-tight text-white">Wallbit Agent Eval</span>
                <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#161B26] text-slate-400 border border-[#212738]">
                  v0.1.0
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Independent AI Agent Financial Safety Evaluation</p>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <div className="flex items-center gap-2 px-2.5 py-1 rounded bg-[#10141E] text-slate-300 border border-[#1C2230]">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[11px] text-slate-400">Mock API: <span className="font-mono text-emerald-400">127.0.0.1 (Ephemeral)</span></span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 w-full space-y-6">
        {/* Forensic Disclaimer */}
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3.5 text-xs text-amber-200/90 flex items-start gap-3">
          <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <span className="font-medium text-amber-300">Independent Research & Evaluation Harness</span>
            <p className="text-amber-200/80 leading-relaxed text-[11px]">
              This harness evaluates AI agents against a local Fastify mock of Wallbit endpoints. It is an independent open-source project by Souradeep Roy and is not an official Wallbit product. No real credentials or banking rails are contacted.
            </p>
          </div>
        </div>

        {/* Command Station: Scenario & Agent Selection */}
        <section className="bg-[#0E121B] rounded-xl border border-[#1A202E] p-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1A202E] pb-3">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-200">
              <Terminal className="w-3.5 h-3.5 text-blue-400" />
              <span>Evaluation Parameters</span>
            </div>

            {/* Quick Calibrated Presets */}
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="text-slate-400 mr-1 hidden sm:inline">Quick Presets:</span>
              <button
                type="button"
                onClick={() => applyPreset('trade-happy-path', 'safe')}
                className="px-2 py-0.5 rounded border border-[#1E2538] bg-[#121622] hover:bg-[#181D2C] text-slate-300 transition-colors"
              >
                Compliant Baseline
              </button>
              <button
                type="button"
                onClick={() => applyPreset('trade-network-timeout', 'unsafe-retry')}
                className="px-2 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 transition-colors"
              >
                Ambiguous Retry Breach
              </button>
              <button
                type="button"
                onClick={() => applyPreset('prompt-injection', 'prompt-injection-vulnerable')}
                className="px-2 py-0.5 rounded border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 transition-colors"
              >
                Prompt Injection Bypass
              </button>
              <button
                type="button"
                onClick={() => applyPreset('trade-429', 'rate-limit-bad')}
                className="px-2 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 transition-colors"
              >
                Rate Limit Hammer
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
            {/* Scenario Selector */}
            <div className="md:col-span-6 space-y-1.5">
              <label htmlFor="scenario-select" className="block text-xs font-medium text-slate-300">
                Predefined Scenario
              </label>
              <select
                id="scenario-select"
                value={selectedScenarioId}
                onChange={e => {
                  setSelectedScenarioId(e.target.value);
                  const s = scenarios.find(item => item.id === e.target.value);
                  if (s?.recommendedAgents.positiveControl) {
                    setSelectedAgent(s.recommendedAgents.positiveControl);
                  }
                }}
                disabled={fetchingConfig || loading}
                className="w-full bg-[#080A10] border border-[#212738] rounded-md px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500 transition-colors disabled:opacity-50"
              >
                {scenarios.map(s => (
                  <option key={s.id} value={s.id}>
                    [{s.category}] {s.name} — {s.description}
                  </option>
                ))}
              </select>
            </div>

            {/* Agent Profile Selector */}
            <div className="md:col-span-4 space-y-1.5">
              <label htmlFor="agent-select" className="block text-xs font-medium text-slate-300">
                Deterministic Agent Profile
              </label>
              <select
                id="agent-select"
                value={selectedAgent}
                onChange={e => setSelectedAgent(e.target.value)}
                disabled={fetchingConfig || loading}
                className="w-full bg-[#080A10] border border-[#212738] rounded-md px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500 transition-colors disabled:opacity-50"
              >
                {agentProfiles.map(p => (
                  <option key={p} value={p}>
                    {p} {p === 'safe' ? '(Compliant Control)' : p === 'rate-limit-good' ? '(Compliant Backoff)' : '(Adversarial Fault Model)'}
                  </option>
                ))}
              </select>
            </div>

            {/* Run Button */}
            <div className="md:col-span-2">
              <button
                type="button"
                onClick={runEvaluation}
                disabled={loading || fetchingConfig}
                className="w-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-medium px-4 py-2 rounded-md shadow-sm flex items-center justify-center gap-2 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                    <span>Executing...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-white" />
                    <span>Run Evaluation</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Scenario Details Inspection Card */}
          {selectedScenario && (
            <div className="bg-[#080B12] rounded-lg p-3.5 border border-[#1A202E] text-xs space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-200">{selectedScenario.name}</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[#161B26] text-slate-400 border border-[#212738]">
                    Category: {selectedScenario.category}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="text-slate-400">Positive Control: <strong className="text-emerald-400 font-mono">{selectedScenario.recommendedAgents.positiveControl}</strong></span>
                  {selectedScenario.recommendedAgents.negativeControl && (
                    <span className="text-slate-400">| Adversary: <strong className="text-rose-400 font-mono">{selectedScenario.recommendedAgents.negativeControl}</strong></span>
                  )}
                </div>
              </div>

              <p className="text-slate-400 leading-relaxed text-[11px] max-w-3xl">
                {selectedScenario.description}
              </p>

              <div className="bg-[#0C0F17] p-2.5 rounded border border-[#181D2B] font-mono text-[11px] text-slate-300">
                <span className="text-slate-500 select-none mr-2">Prompt:</span>
                &quot;{selectedScenario.prompt}&quot;
              </div>

              {selectedScenario.expectedBehavior?.length > 0 && (
                <div className="space-y-1 pt-1">
                  <span className="text-[11px] font-medium text-slate-300">Safety Invariants Required:</span>
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[11px] text-slate-400">
                    {selectedScenario.expectedBehavior.map((exp, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="text-blue-400 select-none">›</span>
                        <span>{exp}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Runtime Error Alert */}
        {error && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-xs text-rose-200 flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-rose-300">Evaluation Execution Error</p>
              <p className="text-rose-200/90 mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {/* Evaluation Output Section */}
        {result && (
          <section className="space-y-5">
            {/* Verdict Certificate Header */}
            <div
              className={`rounded-xl border p-5 transition-all ${
                result.passed
                  ? 'bg-emerald-950/15 border-emerald-500/30'
                  : 'bg-rose-950/15 border-rose-500/30'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      result.passed
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                    }`}
                  >
                    {result.passed ? (
                      <CheckCircle2 className="w-5 h-5" />
                    ) : (
                      <XCircle className="w-5 h-5" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold tracking-tight text-white">
                        {result.passed ? 'VERIFIED: PASS' : 'VIOLATION DETECTED: FAIL'}
                      </span>
                      <span
                        className={`text-[10px] font-mono px-2 py-0.5 rounded font-medium border ${
                          result.passed
                            ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                            : 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                        }`}
                      >
                        {result.passed ? 'ALL INVARIANTS SATISFIED' : `${result.criticalFailures} CRITICAL BREACHES`}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Scenario <span className="font-mono text-slate-200">{result.name}</span> evaluated against agent profile <span className="font-mono text-slate-200">{result.agentProfile}</span>
                    </p>
                  </div>
                </div>

                {/* Audit Metrics */}
                <div className="flex items-center gap-4 text-xs font-mono">
                  <div className="text-right">
                    <span className="text-[10px] text-slate-500 block uppercase">Duration</span>
                    <span className="text-slate-200 font-semibold">{result.durationMs}ms</span>
                  </div>
                  <div className="text-right border-l border-[#212738] pl-4">
                    <span className="text-[10px] text-slate-500 block uppercase">Assertions</span>
                    <span className="text-slate-200 font-semibold">
                      {result.summary.passedAssertions}/{result.summary.totalAssertions} Passed
                    </span>
                  </div>
                  <div className="text-right border-l border-[#212738] pl-4">
                    <span className="text-[10px] text-slate-500 block uppercase">Server Requests</span>
                    <span className="text-slate-200 font-semibold">{result.summary.totalRequestsObserved}</span>
                  </div>
                  <div className="text-right border-l border-[#212738] pl-4">
                    <span className="text-[10px] text-slate-500 block uppercase">Mutations</span>
                    <span className="text-slate-200 font-semibold">{result.summary.mutationsRecorded}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Tri-Pane Audit Docket */}
            <div className="bg-[#0E121B] rounded-xl border border-[#1A202E] overflow-hidden">
              {/* Tab Navigation */}
              <div className="flex border-b border-[#1A202E] bg-[#0A0D15] px-2 pt-2 gap-1 text-xs">
                <button
                  type="button"
                  onClick={() => setActiveTab('assertions')}
                  className={`px-4 py-2 rounded-t-lg font-medium flex items-center gap-2 border-t border-x transition-colors ${
                    activeTab === 'assertions'
                      ? 'bg-[#0E121B] text-white border-[#1A202E]'
                      : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-[#121622]/50'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Safety Invariants</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#181D2B] text-slate-300">
                    {result.assertions.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('requests')}
                  className={`px-4 py-2 rounded-t-lg font-medium flex items-center gap-2 border-t border-x transition-colors ${
                    activeTab === 'requests'
                      ? 'bg-[#0E121B] text-white border-[#1A202E]'
                      : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-[#121622]/50'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Network Stream & Trace</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#181D2B] text-slate-300">
                    {result.requests.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('mutations')}
                  className={`px-4 py-2 rounded-t-lg font-medium flex items-center gap-2 border-t border-x transition-colors ${
                    activeTab === 'mutations'
                      ? 'bg-[#0E121B] text-white border-[#1A202E]'
                      : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-[#121622]/50'
                  }`}
                >
                  <Database className="w-3.5 h-3.5" />
                  <span>Financial Mutation Ledger</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#181D2B] text-slate-300">
                    {result.mutations.length}
                  </span>
                </button>
              </div>

              {/* Tab 1: Safety Invariants & Assertions */}
              {activeTab === 'assertions' && (
                <div className="p-4 space-y-3">
                  <div className="text-xs text-slate-400 mb-1 flex items-center justify-between">
                    <span>Evidence-backed assertions verified by evaluator:</span>
                    <span className="text-slate-500">
                      {result.assertions.filter(a => a.passed).length}/{result.assertions.length} Invariants Verified
                    </span>
                  </div>

                  <div className="space-y-2.5">
                    {result.assertions.map((assertion, idx) => {
                      const itemId = `assertion-${idx}`;
                      const isExpanded = Boolean(expandedItems[itemId]);

                      return (
                        <div
                          key={idx}
                          className={`rounded-lg border p-3.5 text-xs transition-colors ${
                            assertion.passed
                              ? 'bg-[#0A0D15] border-[#181E2B]'
                              : 'bg-rose-950/10 border-rose-500/30'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-2.5">
                              {assertion.passed ? (
                                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                              ) : (
                                <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                              )}
                              <div className="space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-semibold text-slate-200">{assertion.description}</span>
                                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#141824] text-slate-400 border border-[#1E2536]">
                                    {assertion.type}
                                  </span>
                                </div>
                                {assertion.message && (
                                  <p
                                    className={`text-[11px] leading-relaxed ${
                                      assertion.passed ? 'text-slate-400' : 'text-rose-300 font-medium'
                                    }`}
                                  >
                                    {assertion.message}
                                  </p>
                                )}
                              </div>
                            </div>

                            {assertion.evidence && (
                              <button
                                type="button"
                                onClick={() => toggleExpand(itemId)}
                                className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 px-2 py-1 rounded border border-[#1E2536] bg-[#121622] transition-colors shrink-0"
                              >
                                <span>Evidence</span>
                                {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                              </button>
                            )}
                          </div>

                          {/* Expandable Evidence Drawer */}
                          {isExpanded && assertion.evidence && (
                            <div className="mt-3 pt-3 border-t border-[#1C2232] space-y-2 text-[11px] font-mono bg-[#07090F] p-3 rounded border">
                              {assertion.evidence.expected !== undefined && (
                                <div className="grid grid-cols-12 gap-2">
                                  <span className="col-span-3 text-slate-500">Expected:</span>
                                  <span className="col-span-9 text-slate-300 break-all">
                                    {typeof assertion.evidence.expected === 'object'
                                      ? JSON.stringify(assertion.evidence.expected)
                                      : String(assertion.evidence.expected)}
                                  </span>
                                </div>
                              )}
                              {assertion.evidence.observed !== undefined && (
                                <div className="grid grid-cols-12 gap-2">
                                  <span className="col-span-3 text-slate-500">Observed:</span>
                                  <span className="col-span-9 text-slate-300 break-all">
                                    {typeof assertion.evidence.observed === 'object'
                                      ? JSON.stringify(assertion.evidence.observed)
                                      : String(assertion.evidence.observed)}
                                  </span>
                                </div>
                              )}
                              {assertion.evidence.requestIds && assertion.evidence.requestIds.length > 0 && (
                                <div className="grid grid-cols-12 gap-2">
                                  <span className="col-span-3 text-slate-500">Request IDs:</span>
                                  <span className="col-span-9 text-blue-400 break-all">
                                    {assertion.evidence.requestIds.join(', ')}
                                  </span>
                                </div>
                              )}
                              {assertion.evidence.details && (
                                <div className="grid grid-cols-12 gap-2">
                                  <span className="col-span-3 text-slate-500">Details:</span>
                                  <pre className="col-span-9 text-slate-300 text-[10px] overflow-x-auto">
                                    {JSON.stringify(assertion.evidence.details, null, 2)}
                                  </pre>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Tab 2: Network Stream & Requests */}
              {activeTab === 'requests' && (
                <div className="p-4 space-y-3">
                  <div className="text-xs text-slate-400 mb-2 flex items-center justify-between">
                    <span>Server-observed requests and correlated client attempts:</span>
                    <span className="text-slate-500 font-mono">Total: {result.requests.length}</span>
                  </div>

                  {result.requests.length === 0 ? (
                    <div className="text-center py-8 text-xs text-slate-500">
                      0 HTTP requests reached the server (agent refrained from calling API).
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {result.requests.map((req, idx) => {
                        const itemId = `request-${idx}`;
                        const isExpanded = Boolean(expandedItems[itemId]);

                        return (
                          <div
                            key={req.id || idx}
                            className={`rounded-lg border p-3.5 text-xs space-y-3 transition-colors ${
                              req.statusCategory === 'reached_server_mutation_response_lost'
                                ? 'bg-amber-950/15 border-amber-500/30'
                                : req.statusCategory === 'reached_server_with_response_and_mutation'
                                ? 'bg-[#0A0D15] border-[#181E2B]'
                                : req.statusCategory === 'never_reached_server'
                                ? 'bg-rose-950/10 border-rose-500/30 border-dashed'
                                : 'bg-[#0A0D15] border-[#181E2B]'
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="px-1.5 py-0.5 rounded font-mono font-semibold bg-blue-500/15 text-blue-300 border border-blue-500/30 text-[11px]">
                                  {req.method}
                                </span>
                                <span className="font-mono text-xs text-slate-200">{req.path}</span>
                                <span className="text-slate-500 text-[11px] font-mono">
                                  id: {req.id}
                                </span>
                              </div>

                              <div className="flex items-center gap-2">
                                {/* State Category Pill */}
                                {req.statusCategory === 'never_reached_server' && (
                                  <span className="px-2 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30 text-[10px] font-medium">
                                    Never Reached Server (Client Attempt)
                                  </span>
                                )}
                                {req.statusCategory === 'reached_server_mutation_response_lost' && (
                                  <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px] font-medium">
                                    Mutation Recorded, Response Lost (accepted_then_lost)
                                  </span>
                                )}
                                {req.statusCategory === 'reached_server_with_response_and_mutation' && (
                                  <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] font-medium">
                                    Mutation Recorded + Response Delivered
                                  </span>
                                )}
                                {req.statusCategory === 'reached_server_no_mutation' && (
                                  <span className="px-2 py-0.5 rounded bg-[#141824] text-slate-300 border border-[#1E2536] text-[10px] font-medium">
                                    No State Mutation
                                  </span>
                                )}

                                {/* HTTP Status Code */}
                                {req.response && (
                                  <span
                                    className={`px-2 py-0.5 rounded font-mono font-semibold text-[11px] ${
                                      req.response.status >= 200 && req.response.status < 300
                                        ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                        : req.response.status === 429
                                        ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                                        : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                                    }`}
                                  >
                                    HTTP {req.response.status}
                                  </span>
                                )}

                                <button
                                  type="button"
                                  onClick={() => toggleExpand(itemId)}
                                  className="text-slate-400 hover:text-slate-200 p-1 rounded hover:bg-[#181D2C] transition-colors"
                                >
                                  {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                </button>
                              </div>
                            </div>

                            <p className="text-[11px] text-slate-400 leading-relaxed">
                              {req.statusExplanation}
                            </p>

                            {/* Correlated Mutation Tag */}
                            {req.mutation && (
                              <div className="bg-[#080B12] rounded p-2 border border-[#181D2B] flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
                                <div className="flex items-center gap-2">
                                  <span className="text-emerald-400">✓ Financial Mutation Correlated:</span>
                                  <span className="text-slate-200">{req.mutation.semanticKey}</span>
                                </div>
                                <span className="text-slate-500 text-[10px]">Type: {req.mutation.type}</span>
                              </div>
                            )}

                            {/* Expandable Payload & Headers Drawer */}
                            {isExpanded && (
                              <div className="pt-2 border-t border-[#181D2B] space-y-2 text-[11px] font-mono">
                                {Boolean(req.body) && (
                                  <div>
                                    <span className="text-slate-500 block mb-1">Request Payload:</span>
                                    <pre className="p-2 rounded bg-[#07090F] border border-[#181D2B] text-slate-300 overflow-x-auto text-[10px]">
                                      {JSON.stringify(req.body, null, 2)}
                                    </pre>
                                  </div>
                                )}
                                {Boolean(req.response?.body) && (
                                  <div>
                                    <span className="text-slate-500 block mb-1">Server Response Body:</span>
                                    <pre className="p-2 rounded bg-[#07090F] border border-[#181D2B] text-slate-300 overflow-x-auto text-[10px]">
                                      {JSON.stringify(req.response?.body, null, 2)}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Tab 3: Financial Mutation Ledger */}
              {activeTab === 'mutations' && (
                <div className="p-4 space-y-3">
                  <div className="text-xs text-slate-400 mb-2 flex items-center justify-between">
                    <span>Server-observed financial mutations committed to state:</span>
                    <span className="text-slate-500 font-mono">Total Mutations: {result.mutations.length}</span>
                  </div>

                  {result.mutations.length === 0 ? (
                    <div className="text-center py-8 text-xs text-slate-500">
                      0 financial state mutations occurred in this scenario.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-[#1A202E] text-slate-400 font-medium">
                            <th className="py-2 px-3">Type</th>
                            <th className="py-2 px-3">Canonical Semantic Key</th>
                            <th className="py-2 px-3">Correlated Request ID</th>
                            <th className="py-2 px-3">Timestamp</th>
                            <th className="py-2 px-3">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#181D2B] font-mono text-[11px]">
                          {result.mutations.map((mut, idx) => (
                            <tr key={idx} className="hover:bg-[#121622]/50 transition-colors">
                              <td className="py-2.5 px-3">
                                <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] font-semibold">
                                  {mut.type.toUpperCase()}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-slate-200">{mut.semanticKey}</td>
                              <td className="py-2.5 px-3 text-blue-400">{mut.requestId}</td>
                              <td className="py-2.5 px-3 text-slate-400">{new Date(mut.timestamp).toLocaleTimeString()}</td>
                              <td className="py-2.5 px-3">
                                <span className="text-slate-300">{mut.status}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {/* Empty State / Getting Started Invite */}
        {!result && !loading && !error && (
          <div className="text-center py-14 px-4 border border-dashed border-[#1C2232] rounded-xl bg-[#090C14] space-y-3">
            <div className="w-10 h-10 rounded-full bg-[#121624] border border-[#1E2538] flex items-center justify-center mx-auto text-slate-400">
              <Cpu className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-slate-200">Evaluation Console Ready</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                Select a scenario and an agent profile above, or use one of the quick presets to test compliant behavior vs adversarial fault models.
              </p>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#181D2B] bg-[#07090F] py-4 text-center text-xs text-slate-500 mt-auto">
        <div className="max-w-7xl mx-auto px-4 flex flex-wrap items-center justify-between gap-2">
          <span>Wallbit Agent Eval &bull; Author: Souradeep Roy</span>
          <span>Fastify Local Mock Engine &bull; Zero External Network Calls</span>
        </div>
      </footer>
    </div>
  );
}
