import { describe, it, expect, vi } from 'vitest';
import {
  executeEvaluationService,
  getSupportedScenarios,
  getSupportedAgentProfiles,
  getActiveEvaluationCount,
  ALLOWED_AGENT_PROFILES
} from '../src/service/evalService.js';
import * as mockServerModule from '../src/api/mock-server.js';

describe('Web Evaluation Service Lifecycle & Safety Invariants', () => {
  it('returns all supported builtin scenarios and allowed agent profiles', () => {
    const scenarios = getSupportedScenarios();
    expect(scenarios.length).toBeGreaterThanOrEqual(12);
    expect(scenarios.some(s => s.id === 'trade-happy-path')).toBe(true);
    expect(scenarios.some(s => s.id === 'trade-network-timeout')).toBe(true);

    const agents = getSupportedAgentProfiles();
    expect(agents).toEqual([...ALLOWED_AGENT_PROFILES]);
    expect(agents).toContain('safe');
    expect(agents).toContain('unsafe-retry');
  });

  it('runs a safe evaluation and returns expected PASS with evidence and categorized requests', async () => {
    const result = await executeEvaluationService('trade-happy-path', 'safe');

    expect(result.passed).toBe(true);
    expect(result.criticalFailures).toBe(0);
    expect(result.summary.failedAssertions).toBe(0);
    expect(result.summary.passedAssertions).toBeGreaterThan(0);
    expect(result.requests.length).toBe(1);
    expect(result.mutations.length).toBe(1);

    // Verify request categorization
    const req = result.requests[0]!;
    expect(req.statusCategory).toBe('reached_server_with_response_and_mutation');
    expect(req.response?.status).toBe(200);
    expect(req.mutation?.type).toBe('trade');
    expect(req.mutation?.requestId).toBe(req.id);
  });

  it('runs an unsafe evaluation and returns expected FAIL with evidence', async () => {
    const result = await executeEvaluationService('trade-network-timeout', 'unsafe-retry');

    expect(result.passed).toBe(false);
    expect(result.criticalFailures).toBeGreaterThan(0);

    // Verify accepted_then_lost categorized request
    const acceptedLostReq = result.requests.find(r => r.statusCategory === 'reached_server_mutation_response_lost');
    expect(acceptedLostReq).toBeDefined();
    expect(acceptedLostReq?.response).toBeUndefined();
    expect(acceptedLostReq?.mutation).toBeDefined();

    // Verify evaluator explanation for ambiguous retry
    const retryAssertion = result.assertions.find(a => a.type === 'no_automatic_retry');
    expect(retryAssertion).toBeDefined();
    expect(retryAssertion?.passed).toBe(false);
    expect(retryAssertion?.message).toContain('ambiguous outcome');
  });

  it('rejects invalid scenario names with descriptive error', async () => {
    await expect(
      executeEvaluationService('non-existent-scenario-123', 'safe')
    ).rejects.toThrow(/Unknown scenario/);

    await expect(
      executeEvaluationService('../../../etc/passwd', 'safe')
    ).rejects.toThrow(/Unknown scenario/);

    await expect(
      executeEvaluationService('; rm -rf /;', 'safe')
    ).rejects.toThrow(/Unknown scenario/);
  });

  it('rejects unsupported or malicious agent profile names', async () => {
    await expect(
      executeEvaluationService('trade-happy-path', 'malicious-agent')
    ).rejects.toThrow(/Invalid agent profile/);

    await expect(
      executeEvaluationService('trade-happy-path', '$(whoami)')
    ).rejects.toThrow(/Invalid agent profile/);
  });

  it('isolates state so two concurrent evaluations do not leak traces or mutations', async () => {
    // Run two different scenarios concurrently with different parameters
    const [evalA, evalB] = await Promise.all([
      executeEvaluationService('trade-happy-path', 'safe'),
      executeEvaluationService('trade-denied', 'safe')
    ]);

    expect(evalA.passed).toBe(true);
    expect(evalA.name).toBe('trade-happy-path');
    expect(evalA.requests.length).toBe(1);
    expect(evalA.mutations.length).toBe(1);

    expect(evalB.passed).toBe(true);
    expect(evalB.name).toBe('trade-denied');
    expect(evalB.requests.length).toBe(0);
    expect(evalB.mutations.length).toBe(0);

    // Mutual exclusion: requests from A must not appear in B
    const aReqIds = new Set(evalA.requests.map(r => r.id));
    for (const bReq of evalB.requests) {
      expect(aReqIds.has(bReq.id)).toBe(false);
    }
  });

  it('prevents connecting to real external Wallbit servers', async () => {
    // The service only binds to local ephemeral port on 127.0.0.1
    const result = await executeEvaluationService('trade-happy-path', 'safe');
    for (const req of result.requests) {
      const host = req.headers?.['host'] || '';
      expect(host).not.toContain('wallbit.io');
      expect(host).not.toContain('api.wallbit');
      expect(host).toMatch(/127\.0\.0\.1:\d+/);
    }
  });

  it('ensures execution errors never become PASS', async () => {
    // Passing a scenario that doesn't exist throws or fails
    try {
      const res = await executeEvaluationService('', 'safe');
      expect(res.passed).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
    }
  });

  it('guarantees concurrency counter cleanup if mock server creation fails', async () => {
    const initialCount = getActiveEvaluationCount();

    // Mock createMockServer to simulate port exhaustion or setup crash
    const spy = vi.spyOn(mockServerModule, 'createMockServer').mockRejectedValueOnce(
      new Error('Simulated socket bind failure EADDRINUSE')
    );

    await expect(
      executeEvaluationService('trade-happy-path', 'safe')
    ).rejects.toThrow(/Simulated socket bind failure/);

    // Counter must be decremented back to initial count, preventing stuck busy state
    expect(getActiveEvaluationCount()).toBe(initialCount);

    spy.mockRestore();

    // Verify next real evaluation proceeds normally
    const normalResult = await executeEvaluationService('trade-happy-path', 'safe');
    expect(normalResult.passed).toBe(true);
  });

  it('correctly categorizes reached_server_no_mutation for requests without mutations', async () => {
    // trade-429 responds with 429 without creating any mutation
    const result = await executeEvaluationService('trade-429', 'rate-limit-good');
    expect(result.passed).toBe(true);
    expect(result.requests.length).toBeGreaterThan(0);

    const noMutationReq = result.requests.find(r => r.statusCategory === 'reached_server_no_mutation');
    expect(noMutationReq).toBeDefined();
    expect(noMutationReq?.mutation).toBeUndefined();
    expect(noMutationReq?.statusExplanation).toContain('without creating a financial mutation');
  });
});
