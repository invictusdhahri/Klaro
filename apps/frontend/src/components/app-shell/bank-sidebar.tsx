'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  BookOpen,
  KeyRound,
  LayoutDashboard,
  Settings,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@klaro/ui/cn';

type Item = {
  href: string;
  icon: LucideIcon;
  label: string;
  /** When true, only an exact pathname match is active (e.g. /bank vs /bank/clients). */
  exact?: boolean;
};

const items: Item[] = [
  { href: '/bank', icon: LayoutDashboard, label: 'Dashboard', exact: true },
  { href: '/bank/clients', icon: Users, label: 'Clients' },
  { href: '/bank/api', icon: KeyRound, label: 'API keys', exact: true },
  { href: '/bank/api/docs', icon: BookOpen, label: 'API docs' },
  { href: '/bank/settings', icon: Settings, label: 'Settings' },
];

function navActive(pathname: string, item: Item) {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + '/');
}

export function BankSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:flex lg:flex-col w-60 shrink-0 fixed inset-y-0 left-0 z-40 hairline-r bg-[hsl(var(--marketing-bg))]/85 backdrop-blur-md">
      <div className="flex h-14 items-center px-5 hairline-b">
        <Link
          href="/bank"
          className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight text-white"
        >
          <span
            aria-hidden
            className="grid h-6 w-6 place-items-center rounded-md hairline bg-white/[0.04]"
          >
            <svg
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinecap="square"
            >
              <path d="M3 13V3" />
              <path d="M3 8 L13 3" />
              <path d="M3 8 L13 13" />
            </svg>
          </span>
          <span>Klaro</span>
          <span className="mono text-[10px] tracking-[0.18em] text-white/35">/ BANK</span>
        </Link>
      </div>

      <nav className="flex-1 p-2 space-y-0.5">
        {items.map((item) => {
          const active = navActive(pathname, item);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'relative flex items-center gap-3 rounded-md px-3 py-2 text-[13px] font-medium transition-colors',
                active
                  ? 'text-white'
                  : 'text-white/55 hover:text-white hover:bg-white/[0.03]',
              )}
            >
              {active && (
                <motion.span
                  layoutId="bank-sidebar-active"
                  className="absolute inset-0 rounded-md bg-white/[0.06] hairline"
                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                  aria-hidden
                />
              )}
              <Icon className="relative h-4 w-4 shrink-0" strokeWidth={1.6} />
              <span className="relative">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 hairline-t">
        <div className="flex items-center gap-2 mb-2">
          <span className="status-dot" />
          <span className="mono text-[10px] tracking-[0.18em] text-white/55">
            PARTNER · LIVE
          </span>
        </div>
        <p className="mono text-[9px] tracking-[0.18em] text-white/25">
          © {new Date().getFullYear()} KLARO PROTOCOL
        </p>
      </div>
    </aside>
  );
}
