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

export class DeterministicDriver implements AgentDriver {
  name = 'deterministic';
  profile: AgentProfile = 'custom';
  private state: SimulatedState;
  private config: AgentConfig;
  private scriptedResponses: Map<string, AgentRunResult> = new Map();
  private scriptedPatterns: Map<string, AgentRunResult> = new Map();

  constructor(config: AgentConfig = { profile: 'safe' }) {
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

    addTrace('user_input', { input, context });

    // Check for scripted response for exact input match
    if (this.scriptedResponses.has(input)) {
      const scripted = this.scriptedResponses.get(input)!;
      return {
        ...scripted,
        durationMs: scripted.durationMs || Date.now() - startedAt,
        startedAt,
        finishedAt: Date.now()
      };
    }

    // Check for scripted response for pattern match
    for (const [pattern, scripted] of this.scriptedPatterns) {
      if (input.toLowerCase().includes(pattern.toLowerCase())) {
        return {
          ...scripted,
          durationMs: scripted.durationMs || Date.now() - startedAt,
          startedAt,
          finishedAt: Date.now()
        };
      }
    }

    // Parse intent from input
    const tradeParams = this.parseTradeParams(input);
    const operationParams = this.parseOperationParams(input);

    // Check for malicious patterns
    const hasPromptInjection = this.detectPromptInjection(input);

    // Determine if we should execute a financial action
    const shouldExecuteTrade = isTradeRequest && tradeParams;
    const shouldExecuteOperation = isOperationRequest && operationParams;

    // Simulate agent behavior
    if (shouldExecuteTrade && tradeParams) {
      this.state.tradeCount++;
      this.state.lastTradeParams = JSON.stringify(tradeParams);

      // Check for malformed parameters
      if (this.state.shouldInjectMalformed) {
        delete tradeParams['symbol'];
      }

      // Check for prompt injection bypass
      if (hasPromptInjection && this.state.shouldBypassApproval) {
        // Bypass approval - execute directly
        addTrace('tool_call', { name: 'wallbit_create_trade', arguments: tradeParams });
        const toolCall: ToolCall = {
          name: 'wallbit_create_trade',
          arguments: tradeParams,
          timestamp: Date.now(),
          id: generateId('tool')
        };
        toolCalls.push(toolCall);

        // Simulate HTTP request
        const reqId = generateId('req');
        const httpReq: HttpRequest = {
          method: 'POST',
          path: '/trades',
          headers: { 'x-api-key': context?.apiKey || 'test-key', 'content-type': 'application/json' },
          body: tradeParams,
          timestamp: Date.now(),
          id: reqId
        };
        httpRequests.push(httpReq);
        addTrace('http_request', httpReq);

        // Mutation recorded
        const mutation = createMutationEvent('trade', tradeParams, reqId, 'requested');
        mutations.push(mutation);

        // Simulate response
        const httpRes: HttpResponse = {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: { data: { ...tradeParams, id: generateId('trade'), status: 'REQUESTED' } },
          timestamp: Date.now(),
          requestId: reqId
        };
        httpResponses.push(httpRes);
        addTrace('http_response', httpRes);

        // Update mutation status - preserve type and all required fields
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
      } else {
        // Normal flow with approval
        this.state.pendingApproval = true;
        const approvalId = generateId('approval');

        const approvalEvent: ApprovalEvent = {
          toolName: 'wallbit_create_trade',
          parameters: tradeParams,
          required: true,
          approved: this.state.approvalResult === 'approved',
          timeout: this.state.approvalResult === 'timeout',
          timestamp: Date.now(),
          id: approvalId
        };
        approvalEvents.push(approvalEvent);
        addTrace('approval', approvalEvent);

        // Check if approval was denied or timed out
        if (this.state.approvalResult === 'denied' || this.state.approvalResult === 'timeout') {
          addTrace('agent_response', { response: 'Trade cancelled - approval not granted' });
        } else if (this.state.approvalResult === 'approved') {
          // Approved - execute trade
          addTrace('tool_call', { name: 'wallbit_create_trade', arguments: tradeParams });
          const toolCall: ToolCall = {
            name: 'wallbit_create_trade',
            arguments: tradeParams,
            timestamp: Date.now(),
            id: generateId('tool')
          };
          toolCalls.push(toolCall);

          const reqId = generateId('req');
          const httpReq: HttpRequest = {
            method: 'POST',
            path: '/trades',
            headers: { 'x-api-key': context?.apiKey || 'test-key', 'content-type': 'application/json' },
            body: tradeParams,
            timestamp: Date.now(),
            id: reqId
          };
          httpRequests.push(httpReq);
          addTrace('http_request', httpReq);

          mutations.push(createMutationEvent('trade', tradeParams, reqId, 'requested'));

          // Simulate successful response
          const httpRes: HttpResponse = {
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: { data: { ...tradeParams, id: generateId('trade'), status: 'REQUESTED' } },
            timestamp: Date.now(),
            requestId: reqId
          };
          httpResponses.push(httpRes);
          addTrace('http_response', httpRes);

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

      // Check for retry on ambiguous failure
      if (this.state.shouldRetryOnAmbiguous && this.state.tradeCount === 1) {
        // Simulate a retry after "accepted_then_lost"
        // This would be triggered by the mock API behavior
        // For now, we simulate the agent's decision to retry
      }
    }

    if (shouldExecuteOperation && operationParams) {
      this.state.operationCount++;

      if (this.state.shouldInjectMalformed) {
        delete operationParams['amount'];
      }

      if (hasPromptInjection && this.state.shouldBypassApproval) {
        // Bypass approval for operation too
        addTrace('tool_call', { name: 'wallbit_create_operation', arguments: operationParams });
        const toolCall: ToolCall = {
          name: 'wallbit_create_operation',
          arguments: operationParams,
          timestamp: Date.now(),
          id: generateId('tool')
        };
        toolCalls.push(toolCall);

        const reqId = generateId('req');
        const httpReq: HttpRequest = {
          method: 'POST',
          path: '/operations/internal',
          headers: { 'x-api-key': context?.apiKey || 'test-key', 'content-type': 'application/json' },
          body: operationParams,
          timestamp: Date.now(),
          id: reqId
        };
        httpRequests.push(httpReq);
        addTrace('http_request', httpReq);

        mutations.push(createMutationEvent('operation', operationParams, reqId, 'requested'));

        const httpRes: HttpResponse = {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: { data: { ...operationParams, id: generateId('op'), status: 'COMPLETED' } },
          timestamp: Date.now(),
          requestId: reqId
        };
        httpResponses.push(httpRes);
        addTrace('http_response', httpRes);

const lastIdx = mutations.length - 1;
          const prev = mutations[lastIdx]!;
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
      } else {
        // Normal flow with approval
        this.state.pendingApproval = true;
        const approvalId = generateId('approval');

        const approvalEvent: ApprovalEvent = {
          toolName: 'wallbit_create_operation',
          parameters: operationParams,
          required: true,
          approved: this.state.approvalResult === 'approved',
          timeout: this.state.approvalResult === 'timeout',
          timestamp: Date.now(),
          id: approvalId
        };
        approvalEvents.push(approvalEvent);
        addTrace('approval', approvalEvent);

        if (this.state.approvalResult === 'denied' || this.state.approvalResult === 'timeout') {
          addTrace('agent_response', { response: 'Transfer cancelled - approval not granted' });
        } else if (this.state.approvalResult === 'approved') {
          addTrace('tool_call', { name: 'wallbit_create_operation', arguments: operationParams });
          const toolCall: ToolCall = {
            name: 'wallbit_create_operation',
            arguments: operationParams,
            timestamp: Date.now(),
            id: generateId('tool')
          };
          toolCalls.push(toolCall);

          const reqId = generateId('req');
          const httpReq: HttpRequest = {
            method: 'POST',
            path: '/operations/internal',
            headers: { 'x-api-key': context?.apiKey || 'test-key', 'content-type': 'application/json' },
            body: operationParams,
            timestamp: Date.now(),
            id: reqId
          };
          httpRequests.push(httpReq);
          addTrace('http_request', httpReq);

          mutations.push(createMutationEvent('operation', operationParams, reqId, 'requested'));

          const httpRes: HttpResponse = {
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: { data: { ...operationParams, id: generateId('op'), status: 'COMPLETED' } },
            timestamp: Date.now(),
            requestId: reqId
          };
          httpResponses.push(httpRes);
          addTrace('http_response', httpRes);

          const lastIdx = mutations.length - 1;
          const prev = mutations[lastIdx]!;
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

    // Concurrent duplicate simulation
    if (this.state.concurrentMode && (shouldExecuteTrade || shouldExecuteOperation)) {
      // Simulate a second concurrent request
      if (shouldExecuteTrade && tradeParams) {
        const reqId = generateId('req');
        const httpReq: HttpRequest = {
          method: 'POST',
          path: '/trades',
          headers: { 'x-api-key': context?.apiKey || 'test-key', 'content-type': 'application/json' },
          body: tradeParams,
          timestamp: Date.now(),
          id: reqId
        };
        httpRequests.push(httpReq);

        const httpRes: HttpResponse = {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: { data: { ...tradeParams, id: generateId('trade'), status: 'REQUESTED' } },
          timestamp: Date.now(),
          requestId: reqId
        };
        httpResponses.push(httpRes);
        addTrace('http_response', httpRes);

        mutations.push(createMutationEvent('trade', tradeParams, reqId, 'requested'));
      }
    }

    // Rate limit bad behavior - rapid retries
    if (this.state.rateLimitBehavior === 'bad' && shouldExecuteTrade && tradeParams) {
      for (let i = 0; i < 3; i++) {
        const reqId = generateId('req');
        const httpReq: HttpRequest = {
          method: 'POST',
          path: '/trades',
          headers: { 'x-api-key': context?.apiKey || 'test-key', 'content-type': 'application/json' },
          body: tradeParams,
          timestamp: Date.now() + i * 100,
          id: reqId
        };
        httpRequests.push(httpReq);
        addTrace('http_request', httpReq);

        const httpRes: HttpResponse = {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '2' },
          body: { message: 'Too many requests', retry_after: 2 },
          timestamp: Date.now() + i * 100,
          requestId: reqId
        };
        httpResponses.push(httpRes);
        addTrace('http_response', httpRes);
      }
    }

    // Unauthorized action attempt
    if (this.state.shouldAttemptUnauthorized) {
      const reqId = generateId('req');
      const httpReq: HttpRequest = {
        method: 'POST',
        path: '/trades',
        headers: { 'x-api-key': context?.apiKey || 'test-key', 'content-type': 'application/json' },
        body: { symbol: 'AAPL', direction: 'SELL', currency: 'USD', order_type: 'MARKET', shares: 1000 },
        timestamp: Date.now(),
        id: reqId
      };
      httpRequests.push(httpReq);
      addTrace('http_request', httpReq);

      const httpRes: HttpResponse = {
        status: 403,
        headers: { 'content-type': 'application/json' },
        body: { message: 'Insufficient permissions. Required permission: trade' },
        timestamp: Date.now(),
        requestId: reqId
      };
      httpResponses.push(httpRes);
      addTrace('http_response', httpRes);
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

    // Extract symbol
    const symbols = ['AAPL', 'TSLA', 'MSFT', 'SPY', 'NVDA', 'GOOGL', 'AMZN'];
    for (const sym of symbols) {
      if (input.toUpperCase().includes(sym)) {
        params['symbol'] = sym;
        break;
      }
    }

    // Extract amount or shares
    const amountMatch = input.match(/\$?(\d+(?:\.\d+)?)/);
    if (amountMatch) {
      const num = parseFloat(amountMatch[1]!);
      if (input.toLowerCase().includes('share')) {
        params['shares'] = num;
      } else {
        params['amount'] = num;
      }
    }

    return Object.keys(params).length > 3 ? params : null;
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

  setScriptedResponseForInput(input: string, result: AgentRunResult): void {
    this.scriptedResponses.set(input, result);
  }

  setScriptedResponse(pattern: string, result: AgentRunResult): void {
    this.scriptedPatterns.set(pattern, result);
  }

  async initialize(): Promise<void> {}
  async shutdown(): Promise<void> {}
}

export function createDriver(profile: AgentProfile): AgentDriver {
  return new DeterministicDriver({ profile });
}