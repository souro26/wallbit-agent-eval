import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GET as getScenarios } from '../web/src/app/api/scenarios/route.js';
import { POST as postEvaluate } from '../web/src/app/api/evaluate/route.js';
import { resetRateLimitsForTesting } from '../web/src/lib/rateLimit.js';
import * as wallbitAgentEval from 'wallbit-agent-eval';
import type { NextRequest } from 'next/server';

describe('Next.js API Route Handlers (/api/scenarios & /api/evaluate)', () => {
  beforeEach(() => {
    resetRateLimitsForTesting();
  });

  it('GET /api/scenarios returns allowlisted scenarios and agents', async () => {
    const res = await getScenarios();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(Array.isArray(data.scenarios)).toBe(true);
    expect(data.scenarios.length).toBeGreaterThanOrEqual(12);
    expect(Array.isArray(data.agentProfiles)).toBe(true);
    expect(data.agentProfiles).toContain('safe');
    expect(data.agentProfiles).toContain('unsafe-retry');
  });

  it('POST /api/evaluate validates input and runs safe evaluation successfully', async () => {
    const req = new Request('http://localhost:3000/api/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarioId: 'trade-happy-path', agentProfile: 'safe' })
    }) as unknown as NextRequest;
    const res = await postEvaluate(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.result.passed).toBe(true);
    expect(data.result.name).toBe('trade-happy-path');
    expect(data.result.agentProfile).toBe('safe');
    expect(Array.isArray(data.result.assertions)).toBe(true);
    expect(Array.isArray(data.result.requests)).toBe(true);
  }, 15000);

  it('POST /api/evaluate rejects missing or invalid payload', async () => {
    const req = new Request('http://localhost:3000/api/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarioId: '', agentProfile: '' })
    }) as unknown as NextRequest;
    const res = await postEvaluate(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  });

  it('POST /api/evaluate rejects disallowed agent profile or command injection attempt', async () => {
    const req = new Request('http://localhost:3000/api/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarioId: 'trade-happy-path', agentProfile: '; cat /etc/passwd' })
    }) as unknown as NextRequest;
    const res = await postEvaluate(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('Invalid agent profile');
  });

  it('POST /api/evaluate returns 400 for unknown scenario', async () => {
    const req = new Request('http://localhost:3000/api/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarioId: 'exploit-scenario', agentProfile: 'safe' })
    }) as unknown as NextRequest;
    const res = await postEvaluate(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('Unknown scenario');
  });

  it('POST /api/evaluate rejects payloads exceeding 10 KB with HTTP 413', async () => {
    const giantPayload = JSON.stringify({
      scenarioId: 'trade-happy-path',
      agentProfile: 'safe',
      garbage: 'A'.repeat(12 * 1024)
    });

    const req = new Request('http://localhost:3000/api/evaluate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(giantPayload.length)
      },
      body: giantPayload
    }) as unknown as NextRequest;

    const res = await postEvaluate(req);
    expect(res.status).toBe(413);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('maximum allowed size');
  });

  it('POST /api/evaluate enforces per-client rate limits with HTTP 429 and Retry-After header', async () => {
    const clientIp = '203.0.113.195';

    // Send 15 valid requests (the allowed threshold)
    for (let i = 0; i < 15; i++) {
      const req = new Request('http://localhost:3000/api/evaluate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': clientIp
        },
        body: JSON.stringify({ scenarioId: 'invalid-to-be-fast', agentProfile: 'safe' })
      }) as unknown as NextRequest;
      await postEvaluate(req);
    }

    // 16th request must trigger rate limit
    const excessReq = new Request('http://localhost:3000/api/evaluate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': clientIp
      },
      body: JSON.stringify({ scenarioId: 'trade-happy-path', agentProfile: 'safe' })
    }) as unknown as NextRequest;

    const res = await postEvaluate(excessReq);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeDefined();
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('Rate limit exceeded');
  });

  it('POST /api/evaluate sanitizes unexpected internal errors (HTTP 500) without leaking stack traces', async () => {
    // Spy on executeEvaluationService
    const spy = vi.spyOn(wallbitAgentEval, 'executeEvaluationService').mockRejectedValueOnce(
      new Error('Internal database driver exception at /var/app/secret/db.ts:14:9')
    );

    const req = new Request('http://localhost:3000/api/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarioId: 'trade-happy-path', agentProfile: 'safe' })
    }) as unknown as NextRequest;

    const res = await postEvaluate(req);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.success).toBe(false);
    // Error must be generic and not contain sensitive path or database details
    expect(data.error).toBe('An unexpected internal error occurred during evaluation.');
    expect(data.error).not.toContain('/var/app/secret');

    spy.mockRestore();
  });
});
