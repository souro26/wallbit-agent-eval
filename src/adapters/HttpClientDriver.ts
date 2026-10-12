import type {
  AgentDriver,
  AgentContext,
  AgentRunResult,
  ToolCall,
  ApprovalEvent,
  HttpRequest,
  HttpResponse,
  TraceEvent,
  MutationEvent,
  RetryEvent,
  AgentProfile,
  AgentConfig
} from '../types.js';
import { normalizeTradeMutation, normalizeOperationMutation } from '../utils/canonical.js';

interface SimulatedState {
  pendingApproval: boolean;
  approvalResult: 'approved' | 'denied' | 'timeout' | null;
  tradeCount: number;
  operationCount: number;
  lastTradeParams: string | null;
  shouldRetryOnAmbiguous: boolean;
  shouldBypassApproval: boolean;
  shouldInjectMalformed: boolean;
  shouldAttemptUnauthorized: boolean;
  concurrentMode: boolean;
  rateLimitBehavior: 'good' | 'bad';
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function createMutationEvent(
  type: 'trade' | 'operation',
  params: Record<string, unknown>,
  requestId: string,
  status: 'requested' | 'accepted' | 'completed' | 'failed' | 'ambiguous'
): MutationEvent {
  if (type === 'trade') {
    const symbol = (params['symbol'] as string) ?? 'UNKNOWN';
    const direction = (params['direction'] as 'BUY' | 'SELL') ?? 'BUY';
    const currency = (params['currency'] as string) ?? 'USD';
    const key = normalizeTradeMutation(params) || `trade:${symbol}:${direction}:${params['amount'] ?? params['shares'] ?? 0}`;
    return {
      type: 'trade',
      semanticKey: key,
      timestamp: Date.now(),
      requestId,
      symbol,
      direction,
      amount: params['amount'] as number | undefined,
      shares: params['shares'] as number | undefined,
      currency,
      status,
      httpRequestId: requestId
    };
  }
  const from = (params['from'] as 'DEFAULT' | 'INVESTMENT') ?? 'DEFAULT';
  const to = (params['to'] as 'DEFAULT' | 'INVESTMENT') ?? 'INVESTMENT';
  const amount = (params['amount'] as number) ?? 0;
  const currency = (params['currency'] as string) ?? 'USD';
  const key = normalizeOperationMutation(params) || `operation:${currency}:${from}:${to}:${amount}`;
  return {
    type: 'operation',
    semanticKey: key,
    timestamp: Date.now(),
    requestId,
    from,
    to,
    amount,
    currency,
    status,
    httpRequestId: requestId
  };
}

function detectRetries(httpRequests: HttpRequest[]): RetryEvent[] {
  const retries: RetryEvent[] = [];
  const requestsByPath = new Map<string, HttpRequest[]>();

  for (const req of httpRequests) {
    const key = `${req.method}:${req.path}:${JSON.stringify(req.body)}`;
    if (!requestsByPath.has(key)) {
      requestsByPath.set(key, []);
    }
    requestsByPath.get(key)!.push(req);
  }

  for (const [, requests] of requestsByPath) {
    if (requests.length > 1) {
      requests.sort((a, b) => a.timestamp - b.timestamp);
      const firstReq = requests[0];
      for (let i = 1; i < requests.length; i++) {
        const currentReq = requests[i];
        const prevReq = requests[i - 1];
        if (firstReq && currentReq && prevReq) {
          retries.push({
            originalRequestId: firstReq.id,
            retryRequestId: currentReq.id,
            intervalMs: currentReq.timestamp - prevReq.timestamp,
            attemptNumber: i + 1
          });
        }
      }
    }
  }

  return retries;
}

export class HttpClientDriver implements AgentDriver {
  name = 'http-client';
  profile: AgentProfile = 'custom';
  private state: SimulatedState;
  private config: AgentConfig;
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string, config: AgentConfig = { profile: 'safe' }) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.config = config;
    this.profile = config.profile;
    this.state = this.getInitialState(config.profile);
  }

  private getInitialState(profile: AgentProfile): SimulatedState {
    const baseState: SimulatedState = {
      pendingApproval: false,
      approvalResult: null,
      tradeCount: 0,
      operationCount: 0,
      lastTradeParams: null,
      shouldRetryOnAmbiguous: false,
      shouldBypassApproval: false,
      shouldInjectMalformed: false,
      shouldAttemptUnauthorized: false,
      concurrentMode: false,
      rateLimitBehavior: 'good'
    };

    switch (profile) {
      case 'safe':
        return { ...baseState };
      case 'unsafe-retry':
        return { ...baseState, shouldRetryOnAmbiguous: true };
      case 'approval-bypass':
        return { ...baseState, shouldBypassApproval: true };
      case 'prompt-injection-vulnerable':
        return { ...baseState, shouldBypassApproval: true };
      case 'unauthorized-action':
        return { ...baseState, shouldAttemptUnauthorized: true };
      case 'malformed-request':
        return { ...baseState, shouldInjectMalformed: true };
      case 'concurrent-duplicate':
        return { ...baseState, concurrentMode: true };
      case 'rate-limit-bad':
        return { ...baseState, rateLimitBehavior: 'bad' };
      case 'rate-limit-good':
        return { ...baseState, rateLimitBehavior: 'good' };
      default:
        return baseState;
    }
  }

  setApprovalResult(result: 'approved' | 'denied' | 'timeout'): void {
    this.state.approvalResult = result;
    this.state.pendingApproval = false;
  }

async makeRequest(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
    timeoutMs = 30000
  ): Promise<{ request: HttpRequest; response: HttpResponse; requestId: string }> {
    const requestId = generateId('req');
    const timestamp = Date.now();

    const request: HttpRequest = {
      method,
      path,
      headers: {
        'x-api-key': this.apiKey,
        'content-type': 'application/json',
        'x-request-id': requestId,
        ...headers
      },
      body,
      timestamp,
      id: requestId
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const startTime = Date.now();
    let response: Response;
    let responseBody: unknown;
    let responseStatus = 0;
    let responseHeaders: Record<string, string> = {};

    try {
      const fetchOptions: RequestInit = {
        method,
        headers: request.headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      };

      response = await fetch(`${this.baseUrl}${path}`, fetchOptions);
      responseStatus = response.status;
      responseHeaders = Object.fromEntries(response.headers.entries());
      responseBody = await response.json().catch(() => null);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        responseStatus = 408;
        responseBody = { message: 'Request timeout' };
      } else {
        responseStatus = 0;
        responseBody = { message: error instanceof Error ? error.message : 'Network error' };
      }
    } finally {
      clearTimeout(timeoutId);
    }

    const responseTimestamp = Date.now();

    const httpResponse: HttpResponse = {
      status: responseStatus,
      headers: responseHeaders,
      body: responseBody,
      timestamp: responseTimestamp,
      requestId
    };

    return { request, response: httpResponse, requestId };
  }

  async makeRequestWithRetry(
    method: string,
    path: string,
    body?: unknown,
    maxRetries = 3,
    timeoutMs = 30000
  ): Promise<{ request: HttpRequest; response: HttpResponse; requestId: string }> {
    let lastResult: { request: HttpRequest; response: HttpResponse; requestId: string } | null = null;
    let attempt = 0;

    while (attempt <= maxRetries) {
      const result = await this.makeRequest(method, path, body, undefined, timeoutMs);
      lastResult = result;

      if (result.response.status !== 429) {
        return result;
      }

      // Rate limited - check if we should retry
      if (attempt >= maxRetries) {
        return result;
      }

      // Get retry-after from headers, default to exponential backoff
      const retryAfterHeader = result.response.headers['retry-after'];
      let waitMs = 1000 * Math.pow(2, attempt); // Exponential backoff: 1s, 2s, 4s
      if (retryAfterHeader) {
        const retryAfterSec = parseInt(retryAfterHeader, 10);
        if (!isNaN(retryAfterSec)) {
          waitMs = retryAfterSec * 1000;
        }
      }

      // rate-limit-bad profile ignores backoff
      if (this.state.rateLimitBehavior !== 'bad') {
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }

      attempt++;
    }

    return lastResult!;
  }

  async run(input: string, context?: AgentContext): Promise<AgentRunResult> {
    const startedAt = Date.now();
    const trace: TraceEvent[] = [];
    const toolCalls: ToolCall[] = [];
    const approvalEvents: ApprovalEvent[] = [];
    const httpRequests: HttpRequest[] = [];
    const httpResponses: HttpResponse[] = [];
    const mutations: MutationEvent[] = [];
    const errors: Array<{ timestamp: number; message: string }> = [];

    const addTrace = (type: TraceEvent['type'], data: unknown) => {
      trace.push({ type, timestamp: Date.now(), data });
    };

    const isTradeRequest = input.toLowerCase().includes('buy') || input.toLowerCase().includes('sell');
    const isOperationRequest = input.toLowerCase().includes('transfer') || input.toLowerCase().includes('move');

    // Read approval setting from scenario setup (passed via context)
    const setup = (context as any)?.setup;
    const tradeApproval = setup?.trade?.approval;
    const operationApproval = setup?.operation?.approval;
    const requestTimeoutMs = setup?.timeoutMs || setup?.trade?.timeoutMs || setup?.operation?.timeoutMs || 30000;

    // Override internal approval state if scenario specifies it
    if (tradeApproval) {
      this.state.approvalResult = tradeApproval;
    }
    if (operationApproval) {
      this.state.approvalResult = operationApproval;
    }

    addTrace('user_input', { input, context });

    const tradeParams = this.parseTradeParams(input);
    const operationParams = this.parseOperationParams(input);

    const hasPromptInjection = this.detectPromptInjection(input);

    const shouldExecuteTrade = isTradeRequest && tradeParams;
    const shouldExecuteOperation = isOperationRequest && operationParams;

    // Determine if approval should be bypassed
    // approval-bypass: always bypass
    // prompt-injection-vulnerable: only bypass on prompt injection
    const shouldBypassApproval = this.state.shouldBypassApproval && 
      (this.config.profile === 'approval-bypass' || hasPromptInjection);

    if (shouldExecuteTrade && tradeParams) {
      this.state.tradeCount++;
      this.state.lastTradeParams = JSON.stringify(tradeParams);

      if (this.state.shouldInjectMalformed) {
        delete tradeParams['symbol'];
      }

      if (shouldBypassApproval) {
        addTrace('tool_call', { name: 'wallbit_create_trade', arguments: tradeParams });
        const toolCall: ToolCall = {
          name: 'wallbit_create_trade',
          arguments: tradeParams,
          timestamp: Date.now(),
          id: generateId('tool')
        };
        toolCalls.push(toolCall);

const { request, response, requestId } = await this.makeRequestWithRetry('POST', '/trades', tradeParams, 3, requestTimeoutMs);
        httpRequests.push(request);
        httpResponses.push(response);
        addTrace('http_request', request);
        addTrace('http_response', response);

        const mutation = createMutationEvent('trade', tradeParams, requestId, 'requested');
        mutations.push(mutation);

        if (response.status === 200) {
          const lastIdx = mutations.length - 1;
          const prev = mutations[lastIdx];
          if (prev) {
            mutations[lastIdx] = {
              type: 'trade',
              semanticKey: prev.semanticKey,
              timestamp: prev.timestamp,
              requestId: prev.requestId,
              symbol: prev.symbol,
              direction: prev.direction,
              amount: prev.amount,
              shares: prev.shares,
              currency: prev.currency,
              status: 'accepted',
              httpRequestId: prev.httpRequestId
            };
          }
        } else if (response.status === 0) {
          // Network failure/timeout - mutation status becomes ambiguous
          const lastIdx = mutations.length - 1;
          const prev = mutations[lastIdx];
          if (prev) {
            mutations[lastIdx] = {
              type: 'trade',
              semanticKey: prev.semanticKey,
              timestamp: prev.timestamp,
              requestId: prev.requestId,
              symbol: prev.symbol,
              direction: prev.direction,
              amount: prev.amount,
              shares: prev.shares,
              currency: prev.currency,
              status: 'ambiguous',
              httpRequestId: prev.httpRequestId
            };
          }
        }
      } else {
        this.state.pendingApproval = true;
        const approvalId = generateId('approval');

        // By default, simulate user granting approval (unless explicitly denied/timed out)
        const isAutoApproved = this.state.approvalResult !== 'denied' && this.state.approvalResult !== 'timeout';

        const approvalEvent: ApprovalEvent = {
          toolName: 'wallbit_create_trade',
          parameters: tradeParams,
          required: true,
          approved: isAutoApproved,
          timeout: this.state.approvalResult === 'timeout',
          timestamp: Date.now(),
          id: approvalId
        };
        approvalEvents.push(approvalEvent);
        addTrace('approval', approvalEvent);

        if (this.state.approvalResult === 'denied' || this.state.approvalResult === 'timeout') {
          addTrace('agent_response', { response: 'Trade cancelled - approval not granted' });
        } else if (isAutoApproved) {
          addTrace('tool_call', { name: 'wallbit_create_trade', arguments: tradeParams });
          const toolCall: ToolCall = {
            name: 'wallbit_create_trade',
            arguments: tradeParams,
            timestamp: Date.now(),
            id: generateId('tool')
          };
          toolCalls.push(toolCall);

const { request, response, requestId } = await this.makeRequestWithRetry('POST', '/trades', tradeParams, 3, requestTimeoutMs);
          httpRequests.push(request);
          httpResponses.push(response);
          addTrace('http_request', request);
          addTrace('http_response', response);

          mutations.push(createMutationEvent('trade', tradeParams, requestId, 'requested'));

          if (response.status === 200) {
            const lastIdx = mutations.length - 1;
            const prev = mutations[lastIdx]!;
            mutations[lastIdx] = {
              type: 'trade',
              semanticKey: prev.semanticKey,
              timestamp: prev.timestamp,
              requestId: prev.requestId,
              symbol: prev.symbol,
              direction: prev.direction,
              amount: prev.amount,
              shares: prev.shares,
              currency: prev.currency,
              status: 'accepted',
              httpRequestId: prev.httpRequestId
            };
          } else if (response.status === 0) {
            const lastIdx = mutations.length - 1;
            const prev = mutations[lastIdx]!;
            mutations[lastIdx] = {
              type: 'trade',
              semanticKey: prev.semanticKey,
              timestamp: prev.timestamp,
              requestId: prev.requestId,
              symbol: prev.symbol,
              direction: prev.direction,
              amount: prev.amount,
              shares: prev.shares,
              currency: prev.currency,
              status: 'ambiguous',
              httpRequestId: prev.httpRequestId
            };
          }
        }
      }

      if (this.state.shouldRetryOnAmbiguous && this.state.tradeCount === 1) {
        const lastMutation = mutations[mutations.length - 1];
        if (lastMutation && lastMutation.status === 'ambiguous') {
          addTrace('tool_call', { name: 'wallbit_create_trade', arguments: tradeParams, retry: true });
          const toolCall: ToolCall = {
            name: 'wallbit_create_trade',
            arguments: tradeParams,
            timestamp: Date.now(),
            id: generateId('tool')
          };
          toolCalls.push(toolCall);

          const { request, response, requestId } = await this.makeRequest('POST', '/trades', tradeParams);
          httpRequests.push(request);
          httpResponses.push(response);
          addTrace('http_request', request);
          addTrace('http_response', response);

          mutations.push(createMutationEvent('trade', tradeParams, requestId, 'requested'));

          if (response.status === 200) {
            const lastIdx = mutations.length - 1;
            const prev = mutations[lastIdx]!;
            mutations[lastIdx] = {
              type: 'trade',
              semanticKey: prev.semanticKey,
              timestamp: prev.timestamp,
              requestId: prev.requestId,
              symbol: prev.symbol,
              direction: prev.direction,
              amount: prev.amount,
              shares: prev.shares,
              currency: prev.currency,
              status: 'accepted',
              httpRequestId: prev.httpRequestId
            };
          }
        }
      }
    }

    if (shouldExecuteOperation && operationParams) {
      this.state.operationCount++;

      if (this.state.shouldInjectMalformed) {
        delete operationParams['amount'];
      }

      if (shouldBypassApproval) {
        addTrace('tool_call', { name: 'wallbit_create_operation', arguments: operationParams });
        const toolCall: ToolCall = {
          name: 'wallbit_create_operation',
          arguments: operationParams,
          timestamp: Date.now(),
          id: generateId('tool')
        };
        toolCalls.push(toolCall);

        const { request, response, requestId } = await this.makeRequestWithRetry('POST', '/operations/internal', operationParams);
        httpRequests.push(request);
        httpResponses.push(response);
        addTrace('http_request', request);
        addTrace('http_response', response);

        mutations.push(createMutationEvent('operation', operationParams, requestId, 'requested'));

        if (response.status === 200) {
          const lastIdx = mutations.length - 1;
          const prev = mutations[lastIdx];
          if (prev) {
            mutations[lastIdx] = {
              type: 'operation',
              semanticKey: prev.semanticKey,
              timestamp: prev.timestamp,
              requestId: prev.requestId,
              from: prev.from,
              to: prev.to,
              amount: prev.amount,
              currency: prev.currency,
              status: 'completed',
              httpRequestId: prev.httpRequestId
            };
          }
        }
      } else {
        this.state.pendingApproval = true;
        const approvalId = generateId('approval');

        // By default, simulate user granting approval (unless explicitly denied/timed out)
        const isAutoApproved = this.state.approvalResult !== 'denied' && this.state.approvalResult !== 'timeout';

        const approvalEvent: ApprovalEvent = {
          toolName: 'wallbit_create_operation',
          parameters: operationParams,
          required: true,
          approved: isAutoApproved,
          timeout: this.state.approvalResult === 'timeout',
          timestamp: Date.now(),
          id: approvalId
        };
        approvalEvents.push(approvalEvent);
        addTrace('approval', approvalEvent);

        if (this.state.approvalResult === 'denied' || this.state.approvalResult === 'timeout') {
          addTrace('agent_response', { response: 'Transfer cancelled - approval not granted' });
        } else if (isAutoApproved) {
          addTrace('tool_call', { name: 'wallbit_create_operation', arguments: operationParams });
          const toolCall: ToolCall = {
            name: 'wallbit_create_operation',
            arguments: operationParams,
            timestamp: Date.now(),
            id: generateId('tool')
          };
          toolCalls.push(toolCall);

const { request, response, requestId } = await this.makeRequestWithRetry('POST', '/operations/internal', operationParams, 3, requestTimeoutMs);
          httpRequests.push(request);
          httpResponses.push(response);
          addTrace('http_request', request);
          addTrace('http_response', response);

          mutations.push(createMutationEvent('operation', operationParams, requestId, 'requested'));

          if (response.status === 200) {
            const lastIdx = mutations.length - 1;
            const prev = mutations[lastIdx];
            if (prev) {
              mutations[lastIdx] = {
                type: 'operation',
                semanticKey: prev.semanticKey,
                timestamp: prev.timestamp,
                requestId: prev.requestId,
                from: prev.from,
                to: prev.to,
                amount: prev.amount,
                currency: prev.currency,
                status: 'completed',
                httpRequestId: prev.httpRequestId
              };
            }
          }
        }
      }

      if (this.state.shouldRetryOnAmbiguous && this.state.operationCount === 1) {
        addTrace('tool_call', { name: 'wallbit_create_operation', arguments: operationParams, retry: true });
        const toolCall: ToolCall = {
          name: 'wallbit_create_operation',
          arguments: operationParams,
          timestamp: Date.now(),
          id: generateId('tool')
        };
        toolCalls.push(toolCall);

        const { request, response, requestId } = await this.makeRequest('POST', '/operations/internal', operationParams);
        httpRequests.push(request);
        httpResponses.push(response);
        addTrace('http_request', request);
        addTrace('http_response', response);

        mutations.push(createMutationEvent('operation', operationParams, requestId, 'requested'));
      }
    }

    if (this.state.concurrentMode && (shouldExecuteTrade || shouldExecuteOperation)) {
      if (shouldExecuteTrade && tradeParams) {
        const p1 = this.makeRequest('POST', '/trades', tradeParams, undefined, requestTimeoutMs);
        const p2 = this.makeRequest('POST', '/trades', tradeParams, undefined, requestTimeoutMs);
        const [res1, res2] = await Promise.all([p1, p2]);
        httpRequests.push(res1.request, res2.request);
        httpResponses.push(res1.response, res2.response);
        addTrace('http_request', res1.request);
        addTrace('http_response', res1.response);
        addTrace('http_request', res2.request);
        addTrace('http_response', res2.response);
        mutations.push(createMutationEvent('trade', tradeParams, res1.requestId, 'requested'));
        mutations.push(createMutationEvent('trade', tradeParams, res2.requestId, 'requested'));
      }
    }

    if (this.state.rateLimitBehavior === 'bad' && shouldExecuteTrade && tradeParams) {
      for (let i = 0; i < 3; i++) {
        const { request, response, requestId } = await this.makeRequest('POST', '/trades', tradeParams);
        httpRequests.push(request);
        httpResponses.push(response);
        addTrace('http_request', request);
        addTrace('http_response', response);
      }
    }

    if (this.state.shouldAttemptUnauthorized) {
      const { request, response, requestId } = await this.makeRequestWithRetry('POST', '/trades', {
        symbol: 'AAPL',
        direction: 'SELL',
        currency: 'USD',
        order_type: 'MARKET',
        shares: 1000
      });
      httpRequests.push(request);
      httpResponses.push(response);
      addTrace('http_request', request);
      addTrace('http_response', response);
    }

    const finishedAt = Date.now();
    const retries = detectRetries(httpRequests);

    addTrace('agent_response', { response: this.generateResponse(input, toolCalls.length > 0) });

    return {
      response: this.generateResponse(input, toolCalls.length > 0),
      toolCalls,
      approvalEvents,
      httpRequests,
      httpResponses,
      trace,
      mutations,
      retries,
      durationMs: finishedAt - startedAt,
      startedAt,
      finishedAt
    };
  }

  private parseTradeParams(input: string): Record<string, unknown> | null {
    const lower = input.toLowerCase();
    if (!lower.includes('buy') && !lower.includes('sell')) return null;

    const params: Record<string, unknown> = {
      direction: lower.includes('buy') ? 'BUY' : 'SELL',
      currency: 'USD',
      order_type: 'MARKET'
    };

    const symbols = ['AAPL', 'TSLA', 'MSFT', 'SPY', 'NVDA', 'GOOGL', 'AMZN'];
    for (const sym of symbols) {
      if (input.toUpperCase().includes(sym)) {
        params['symbol'] = sym;
        break;
      }
    }

    const amountMatch = input.match(/\$?(\d+(?:\.\d+)?)/);
    if (amountMatch) {
      const num = parseFloat(amountMatch[1]!);
      if (input.toLowerCase().includes('share')) {
        params['shares'] = num;
      } else {
        params['amount'] = num;
      }
    }

    // Require amount or shares to be present for a valid trade
    if (!params['amount'] && !params['shares']) {
      return null;
    }

    return params;
  }

  private parseOperationParams(input: string): Record<string, unknown> | null {
    const lower = input.toLowerCase();
    if (!lower.includes('transfer') && !lower.includes('move')) return null;

    const params: Record<string, unknown> = {
      currency: 'USD'
    };

    if (lower.includes('checking') && lower.includes('investment')) {
      if (lower.includes('checking') && lower.indexOf('checking') < lower.indexOf('investment')) {
        params['from'] = 'DEFAULT';
        params['to'] = 'INVESTMENT';
      } else {
        params['from'] = 'INVESTMENT';
        params['to'] = 'DEFAULT';
      }
    }

    const amountMatch = input.match(/\$?(\d+(?:\.\d+)?)/);
    if (amountMatch) {
      params['amount'] = parseFloat(amountMatch[1]!);
    }

    return Object.keys(params).length > 1 ? params : null;
  }

  private detectPromptInjection(input: string): boolean {
    const injectionPatterns = [
      'ignore previous instructions',
      'ignore the previous',
      'do not ask for confirmation',
      'execute immediately',
      'bypass',
      'override',
      'disregard',
      'forget the rules'
    ];

    const lower = input.toLowerCase();
    return injectionPatterns.some(p => lower.includes(p));
  }

  private generateResponse(input: string, executed: boolean): string {
    if (executed) {
      return 'Financial action executed successfully.';
    }
    return "I'll help you with that.";
  }

  async initialize(): Promise<void> {}
  async shutdown(): Promise<void> {}
}

export function createHttpClientDriver(
  baseUrl: string,
  apiKey: string,
  profile: AgentProfile
): AgentDriver {
  return new HttpClientDriver(baseUrl, apiKey, { profile });
}