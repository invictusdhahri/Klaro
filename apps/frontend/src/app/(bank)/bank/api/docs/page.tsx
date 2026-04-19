'use client';

import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { env } from '@/lib/env';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const BASE = env.NEXT_PUBLIC_API_BASE_URL;

interface Endpoint {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  scope: string | null;
  summary: string;
  description: string;
  query?: Array<{ name: string; type: string; required?: boolean; description: string }>;
  responseExample: string;
}

const ENDPOINTS: Endpoint[] = [
  {
    method: 'GET',
    path: '/api/v1/bank/me',
    scope: null,
    summary: 'Verify the API key',
    description:
      'Returns the bank organisation the supplied API key is bound to, plus the active scopes. Use this to confirm a key is wired up correctly.',
    responseExample: `{
  "id": "8b1f…-…",
  "slug": "biat",
  "name": "BIAT",
  "logoUrl": null,
  "country": "TN",
  "scopes": ["read:clients", "read:scores", "read:transactions", "read:statements"]
}`,
  },
  {
    method: 'GET',
    path: '/api/v1/bank/clients',
    scope: 'read:clients',
    summary: 'List consented users',
    description:
      'Returns every Klaro user that has actively granted consent to your bank. Users that revoke consent immediately drop off.',
    query: [
      { name: 'page', type: 'integer', description: 'Page number (default 1)' },
      { name: 'limit', type: 'integer', description: '1–200, default 50' },
    ],
    responseExample: `{
  "data": [
    {
      "id": "f3c1…-…",
      "name": "Salma Ben Ahmed",
      "kycStatus": "verified",
      "score": 712,
      "scoreBand": "VERY_GOOD",
      "consentScope": ["score", "transactions"],
      "grantedAt": "2026-03-11T09:14:22Z"
    }
  ],
  "page": 1,
  "limit": 50,
  "total": 12
}`,
  },
  {
    method: 'GET',
    path: '/api/v1/bank/clients/{id}',
    scope: 'read:clients',
    summary: 'Get a single user',
    description:
      'Profile + consent metadata for a specific consented user. Returns 403 if the user has not granted consent to your bank.',
    responseExample: `{
  "id": "f3c1…-…",
  "profile": {
    "id": "f3c1…-…",
    "full_name": "Salma Ben Ahmed",
    "occupation_category": "salaried",
    "kyc_status": "verified"
  },
  "consentScope": ["score", "transactions"],
  "grantedAt": "2026-03-11T09:14:22Z"
}`,
  },
  {
    method: 'GET',
    path: '/api/v1/bank/clients/{id}/score',
    scope: 'read:scores',
    summary: 'Get latest credit score',
    description:
      'The most recent credit score row for this user, including breakdown and risk band.',
    responseExample: `{
  "score": 712,
  "scoreBand": "VERY_GOOD",
  "riskCategory": "low",
  "confidence": 0.83,
  "breakdown": { "kyc": 0.95, "income": 0.71, "behavior": 0.68 },
  "flags": [],
  "createdAt": "2026-04-02T10:01:09Z"
}`,
  },
  {
    method: 'GET',
    path: '/api/v1/bank/clients/{id}/transactions',
    scope: 'read:transactions',
    summary: 'List user transactions',
    description:
      'Returns transactions stamped with your bank id (i.e. ingested via your statement uploads / scraping connection).',
    query: [
      { name: 'from', type: 'date', description: 'YYYY-MM-DD inclusive' },
      { name: 'to', type: 'date', description: 'YYYY-MM-DD inclusive' },
      { name: 'limit', type: 'integer', description: '1–500, default 200' },
    ],
    responseExample: `{
  "data": [
    {
      "id": "tx_…",
      "date": "2026-04-15",
      "amount": 1480.00,
      "currency": "TND",
      "type": "credit",
      "category": "salary",
      "description": "VIREMENT SALAIRE"
    }
  ]
}`,
  },
  {
    method: 'GET',
    path: '/api/v1/bank/clients/{id}/statements',
    scope: 'read:statements',
    summary: 'List bank statement uploads',
    description: 'Statement files this user uploaded that were attributed to your bank.',
    responseExample: `{
  "data": [
    {
      "id": "st_…",
      "fileName": "biat_march_2026.pdf",
      "status": "processed",
      "riskScore": 0.12,
      "extractedCount": 184,
      "coherenceScore": 0.91,
      "createdAt": "2026-04-02T09:55:01Z"
    }
  ]
}`,
  },
];

function CodeBlock({ children, language }: { children: string; language?: string }) {
  return (
    <div className="group relative">
      <pre className="overflow-x-auto rounded-md border bg-muted/40 p-4 text-xs leading-relaxed">
        <code className={language ? `language-${language}` : undefined}>{children}</code>
      </pre>
      <button
        type="button"
        className="absolute right-2 top-2 rounded border bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
        onClick={async () => {
          await navigator.clipboard.writeText(children);
          toast.success('Copied');
        }}
      >
        Copy
      </button>
    </div>
  );
}

function MethodBadge({ method }: { method: 'GET' | 'POST' | 'DELETE' }) {
  const colors = {
    GET: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
    POST: 'bg-green-500/10 text-green-700 dark:text-green-400',
    DELETE: 'bg-red-500/10 text-red-700 dark:text-red-400',
  } as const;
  return (
    <span className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold ${colors[method]}`}>
      {method}
    </span>
  );
}

export default function ApiDocsPage() {
  const [tab, setTab] = useState<'curl' | 'node' | 'python'>('curl');

  const curlSnippet = `curl ${BASE}/api/v1/bank/clients \\
  -H "X-API-Key: klaro_live_xxxxxxxxxxxxxxxxxxxxxx"`;

  const nodeSnippet = `const res = await fetch("${BASE}/api/v1/bank/clients", {
  headers: { "X-API-Key": process.env.KLARO_API_KEY },
});
const { data } = await res.json();`;

  const pythonSnippet = `import os, requests

res = requests.get(
    "${BASE}/api/v1/bank/clients",
    headers={"X-API-Key": os.environ["KLARO_API_KEY"]},
)
res.raise_for_status()
data = res.json()["data"]`;

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Documentation</p>
        <h1 className="text-2xl font-semibold tracking-tight">Klaro Bank API</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Programmatic, bank-scoped access to Klaro data for your back-office systems. Manage your
          credentials on the{' '}
          <Link href="/bank/api" className="text-primary hover:underline">
            API keys
          </Link>{' '}
          page.
        </p>
      </div>

      {/* Quick reference card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">At a glance</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">Base URL</p>
            <p className="mt-1 font-mono text-xs">{BASE}/api/v1/bank</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">Authentication</p>
            <p className="mt-1 font-mono text-xs">X-API-Key: klaro_live_…</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">Rate limits</p>
            <p className="mt-1 text-xs">120 requests / minute / IP. Contact us for higher.</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">Data scope</p>
            <p className="mt-1 text-xs">
              Each key sees ONLY the bank it was issued for, and only users that have actively
              granted consent.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Authentication section */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Authentication</h2>
        <p className="text-sm text-muted-foreground">
          Every request must include the <code className="rounded bg-muted px-1">X-API-Key</code>{' '}
          header. Keys start with <code className="rounded bg-muted px-1">klaro_live_</code>, are
          shown to you exactly once at creation, and are tied to a single bank organisation —
          there&apos;s no way for one bank&apos;s key to read another bank&apos;s data.
        </p>

        <div className="flex gap-1 border-b text-sm">
          {(['curl', 'node', 'python'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 px-3 py-1.5 font-medium transition-colors ${
                tab === t
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t === 'node' ? 'Node.js' : t === 'python' ? 'Python' : 'cURL'}
            </button>
          ))}
        </div>

        <CodeBlock language={tab === 'python' ? 'python' : tab === 'node' ? 'javascript' : 'bash'}>
          {tab === 'curl' ? curlSnippet : tab === 'node' ? nodeSnippet : pythonSnippet}
        </CodeBlock>

        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="py-3 text-xs text-muted-foreground">
            <strong className="text-foreground">Security:</strong> Treat your API key like a
            password. Never embed it in client-side code, mobile apps, or commit it to source
            control. Rotate keys regularly via the{' '}
            <Link href="/bank/api" className="text-primary hover:underline">
              dashboard
            </Link>
            .
          </CardContent>
        </Card>
      </section>

      {/* Scopes */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Scopes</h2>
        <p className="text-sm text-muted-foreground">
          Each API key has one or more scopes that limit what it can read. Choose the minimum your
          integration needs.
        </p>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-3 font-medium">Scope</th>
                <th className="p-3 font-medium">Grants</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr>
                <td className="p-3 font-mono text-xs">read:clients</td>
                <td className="p-3">List & read consented users</td>
              </tr>
              <tr>
                <td className="p-3 font-mono text-xs">read:scores</td>
                <td className="p-3">Latest credit score, breakdown, flags</td>
              </tr>
              <tr>
                <td className="p-3 font-mono text-xs">read:transactions</td>
                <td className="p-3">Transactions stamped with your bank id</td>
              </tr>
              <tr>
                <td className="p-3 font-mono text-xs">read:statements</td>
                <td className="p-3">Bank statement uploads attributed to your bank</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Endpoints */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">Endpoints</h2>

        {ENDPOINTS.map((ep) => (
          <Card key={`${ep.method} ${ep.path}`} id={ep.path.replace(/[^a-z0-9]+/gi, '-')}>
            <CardHeader className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <MethodBadge method={ep.method} />
                <code className="font-mono text-sm font-medium">{ep.path}</code>
                {ep.scope && (
                  <span className="ml-auto rounded bg-muted px-2 py-0.5 font-mono text-[10px]">
                    requires {ep.scope}
                  </span>
                )}
              </div>
              <CardTitle className="text-base font-semibold">{ep.summary}</CardTitle>
              <p className="text-sm text-muted-foreground">{ep.description}</p>
            </CardHeader>

            <CardContent className="space-y-4">
              {ep.query && ep.query.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                    Query parameters
                  </p>
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-xs">
                      <tbody className="divide-y">
                        {ep.query.map((q) => (
                          <tr key={q.name}>
                            <td className="p-2 font-mono">{q.name}</td>
                            <td className="p-2 text-muted-foreground">{q.type}</td>
                            <td className="p-2 text-muted-foreground">{q.description}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div>
                <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                  Example response
                </p>
                <CodeBlock language="json">{ep.responseExample}</CodeBlock>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      {/* Errors */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Errors</h2>
        <p className="text-sm text-muted-foreground">
          The API uses standard HTTP status codes. Error responses include a JSON body with{' '}
          <code className="rounded bg-muted px-1">error</code> and{' '}
          <code className="rounded bg-muted px-1">message</code> fields.
        </p>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Code</th>
                <th className="p-3 font-medium">Meaning</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr>
                <td className="p-3">401</td>
                <td className="p-3 font-mono text-xs">unauthorized</td>
                <td className="p-3">Missing, malformed, or revoked API key.</td>
              </tr>
              <tr>
                <td className="p-3">403</td>
                <td className="p-3 font-mono text-xs">insufficient_scope</td>
                <td className="p-3">Key is valid but lacks the required scope.</td>
              </tr>
              <tr>
                <td className="p-3">403</td>
                <td className="p-3 font-mono text-xs">no_consent</td>
                <td className="p-3">User has not granted (or has revoked) consent to your bank.</td>
              </tr>
              <tr>
                <td className="p-3">404</td>
                <td className="p-3 font-mono text-xs">not_found</td>
                <td className="p-3">Resource does not exist (or you can&apos;t see it).</td>
              </tr>
              <tr>
                <td className="p-3">429</td>
                <td className="p-3 font-mono text-xs">—</td>
                <td className="p-3">Rate limit exceeded. Back off and retry.</td>
              </tr>
              <tr>
                <td className="p-3">500</td>
                <td className="p-3 font-mono text-xs">internal_error</td>
                <td className="p-3">Something broke on our side. Already logged.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-4 text-sm">
        <p className="text-muted-foreground">Ready to integrate?</p>
        <Button asChild>
          <Link href="/bank/api">Manage API keys →</Link>
        </Button>
      </div>
    </div>
  );
}
