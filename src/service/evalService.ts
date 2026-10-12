import { getBuiltinScenarios, getScenarioByName } from '../scenarios/registry.js';
import { createMockServer, type MockWallbitApi } from '../api/mock-server.js';
import { createHttpClientDriver } from '../adapters/HttpClientDriver.js';
import { runEvaluation } from '../evaluation/evaluator.js';
import { classifyRequestOutcome } from '../scenarios/builtins.js';
import type { Scenario } from '../types.js';

export const ALLOWED_AGENT_PROFILES = [
  'safe',
  'unsafe-retry',
  'approval-bypass',
  'prompt-injection-vulnerable',
  'unauthorized-action',
  'malformed-request',
  'concurrent-duplicate',
  'rate-limit-bad',
  'rate-limit-good'
] as const;

export type AllowedAgentProfile = (typeof ALLOWED_AGENT_PROFILES)[number];

export interface ScenarioSummary {
  id: string;
  name: string;
  description: string;
  category: string;
  severity: string;
  prompt: string;
  expectedBehavior: string[];
  forbiddenBehavior: string[];
  recommendedAgents: {
    positiveControl: string;
    negativeControl?: string;
  };
}

export interface CategorizedRequest {
  id: string;
  method: string;
  path: string;
  timestamp: number;
  headers?: Record<string, string>;
  body?: unknown;
  statusCategory:
    | 'reached_server_with_response_and_mutation'
    | 'reached_server_mutation_response_lost'
    | 'reached_server_no_mutation'
    | 'never_reached_server';
  statusExplanation: string;
  response?: {
    status: number;
    headers?: Record<string, string>;
    body?: unknown;
    timestamp?: number;
  };
  mutation?: {
    type: string;
    semanticKey: string;
    timestamp: number;
    requestId: string;
  };
}

export interface FormattedEvaluationResult {
  id: string;
  name: string;
  description: string;
  category: string;
  severity: string;
  passed: boolean;
  agentProfile: string;
  durationMs: number;
  criticalFailures: number;
  error?: string;
  assertions: Array<{
    type: string;
    description: string;
    severity: 'critical' | 'warning' | 'info';
    passed: boolean;
    message: string;
    evidence?: {
      expected?: unknown;
      observed?: unknown;
      requestIds?: string[];
      timestamps?: number[];
      details?: Record<string, unknown>;
    };
  }>;
  requests: CategorizedRequest[];
  mutations: Array<{
    type: string;
    semanticKey: string;
    timestamp: number;
    requestId: string;
    status: string;
  }>;
  summary: {
    totalAssertions: number;
    passedAssertions: number;
    failedAssertions: number;
    totalRequestsObserved: number;
    totalClientAttempts?: number;
    mutationsRecorded: number;
    responsesDelivered: number;
  };
}

const SCENARIO_AGENT_RECOMMENDATIONS: Record<string, { positiveControl: string; negativeControl?: string }> = {
  'trade-happy-path': { positiveControl: 'safe', negativeControl: 'approval-bypass' },
  'trade-denied': { positiveControl: 'safe' },
  'trade-approval-timeout': { positiveControl: 'safe' },
  'trade-429': { positiveControl: 'rate-limit-good', negativeControl: 'rate-limit-bad' },
  'trade-500': { positiveControl: 'safe', negativeControl: 'unsafe-retry' },
  'trade-network-timeout': { positiveControl: 'safe', negativeControl: 'unsafe-retry' },
  'malformed-parameters': { positiveControl: 'safe', negativeControl: 'malformed-request' },
  'concurrent-trades': { positiveControl: 'safe', negativeControl: 'concurrent-duplicate' },
  'prompt-injection': { positiveControl: 'safe', negativeControl: 'prompt-injection-vulnerable' },
  'unauthorized-action': { positiveControl: 'safe', negativeControl: 'unauthorized-action' },
  'operation-happy-path': { positiveControl: 'safe', negativeControl: 'approval-bypass' },
  'operation-network-timeout': { positiveControl: 'safe', negativeControl: 'unsafe-retry' }
};

export function getSupportedScenarios(): ScenarioSummary[] {
  const builtin = getBuiltinScenarios();
  return builtin.map(s => ({
    id: s.id,
    name: s.name,
    description: s.description,
    category: s.category,
    severity: s.severity,
    prompt: s.prompt,
    expectedBehavior: s.expectedBehavior || [],
    forbiddenBehavior: s.forbiddenBehavior || [],
    recommendedAgents: SCENARIO_AGENT_RECOMMENDATIONS[s.id] || { positiveControl: 'safe' }
  }));
}

export function getSupportedAgentProfiles(): string[] {
  return [...ALLOWED_AGENT_PROFILES];
}

let activeEvaluationCount = 0;
const MAX_CONCURRENT_EVALS = 4;

export function getActiveEvaluationCount(): number {
  return activeEvaluationCount;
}

export async function executeEvaluationService(
  scenarioId: string,
  agentProfile: string,
  timeoutMs = 25000
): Promise<FormattedEvaluationResult> {
  // Validate scenario
  if (!scenarioId || typeof scenarioId !== 'string') {
    throw new Error('scenarioId must be a non-empty string');
  }
  const scenario = getScenarioByName(scenarioId.trim());
  if (!scenario) {
    throw new Error(`Unknown scenario: "${scenarioId}". Only predefined scenarios are allowed.`);
  }

  // Validate agent profile
  if (!agentProfile || typeof agentProfile !== 'string') {
    throw new Error('agentProfile must be a non-empty string');
  }
  const cleanProfile = agentProfile.trim() as AllowedAgentProfile;
  if (!ALLOWED_AGENT_PROFILES.includes(cleanProfile)) {
    throw new Error(
      `Invalid agent profile: "${agentProfile}". Allowed profiles: ${ALLOWED_AGENT_PROFILES.join(', ')}`
    );
  }

  // Concurrency guard
  if (activeEvaluationCount >= MAX_CONCURRENT_EVALS) {
    throw new Error('Evaluation server is currently busy. Maximum concurrent evaluations reached. Please retry shortly.');
  }

  activeEvaluationCount++;
  const boundedTimeout = Math.min(Math.max(timeoutMs, 2000), 30000);

  let serverInstance: { close: () => Promise<unknown> } | undefined;

  try {
    // Each evaluation instantiates its own isolated Fastify mock server on an ephemeral loopback port
    const { api: mockApi, server, url } = await createMockServer(0);
    serverInstance = server;

    const driver = createHttpClientDriver(url, 'test-key', cleanProfile);

    const evalPromise = runEvaluation(driver, mockApi, scenario);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Evaluation timed out after ${boundedTimeout}ms`));
      }, boundedTimeout).unref();
    });

    const rawResult = await Promise.race([evalPromise, timeoutPromise]);
    return formatAndCategorizeResult(rawResult, scenario, cleanProfile, mockApi);
  } finally {
    activeEvaluationCount = Math.max(0, activeEvaluationCount - 1);
    if (serverInstance) {
      try {
        await serverInstance.close();
      } catch {
        // Ignore cleanup error
      }
    }
  }
}

function sanitizeString(str?: string): string | undefined {
  if (!str) return str;
  // Strip local filesystem paths from machine
  return str.replace(/[A-Za-z]:\\[^"'\s\n\r]+/g, '[system_path]').replace(/\/home\/[^"'\s\n\r]+/g, '[system_path]');
}

function formatAndCategorizeResult(
  rawResult: any,
  scenario: Scenario,
  agentProfile: string,
  mockApi: MockWallbitApi
): FormattedEvaluationResult {
  const trace = rawResult.trace || {};
  const serverRequests: any[] = trace.httpRequests || [];
  const serverResponses: any[] = trace.httpResponses || [];
  const serverMutations: any[] = trace.mutations || [];
  const clientRequests: any[] = trace.clientHttpRequests || [];
  const clientResponses: any[] = trace.clientHttpResponses || [];

  // Categorize authoritative server-observed HTTP requests
  const categorizedServerRequests: CategorizedRequest[] = serverRequests.map(req => {
    const res = serverResponses.find(r => r.requestId === req.id);
    const mutation = serverMutations.find(m => m.requestId === req.id || m.httpRequestId === req.id);
    const outcome = classifyRequestOutcome(req, trace, mockApi.getState());

    let statusCategory: CategorizedRequest['statusCategory'];
    let statusExplanation: string;

    if (outcome.type === 'accepted_then_lost') {
      statusCategory = 'reached_server_mutation_response_lost';
      statusExplanation = 'Request reached server; financial mutation recorded, but HTTP response was deliberately omitted/lost (accepted_then_lost).';
    } else if (mutation && res) {
      statusCategory = 'reached_server_with_response_and_mutation';
      statusExplanation = `Request reached server; financial mutation recorded and HTTP ${res.status} response returned.`;
    } else if (mutation && !res) {
      statusCategory = 'reached_server_mutation_response_lost';
      statusExplanation = 'Request reached server; financial mutation recorded, but connection dropped before response delivery.';
    } else if (!mutation && res) {
      statusCategory = 'reached_server_no_mutation';
      statusExplanation = `Request reached server; HTTP ${res.status} returned without creating a financial mutation.`;
    } else {
      statusCategory = 'reached_server_no_mutation';
      statusExplanation = 'Request reached server, but no mutation was recorded and connection was dropped before response.';
    }

    return {
      id: req.id,
      method: req.method,
      path: req.path,
      timestamp: req.timestamp,
      headers: req.headers,
      body: req.body,
      statusCategory,
      statusExplanation,
      response: res ? {
        status: res.status,
        headers: res.headers,
        body: res.body,
        timestamp: res.timestamp
      } : undefined,
      mutation: mutation ? {
        type: mutation.type,
        semanticKey: mutation.semanticKey,
        timestamp: mutation.timestamp,
        requestId: mutation.requestId || req.id
      } : undefined
    };
  });

  // Correlate client-side attempts that never reached the mock server
  const serverObservedIds = new Set(serverRequests.map(r => r.id));
  const unreachedClientRequests: CategorizedRequest[] = clientRequests
    .filter(cReq => !serverObservedIds.has(cReq.id))
    .map(cReq => {
      const clientRes = clientResponses.find(r => r.requestId === cReq.id);
      return {
        id: cReq.id,
        method: cReq.method,
        path: cReq.path,
        timestamp: cReq.timestamp,
        headers: cReq.headers,
        body: cReq.body,
        statusCategory: 'never_reached_server',
        statusExplanation: 'Client attempted HTTP request, but the request never reached the mock server (aborted, blocked, or connection failed).',
        response: clientRes ? {
          status: clientRes.status,
          headers: clientRes.headers,
          body: clientRes.body,
          timestamp: clientRes.timestamp
        } : undefined,
        mutation: undefined
      };
    });

  const allRequests = [...categorizedServerRequests, ...unreachedClientRequests].sort(
    (a, b) => a.timestamp - b.timestamp
  );

  const assertions = (rawResult.assertions || []).map((a: any) => ({
    type: a.expectation?.type || 'assertion',
    description: a.expectation?.description || 'Scenario Assertion',
    severity: (a.expectation?.severity || 'critical') as 'critical' | 'warning' | 'info',
    passed: Boolean(a.result?.passed),
    message: sanitizeString(a.result?.message) || '',
    evidence: a.result?.evidence ? {
      expected: a.result.evidence.expected,
      observed: sanitizeString(typeof a.result.evidence.observed === 'string' ? a.result.evidence.observed : JSON.stringify(a.result.evidence.observed)),
      requestIds: a.result.evidence.requestIds || [],
      timestamps: a.result.evidence.timestamps || [],
      details: a.result.evidence.details
    } : undefined
  }));

  const passedAssertions = assertions.filter((a: any) => a.passed).length;
  const failedAssertions = assertions.filter((a: any) => !a.passed).length;

  return {
    id: scenario.id,
    name: scenario.name,
    description: scenario.description,
    category: scenario.category,
    severity: scenario.severity,
    passed: Boolean(rawResult.passed),
    agentProfile,
    durationMs: rawResult.durationMs || 0,
    criticalFailures: rawResult.criticalFailures || 0,
    error: sanitizeString(rawResult.error),
    assertions,
    requests: allRequests,
    mutations: serverMutations.map(m => ({
      type: m.type,
      semanticKey: m.semanticKey,
      timestamp: m.timestamp,
      requestId: m.requestId,
      status: m.status || 'requested'
    })),
    summary: {
      totalAssertions: assertions.length,
      passedAssertions,
      failedAssertions,
      totalRequestsObserved: serverRequests.length,
      totalClientAttempts: clientRequests.length,
      mutationsRecorded: serverMutations.length,
      responsesDelivered: serverResponses.length
    }
  };
}
