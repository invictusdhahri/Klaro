'use client';

import { useState } from 'react';
import {
  Terminal,
  TerminalKey,
  TerminalNumber,
  TerminalPrompt,
  TerminalString,
} from '@/components/marketing/terminal';

type Method = 'GET' | 'POST' | 'DELETE';

const ENDPOINTS: {
  method: Method;
  path: string;
  note: string;
  terminalTitle: string;
  content: React.ReactNode;
}[] = [
  {
    method: 'GET',
    path: '/v1/score/:user_id',
    note: 'Latest score, band, and signal breakdown for a single user.',
    terminalTitle: 'GET /v1/score/:user_id',
    content: (
      <>
        <TerminalPrompt>
          curl -sX GET https://api.klaro.tn/v1/score/klr_7421 \
        </TerminalPrompt>
        {'\n'}
        {'     '}-H {'"'}Authorization: Bearer $KLARO_BANK_KEY{'"'}
        {'\n\n'}
        {'{'}
        {'\n'}
        {'  '}<TerminalKey>&quot;user_id&quot;</TerminalKey>: <TerminalString>&quot;klr_7421&quot;</TerminalString>,{'\n'}
        {'  '}<TerminalKey>&quot;score&quot;</TerminalKey>: <TerminalNumber>712</TerminalNumber>,{'\n'}
        {'  '}<TerminalKey>&quot;band&quot;</TerminalKey>: <TerminalString>&quot;GOOD&quot;</TerminalString>,{'\n'}
        {'  '}<TerminalKey>&quot;signals&quot;</TerminalKey>: {'{'}
        {'\n'}
        {'    '}<TerminalKey>&quot;identity&quot;</TerminalKey>: <TerminalNumber>0.91</TerminalNumber>,{'\n'}
        {'    '}<TerminalKey>&quot;income&quot;</TerminalKey>: <TerminalNumber>0.74</TerminalNumber>,{'\n'}
        {'    '}<TerminalKey>&quot;habits&quot;</TerminalKey>: <TerminalNumber>0.68</TerminalNumber>,{'\n'}
        {'    '}<TerminalKey>&quot;stability&quot;</TerminalKey>: <TerminalNumber>0.72</TerminalNumber>
        {'\n'}
        {'  '}{'}'},
        {'\n'}
        {'  '}<TerminalKey>&quot;updated_at&quot;</TerminalKey>: <TerminalString>&quot;2026-04-19T04:12:00Z&quot;</TerminalString>
        {'\n'}
        {'}'}
      </>
    ),
  },
  {
    method: 'POST',
    path: '/v1/score/batch',
    note: 'Bulk score up to 1,000 users in a single request.',
    terminalTitle: 'POST /v1/score/batch',
    content: (
      <>
        <TerminalPrompt>
          curl -sX POST https://api.klaro.tn/v1/score/batch \
        </TerminalPrompt>
        {'\n'}
        {'     '}-H {'"'}Authorization: Bearer $KLARO_BANK_KEY{'"'} \{'\n'}
        {'     '}-H {'"'}Content-Type: application/json{'"'} \{'\n'}
        {'     '}-d {'\''}{'{'} <TerminalKey>&quot;user_ids&quot;</TerminalKey>: [<TerminalString>&quot;klr_7421&quot;</TerminalString>, <TerminalString>&quot;klr_7409&quot;</TerminalString>] {'}'}{'\''}
        {'\n\n'}
        {'{'}
        {'\n'}
        {'  '}<TerminalKey>&quot;results&quot;</TerminalKey>: [
        {'\n'}
        {'    '}{'{'}
        {'\n'}
        {'      '}<TerminalKey>&quot;user_id&quot;</TerminalKey>: <TerminalString>&quot;klr_7421&quot;</TerminalString>,{'\n'}
        {'      '}<TerminalKey>&quot;score&quot;</TerminalKey>: <TerminalNumber>712</TerminalNumber>,{'\n'}
        {'      '}<TerminalKey>&quot;band&quot;</TerminalKey>: <TerminalString>&quot;GOOD&quot;</TerminalString>,{'\n'}
        {'      '}<TerminalKey>&quot;habits&quot;</TerminalKey>: {'{'}
        {'\n'}
        {'        '}<TerminalKey>&quot;on_time_ratio&quot;</TerminalKey>: <TerminalNumber>0.94</TerminalNumber>,{'\n'}
        {'        '}<TerminalKey>&quot;cash_buffer_days&quot;</TerminalKey>: <TerminalNumber>23</TerminalNumber>,{'\n'}
        {'        '}<TerminalKey>&quot;debt_to_income&quot;</TerminalKey>: <TerminalNumber>0.31</TerminalNumber>
        {'\n'}
        {'      '}{'}'}
        {'\n'}
        {'    '}{'}'},
        {'\n'}
        {'    '}{'{'} <TerminalKey>&quot;user_id&quot;</TerminalKey>: <TerminalString>&quot;klr_7409&quot;</TerminalString>, <TerminalKey>&quot;score&quot;</TerminalKey>: <TerminalNumber>488</TerminalNumber>, <TerminalKey>&quot;band&quot;</TerminalKey>: <TerminalString>&quot;FAIR&quot;</TerminalString> {'}'}
        {'\n'}
        {'  '}]
        {'\n'}
        {'}'}
      </>
    ),
  },
  {
    method: 'GET',
    path: '/v1/users/:user_id/habits',
    note: 'Cash-flow habits, on-time ratio, income variance, debt-to-income.',
    terminalTitle: 'GET /v1/users/:user_id/habits',
    content: (
      <>
        <TerminalPrompt>
          curl -sX GET https://api.klaro.tn/v1/users/klr_7421/habits \
        </TerminalPrompt>
        {'\n'}
        {'     '}-H {'"'}Authorization: Bearer $KLARO_BANK_KEY{'"'}
        {'\n\n'}
        {'{'}
        {'\n'}
        {'  '}<TerminalKey>&quot;user_id&quot;</TerminalKey>: <TerminalString>&quot;klr_7421&quot;</TerminalString>,{'\n'}
        {'  '}<TerminalKey>&quot;on_time_ratio&quot;</TerminalKey>: <TerminalNumber>0.94</TerminalNumber>,{'\n'}
        {'  '}<TerminalKey>&quot;cash_buffer_days&quot;</TerminalKey>: <TerminalNumber>23</TerminalNumber>,{'\n'}
        {'  '}<TerminalKey>&quot;debt_to_income&quot;</TerminalKey>: <TerminalNumber>0.31</TerminalNumber>,{'\n'}
        {'  '}<TerminalKey>&quot;income_variance&quot;</TerminalKey>: <TerminalNumber>0.08</TerminalNumber>,{'\n'}
        {'  '}<TerminalKey>&quot;avg_monthly_income&quot;</TerminalKey>: <TerminalNumber>2840</TerminalNumber>,{'\n'}
        {'  '}<TerminalKey>&quot;period&quot;</TerminalKey>: <TerminalString>&quot;6mo&quot;</TerminalString>
        {'\n'}
        {'}'}
      </>
    ),
  },
  {
    method: 'POST',
    path: '/v1/webhooks',
    note: 'Register an HMAC-signed endpoint for score & KYC events.',
    terminalTitle: 'POST /v1/webhooks',
    content: (
      <>
        <TerminalPrompt>
          curl -sX POST https://api.klaro.tn/v1/webhooks \
        </TerminalPrompt>
        {'\n'}
        {'     '}-H {'"'}Authorization: Bearer $KLARO_BANK_KEY{'"'} \{'\n'}
        {'     '}-H {'"'}Content-Type: application/json{'"'} \{'\n'}
        {'     '}-d {'\''}{'{'} <TerminalKey>&quot;url&quot;</TerminalKey>: <TerminalString>&quot;https://bank.tn/hooks/klaro&quot;</TerminalString>,{' '}
        <TerminalKey>&quot;events&quot;</TerminalKey>: [<TerminalString>&quot;score.changed&quot;</TerminalString>] {'}'}{'\''}
        {'\n\n'}
        {'{'}
        {'\n'}
        {'  '}<TerminalKey>&quot;id&quot;</TerminalKey>: <TerminalString>&quot;wh_9f3a1c&quot;</TerminalString>,{'\n'}
        {'  '}<TerminalKey>&quot;url&quot;</TerminalKey>: <TerminalString>&quot;https://bank.tn/hooks/klaro&quot;</TerminalString>,{'\n'}
        {'  '}<TerminalKey>&quot;events&quot;</TerminalKey>: [<TerminalString>&quot;score.changed&quot;</TerminalString>, <TerminalString>&quot;kyc.completed&quot;</TerminalString>],{'\n'}
        {'  '}<TerminalKey>&quot;secret&quot;</TerminalKey>: <TerminalString>&quot;whsec_••••••••&quot;</TerminalString>,{'\n'}
        {'  '}<TerminalKey>&quot;created_at&quot;</TerminalKey>: <TerminalString>&quot;2026-04-19T04:15:00Z&quot;</TerminalString>
        {'\n'}
        {'}'}
      </>
    ),
  },
  {
    method: 'GET',
    path: '/v1/usage',
    note: 'Per-key request counts, rate-limit headroom, and audit log.',
    terminalTitle: 'GET /v1/usage',
    content: (
      <>
        <TerminalPrompt>
          curl -sX GET https://api.klaro.tn/v1/usage \
        </TerminalPrompt>
        {'\n'}
        {'     '}-H {'"'}Authorization: Bearer $KLARO_BANK_KEY{'"'}
        {'\n\n'}
        {'{'}
        {'\n'}
        {'  '}<TerminalKey>&quot;key&quot;</TerminalKey>: <TerminalString>&quot;key_production&quot;</TerminalString>,{'\n'}
        {'  '}<TerminalKey>&quot;period&quot;</TerminalKey>: <TerminalString>&quot;2026-04&quot;</TerminalString>,{'\n'}
        {'  '}<TerminalKey>&quot;requests&quot;</TerminalKey>: <TerminalNumber>128400</TerminalNumber>,{'\n'}
        {'  '}<TerminalKey>&quot;limit&quot;</TerminalKey>: <TerminalNumber>500000</TerminalNumber>,{'\n'}
        {'  '}<TerminalKey>&quot;rate_limit_rps&quot;</TerminalKey>: <TerminalNumber>60</TerminalNumber>,{'\n'}
        {'  '}<TerminalKey>&quot;last_request_at&quot;</TerminalKey>: <TerminalString>&quot;2026-04-19T04:11:58Z&quot;</TerminalString>
        {'\n'}
        {'}'}
      </>
    ),
  },
];

export function ApiBlock() {
  const [active, setActive] = useState(0);
  const endpoint = ENDPOINTS[active];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr] lg:items-stretch">
      <div className="space-y-3">
        {ENDPOINTS.map((ep, i) => (
          <button
            key={ep.path}
            onClick={() => setActive(i)}
            className={`w-full text-left hairline rounded-xl p-4 transition-colors duration-150 ${
              active === i
                ? 'bg-white/[0.05] border-white/20'
                : 'marketing-card-hover'
            }`}
          >
            <div className="flex items-center gap-3">
              <span
                className={`mono text-[10.5px] tracking-[0.16em] uppercase px-2 py-0.5 rounded ${
                  ep.method === 'POST'
                    ? 'bg-emerald-500/10 text-emerald-300'
                    : 'bg-sky-500/10 text-sky-300'
                }`}
              >
                {ep.method}
              </span>
              <span className={`mono text-[13px] ${active === i ? 'text-white' : 'text-white/75'}`}>
                {ep.path}
              </span>
            </div>
            <p className="mt-2 text-[13px] text-white/55 leading-relaxed">{ep.note}</p>
          </button>
        ))}
      </div>

      <div key={active} className="animate-fade-in">
        {endpoint && (
          <Terminal title={endpoint.terminalTitle}>
            {endpoint.content}
          </Terminal>
        )}
      </div>
    </div>
  );
}
