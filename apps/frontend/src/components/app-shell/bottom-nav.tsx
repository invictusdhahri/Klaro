'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  IdCard,
  Landmark,
  FileText,
  Sparkles,
} from 'lucide-react';
import { cn } from '@klaro/ui/cn';

const items = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Home' },
  { href: '/kyc', icon: IdCard, label: 'ID' },
  { href: '/connect-bank', icon: Landmark, label: 'Bank' },
  { href: '/documents', icon: FileText, label: 'Docs' },
  { href: '/chat', icon: Sparkles, label: 'Advisor' },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-50 pb-safe">
      <div className="hairline-t bg-[hsl(var(--marketing-bg))]/92 backdrop-blur-md px-2 pt-2 pb-1">
        <div className="flex items-center justify-around">
          {items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'relative flex flex-col items-center gap-1 px-3 py-1.5 rounded-md transition-colors min-w-[56px]',
                  active ? 'text-white' : 'text-white/45 hover:text-white/80',
                )}
              >
                {active && (
                  <motion.span
                    layoutId="bottomnav-active"
                    className="absolute inset-0 rounded-md bg-white/[0.06] hairline"
                    transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                    aria-hidden
                  />
                )}
                <Icon className="relative h-[18px] w-[18px]" strokeWidth={1.6} />
                <span className="relative mono text-[9px] tracking-[0.14em] uppercase">
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
