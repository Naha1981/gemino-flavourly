import { processInboundAIResponse } from './responder';

export interface ConciergeTurnOptions {
  tenantId: string;
  waAccountId: string;
  phone: string;
  senderName: string;
  text: string;
  conversationId: string;
  contactId: string;
}

/**
 * Main AI Concierge turn runner.
 * Processes inbound customer inquiries, loyalty requests, table reservations, and waitlist joins.
 */
export async function runConciergeTurn(options: ConciergeTurnOptions): Promise<string | null> {
  return await processInboundAIResponse(options);
}

export { processInboundAIResponse };
