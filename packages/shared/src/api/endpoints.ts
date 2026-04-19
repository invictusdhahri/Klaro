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
    submitOtp: (jobId: string) => `/api/scrape/otp/${jobId}`,
  },

  score: {
    current: '/api/score/current',
    history: '/api/score/history',
    calculate: '/api/score/calculate',
  },

  chat: {
    send: '/api/chat/send',
    stream: '/api/chat/stream',
    streamFile: '/api/chat/stream-file',
    history: '/api/chat/history',
    sessions: '/api/chat/sessions',
    session: (id: string) => `/api/chat/sessions/${id}`,
    sessionMessages: (id: string) => `/api/chat/sessions/${id}/messages`,
    memories: '/api/chat/memories',
    deleteMemory: (id: string) => `/api/chat/memories/${id}`,
  },

  documents: {
    list: '/api/documents',
    upload: '/api/documents/upload',
    delete: (id: string) => `/api/documents/${id}`,
    answer: (id: string) => `/api/documents/${id}/answer`,
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
