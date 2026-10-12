import { type NextRequest, NextResponse } from 'next/server';
import * as evalModule from 'wallbit-agent-eval';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { checkRateLimit } from '../../../lib/rateLimit';

const MAX_PAYLOAD_BYTES = 10 * 1024; // 10 KB payload limit
const EXECUTION_TIMEOUT_MS = 25 * 1000; // 25 seconds execution timeout

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip') || '127.0.0.1';
}

export async function POST(req: NextRequest) {
  try {
    // 1. Enforce Per-Client Rate Limiting
    const clientIp = getClientIp(req);
    const rateCheck = checkRateLimit(clientIp);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: `Too many evaluation requests. Rate limit exceeded. Please retry in ${rateCheck.retryAfter}s.`
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateCheck.retryAfter || 60)
          }
        }
      );
    }

    // 2. Enforce Request Body Size Limit
    const contentLength = req.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_BYTES) {
      return NextResponse.json(
        { success: false, error: 'Request payload exceeds maximum allowed size (10 KB)' },
        { status: 413 }
      );
    }

    let rawText: string;
    try {
      rawText = await req.text();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Failed to read request body' },
        { status: 400 }
      );
    }

    if (rawText.length > MAX_PAYLOAD_BYTES) {
      return NextResponse.json(
        { success: false, error: 'Request payload exceeds maximum allowed size (10 KB)' },
        { status: 413 }
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(rawText);
    } catch {
      return NextResponse.json(
        { success: false, error: 'Malformed JSON payload' },
        { status: 400 }
      );
    }

    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { success: false, error: 'Request body must be an object' },
        { status: 400 }
      );
    }

    const payload = body as Record<string, unknown>;
    const { scenarioId, agentProfile } = payload;

    if (!scenarioId || typeof scenarioId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Missing or invalid scenarioId parameter' },
        { status: 400 }
      );
    }

    if (!agentProfile || typeof agentProfile !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Missing or invalid agentProfile parameter' },
        { status: 400 }
      );
    }

    // 3. Execution Timeout Guard
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Evaluation execution timed out after ${EXECUTION_TIMEOUT_MS}ms`));
      }, EXECUTION_TIMEOUT_MS).unref();
    });

    const executionPromise = evalModule.executeEvaluationService(scenarioId, agentProfile, EXECUTION_TIMEOUT_MS);
    const result = await Promise.race([executionPromise, timeoutPromise]);

    return NextResponse.json({
      success: true,
      result
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const isBusy = message.includes('busy') || message.includes('Maximum concurrent evaluations reached');
    const isValidation = message.includes('Unknown scenario') || message.includes('Invalid agent profile');
    const isTimeout = message.includes('timed out');

    if (isBusy) {
      return NextResponse.json(
        { success: false, error: message },
        { status: 429, headers: { 'Retry-After': '5' } }
      );
    }

    if (isValidation) {
      return NextResponse.json(
        { success: false, error: message },
        { status: 400 }
      );
    }

    if (isTimeout) {
      return NextResponse.json(
        { success: false, error: 'Evaluation timed out while running.' },
        { status: 504 }
      );
    }

    // 4. Log detailed diagnostic on server, but return generic sanitized error to client
    console.error('[Evaluation API Unexpected Internal Error]:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'An unexpected internal error occurred during evaluation.'
      },
      { status: 500 }
    );
  }
}
