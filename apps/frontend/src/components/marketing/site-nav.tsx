'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@klaro/ui';

const navLinks = [
  { href: '/', label: 'Product' },
  { href: '/partners', label: 'For Banks' },
  { href: '/#how', label: 'How it works' },
  { href: '/partners#api', label: 'API' },
] as const;

const EASE = [0.32, 0.72, 0, 1] as const;

export function SiteNav() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 52);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className="sticky top-0 z-50 pointer-events-none">
      <motion.div
        layout
        transition={{ duration: 0.55, ease: EASE }}
        className={cn(
          'pointer-events-auto mx-auto flex items-center justify-between',
          scrolled
            ? 'mt-3 h-11 rounded-full px-4 backdrop-blur-2xl'
            : 'h-14 pl-4 pr-4 sm:pl-8 sm:pr-6 lg:pl-12 lg:pr-6',
        )}
        style={
          scrolled
            ? {
                maxWidth: '780px',
                background: 'rgba(8, 8, 8, 0.82)',
                border: '1px solid rgba(255,255,255,0.09)',
                boxShadow: '0 8px 40px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06)',
              }
            : {
                maxWidth: '1480px',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
              }
        }
      >
        <Link
          href="/"
          className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight text-white"
        >
          <KlaroMark scrolled={scrolled} />
          <motion.span layout="position" className="whitespace-nowrap">
            Klaro
          </motion.span>
          <AnimatePresence>
            {!scrolled && (
              <motion.span
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.3, ease: EASE }}
                className="mono text-[10px] tracking-[0.18em] text-white/35 hidden sm:inline overflow-hidden"
              >
                / TN
              </motion.span>
            )}
          </AnimatePresence>
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {navLinks.map((link) => {
            const active =
              link.href === pathname ||
              (link.href === '/partners' && pathname === '/partners');
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'px-3 py-1.5 text-[13px] text-white/55 hover:text-white transition-colors',
                  active && 'text-white',
                  scrolled && 'text-[12px]',
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <AnimatePresence>
            {!scrolled && (
              <motion.div
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.3, ease: EASE }}
                className="overflow-hidden"
              >
                <Link
                  href="/login"
                  className="hidden sm:inline-flex items-center px-3 py-1.5 text-[13px] text-white/65 hover:text-white transition-colors whitespace-nowrap"
                >
                  Sign in
                </Link>
              </motion.div>
            )}
          </AnimatePresence>
          <Link
            href="/register"
            className={cn(
              'btn-mark-primary inline-flex items-center font-medium transition-all duration-300',
              scrolled ? 'px-3 py-1 text-[12px]' : 'px-3.5 py-1.5 text-[13px]',
            )}
          >
            Get started
          </Link>
        </div>
      </motion.div>
    </header>
  );
}

function KlaroMark({ scrolled }: { scrolled: boolean }) {
  return (
    <motion.span
      layout
      aria-hidden
      transition={{ duration: 0.55, ease: EASE }}
      className={cn(
        'grid place-items-center hairline bg-white/[0.04] flex-shrink-0 transition-all duration-500',
        scrolled ? 'h-5 w-5 rounded' : 'h-6 w-6 rounded-md',
      )}
    >
      <svg
        viewBox="0 0 16 16"
        className={cn('transition-all duration-500', scrolled ? 'h-3 w-3' : 'h-3.5 w-3.5')}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="square"
      >
        <path d="M3 13V3" />
        <path d="M3 8 L13 3" />
        <path d="M3 8 L13 13" />
      </svg>
    </motion.span>
  );
}
