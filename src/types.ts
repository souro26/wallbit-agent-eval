export interface AgentContext {
  apiKey?: string;
  baseUrl?: string;
  [key: string]: unknown;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
  timestamp: number;
  id: string;
}

export interface ApprovalEvent {
  toolName: string;
  parameters: Record<string, unknown>;
  required: boolean;
  approved?: boolean;
  timeout?: boolean;
  timestamp: number;
  id: string;
}

export interface HttpRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
  timestamp: number;
  id: string;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body?: unknown;
  timestamp: number;
  requestId: string;
}

export type TraceEventType =
  | 'user_input'
  | 'agent_response'
  | 'tool_call'
  | 'approval'
  | 'http_request'
  | 'http_response'
  | 'error'
  | 'api_state_change';

export interface TraceEvent {
  type: TraceEventType;
  timestamp: number;
  data: unknown;
}

export interface MutationEvent {
  type: 'trade' | 'operation';
  semanticKey: string;
  timestamp: number;
  requestId: string;
  symbol?: string;
  direction?: 'BUY' | 'SELL';
  amount?: number;
  shares?: number;
  from?: 'DEFAULT' | 'INVESTMENT';
  to?: 'DEFAULT' | 'INVESTMENT';
  currency: string;
  status: 'requested' | 'accepted' | 'completed' | 'failed' | 'ambiguous';
  httpRequestId: string;
}

export interface RetryEvent {
  originalRequestId: string;
  retryRequestId: string;
  intervalMs: number;
  attemptNumber: number;
}

export interface AgentRunResult {
  response: string;
  toolCalls: ToolCall[];
  approvalEvents: ApprovalEvent[];
  httpRequests: HttpRequest[];
  httpResponses: HttpResponse[];
  trace: TraceEvent[];
  mutations: MutationEvent[];
  retries: RetryEvent[];
  error?: string;
  durationMs: number;
  startedAt: number;
  finishedAt: number;
}

export interface AgentDriver {
  name: string;
  profile: AgentProfile;
  run(input: string, context?: AgentContext): Promise<AgentRunResult>;
  initialize?(): Promise<void>;
  shutdown?(): Promise<void>;
}

export type AgentProfile =
  | 'safe'
  | 'unsafe-retry'
  | 'approval-bypass'
  | 'prompt-injection-vulnerable'
  | 'unauthorized-action'
  | 'malformed-request'
  | 'concurrent-duplicate'
  | 'rate-limit-bad'
  | 'rate-limit-good'
  | 'custom';

export interface ApiBehaviorConfig {
  type: 'success' | 'error' | 'timeout' | 'network_failure' | 'accepted_then_lost' | 'rate_limit' | 'custom';
  statusCode?: number;
  delayMs?: number;
  errorMessage?: string;
  retryAfter?: number;
  customResponse?: (request: HttpRequest) => Promise<{ status: number; body: unknown }>;
}

export interface MockApiState {
  trades: Map<string, TradeRecord>;
  operations: Map<string, OperationRecord>;
  balances: { checking: CheckingBalance[]; stocks: StockBalance[] };
  transactions: TransactionRecord[];
  rateLimitCounters: Map<string, { count: number; resetAt: number }>;
}

export interface TradeRecord {
  id: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  currency: string;
  orderType: string;
  amount?: number;
  shares?: number;
  limitPrice?: number;
  stopPrice?: number;
  timeInForce?: string;
  status: 'REQUESTED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  createdAt: string;
  updatedAt: string;
}

export interface OperationRecord {
  id: string;
  currency: string;
  from: 'DEFAULT' | 'INVESTMENT';
  to: 'DEFAULT' | 'INVESTMENT';
  amount: number;
  status: 'COMPLETED' | 'FAILED' | 'PENDING';
  createdAt: string;
}

export interface CheckingBalance {
  currency: string;
  balance: number;
}

export interface StockBalance {
  symbol: string;
  shares: number;
}

export interface TransactionRecord {
  uuid: string;
  type: 'TRADE' | 'TRANSFER' | 'DEPOSIT' | 'WITHDRAWAL';
  sourceCurrency: string;
  destCurrency: string;
  sourceAmount: number;
  destAmount: number;
  status: 'COMPLETED' | 'PENDING' | 'FAILED' | 'REQUESTED';
  createdAt: string;
  symbol?: string;
  direction?: 'BUY' | 'SELL';
}

export interface ScenarioExpectation {
  type: string;
  description: string;
  severity: 'critical' | 'warning' | 'info';
  evaluate: (trace: EvaluationTrace, apiState: MockApiState, runResult: AgentRunResult) => AssertionResult;
}

export interface AssertionResult {
  passed: boolean;
  message: string;
  severity: 'critical' | 'warning' | 'info';
  evidence?: AssertionEvidence;
}

export interface AssertionEvidence {
  expected: unknown;
  observed: unknown;
  requestIds?: string[];
  timestamps?: number[];
  details?: Record<string, unknown>;
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  category: string;
  prompt: string;
  setup: ScenarioSetup;
  expectedBehavior: string[];
  forbiddenBehavior: string[];
  expectations: ScenarioExpectation[];
  severity: 'critical' | 'warning' | 'info';
  timeoutMs?: number;
}

export interface ScenarioSetup {
  trade?: TradeSetup;
  operation?: OperationSetup;
  api?: ApiSetup;
}

export interface TradeSetup {
  failure?: 'success' | 'accepted_then_lost' | 'error' | 'rate_limit' | 'timeout' | 'network_failure';
  statusCode?: number;
  retryAfter?: number;
  approval?: 'approved' | 'denied' | 'timeout';
}

export interface OperationSetup {
  failure?: 'success' | 'accepted_then_lost' | 'error' | 'rate_limit' | 'timeout' | 'network_failure';
  statusCode?: number;
  retryAfter?: number;
  approval?: 'approved' | 'denied' | 'timeout';
}

export interface ApiSetup {
  behaviors?: Record<string, ApiBehaviorConfig>;
}

export interface ScenarioResult {
  id: string;
  name: string;
  description: string;
  category: string;
  passed: boolean;
  severity: 'critical' | 'warning' | 'info';
  assertions: { expectation: ScenarioExpectation; result: AssertionResult }[];
  trace: EvaluationTrace;
  durationMs: number;
  error?: string;
  criticalFailures: number;
}

export interface EvaluationTrace {
  startedAt: number;
  finishedAt: number;
  agentEvents: TraceEvent[];
  toolCalls: ToolCall[];
  approvalEvents: ApprovalEvent[];
  httpRequests: HttpRequest[];
  httpResponses: HttpResponse[];
  mutations: MutationEvent[];
  retries: RetryEvent[];
  errors: EvaluationError[];
  clientHttpRequests?: HttpRequest[];
  clientHttpResponses?: HttpResponse[];
  filter: (predicate: (event: TraceEvent) => boolean) => TraceEvent[];
  some: (predicate: (event: TraceEvent) => boolean) => boolean;
  map: <T>(callback: (event: TraceEvent) => T) => T[];
}

export interface EvaluationError {
  timestamp: number;
  message: string;
  context?: Record<string, unknown>;
}

export interface EvaluationReport {
  metadata: ReportMetadata;
  scenarios: ScenarioResult[];
  totalPassed: number;
  totalFailed: number;
  totalCriticalFailures: number;
  totalDurationMs: number;
}

export interface ReportMetadata {
  agent: string;
  driver: string;
  startedAt: string;
  finishedAt: string;
  scenarioCount: number;
}

export interface Reporter {
  name: string;
  report(report: EvaluationReport): Promise<void> | void;
}

export interface CliOptions {
  scenarios?: string[];
  agent?: string;
  driver?: string;
  json?: string | boolean;
  junit?: string | boolean;
  verbose?: boolean;
  list?: boolean;
  output?: string;
  format?: 'text' | 'json' | 'junit';
}

export interface AgentConfig {
  profile: AgentProfile;
  customBehavior?: Partial<AgentRunResult>;
}