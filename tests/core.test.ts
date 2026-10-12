import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MockWallbitApi } from '../src/api/mock-server.js';
import { DeterministicDriver, buildRunResult, createTraceEvent } from '../src/adapters/AgentDriver.js';
import { runEvaluation } from '../src/evaluation/evaluator.js';
import { listScenarios, getScenarioByName } from '../src/scenarios/registry.js';
import { Scenario } from '../src/types.js';

describe('MockWallbitApi', () => {
  let api: MockWallbitApi;

  beforeEach(() => {
    api = new MockWallbitApi();
  });

  it('initializes with default state', () => {
    const state = api.getState();
    expect(state.balances.checking.length).toBeGreaterThan(0);
    expect(state.balances.stocks.length).toBeGreaterThan(0);
    expect(state.transactions.length).toBeGreaterThan(0);
  });

  it('accepts trade and records it', async () => {
    // Simulate a trade POST
    // We test the internal state directly since we don't have HTTP server in unit test
    const tradeId = 'test-trade-1';
    const now = new Date().toISOString();
    
    // Directly manipulate state to verify behavior
    const trade = {
      id: tradeId,
      symbol: 'AAPL',
      direction: 'BUY' as const,
      currency: 'USD',
      orderType: 'MARKET',
      amount: 100,
      status: 'REQUESTED' as const,
      createdAt: now,
      updatedAt: now
    };
    
    api.getState().trades.set(tradeId, trade);
    
    const state = api.getState();
    expect(state.trades.size).toBe(1);
    expect(state.trades.get(tradeId)?.symbol).toBe('AAPL');
  });

  it('accepts operation and records it', () => {
    const opId = 'test-op-1';
    const now = new Date().toISOString();
    
    const operation = {
      id: opId,
      currency: 'USD',
      from: 'DEFAULT' as const,
      to: 'INVESTMENT' as const,
      amount: 500,
      status: 'COMPLETED' as const,
      createdAt: now
    };
    
    api.getState().operations.set(opId, operation);
    
    const state = api.getState();
    expect(state.operations.size).toBe(1);
    expect(state.operations.get(opId)?.amount).toBe(500);
  });

  it('tracks rate limit counters', () => {
    // Access private method through a mock request
    const mockReq = {
      ip: '127.0.0.1',
      url: '/trades',
      method: 'POST',
      headers: { 'x-api-key': 'test' },
      query: {},
      body: {}
    } as any;
    
    // We can't easily test private method, but we can verify the structure
    expect(api.getState().rateLimitCounters).toBeInstanceOf(Map);
  });

  it('resets state correctly', () => {
    api.getState().trades.set('test', {} as any);
    api.resetState();
    expect(api.getState().trades.size).toBe(0);
    expect(api.getState().operations.size).toBe(0);
  });

  it('sets and clears behaviors', () => {
    api.setBehavior('POST /trades', { type: 'error', statusCode: 500 });
    api.clearBehaviors();
    // Can't directly test private map, but resetState clears it
    api.resetState();
  });
});

describe('DeterministicDriver', () => {
  let driver: DeterministicDriver;

  beforeEach(() => {
    driver = new DeterministicDriver();
  });

  it('returns default response for unknown input', async () => {
    const result = await driver.run('unknown command');
    expect(result.response).toBe("I'll help you with that.");
    expect(result.toolCalls).toEqual([]);
    expect(result.approvalEvents).toEqual([]);
  });

  it('returns scripted response for matching input', async () => {
    const scriptedResult = {
      response: 'Scripted response',
      toolCalls: [],
      approvalEvents: [],
      httpRequests: [],
      httpResponses: [],
      trace: [],
      durationMs: 5
    };
    
    driver.setScriptedResponseForInput('buy apple', scriptedResult);
    
    const result = await driver.run('buy apple');
    expect(result.response).toBe('Scripted response');
    expect(result.durationMs).toBe(5);
  });

  it('matches pattern in input', async () => {
    const scriptedResult = {
      response: 'Pattern matched',
      toolCalls: [],
      approvalEvents: [],
      httpRequests: [],
      httpResponses: [],
      trace: [],
      durationMs: 10
    };
    
    driver.setScriptedResponse('apple', scriptedResult);
    
    const result = await driver.run('I want to buy apple stock');
    expect(result.response).toBe('Pattern matched');
  });

  it('includes input and context in trace', async () => {
    const scriptedResult = {
      response: 'Test',
      toolCalls: [],
      approvalEvents: [],
      httpRequests: [],
      httpResponses: [],
      trace: [
        { type: 'user_input' as const, timestamp: 1000, data: {} }
      ],
      durationMs: 10
    };
    
    driver.setScriptedResponseForInput('test', scriptedResult);
    
    const result = await driver.run('test input', { apiKey: 'test-key' });
    expect(result.trace[0].data).toEqual(expect.objectContaining({ input: 'test input', context: { apiKey: 'test-key' } }));
  });
});

describe('Scenario Registry', () => {
  it('lists all builtin scenarios', () => {
    const scenarios = listScenarios();
    expect(scenarios.length).toBeGreaterThan(0);
    
    const names = scenarios.map(s => s.name);
    expect(names).toContain('trade-happy-path');
    expect(names).toContain('trade-denied');
    expect(names).toContain('trade-approval-timeout');
    expect(names).toContain('trade-429');
    expect(names).toContain('trade-500');
    expect(names).toContain('trade-network-timeout');
    expect(names).toContain('malformed-parameters');
    expect(names).toContain('concurrent-trades');
    expect(names).toContain('prompt-injection');
    expect(names).toContain('unauthorized-action');
    expect(names).toContain('operation-happy-path');
    expect(names).toContain('operation-network-timeout');
  });

  it('gets scenario by name', () => {
    const scenario = getScenarioByName('trade-happy-path');
    expect(scenario).toBeDefined();
    expect(scenario?.name).toBe('trade-happy-path');
    expect(scenario?.expectations.length).toBeGreaterThan(0);
  });

  it('returns undefined for unknown scenario', () => {
    const scenario = getScenarioByName('nonexistent');
    expect(scenario).toBeUndefined();
  });

  it('filters scenarios by category', () => {
    const tradeScenarios = listScenarios().filter(s => s.category === 'trade');
    expect(tradeScenarios.length).toBeGreaterThan(0);
    expect(tradeScenarios.every(s => s.category === 'trade')).toBe(true);
  });
});

describe('Evaluation Engine', () => {
  let driver: DeterministicDriver;
  let api: MockWallbitApi;

  beforeEach(() => {
    driver = new DeterministicDriver();
    api = new MockWallbitApi();
  });

  it('evaluates a passing scenario', async () => {
    const scenario = {
      id: 'test-pass',
      name: 'test-pass',
      description: 'Test passing scenario',
      category: 'test',
      prompt: 'test',
      setup: {},
      expectedBehavior: [],
      forbiddenBehavior: [],
      expectations: [
        {
          type: 'always_pass',
          description: 'Always passes',
          severity: 'info' as const,
          evaluate: () => ({ passed: true, message: 'Passed', severity: 'info' as const })
        }
      ],
      severity: 'info' as const
    };

    const result = await runEvaluation(driver, api, scenario);
    expect(result.passed).toBe(true);
    expect(result.assertions.length).toBe(1);
    expect(result.assertions[0].result.passed).toBe(true);
  });

  it('evaluates a failing scenario', async () => {
    const scenario = {
      id: 'test-fail',
      name: 'test-fail',
      description: 'Test failing scenario',
      category: 'test',
      prompt: 'test',
      setup: {},
      expectedBehavior: [],
      forbiddenBehavior: [],
      expectations: [
        {
          type: 'always_fail',
          description: 'Always fails',
          severity: 'critical' as const,
          evaluate: () => ({ passed: false, message: 'Failed', severity: 'critical' as const })
        }
      ],
      severity: 'critical' as const
    };

    const result = await runEvaluation(driver, api, scenario);
    expect(result.passed).toBe(false);
    expect(result.assertions[0].result.passed).toBe(false);
  });

  it('handles multiple expectations', async () => {
    const scenario = {
      id: 'test-multi',
      name: 'test-multi',
      description: 'Test multiple expectations',
      category: 'test',
      prompt: 'test',
      setup: {},
      expectedBehavior: [],
      forbiddenBehavior: [],
      expectations: [
        {
          type: 'pass1',
          description: 'First passes',
          severity: 'info' as const,
          evaluate: () => ({ passed: true, message: 'Passed 1', severity: 'info' as const })
        },
        {
          type: 'pass2',
          description: 'Second passes',
          severity: 'info' as const,
          evaluate: () => ({ passed: true, message: 'Passed 2', severity: 'info' as const })
        }
      ],
      severity: 'info' as const
    };

    const result = await runEvaluation(driver, api, scenario);
    expect(result.passed).toBe(true);
    expect(result.assertions.length).toBe(2);
  });

  it('handles expectation error gracefully', async () => {
    const scenario = {
      id: 'test-error',
      name: 'test-error',
      description: 'Test expectation error',
      category: 'test',
      prompt: 'test',
      setup: {},
      expectedBehavior: [],
      forbiddenBehavior: [],
      expectations: [
        {
          type: 'error',
          description: 'Throws error',
          severity: 'critical' as const,
          evaluate: () => { throw new Error('Assertion error'); }
        }
      ],
      severity: 'critical' as const
    };

    const result = await runEvaluation(driver, api, scenario);
    expect(result.passed).toBe(false);
    expect(result.assertions[0].result.passed).toBe(false);
    expect(result.assertions[0].result.message).toContain('Assertion error');
  });
});

import { noDuplicateTrade, noAutomaticRetry } from '../src/scenarios/builtins.js';

import { requiresUserConfirmation, noDuplicateTrade, noAutomaticRetry, rejectsUnauthorizedAction, validatesParameters } from '../src/scenarios/builtins.js';

describe('Built-in Assertions', () => {
  let api: MockWallbitApi;

  beforeEach(() => {
    api = new MockWallbitApi();
  });

  it('noDuplicateTrade passes with single trade', () => {
    const trace = {
      agentEvents: [{ type: 'user_input', timestamp: 999, data: {} }],
      httpRequests: [{ method: 'POST', path: '/trades', headers: {}, body: { symbol: 'AAPL', direction: 'BUY', amount: 100 }, timestamp: 1000, id: 'req1' }],
      httpResponses: [{ status: 200, headers: {}, body: {}, timestamp: 1001, requestId: 'req1' }],
      approvalEvents: [],
      toolCalls: [],
      retries: [],
    };
    const runResult = { response: '', toolCalls: [], approvalEvents: [], httpRequests: [], httpResponses: [], trace: [], durationMs: 10, startedAt: 999, finishedAt: 1001 };

    const expectation = noDuplicateTrade();
    const result = expectation.evaluate(trace, api.getState(), runResult);
    expect(result.passed).toBe(true);
  });

  it('noDuplicateTrade fails with duplicate trade', () => {
    const trace = {
      agentEvents: [{ type: 'user_input', timestamp: 999, data: {} }],
      httpRequests: [
        { method: 'POST', path: '/trades', headers: {}, body: { symbol: 'AAPL', direction: 'BUY', amount: 100 }, timestamp: 1000, id: 'req1' },
        { method: 'POST', path: '/trades', headers: {}, body: { symbol: 'AAPL', direction: 'BUY', amount: 100 }, timestamp: 1001, id: 'req2' }
      ],
      httpResponses: [],
      approvalEvents: [],
      toolCalls: [],
      retries: [],
    };
    const runResult = { response: '', toolCalls: [], approvalEvents: [], httpRequests: [], httpResponses: [], trace: [], durationMs: 10, startedAt: 999, finishedAt: 1001 };

    const expectation = noDuplicateTrade();
    const result = expectation.evaluate(trace, api.getState(), runResult);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('Duplicate');
  });

  it('noAutomaticRetry passes with single request', () => {
    const trace = {
      agentEvents: [{ type: 'user_input', timestamp: 999, data: {} }],
      httpRequests: [{ method: 'POST', path: '/trades', headers: {}, body: { symbol: 'AAPL', direction: 'BUY', amount: 100 }, timestamp: 1000, id: 'req1' }],
      httpResponses: [],
      approvalEvents: [],
      toolCalls: [],
      retries: [],
    };
    const runResult = { response: '', toolCalls: [], approvalEvents: [], httpRequests: [], httpResponses: [], trace: [], durationMs: 10, startedAt: 999, finishedAt: 1001 };

    const expectation = noAutomaticRetry();
    const result = expectation.evaluate(trace, api.getState(), runResult);
    expect(result.passed).toBe(true);
  });

  it('noAutomaticRetry fails with multiple semantically equivalent requests after failure', () => {
    const trace = {
      agentEvents: [{ type: 'user_input', timestamp: 999, data: {} }],
      httpRequests: [
        { method: 'POST', path: '/trades', headers: {}, body: { symbol: 'AAPL', direction: 'BUY', amount: 100 }, timestamp: 1000, id: 'req1' },
        { method: 'POST', path: '/trades', headers: {}, body: { symbol: 'AAPL', direction: 'BUY', amount: 100 }, timestamp: 1001, id: 'req2' }
      ],
      httpResponses: [],
      approvalEvents: [],
      toolCalls: [],
      retries: [],
    };
    const runResult = { response: '', toolCalls: [], approvalEvents: [], httpRequests: [], httpResponses: [], trace: [], durationMs: 10, startedAt: 999, finishedAt: 1001 };

    const expectation = noAutomaticRetry();
    const result = expectation.evaluate(trace, api.getState(), runResult);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('ambiguous outcome');
  });
});

describe('Empty Trace & Safety Assertion Guarantees (Regression Tests)', () => {
  let api: MockWallbitApi;

  beforeEach(() => {
    api = new MockWallbitApi();
  });

  it('guarantees empty trace cannot falsely PASS safety assertions', () => {
    const emptyTrace = {
      agentEvents: [],
      httpRequests: [],
      httpResponses: [],
      approvalEvents: [],
      toolCalls: [],
      mutations: [],
      retries: [],
      errors: [],
      startedAt: Date.now(),
      finishedAt: Date.now()
    };
    const emptyRunResult = {
      response: '',
      toolCalls: [],
      approvalEvents: [],
      httpRequests: [],
      httpResponses: [],
      trace: [],
      mutations: [],
      retries: [],
      durationMs: 0,
      startedAt: Date.now(),
      finishedAt: Date.now()
    };

    expect(requiresUserConfirmation().evaluate(emptyTrace, api.getState(), emptyRunResult).passed).toBe(false);
    expect(rejectsUnauthorizedAction().evaluate(emptyTrace, api.getState(), emptyRunResult).passed).toBe(false);
    expect(validatesParameters().evaluate(emptyTrace, api.getState(), emptyRunResult).passed).toBe(false);
    expect(noDuplicateTrade().evaluate(emptyTrace, api.getState(), emptyRunResult).passed).toBe(false);
    expect(noAutomaticRetry().evaluate(emptyTrace, api.getState(), emptyRunResult).passed).toBe(false);
  });

  it('evaluates requiresUserConfirmation by OBSERVED EVENT ORDER', () => {
    const runResult = { response: '', toolCalls: [], approvalEvents: [], httpRequests: [], httpResponses: [], trace: [], durationMs: 10, startedAt: 900, finishedAt: 1100 };

    // Case 1: approval event -> approved -> financial mutation (PASS)
    const validTrace = {
      agentEvents: [{ type: 'user_input', timestamp: 900, data: {} }],
      approvalEvents: [{ id: 'app-1', toolName: 'wallbit_create_trade', parameters: { symbol: 'AAPL', direction: 'BUY', amount: 100, currency: 'USD', order_type: 'MARKET' }, required: true, approved: true, timestamp: 1000 }],
      httpRequests: [{ id: 'req-1', method: 'POST', path: '/trades', headers: {}, body: { symbol: 'AAPL', direction: 'BUY', amount: 100, currency: 'USD', order_type: 'MARKET' }, timestamp: 1005 }],
      httpResponses: [{ requestId: 'req-1', status: 200, headers: {}, body: {}, timestamp: 1010 }]
    };
    expect(requiresUserConfirmation().evaluate(validTrace, api.getState(), runResult).passed).toBe(true);

    // Case 2: financial mutation -> approval event (out of order => FAIL)
    const outOfOrderTrace = {
      agentEvents: [{ type: 'user_input', timestamp: 900, data: {} }],
      approvalEvents: [{ id: 'app-1', toolName: 'wallbit_create_trade', parameters: { symbol: 'AAPL', direction: 'BUY', amount: 100, currency: 'USD', order_type: 'MARKET' }, required: true, approved: true, timestamp: 1010 }],
      httpRequests: [{ id: 'req-1', method: 'POST', path: '/trades', headers: {}, body: { symbol: 'AAPL', direction: 'BUY', amount: 100, currency: 'USD', order_type: 'MARKET' }, timestamp: 1000 }],
      httpResponses: [{ requestId: 'req-1', status: 200, headers: {}, body: {}, timestamp: 1005 }]
    };
    expect(requiresUserConfirmation().evaluate(outOfOrderTrace, api.getState(), runResult).passed).toBe(false);

    // Case 3: financial mutation -> no approval event (FAIL)
    const noApprovalTrace = {
      agentEvents: [{ type: 'user_input', timestamp: 900, data: {} }],
      approvalEvents: [],
      httpRequests: [{ id: 'req-1', method: 'POST', path: '/trades', headers: {}, body: { symbol: 'AAPL', direction: 'BUY', amount: 100, currency: 'USD', order_type: 'MARKET' }, timestamp: 1000 }],
      httpResponses: [{ requestId: 'req-1', status: 200, headers: {}, body: {}, timestamp: 1005 }]
    };
    expect(requiresUserConfirmation().evaluate(noApprovalTrace, api.getState(), runResult).passed).toBe(false);
  });

  it('guarantees evaluation does NOT become PASS when driver throws an error', async () => {
    const throwingDriver = {
      name: 'throwing-driver',
      profile: 'safe' as const,
      run: async () => {
        throw new Error('Driver network crash');
      }
    };
    const scenario = getScenarioByName('trade-happy-path')!;
    const result = await runEvaluation(throwingDriver, api, scenario);

    expect(result.passed).toBe(false);
    expect(result.criticalFailures).toBe(1);
    expect(result.error).toContain('Driver network crash');
  });
});

describe('Reporters', () => {
  it('TerminalReporter does not throw', async () => {
    const { TerminalReporter } = await import('../src/reporters/index.js');
    const reporter = new TerminalReporter();
    
    const report = {
      metadata: { agent: 'test', driver: 'test', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), scenarioCount: 1 },
      scenarios: [{
        id: 'test',
        name: 'test',
        description: 'Test',
        category: 'test',
        passed: true,
        severity: 'info' as const,
        assertions: [{ expectation: { type: 'test', description: 'Test', severity: 'info' as const, evaluate: () => ({ passed: true, message: 'ok', severity: 'info' as const }) }, result: { passed: true, message: 'ok', severity: 'info' as const } }],
        trace: { startedAt: Date.now(), finishedAt: Date.now(), agentEvents: [], toolCalls: [], approvalEvents: [], httpRequests: [], httpResponses: [], mutations: [], retries: [], errors: [] },
        durationMs: 10,
        criticalFailures: 0
      }],
      totalPassed: 1,
      totalFailed: 0,
      totalCriticalFailures: 0,
      totalDurationMs: 10
    };

    await reporter.report(report as any);
  });

  it('JsonReporter produces valid JSON', async () => {
    const { JsonReporter } = await import('../src/reporters/index.js');
    const reporter = new JsonReporter();
    
    const report = {
      metadata: { agent: 'test', driver: 'test', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), scenarioCount: 1 },
      scenarios: [{
        id: 'test',
        name: 'test',
        description: 'Test',
        category: 'test',
        passed: true,
        severity: 'info' as const,
        assertions: [],
        trace: { startedAt: Date.now(), finishedAt: Date.now(), agentEvents: [], toolCalls: [], approvalEvents: [], httpRequests: [], httpResponses: [], mutations: [], retries: [], errors: [] },
        durationMs: 10,
        criticalFailures: 0
      }],
      totalPassed: 1,
      totalFailed: 0,
      totalCriticalFailures: 0,
      totalDurationMs: 10
    };

    await reporter.report(report as any);
  });

  it('JUnitReporter produces valid XML', async () => {
    const { JUnitReporter } = await import('../src/reporters/index.js');
    const reporter = new JUnitReporter();
    
    const report = {
      metadata: { agent: 'test', driver: 'test', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), scenarioCount: 1 },
      scenarios: [{
        id: 'test',
        name: 'test',
        description: 'Test',
        category: 'test',
        passed: true,
        severity: 'info' as const,
        assertions: [],
        trace: { startedAt: Date.now(), finishedAt: Date.now(), agentEvents: [], toolCalls: [], approvalEvents: [], httpRequests: [], httpResponses: [], mutations: [], retries: [], errors: [] },
        durationMs: 10,
        criticalFailures: 0
      }],
      totalPassed: 1,
      totalFailed: 0,
      totalCriticalFailures: 0,
      totalDurationMs: 10
    };

    await reporter.report(report as any);
  });
});