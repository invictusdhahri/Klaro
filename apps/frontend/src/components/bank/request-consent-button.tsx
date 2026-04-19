'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { API_ENDPOINTS } from '@klaro/shared';

interface RequestConsentButtonProps {
  clientId: string;
}

export function RequestConsentButton({ clientId }: RequestConsentButtonProps) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle');

  async function handleRequest() {
    setStatus('loading');
    try {
      await api.post(API_ENDPOINTS.bank.requestConsent(clientId));
      setStatus('sent');
    } catch {
      setStatus('error');
    }
  }

  if (status === 'sent') {
    return (
      <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400">
        Consent request sent. The user will be notified.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <Button
        variant="outline"
        size="sm"
        onClick={handleRequest}
        disabled={status === 'loading'}
      >
        {status === 'loading' ? 'Sending…' : 'Request expanded consent'}
      </Button>
      {status === 'error' && (
        <p className="text-xs text-destructive">Failed to send request. Please try again.</p>
      )}
    </div>
  );
}
