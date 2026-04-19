export const API_ENDPOINTS = {
  health: '/health',

  auth: {
    me: '/api/auth/me',
    logout: '/api/auth/logout',
  },

  kyc: {
    upload: '/api/kyc/upload',
    verify: '/api/kyc/verify',
    status: '/api/kyc/status',
  },

  scrape: {
    start: '/api/scrape/start',
    status: (jobId: string) => `/api/scrape/status/${jobId}`,
    cancel: (jobId: string) => `/api/scrape/cancel/${jobId}`,
  },

  score: {
    current: '/api/score/current',
    history: '/api/score/history',
    calculate: '/api/score/calculate',
  },

  chat: {
    send: '/api/chat/send',
    stream: '/api/chat/stream',
    history: '/api/chat/history',
  },

  documents: {
    list: '/api/documents',
    upload: '/api/documents/upload',
    delete: (id: string) => `/api/documents/${id}`,
  },

  bank: {
    clients: '/api/bank/clients',
    client: (id: string) => `/api/bank/clients/${id}`,
    clientScore: (id: string) => `/api/bank/clients/${id}/score`,
    requestConsent: (id: string) => `/api/bank/clients/${id}/request-consent`,
    consent: '/api/bank/consent',
  },

  transactions: {
    list: '/api/transactions',
  },
} as const;
