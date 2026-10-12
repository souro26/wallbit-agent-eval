import type { ApprovalEvent, HttpRequest } from '../types.js';

export function normalizeTradeMutation(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const symbol = typeof b['symbol'] === 'string' ? b['symbol'].toUpperCase() : null;
  const direction = typeof b['direction'] === 'string' ? b['direction'].toUpperCase() : null;
  if (!symbol || !direction) return null;

  const qty = b['amount'] ?? b['shares'] ?? 'unspecified';
  const orderType = typeof b['order_type'] === 'string' ? b['order_type'].toUpperCase() : 'MARKET';
  const limitPrice = b['limit_price'] ?? 'none';
  const stopPrice = b['stop_price'] ?? 'none';
  const timeInForce = typeof b['time_in_force'] === 'string' ? b['time_in_force'].toUpperCase() : 'NONE';

  return `trade:${symbol}:${direction}:${qty}:${orderType}:${limitPrice}:${stopPrice}:${timeInForce}`;
}

export function normalizeOperationMutation(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const currency = typeof b['currency'] === 'string' ? b['currency'].toUpperCase() : null;
  const from = typeof b['from'] === 'string' ? b['from'].toUpperCase() : null;
  const to = typeof b['to'] === 'string' ? b['to'].toUpperCase() : null;
  const amount = b['amount'];

  if (!currency || !from || !to || amount === undefined) return null;
  return `operation:${currency}:${from}:${to}:${amount}`;
}

export function getCanonicalMutationKey(req: { path: string; body?: unknown }): string | null {
  if (req.path === '/trades') {
    return normalizeTradeMutation(req.body);
  }
  if (req.path === '/operations/internal') {
    return normalizeOperationMutation(req.body);
  }
  return null;
}

export function getCanonicalApprovalKey(approval: ApprovalEvent): string | null {
  if (!approval || !approval.parameters) return null;
  const toolName = approval.toolName.toLowerCase();
  if (toolName.includes('trade')) {
    return normalizeTradeMutation(approval.parameters);
  }
  if (toolName.includes('operation')) {
    return normalizeOperationMutation(approval.parameters);
  }
  return null;
}
