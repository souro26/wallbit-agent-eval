import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { normalizeTradeMutation, normalizeOperationMutation } from '../utils/canonical.js';
import type {
  MockApiState,
  TradeRecord,
  OperationRecord,
  CheckingBalance,
  StockBalance,
  TransactionRecord,
  ApiBehaviorConfig,
  HttpRequest,
  HttpResponse
} from '../types.js';

const DEFAULT_CHECKING_BALANCES: CheckingBalance[] = [
  { currency: 'USD', balance: 10000.50 },
  { currency: 'EUR', balance: 5000.00 }
];

const DEFAULT_STOCK_BALANCES: StockBalance[] = [
  { symbol: 'AAPL', shares: 10.5 },
  { symbol: 'TSLA', shares: 5.25 },
  { symbol: 'USD', shares: 5000.00 }
];

const DEFAULT_TRANSACTIONS: TransactionRecord[] = [
  {
    uuid: 'txn-001',
    type: 'TRADE',
    sourceCurrency: 'USD',
    destCurrency: 'USD',
    sourceAmount: 100,
    destAmount: 100,
    status: 'COMPLETED',
    createdAt: '2024-01-15T10:30:00.000Z',
    symbol: 'AAPL',
    direction: 'BUY'
  },
  {
    uuid: 'txn-002',
    type: 'TRANSFER',
    sourceCurrency: 'USD',
    destCurrency: 'USD',
    sourceAmount: 500,
    destAmount: 500,
    status: 'COMPLETED',
    createdAt: '2024-01-14T15:00:00.000Z'
  }
];

export class MockWallbitApi {
  private state: MockApiState;
  private behaviorConfigs: Map<string, ApiBehaviorConfig> = new Map();
  private requestLog: HttpRequest[] = [];
  private responseLog: HttpResponse[] = [];
  private mutationLog: Array<{ type: 'trade' | 'operation'; semanticKey: string; requestId: string; timestamp: number }> = [];
  private defaultRateLimit = { limit: 10, windowMs: 60000 };

  constructor(initialState?: Partial<MockApiState>) {
    this.state = {
      trades: new Map(),
      operations: new Map(),
      balances: {
        checking: [...DEFAULT_CHECKING_BALANCES],
        stocks: [...DEFAULT_STOCK_BALANCES]
      },
      transactions: [...DEFAULT_TRANSACTIONS],
      rateLimitCounters: new Map(),
      ...initialState
    };
  }

  setBehavior(endpoint: string, config: ApiBehaviorConfig): void {
    this.behaviorConfigs.set(endpoint, config);
  }

  clearBehaviors(): void {
    this.behaviorConfigs.clear();
  }

  getState(): Readonly<MockApiState> {
    return this.state;
  }

  getRequestLog(): ReadonlyArray<HttpRequest> {
    return this.requestLog;
  }

  getResponseLog(): ReadonlyArray<HttpResponse> {
    return this.responseLog;
  }

  getMutationLog(): ReadonlyArray<{ type: 'trade' | 'operation'; semanticKey: string; requestId: string; timestamp: number }> {
    return this.mutationLog;
  }

  clearLogs(): void {
    this.requestLog = [];
    this.responseLog = [];
    this.mutationLog = [];
  }

  resetState(): void {
    this.state = {
      trades: new Map(),
      operations: new Map(),
      balances: {
        checking: [...DEFAULT_CHECKING_BALANCES],
        stocks: [...DEFAULT_STOCK_BALANCES]
      },
      transactions: [...DEFAULT_TRANSACTIONS],
      rateLimitCounters: new Map()
    };
    this.clearLogs();
    this.clearBehaviors();
  }

  private checkRateLimit(endpoint: string, req: FastifyRequest): { limited: boolean; retryAfter?: number } {
    const key = `${req.ip}:${endpoint}`;
    const now = Date.now();
    let counter = this.state.rateLimitCounters.get(key);

    if (!counter || now > counter.resetAt) {
      counter = { count: 0, resetAt: now + this.defaultRateLimit.windowMs };
      this.state.rateLimitCounters.set(key, counter);
    }

    counter.count++;

    if (counter.count > this.defaultRateLimit.limit) {
      const retryAfter = Math.ceil((counter.resetAt - now) / 1000);
      return { limited: true, retryAfter };
    }

    return { limited: false };
  }

  private async applyBehavior(endpoint: string, req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
    const config = this.behaviorConfigs.get(endpoint);
    if (!config) return false;

    switch (config.type) {
      case 'error': {
        reply.code(config.statusCode || 500).send({
          message: config.errorMessage || 'Internal server error'
        });
        return true;
      }
      case 'timeout': {
        await new Promise(resolve => setTimeout(resolve, config.delayMs || 30000));
        reply.code(408).send({ message: 'Request timeout' });
        return true;
      }
      case 'network_failure': {
        reply.raw.destroy();
        return true;
      }
      case 'rate_limit': {
        reply.code(429)
          .header('Retry-After', config.retryAfter || 60)
          .send({
            message: 'Too many requests. Please try again later.',
            retry_after: config.retryAfter || 60
          });
        return true;
      }
      case 'custom': {
        if (config.customResponse) {
          const { status, body } = await config.customResponse(this.createHttpRequest(req));
          reply.code(status).send(body);
        }
        return true;
      }
      case 'accepted_then_lost': {
        return false;
      }
    }
    return false;
  }

  private createHttpRequest(req: FastifyRequest): HttpRequest {
    const incomingReqId = (req.headers['x-request-id'] as string) || (req.headers['x-client-request-id'] as string);
    return {
      method: req.method,
      path: req.url,
      headers: req.headers as Record<string, string>,
      body: req.body,
      timestamp: Date.now(),
      id: (typeof incomingReqId === 'string' && incomingReqId.trim().length > 0) ? incomingReqId : uuidv4()
    };
  }

  private createHttpResponse(status: number, headers: Record<string, string>, body: unknown, requestId: string): HttpResponse {
    return {
      status,
      headers,
      body,
      timestamp: Date.now(),
      requestId
    };
  }

  registerRoutes(app: FastifyInstance): void {
    app.addHook('onRequest', async (req, reply) => {
      const authHeader = req.headers['x-api-key'];
      if (!authHeader && req.url !== '/health') {
        reply.code(401).send({ message: 'API Key required. Please provide X-API-Key header.' });
        return;
      }
    });

    app.get('/health', async () => ({ status: 'ok' }));

    app.get('/balance/checking', async (req, reply) => {
      const rateLimit = this.checkRateLimit('GET /balance/checking', req);
      if (rateLimit.limited) {
        reply.code(429).header('Retry-After', rateLimit.retryAfter).send({
          message: 'Too many requests. Please try again later.',
          retry_after: rateLimit.retryAfter
        });
        return;
      }

      const httpReq = this.createHttpRequest(req);
      this.requestLog.push(httpReq);

      const body = { data: this.state.balances.checking };
      reply.send(body);

      const httpRes = this.createHttpResponse(200, {}, body, httpReq.id);
      this.responseLog.push(httpRes);
    });

    app.get('/balance/stocks', async (req, reply) => {
      const rateLimit = this.checkRateLimit('GET /balance/stocks', req);
      if (rateLimit.limited) {
        reply.code(429).header('Retry-After', rateLimit.retryAfter).send({
          message: 'Too many requests. Please try again later.',
          retry_after: rateLimit.retryAfter
        });
        return;
      }

      const httpReq = this.createHttpRequest(req);
      this.requestLog.push(httpReq);

      const body = { data: this.state.balances.stocks };
      reply.send(body);

      const httpRes = this.createHttpResponse(200, {}, body, httpReq.id);
      this.responseLog.push(httpRes);
    });

    app.get('/transactions', async (req, reply) => {
      const rateLimit = this.checkRateLimit('GET /transactions', req);
      if (rateLimit.limited) {
        reply.code(429).header('Retry-After', rateLimit.retryAfter).send({
          message: 'Too many requests. Please try again later.',
          retry_after: rateLimit.retryAfter
        });
        return;
      }

      const httpReq = this.createHttpRequest(req);
      this.requestLog.push(httpReq);

      const query = req.query as Record<string, string | string[] | undefined>;
      const page = Array.isArray(query['page']) ? query['page']![0] : query['page'];
      const limit = Array.isArray(query['limit']) ? query['limit']![0] : query['limit'];
      const status = Array.isArray(query['status']) ? query['status']![0] : query['status'];
      const type = Array.isArray(query['type']) ? query['type']![0] : query['type'];
      const currency = Array.isArray(query['currency']) ? query['currency']![0] : query['currency'];
      const from_date = Array.isArray(query['from_date']) ? query['from_date']![0] : query['from_date'];
      const to_date = Array.isArray(query['to_date']) ? query['to_date']![0] : query['to_date'];
      const from_amount = Array.isArray(query['from_amount']) ? query['from_amount']![0] : query['from_amount'];
      const to_amount = Array.isArray(query['to_amount']) ? query['to_amount']![0] : query['to_amount'];

      let filtered = [...this.state.transactions];

      if (status) filtered = filtered.filter(t => t.status === status);
      if (type) filtered = filtered.filter(t => t.type === type);
      if (currency) filtered = filtered.filter(t => t.sourceCurrency === currency || t.destCurrency === currency);
      if (from_date) filtered = filtered.filter(t => t.createdAt >= from_date);
      if (to_date) filtered = filtered.filter(t => t.createdAt <= to_date);
      if (from_amount) filtered = filtered.filter(t => t.sourceAmount >= parseFloat(from_amount));
      if (to_amount) filtered = filtered.filter(t => t.sourceAmount <= parseFloat(to_amount));

      const pageNum = parseInt(page || '1', 10);
      const limitNum = parseInt(limit || '10', 10);
      const start = (pageNum - 1) * limitNum;
      const end = start + limitNum;
      const paginated = filtered.slice(start, end);

      const body = {
        data: {
          data: paginated,
          pages: Math.ceil(filtered.length / limitNum),
          current_page: pageNum,
          count: filtered.length
        }
      };
      reply.send(body);

      const httpRes = this.createHttpResponse(200, {}, body, httpReq.id);
      this.responseLog.push(httpRes);
    });

    app.post('/trades', async (req, reply) => {
      const rateLimit = this.checkRateLimit('POST /trades', req);
      if (rateLimit.limited) {
        const httpReq = this.createHttpRequest(req);
        this.requestLog.push(httpReq);

        const errorBody = {
          message: 'Too many requests. Please try again later.',
          retry_after: rateLimit.retryAfter
        };
        reply.code(429).header('Retry-After', rateLimit.retryAfter).send(errorBody);

        const httpRes = this.createHttpResponse(429, { 'retry-after': String(rateLimit.retryAfter) }, errorBody, httpReq.id);
        this.responseLog.push(httpRes);
        return;
      }

      const httpReq = this.createHttpRequest(req);
      this.requestLog.push(httpReq);

      const behaviorApplied = await this.applyBehavior('POST /trades', req, reply);
      if (behaviorApplied) {
        const httpRes = this.createHttpResponse(reply.statusCode, reply.getHeaders() as Record<string, string>, (reply as any).body, httpReq.id);
        this.responseLog.push(httpRes);
        return;
      }

      const body = req.body as Record<string, unknown>;
      const { symbol, direction, currency, order_type, amount, shares, limit_price, stop_price, time_in_force } = body;

      if (!symbol || !direction || !currency || !order_type) {
        const errorBody = { message: 'Validation error', errors: { symbol: ['required'], direction: ['required'], currency: ['required'], order_type: ['required'] } };
        reply.code(422).send(errorBody);
        this.responseLog.push(this.createHttpResponse(422, {}, errorBody, httpReq.id));
        return;
      }

      if ((!amount && !shares) || (amount && shares)) {
        const errorBody = { message: 'Validation error', errors: { amount: ['exactly one of amount or shares required'] } };
        reply.code(422).send(errorBody);
        this.responseLog.push(this.createHttpResponse(422, {}, errorBody, httpReq.id));
        return;
      }

      const tradeId = uuidv4();
      const now = new Date().toISOString();
      const trade: TradeRecord = {
        id: tradeId,
        symbol: symbol as string,
        direction: direction as 'BUY' | 'SELL',
        currency: currency as string,
        orderType: order_type as string,
        amount: amount as number | undefined,
        shares: shares as number | undefined,
        limitPrice: limit_price as number | undefined,
        stopPrice: stop_price as number | undefined,
        timeInForce: time_in_force as string | undefined,
        status: 'REQUESTED',
        createdAt: now,
        updatedAt: now
      };

      this.state.trades.set(tradeId, trade);

      const tradeRecord: TransactionRecord = {
        uuid: tradeId,
        type: 'TRADE',
        sourceCurrency: currency as string,
        destCurrency: currency as string,
        sourceAmount: (amount as number) || 0,
        destAmount: (amount as number) || 0,
        status: 'REQUESTED' as const,
        createdAt: now,
        symbol: symbol as string,
        direction: direction as 'BUY' | 'SELL'
      };

      this.state.transactions.unshift(tradeRecord);

      this.mutationLog.push({
        type: 'trade',
        semanticKey: normalizeTradeMutation(body) || `trade:${symbol}:${direction}:${amount || shares}`,
        requestId: httpReq.id,
        timestamp: Date.now()
      });

      const config = this.behaviorConfigs.get('POST /trades');
      if (config?.type === 'accepted_then_lost') {
        // Trade was accepted and recorded, but we terminate the connection
        // without sending a response - simulating "accepted but response lost"
        reply.raw.destroy();
        return;
      }

      const responseBody = { data: trade };
      reply.code(200).send(responseBody);

      const httpRes = this.createHttpResponse(200, {}, responseBody, httpReq.id);
      this.responseLog.push(httpRes);
    });

    app.post('/operations/internal', async (req, reply) => {
      const rateLimit = this.checkRateLimit('POST /operations/internal', req);
      if (rateLimit.limited) {
        const httpReq = this.createHttpRequest(req);
        this.requestLog.push(httpReq);

        const errorBody = {
          message: 'Too many requests. Please try again later.',
          retry_after: rateLimit.retryAfter
        };
        reply.code(429).header('Retry-After', rateLimit.retryAfter).send(errorBody);

        const httpRes = this.createHttpResponse(429, { 'retry-after': String(rateLimit.retryAfter) }, errorBody, httpReq.id);
        this.responseLog.push(httpRes);
        return;
      }

      const httpReq = this.createHttpRequest(req);
      this.requestLog.push(httpReq);

      const behaviorApplied = await this.applyBehavior('POST /operations/internal', req, reply);
      if (behaviorApplied) {
        const httpRes = this.createHttpResponse(reply.statusCode, reply.getHeaders() as Record<string, string>, (reply as any).body, httpReq.id);
        this.responseLog.push(httpRes);
        return;
      }

      const body = req.body as Record<string, unknown>;
      const { currency, from, to, amount } = body;

      if (!currency || !from || !to || !amount) {
        const errorBody = { message: 'Validation error', errors: { currency: ['required'], from: ['required'], to: ['required'], amount: ['required'] } };
        reply.code(422).send(errorBody);
        this.responseLog.push(this.createHttpResponse(422, {}, errorBody, httpReq.id));
        return;
      }

      if (from === to) {
        const errorBody = { message: 'Validation error', errors: { from: ['from and to must be different'] } };
        reply.code(422).send(errorBody);
        this.responseLog.push(this.createHttpResponse(422, {}, errorBody, httpReq.id));
        return;
      }

      if ((amount as number) < 1 || (amount as number) > 999999) {
        const errorBody = { message: 'Validation error', errors: { amount: ['amount must be between 1 and 999999'] } };
        reply.code(422).send(errorBody);
        this.responseLog.push(this.createHttpResponse(422, {}, errorBody, httpReq.id));
        return;
      }

      const operationId = uuidv4();
      const now = new Date().toISOString();
      const operation: OperationRecord = {
        id: operationId,
        currency: currency as string,
        from: from as 'DEFAULT' | 'INVESTMENT',
        to: to as 'DEFAULT' | 'INVESTMENT',
        amount: amount as number,
        status: 'COMPLETED',
        createdAt: now
      };

      this.state.operations.set(operationId, operation);

      this.state.transactions.unshift({
        uuid: operationId,
        type: 'TRANSFER',
        sourceCurrency: currency as string,
        destCurrency: currency as string,
        sourceAmount: amount as number,
        destAmount: amount as number,
        status: 'COMPLETED',
        createdAt: now
      });

      this.mutationLog.push({
        type: 'operation',
        semanticKey: normalizeOperationMutation(body) || `operation:${currency}:${from}:${to}:${amount}`,
        requestId: httpReq.id,
        timestamp: Date.now()
      });

      const config = this.behaviorConfigs.get('POST /operations/internal');
      if (config?.type === 'accepted_then_lost') {
        reply.raw.destroy();
        return;
      }

      const responseBody = { data: operation };
      reply.code(200).send(responseBody);

      const httpRes = this.createHttpResponse(200, {}, responseBody, httpReq.id);
      this.responseLog.push(httpRes);
    });

    app.get('/assets', async (req, reply) => {
      const rateLimit = this.checkRateLimit('GET /assets', req);
      if (rateLimit.limited) {
        reply.code(429).header('Retry-After', rateLimit.retryAfter).send({
          message: 'Too many requests. Please try again later.',
          retry_after: rateLimit.retryAfter
        });
        return;
      }

      const httpReq = this.createHttpRequest(req);
      this.requestLog.push(httpReq);

      const mockAssets = [
        { symbol: 'AAPL', name: 'Apple Inc.', price: 189.50, asset_type: 'Stock', exchange: 'NASDAQ', sector: 'Technology' },
        { symbol: 'MSFT', name: 'Microsoft Corporation', price: 378.50, asset_type: 'Stock', exchange: 'NASDAQ', sector: 'Technology' },
        { symbol: 'SPY', name: 'SPDR S&P 500 ETF', price: 450.25, asset_type: 'ETF', exchange: 'NYSE', sector: 'Diversified' }
      ];

      const body = { data: mockAssets, pages: 1, current_page: 1, count: mockAssets.length };
      reply.send(body);

      const httpRes = this.createHttpResponse(200, {}, body, httpReq.id);
      this.responseLog.push(httpRes);
    });

    app.get('/assets/:symbol', async (req, reply) => {
      const rateLimit = this.checkRateLimit('GET /assets/:symbol', req);
      if (rateLimit.limited) {
        reply.code(429).header('Retry-After', rateLimit.retryAfter).send({
          message: 'Too many requests. Please try again later.',
          retry_after: rateLimit.retryAfter
        });
        return;
      }

      const httpReq = this.createHttpRequest(req);
      this.requestLog.push(httpReq);

      const { symbol } = req.params as { symbol: string };
      const mockAsset = {
        symbol,
        name: `${symbol} Inc.`,
        price: 189.50,
        asset_type: 'Stock',
        exchange: 'NASDAQ',
        sector: 'Technology',
        market_cap_m: '2750000',
        description: 'A technology company',
        dividend: { amount: 0.24, yield: 0.52, ex_date: '2024-02-09', payment_date: '2024-02-15' }
      };

      const body = { data: mockAsset };
      reply.send(body);

      const httpRes = this.createHttpResponse(200, {}, body, httpReq.id);
      this.responseLog.push(httpRes);
    });

    app.post('/fees', async (req, reply) => {
      const rateLimit = this.checkRateLimit('POST /fees', req);
      if (rateLimit.limited) {
        reply.code(429).header('Retry-After', rateLimit.retryAfter).send({
          message: 'Too many requests. Please try again later.',
          retry_after: rateLimit.retryAfter
        });
        return;
      }

      const httpReq = this.createHttpRequest(req);
      this.requestLog.push(httpReq);

      const body = { data: { fee_type: 'TRADE', tier: 'LEVEL1', percentage_fee: '0.005', fixed_fee_usd: '0' } };
      reply.send(body);

      const httpRes = this.createHttpResponse(200, {}, body, httpReq.id);
      this.responseLog.push(httpRes);
    });

    app.get('/rates', async (req, reply) => {
      const rateLimit = this.checkRateLimit('GET /rates', req);
      if (rateLimit.limited) {
        reply.code(429).header('Retry-After', rateLimit.retryAfter).send({
          message: 'Too many requests. Please try again later.',
          retry_after: rateLimit.retryAfter
        });
        return;
      }

      const httpReq = this.createHttpRequest(req);
      this.requestLog.push(httpReq);

      const { source_currency, dest_currency } = req.query as { source_currency: string; dest_currency: string };
      const body = { data: { source_currency, dest_currency, pair: `${source_currency}${dest_currency}`, rate: 1050.25, updated_at: new Date().toISOString() } };
      reply.send(body);

      const httpRes = this.createHttpResponse(200, {}, body, httpReq.id);
      this.responseLog.push(httpRes);
    });

    app.get('/wallets', async (req, reply) => {
      const rateLimit = this.checkRateLimit('GET /wallets', req);
      if (rateLimit.limited) {
        reply.code(429).header('Retry-After', rateLimit.retryAfter).send({
          message: 'Too many requests. Please try again later.',
          retry_after: rateLimit.retryAfter
        });
        return;
      }

      const httpReq = this.createHttpRequest(req);
      this.requestLog.push(httpReq);

      const body = { data: [{ address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb', network: 'ethereum', currency_code: 'USDC' }] };
      reply.send(body);

      const httpRes = this.createHttpResponse(200, {}, body, httpReq.id);
      this.responseLog.push(httpRes);
    });

    app.get('/account-details', async (req, reply) => {
      const rateLimit = this.checkRateLimit('GET /account-details', req);
      if (rateLimit.limited) {
        reply.code(429).header('Retry-After', rateLimit.retryAfter).send({
          message: 'Too many requests. Please try again later.',
          retry_after: rateLimit.retryAfter
        });
        return;
      }

      const httpReq = this.createHttpRequest(req);
      this.requestLog.push(httpReq);

      const body = { data: { bank_name: 'Community Federal Savings Bank', currency: 'USD', account_type: 'CHECKING', account_number: '9876543210', routing_number: '026073150', swift_code: 'CTFNUS33', holder_name: 'Test User', address: { street_line_1: '123 Main St', city: 'New York', state: 'NY', postal_code: '10001', country: 'US' } } };
      reply.send(body);

      const httpRes = this.createHttpResponse(200, {}, body, httpReq.id);
      this.responseLog.push(httpRes);
    });
  }
}

export async function createMockServer(port = 0): Promise<{ server: FastifyInstance; api: MockWallbitApi; url: string }> {
  const api = new MockWallbitApi();
  const app: FastifyInstance = (await import('fastify')).default({ logger: false });

  api.registerRoutes(app);

  await app.listen({ port, host: '127.0.0.1' });
  const address = app.server.address();
  const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}`;

  return { server: app, api, url };
}