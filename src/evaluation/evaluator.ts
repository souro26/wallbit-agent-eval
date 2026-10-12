import { v4 as uuidv4 } from 'uuid';
import type {
  Scenario,
  ScenarioResult,
  ScenarioExpectation,
  AssertionResult,
  AgentDriver,
  AgentRunResult,
  TraceEvent,
  MockApiState,
  EvaluationReport,
  EvaluationTrace,
  AssertionResult as AssertionResultType,
  ApiBehaviorConfig,
  AssertionEvidence,
  HttpRequest,
  HttpResponse
} from '../types.js';
import type { MockWallbitApi } from '../api/mock-server.js';
import {
  requiresUserConfirmation,
  noDuplicateTrade,
  noAutomaticRetry,
  respectsApprovalDenial,
  handlesApprovalTimeout,
  handlesRateLimitCorrectly,
  handlesServerError,
  validatesParameters,
  rejectsPromptInjection,
  rejectsUnauthorizedAction,
  noConcurrentDuplicates
} from '../scenarios/builtins.js';

const EXPECTATION_MAP: Record<string, () => any> = {
  'requires_confirmation': requiresUserConfirmation,
  'no_duplicate_trade': noDuplicateTrade,
  'no_automatic_retry': noAutomaticRetry,
  'respects_approval_denial': respectsApprovalDenial,
  'respects_denial': respectsApprovalDenial,
  'handles_approval_timeout': handlesApprovalTimeout,
  'handles_rate_limit': handlesRateLimitCorrectly,
  'rate_limit_handling': handlesRateLimitCorrectly,
  'handles_server_error': handlesServerError,
  'server_error_handling': handlesServerError,
  'parameter_validation': validatesParameters,
  'rejects_prompt_injection': rejectsPromptInjection,
  'prompt_injection_resistance': rejectsPromptInjection,
  'rejects_unauthorized_action': rejectsUnauthorizedAction,
  'unauthorized_action_rejection': rejectsUnauthorizedAction,
  'no_concurrent_duplicates': noConcurrentDuplicates,
  'concurrent_duplicate_prevention': noConcurrentDuplicates
};

export interface EvaluationOptions {
  driver: AgentDriver;
  mockApi: MockWallbitApi;
  scenario: Scenario;
  verbose?: boolean;
}

export class Evaluator {
  private driver: AgentDriver;
  private mockApi: MockWallbitApi;
  private verbose: boolean;

  constructor(driver: AgentDriver, mockApi: MockWallbitApi, verbose = false) {
    this.driver = driver;
    this.mockApi = mockApi;
    this.verbose = verbose;
  }

  async evaluate(scenario: Scenario): Promise<any> {
    const startTime = Date.now();

    this.mockApi.resetState();
    this.applyApiBehaviors(scenario.setup);

    this.log(`Starting scenario: ${scenario.name}`);
    this.log(`Input: ${scenario.prompt}`);

    try {
      await this.driver.initialize?.();
      const runResult = await this.driver.run(scenario.prompt, { ...scenario.setup.api?.behaviors, setup: scenario.setup });
      await this.driver.shutdown?.();

      const endTime = Date.now();
      const durationMs = endTime - startTime;

      this.log(`Scenario completed in ${durationMs}ms`);

      // Build evaluation trace from OBSERVED server events (ground truth)
      const serverRequests = this.mockApi.getRequestLog();
      const serverResponses = this.mockApi.getResponseLog();
      const serverMutations = this.mockApi.getMutationLog();

      // Combine driver trace with server-observed events
      const evaluationTrace = this.buildEvaluationTrace(runResult, serverRequests, serverResponses, serverMutations);

      const assertionResults = await this.evaluateExpectations(
        scenario.expectations,
        evaluationTrace,
        this.mockApi.getState(),
        runResult
      );

      const passed = assertionResults.every(r => r.result.passed);
      const criticalFailures = assertionResults.filter(r => !r.result.passed && r.expectation.severity === 'critical').length;

      return {
        id: scenario.id,
        name: scenario.name,
        description: scenario.description,
        category: scenario.category,
        passed,
        severity: scenario.severity,
        assertions: assertionResults,
        trace: evaluationTrace,
        durationMs,
        error: runResult.error,
        criticalFailures
      };
    } catch (error) {
      const endTime = Date.now();
      return {
        id: scenario.id,
        name: scenario.name,
        description: scenario.description,
        category: scenario.category,
        passed: false,
        severity: scenario.severity,
        assertions: [],
        trace: this.buildEmptyTrace(),
        durationMs: endTime - startTime,
        error: error instanceof Error ? error.message : String(error),
        criticalFailures: 1
      };
    }
  }

  private buildEmptyTrace() {
    return {
      startedAt: Date.now(),
      finishedAt: Date.now(),
      agentEvents: [],
      toolCalls: [],
      approvalEvents: [],
      httpRequests: [],
      httpResponses: [],
      mutations: [],
      retries: [],
      errors: []
    };
  }

  private buildEvaluationTrace(
    runResult: AgentRunResult,
    serverRequests: ReadonlyArray<HttpRequest>,
    serverResponses: ReadonlyArray<HttpResponse>,
    serverMutations: ReadonlyArray<{ type: 'trade' | 'operation'; semanticKey: string; requestId: string; timestamp: number }>
  ): any {
    // Convert server mutations to MutationEvent format
    const mutations = serverMutations.map(m => ({
      type: m.type,
      semanticKey: m.semanticKey,
      timestamp: m.timestamp,
      requestId: m.requestId,
      status: 'requested' as const,
      httpRequestId: m.requestId,
      currency: 'USD'
    }));

    return {
      startedAt: runResult.startedAt,
      finishedAt: runResult.finishedAt,
      agentEvents: runResult.trace,
      toolCalls: runResult.toolCalls,
      approvalEvents: runResult.approvalEvents,
      httpRequests: serverRequests,  // USE SERVER LOG AS GROUND TRUTH
      httpResponses: serverResponses, // USE SERVER LOG AS GROUND TRUTH
      mutations,
      retries: runResult.retries,
      errors: runResult.error ? [{ timestamp: Date.now(), message: runResult.error }] : [],
      clientHttpRequests: runResult.httpRequests || [],
      clientHttpResponses: runResult.httpResponses || []
    };
  }

  private applyApiBehaviors(setup: any): void {
    this.mockApi.clearBehaviors();

    if (setup.trade) {
      this.mockApi.setBehavior('POST /trades', { type: setup.trade.failure || 'success', statusCode: setup.trade.statusCode, retryAfter: setup.trade.retryAfter });
    }
    if (setup.operation) {
      this.mockApi.setBehavior('POST /operations/internal', { type: setup.operation.failure || 'success', statusCode: setup.operation.statusCode, retryAfter: setup.operation.retryAfter });
    }
    if (setup.api?.behaviors) {
      for (const [endpoint, config] of Object.entries(setup.api.behaviors)) {
        this.mockApi.setBehavior(endpoint, config as any);
      }
    }
  }

  private async evaluateExpectations(
    expectations: any[],
    trace: any,
    apiState: any,
    runResult: AgentRunResult
  ): Promise<{ expectation: any; result: any }[]> {
    const results: { expectation: any; result: any }[] = [];

    for (const expectation of expectations) {
      this.log(`  Evaluating: ${expectation.description}`);
      try {
        let evalFn: (trace: any, apiState: any, runResult: any) => any;
        if (typeof expectation.evaluate === 'function') {
          evalFn = expectation.evaluate;
        } else if (typeof expectation.type === 'string' && EXPECTATION_MAP[expectation.type]) {
          const factory = EXPECTATION_MAP[expectation.type]!;
          const builtinExpectation = factory();
          evalFn = builtinExpectation.evaluate;
          Object.assign(expectation, builtinExpectation);
        } else {
          throw new Error(`Unknown expectation type: ${expectation.type}`);
        }

        const result = await evalFn(trace, this.mockApi.getState(), runResult);
        this.log(`    ${result.passed ? '✓' : '✗'} ${result.message}`);
        if (!result.passed && this.verbose && result.evidence) {
          this.log(`      Details: ${JSON.stringify(result.evidence, null, 2)}`);
        }
        results.push({ expectation, result });
      } catch (error) {
        const result = {
          passed: false,
          message: `Assertion error: ${error instanceof Error ? error.message : String(error)}`,
          severity: 'critical' as const,
          evidence: { details: { error: String(error) } }
        };
        this.log(`    ✗ ${result.message}`);
        results.push({ expectation, result });
      }
    }

    return results;
  }

  private log(message: string): void {
    if (this.verbose) {
      console.log(message);
    }
  }
}

export async function runEvaluation(
  driver: any,
  mockApi: any,
  scenario: any,
  verbose = false
): Promise<any> {
  const evaluator = new Evaluator(driver, mockApi, verbose);
  return evaluator.evaluate(scenario);
}

export async function runScenarios(
  driver: any,
  mockApi: any,
  scenarios: any[],
  verbose = false
): Promise<any[]> {
  const results: any[] = [];

  for (const scenario of scenarios) {
    const result = await runEvaluation(driver, mockApi, scenario, verbose);
    results.push(result);
  }

  return results;
}

export function generateReport(results: any[]): any {
  const totalPassed = results.filter(r => r.passed).length;
  const totalFailed = results.filter(r => !r.passed).length;
  const totalCriticalFailures = results.reduce((sum, r) => sum + (r.criticalFailures || 0), 0);
  const totalDurationMs = results.reduce((sum, r) => sum + r.durationMs, 0);
  const startedAt = new Date(Math.min(...results.map(r => r.trace?.startedAt || Date.now()))).toISOString();
  const finishedAt = new Date(Math.max(...results.map(r => r.trace?.finishedAt || Date.now()))).toISOString();

  return {
    metadata: {
      agent: 'unknown',
      driver: 'unknown',
      startedAt,
      finishedAt,
      scenarioCount: results.length
    },
    scenarios: results,
    totalPassed,
    totalFailed,
    totalCriticalFailures,
    totalDurationMs
  };
}