'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@klaro/ui/cn';

const items = [
  { href: '/dashboard',    emoji: '🏠', label: 'Home' },
  { href: '/kyc',          emoji: '🪪', label: 'KYC' },
  { href: '/connect-bank', emoji: '🏦', label: 'Bank' },
  { href: '/documents',    emoji: '📄', label: 'Docs' },
  { href: '/chat',         emoji: '🤖', label: 'Advisor' },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-50 pb-safe">
      <div className="glass-strong border-t border-white/10 px-2 pt-2 pb-1">
        <div className="flex items-center justify-around">
          {items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-all min-w-[52px]',
                  active
                    ? 'bg-indigo-500/20'
                    : 'opacity-50 hover:opacity-80',
                )}
              >
                <span className={cn('text-2xl leading-none transition-transform', active && 'scale-110')}>
                  {item.emoji}
                </span>
                <span
                  className={cn(
                    'text-[10px] font-medium tracking-wide',
                    active ? 'text-indigo-300' : 'text-white/60',
                  )}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
