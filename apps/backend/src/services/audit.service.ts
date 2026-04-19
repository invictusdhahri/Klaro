/**
 * Audit logging service.
 *
 * Writes to the public.audit_logs table using the service-role client so it
 * can't be blocked by RLS. Failures are fire-and-forget — a logging error
 * should never break the caller's response.
 */

import type { Json } from '@klaro/shared';

import { supabaseAdmin } from './supabase';

export type ActorType = 'user' | 'bank' | 'system' | 'admin';

export interface AuditEvent {
  actor_type: ActorType;
  actor_id: string;
  action: string;
  resource_type?: string;
  resource_id?: string;            // must be a valid UUID if provided
  metadata?: Record<string, unknown>;
  ip_address?: string;
}

/**
 * Insert an audit log entry. Non-throwing — errors are swallowed and logged
 * to stderr so the caller is never affected.
 */
export async function audit(event: AuditEvent): Promise<void> {
  const row = {
    actor_type: event.actor_type,
    actor_id: event.actor_id,
    action: event.action,
    resource_type: event.resource_type,
    resource_id: event.resource_id,
    metadata: event.metadata as Json | undefined,
    ip_address: event.ip_address,
  };

  const { error } = await supabaseAdmin.from('audit_logs').insert(row);
  if (error) {
    console.error('[audit] insert failed:', error.message, '| event:', event.action);
  }
}
