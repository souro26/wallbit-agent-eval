'use client';

import React, { useState, useEffect } from 'react';
import type { FormattedEvaluationResult, ScenarioSummary } from 'wallbit-agent-eval';
import {
  ShieldCheck,
  Play,
  RotateCcw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Server,
  Activity,
  Database,
  Layers,
  Terminal,
  ChevronDown,
  ChevronUp
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
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* Top Header */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 ring-1 ring-white/10">
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg tracking-tight text-white">Wallbit Agent Eval</span>
                <span className="text-[10px] uppercase font-semibold tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  Harness v0.1.0
                </span>
              </div>
              <p className="text-xs text-slate-400">Independent AI Agent Financial Safety Evaluation</p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800/80 text-slate-300 border border-slate-700/60">
              <Server className="w-3.5 h-3.5 text-emerald-400" />
              <span>Fastify Mock Engine: <strong className="text-emerald-400">Isolated Ephemeral</strong></span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 w-full space-y-6">
        {/* Independence Disclaimer Banner */}
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs sm:text-sm text-amber-200/90 flex items-start gap-3 shadow-sm">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-amber-300">
              Notice: Independent Evaluation Harness
            </p>
            <p className="text-amber-200/80 leading-relaxed text-xs">
              This is an independent open-source evaluation harness testing AI agent safety invariants against a local Fastify mock API. It is not an official Wallbit product and does not connect to Wallbit production systems or external banking rails. All state mutations and HTTP logs are observed in a local ephemeral mock server.
            </p>
          </div>
        </div>

        {/* Configuration Bar */}
        <section className="bg-slate-900/90 rounded-2xl border border-slate-800 shadow-xl p-5 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
              <Terminal className="w-4 h-4 text-indigo-400" />
              <span>Configure Scenario & Control Profile</span>
            </div>
            {selectedScenario?.recommendedAgents && (
              <div className="hidden sm:flex items-center gap-2 text-xs">
                <span className="text-slate-400">Recommended:</span>
                <button
                  type="button"
                  onClick={() => setSelectedAgent(selectedScenario.recommendedAgents.positiveControl)}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-colors ${
                    selectedAgent === selectedScenario.recommendedAgents.positiveControl
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                      : 'bg-slate-800 text-slate-300 border-slate-700 hover:border-slate-600'
                  }`}
                >
                  ✓ {selectedScenario.recommendedAgents.positiveControl} (Safe)
                </button>
                {selectedScenario.recommendedAgents.negativeControl && (
                  <button
                    type="button"
                    onClick={() => setSelectedAgent(selectedScenario.recommendedAgents.negativeControl!)}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-colors ${
                      selectedAgent === selectedScenario.recommendedAgents.negativeControl
                        ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                        : 'bg-slate-800 text-slate-300 border-slate-700 hover:border-slate-600'
                    }`}
                  >
                    ✗ {selectedScenario.recommendedAgents.negativeControl} (Adversarial)
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
            {/* Scenario Selector */}
            <div className="md:col-span-6 space-y-1.5">
              <label htmlFor="scenario-select" className="block text-xs font-medium text-slate-300">
                Predefined Evaluation Scenario
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
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-colors disabled:opacity-50"
              >
                {scenarios.map(s => (
                  <option key={s.id} value={s.id}>
                    [{s.category.toUpperCase()}] {s.name} — {s.description}
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
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-colors disabled:opacity-50"
              >
                {agentProfiles.map(p => (
                  <option key={p} value={p}>
                    {p} {p === 'safe' ? '(Compliant)' : p === 'rate-limit-good' ? '(Compliant Backoff)' : '(Adversarial / Faulty)'}
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
                className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 active:scale-[0.98] text-white font-medium px-4 py-2.5 rounded-lg shadow-lg shadow-indigo-500/25 flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <RotateCcw className="w-4 h-4 animate-spin text-white" />
                    <span>Evaluating...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-white" />
                    <span>Run Eval</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Scenario Details Preview */}
          {selectedScenario && (
            <div className="bg-slate-950/70 rounded-xl p-3.5 border border-slate-800/80 text-xs space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-200">Selected Scenario:</span>
                <span className="font-mono text-indigo-400">{selectedScenario.name}</span>
                <span className="text-slate-500">|</span>
                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                  Category: {selectedScenario.category}
                </span>
                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                  Severity: {selectedScenario.severity}
                </span>
              </div>
              <div className="text-slate-400">
                <strong className="text-slate-300">Agent Prompt:</strong> &quot;{selectedScenario.prompt}&quot;
              </div>
            </div>
          )}
        </section>

        {/* Error Display */}
        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300 flex items-start gap-3 animate-in fade-in duration-200">
            <XCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-rose-200">Evaluation Execution Error</p>
              <p className="text-xs text-rose-300/90 mt-0.5 font-mono">{error}</p>
            </div>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-12 text-center space-y-4">
            <div className="inline-flex p-3 rounded-2xl bg-indigo-500/10 ring-1 ring-indigo-500/20">
              <RotateCcw className="w-8 h-8 text-indigo-400 animate-spin" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-white">Running Isolated Server-Side Evaluation</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Spinning up ephemeral Fastify mock instance on local loopback, generating agent traffic, recording server mutations, and evaluating invariants...
              </p>
            </div>
          </div>
        )}

        {/* Evaluation Result View */}
        {result && (
          <div className="space-y-6 animate-in fade-in-50 duration-300">
            {/* Verdict Card */}
            <div
              className={`rounded-2xl border p-6 shadow-xl relative overflow-hidden ${
                result.passed
                  ? 'bg-gradient-to-br from-emerald-950/40 via-slate-900 to-slate-950 border-emerald-500/40'
                  : 'bg-gradient-to-br from-rose-950/40 via-slate-900 to-slate-950 border-rose-500/40'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div
                    className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg ${
                      result.passed
                        ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30'
                        : 'bg-rose-500/20 text-rose-400 ring-1 ring-rose-500/30'
                    }`}
                  >
                    {result.passed ? (
                      <CheckCircle2 className="w-8 h-8" />
                    ) : (
                      <XCircle className="w-8 h-8" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-3">
                      <span
                        className={`text-2xl font-black tracking-tight uppercase ${
                          result.passed ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {result.passed ? 'EVALUATION PASSED' : 'EVALUATION FAILED'}
                      </span>
                      <span className="text-xs px-2.5 py-0.5 rounded-full font-mono font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                        {result.durationMs}ms
                      </span>
                    </div>
                    <p className="text-sm text-slate-300 mt-1">
                      Scenario <span className="font-mono text-indigo-400 font-semibold">{result.name}</span> tested against{' '}
                      <span className="font-mono text-amber-300 font-semibold">{result.agentProfile}</span> agent profile.
                    </p>
                  </div>
                </div>

                {/* Metrics Badges */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="bg-slate-900/90 border border-slate-800 rounded-xl px-3.5 py-2 text-center min-w-[90px]">
                    <div className="text-xs text-slate-400">Assertions</div>
                    <div className="text-sm font-bold text-slate-200">
                      <span className="text-emerald-400">{result.summary.passedAssertions}</span> / {result.summary.totalAssertions}
                    </div>
                  </div>
                  <div className="bg-slate-900/90 border border-slate-800 rounded-xl px-3.5 py-2 text-center min-w-[90px]">
                    <div className="text-xs text-slate-400">HTTP Requests</div>
                    <div className="text-sm font-bold text-slate-200">{result.summary.totalRequestsObserved}</div>
                  </div>
                  <div className="bg-slate-900/90 border border-slate-800 rounded-xl px-3.5 py-2 text-center min-w-[90px]">
                    <div className="text-xs text-slate-400">Mutations</div>
                    <div className="text-sm font-bold text-indigo-400">{result.summary.mutationsRecorded}</div>
                  </div>
                </div>
              </div>

              {/* Evaluator Explanation Banner on Failure */}
              {!result.passed && (
                <div className="mt-4 pt-4 border-t border-slate-800/80 text-xs text-rose-300 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-rose-200">Evaluator Safety Invariant Violation:</strong>{' '}
                    {result.assertions.filter(a => !a.passed).map(a => a.message).join(' | ')}
                  </div>
                </div>
              )}
            </div>

            {/* Tabs for Details */}
            <div className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
              <div className="flex border-b border-slate-800 bg-slate-950/60 px-4">
                <button
                  type="button"
                  onClick={() => setActiveTab('assertions')}
                  className={`py-3 px-4 text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors ${
                    activeTab === 'assertions'
                      ? 'border-indigo-500 text-indigo-400'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>Assertions ({result.assertions.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('requests')}
                  className={`py-3 px-4 text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors ${
                    activeTab === 'requests'
                      ? 'border-indigo-500 text-indigo-400'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Activity className="w-4 h-4" />
                  <span>Server-Observed Requests ({result.requests.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('mutations')}
                  className={`py-3 px-4 text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors ${
                    activeTab === 'mutations'
                      ? 'border-indigo-500 text-indigo-400'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Database className="w-4 h-4" />
                  <span>Financial Mutations ({result.mutations.length})</span>
                </button>
              </div>

              {/* Tab: Assertions */}
              {activeTab === 'assertions' && (
                <div className="divide-y divide-slate-800/80 p-4 space-y-3">
                  {result.assertions.map((assertion, idx) => (
                    <div
                      key={idx}
                      className={`p-4 rounded-xl border transition-all ${
                        assertion.passed
                          ? 'bg-slate-950/40 border-slate-800/80'
                          : 'bg-rose-950/20 border-rose-500/30 ring-1 ring-rose-500/20'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          {assertion.passed ? (
                            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                          ) : (
                            <XCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                          )}
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-sm text-slate-200">
                                {assertion.description}
                              </span>
                              <span
                                className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded ${
                                  assertion.severity === 'critical'
                                    ? 'bg-rose-500/20 text-rose-300'
                                    : 'bg-amber-500/20 text-amber-300'
                                }`}
                              >
                                {assertion.severity}
                              </span>
                              <span className="text-[10px] font-mono text-slate-500">
                                type: {assertion.type}
                              </span>
                            </div>
                            <p
                              className={`text-xs mt-1 font-medium ${
                                assertion.passed ? 'text-slate-400' : 'text-rose-300'
                              }`}
                            >
                              {assertion.message}
                            </p>
                          </div>
                        </div>

                        {assertion.evidence && (
                          <button
                            type="button"
                            onClick={() => toggleExpand(`assertion-${idx}`)}
                            className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 shrink-0 p-1"
                          >
                            <span>Evidence</span>
                            {expandedItems[`assertion-${idx}`] ? (
                              <ChevronUp className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}
                      </div>

                      {/* Evidence Details */}
                      {assertion.evidence && expandedItems[`assertion-${idx}`] && (
                        <div className="mt-3 pt-3 border-t border-slate-800/80 bg-slate-950 rounded-lg p-3 text-xs font-mono space-y-2">
                          {Boolean(assertion.evidence.expected) && (
                            <div>
                              <span className="text-slate-500">Expected: </span>
                              <span className="text-emerald-400">
                                {String(assertion.evidence.expected)}
                              </span>
                            </div>
                          )}
                          {Boolean(assertion.evidence.observed) && (
                            <div>
                              <span className="text-slate-500">Observed: </span>
                              <span className="text-amber-400">
                                {String(assertion.evidence.observed)}
                              </span>
                            </div>
                          )}
                          {assertion.evidence.requestIds && assertion.evidence.requestIds.length > 0 && (
                            <div>
                              <span className="text-slate-500">Correlated Request IDs: </span>
                              <span className="text-indigo-300">
                                {assertion.evidence.requestIds.join(', ')}
                              </span>
                            </div>
                          )}
                          {assertion.evidence.details && (
                            <div className="mt-1">
                              <span className="text-slate-500">Details: </span>
                              <pre className="text-[11px] text-slate-300 mt-1 overflow-x-auto bg-slate-900 p-2 rounded">
                                {JSON.stringify(assertion.evidence.details, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Tab: Requests */}
              {activeTab === 'requests' && (
                <div className="p-4 space-y-3">
                  <div className="text-xs text-slate-400 mb-2 flex items-center justify-between">
                    <span>Server-observed requests and correlated client attempts:</span>
                    <span className="text-slate-500">Total: {result.requests.length}</span>
                  </div>

                  {result.requests.length === 0 ? (
                    <div className="text-center py-8 text-xs text-slate-500">
                      0 HTTP requests reached the server (agent refrained from calling endpoints).
                    </div>
                  ) : (
                    result.requests.map((req, idx) => (
                      <div
                        key={req.id || idx}
                        className={`rounded-xl border p-4 text-xs space-y-3 ${
                          req.statusCategory === 'reached_server_mutation_response_lost'
                            ? 'bg-amber-950/20 border-amber-500/40 ring-1 ring-amber-500/20'
                            : req.statusCategory === 'reached_server_with_response_and_mutation'
                            ? 'bg-slate-950/60 border-slate-800'
                            : req.statusCategory === 'never_reached_server'
                            ? 'bg-rose-950/10 border-rose-500/30 border-dashed'
                            : 'bg-slate-950/40 border-slate-800/80'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded font-mono font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                              {req.method}
                            </span>
                            <span className="font-mono text-sm text-slate-200">{req.path}</span>
                            <span className="text-slate-500 text-[11px] font-mono">
                              id: {req.id}
                            </span>
                          </div>

                          {/* Category Badge */}
                          <div className="flex items-center gap-2">
                            {req.statusCategory === 'never_reached_server' && (
                              <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 font-semibold text-[10px]">
                                Never Reached Server
                              </span>
                            )}
                            {req.statusCategory === 'reached_server_mutation_response_lost' && (
                              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-semibold text-[10px]">
                                Accepted & Lost (Response Omitted)
                              </span>
                            )}
                            {req.statusCategory === 'reached_server_with_response_and_mutation' && (
                              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold text-[10px]">
                                Mutation + Response Delivered
                              </span>
                            )}
                            {req.statusCategory === 'reached_server_no_mutation' && (
                              <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-semibold text-[10px]">
                                No Mutation
                              </span>
                            )}

                            {req.response && (
                              <span
                                className={`px-2 py-0.5 rounded font-mono font-bold text-[11px] ${
                                  req.response.status >= 200 && req.response.status < 300
                                    ? 'bg-emerald-500/20 text-emerald-300'
                                    : req.response.status === 429
                                    ? 'bg-amber-500/20 text-amber-300'
                                    : 'bg-rose-500/20 text-rose-300'
                                }`}
                              >
                                HTTP {req.response.status}
                              </span>
                            )}
                          </div>
                        </div>

                        <p className="text-slate-400 text-xs">
                          <strong className="text-slate-300">Observation Status:</strong> {req.statusExplanation}
                        </p>

                        {/* Request Body & Response Info */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-slate-800/60 font-mono text-[11px]">
                          <div>
                            <span className="text-slate-500">Request Body:</span>
                            <pre className="mt-1 bg-slate-900/80 p-2 rounded text-slate-300 overflow-x-auto">
                              {req.body ? JSON.stringify(req.body, null, 2) : '(none)'}
                            </pre>
                          </div>
                          <div>
                            <span className="text-slate-500">Response Body / Status:</span>
                            <pre className="mt-1 bg-slate-900/80 p-2 rounded text-slate-300 overflow-x-auto">
                              {req.response
                                ? JSON.stringify(req.response.body, null, 2)
                                : '(Connection destroyed without response)'}
                            </pre>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Tab: Mutations */}
              {activeTab === 'mutations' && (
                <div className="p-4 space-y-3">
                  <div className="text-xs text-slate-400 mb-2">
                    Actual financial mutations recorded in server memory (ground truth):
                  </div>

                  {result.mutations.length === 0 ? (
                    <div className="text-center py-8 text-xs text-slate-500">
                      0 financial mutations recorded on the mock server.
                    </div>
                  ) : (
                    result.mutations.map((mut, idx) => (
                      <div
                        key={idx}
                        className="rounded-xl border border-indigo-500/20 bg-indigo-950/10 p-4 text-xs font-mono space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-bold uppercase text-[10px]">
                              {mut.type}
                            </span>
                            <span className="text-sm font-semibold text-slate-200">
                              {mut.semanticKey}
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-500">
                            status: {mut.status}
                          </span>
                        </div>
                        <div className="text-slate-400 text-[11px] pt-1 border-t border-slate-800/80 flex flex-wrap gap-4">
                          <span>
                            Linked HTTP Request ID: <strong className="text-indigo-400">{mut.requestId}</strong>
                          </span>
                          <span>Timestamp: {mut.timestamp}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Empty State */}
        {!result && !loading && !error && (
          <div className="bg-slate-900/40 rounded-2xl border border-slate-800/80 p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
              <Layers className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-slate-200">Ready for Evaluation</h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
              Select a predefined scenario and agent profile above, then click &quot;Run Eval&quot;. The evaluator will inspect actual server-observed requests, responses, and state mutations to produce an evidence-backed report.
            </p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/60 bg-slate-950 text-slate-500 py-4 text-center text-xs">
        <p>Wallbit Agent Eval — Independent Developer Tool by Souradeep Roy</p>
      </footer>
    </div>
  );
}
