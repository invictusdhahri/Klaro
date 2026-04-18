'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, FileCheck2, Building2, Receipt, MessageCircle, FolderOpen } from 'lucide-react';
import { cn } from '@klaro/ui/cn';

const items = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/kyc', label: 'KYC', icon: FileCheck2 },
  { href: '/connect-bank', label: 'Bank', icon: Building2 },
  { href: '/transactions', label: 'Transactions', icon: Receipt },
  { href: '/documents', label: 'Documents', icon: FolderOpen },
  { href: '/chat', label: 'Advisor', icon: MessageCircle },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden w-60 shrink-0 border-r lg:block">
      <div className="flex h-16 items-center border-b px-6">
        <Link href="/dashboard" className="text-lg font-bold tracking-tight">
          Klaro
        </Link>
      </div>
      <nav className="space-y-1 p-3">
        {items.map((it) => {
          const active = pathname === it.href || pathname.startsWith(it.href + '/');
          const Icon = it.icon;
          return (
            <Link
              key={it.href}
              href={it.href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              {it.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
