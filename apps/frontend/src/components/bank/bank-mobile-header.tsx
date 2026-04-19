'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BankNav } from './bank-nav';

interface Props {
  bankName: string;
  bankInitial: string;
  logoUrl: string | null | undefined;
}

export function BankMobileHeader({ bankName, bankInitial, logoUrl }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobile top bar */}
      <header className="flex h-14 items-center justify-between border-b px-4 lg:hidden">
        <Link href="/bank" className="flex items-center gap-2">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={bankName} className="h-7 w-7 rounded object-contain" />
          ) : (
            <div className="flex h-7 w-7 items-center justify-center rounded bg-primary/10 text-xs font-bold text-primary">
              {bankInitial}
            </div>
          )}
          <span className="text-sm font-bold">{bankName}</span>
        </Link>

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label="Toggle menu"
          className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {open ? (
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          ) : (
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </header>

      {/* Mobile drawer */}
      {open && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          onClick={() => setOpen(false)}
        >
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" />
          <nav
            className="absolute left-0 top-0 h-full w-60 border-r bg-background shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-14 items-center gap-3 border-b px-6">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt={bankName} className="h-7 w-7 rounded object-contain" />
              ) : (
                <div className="flex h-7 w-7 items-center justify-center rounded bg-primary/10 text-xs font-bold text-primary">
                  {bankInitial}
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-bold leading-tight">{bankName}</p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Portal</p>
              </div>
            </div>
            <div onClick={() => setOpen(false)}>
              <BankNav />
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
