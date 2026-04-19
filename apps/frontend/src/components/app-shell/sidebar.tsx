'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@klaro/ui/cn';

const items = [
  { href: '/dashboard',    emoji: '🏠', label: 'Dashboard' },
  { href: '/kyc',          emoji: '🪪', label: 'KYC' },
  { href: '/connect-bank', emoji: '🏦', label: 'Bank' },
  { href: '/transactions', emoji: '💳', label: 'Transactions' },
  { href: '/documents',    emoji: '📄', label: 'Documents' },
  { href: '/chat',         emoji: '🤖', label: 'Advisor' },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden lg:flex lg:flex-col w-64 shrink-0 fixed inset-y-0 left-0 z-40 min-h-0 isolate">
      <div className="glass-strong h-full min-h-0 border-r border-white/10 flex flex-col overflow-hidden">
        {/* Logo */}
        <div className="flex h-16 items-center px-6 border-b border-white/10">
          <Link href="/dashboard" className="text-xl font-black tracking-tighter text-white hover:text-indigo-300 transition-colors">
            Klaro
          </Link>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1">
          {items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all',
                  active
                    ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/20'
                    : 'text-white/50 hover:bg-white/5 hover:text-white',
                )}
              >
                <span className="text-lg leading-none">{item.emoji}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Bottom brand */}
        <div className="p-4 border-t border-white/10">
          <p className="text-[10px] text-white/20 text-center tracking-widest uppercase">
            © {new Date().getFullYear()} Klaro
          </p>
        </div>
      </div>
    </aside>
  );
}
