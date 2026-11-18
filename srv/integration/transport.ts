import type { OrderConfirmation, OrderPayload } from './contract.ts';

export class TransferError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, message: string, retryable: boolean) { super(message); this.code = code; this.retryable = retryable; }
}
export function httpFailure(status: number): TransferError {
  const retryable = status >= 500 || [408, 429].includes(status);
  const code = status === 409 ? 'ERP_CONFLICT' : [401,403].includes(status) ? 'ERP_AUTH' : retryable ? 'ERP_UNAVAILABLE' : 'ERP_REJECTED';
  return new TransferError(code, `ERP returned HTTP ${status}.`, retryable);
}
export interface OrderTransport {
  send(payload: OrderPayload, signal?: AbortSignal): Promise<OrderConfirmation>;
}
export class HttpOrderTransport implements OrderTransport {
  private readonly endpoint: URL;
  private readonly authorization: string;
  readonly timeoutMs: number;
  constructor(baseURL: string, user: string, password: string, timeoutMs = 2000) {
    this.timeoutMs = timeoutMs;
    this.endpoint = new URL('/erp/Orders', baseURL);
    if (!['http:', 'https:'].includes(this.endpoint.protocol) || this.endpoint.username || this.endpoint.password) throw new Error('Invalid configured ERP URL.');
    if (!user || !password || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid ERP transport configuration.');
    this.authorization = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
  }
  async send(payload: OrderPayload, signal?: AbortSignal): Promise<OrderConfirmation> {
    const deadline = AbortSignal.timeout(this.timeoutMs);
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST', redirect: 'error', signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: this.authorization },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw httpFailure(response.status);
      }
      const text = await response.text();
      if (text.length > 65536) throw new TransferError('INVALID_CONFIRMATION', 'ERP confirmation exceeds the response limit.', false);
      let confirmation: unknown;
      try { confirmation = JSON.parse(text); } catch { throw new TransferError('INVALID_CONFIRMATION', 'ERP did not return a JSON confirmation.', false); }
      if (!confirmation || typeof confirmation !== 'object') throw new TransferError('INVALID_CONFIRMATION', 'ERP returned an invalid confirmation.', false);
      return confirmation as OrderConfirmation;
    } catch (error) {
      if (error instanceof TransferError) throw error;
      throw new TransferError(deadline.aborted ? 'ERP_TIMEOUT' : 'ERP_CONNECTION', deadline.aborted ? 'ERP request exceeded its deadline.' : 'ERP connection was interrupted.', true);
    }
  }
}
