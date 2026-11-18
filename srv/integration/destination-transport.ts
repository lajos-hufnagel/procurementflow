import { alwaysProvider, getDestination, isHttpDestination, type Destination } from '@sap-cloud-sdk/connectivity';
import { executeHttpRequest } from '@sap-cloud-sdk/http-client';
import type { OrderConfirmation, OrderPayload } from './contract.ts';
import { httpFailure, TransferError, type OrderTransport } from './transport.ts';

type DestinationResolver = (name: string) => Promise<Destination | null>;
const resolveDestination: DestinationResolver = name => getDestination({ destinationName: name, selectionStrategy: alwaysProvider });

/** Stop waiting for lookup on cancellation; consume late results without ever starting a late POST. */
function untilAborted<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancelled = () => { signal.removeEventListener('abort', cancelled); reject(signal.reason); };
    signal.addEventListener('abort', cancelled, { once: true });
    pending.then(value => { signal.removeEventListener('abort', cancelled); resolve(value); },
      error => { signal.removeEventListener('abort', cancelled); reject(error); });
    if (signal.aborted) cancelled();
  });
}

/** Single-tenant technical Destination access. Caller JWTs and credentials never enter the outbox. */
export class DestinationOrderTransport implements OrderTransport {
  private readonly name: string;
  private readonly timeoutMs: number;
  private readonly resolver: DestinationResolver;
  constructor(name: string, timeoutMs = 10000, resolver: DestinationResolver = resolveDestination) {
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(name)) throw new Error('Invalid ERP_DESTINATION.');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('Invalid ERP destination timeout.');
    this.name = name; this.timeoutMs = timeoutMs; this.resolver = resolver;
  }
  async send(payload: OrderPayload, callerSignal?: AbortSignal): Promise<OrderConfirmation> {
    const started = performance.now();
    const deadline = AbortSignal.timeout(this.timeoutMs);
    const signal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline;
    try {
      signal.throwIfAborted();
      let destination: Destination | null;
      try { destination = await untilAborted(this.resolver(this.name), signal); }
      catch (error) {
        if (signal.aborted) throw error;
        throw new TransferError('ERP_DESTINATION_UNAVAILABLE', 'The configured ERP destination could not be resolved.', true);
      }
      signal.throwIfAborted();
      if (!destination) throw new TransferError('ERP_DESTINATION_MISSING', 'The configured ERP destination was not found.', false);
      if (!isHttpDestination(destination)) throw new TransferError('ERP_DESTINATION_INVALID', 'The configured destination is not an HTTP destination.', false);
      let url: URL;
      try { url = new URL(destination.url); }
      catch { throw new TransferError('ERP_DESTINATION_INVALID', 'The configured ERP destination URL is invalid.', false); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new TransferError('ERP_DESTINATION_INVALID', 'The configured ERP destination URL is invalid.', false);
      }
      const remaining = Math.max(1, Math.ceil(this.timeoutMs - (performance.now() - started)));
      const response = await executeHttpRequest(destination, {
        method: 'POST', url: '/erp/Orders', data: payload, responseType: 'text',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        signal, timeout: remaining, maxRedirects: 0, maxContentLength: 65536, maxBodyLength: 65536,
        middleware: []
      }, { fetchCsrfToken: false });
      signal.throwIfAborted();
      if (response.status < 200 || response.status >= 300) throw httpFailure(response.status);
      let confirmation: unknown;
      try { confirmation = JSON.parse(response.data as string); }
      catch { throw new TransferError('INVALID_CONFIRMATION', 'ERP did not return a JSON confirmation.', false); }
      if (!confirmation || typeof confirmation !== 'object' || Array.isArray(confirmation)) {
        throw new TransferError('INVALID_CONFIRMATION', 'ERP returned an invalid confirmation.', false);
      }
      return confirmation as OrderConfirmation;
    } catch (error) {
      if (error instanceof TransferError) throw error;
      const details = error as { response?: { status?: number }; code?: string } | undefined;
      if (typeof details?.response?.status === 'number') throw httpFailure(details.response.status);
      const timedOut = deadline.aborted || ['ETIMEDOUT', 'ECONNABORTED'].includes(details?.code ?? '');
      throw new TransferError(timedOut ? 'ERP_TIMEOUT' : 'ERP_CONNECTION',
        timedOut ? 'ERP destination operation exceeded its deadline.' : 'ERP connection was interrupted.', true);
    }
  }
}
