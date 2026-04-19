'use client';

import Link from 'next/link';
import { motion, type Variants } from 'framer-motion';
import { InteractiveDashboard } from './interactive-dashboard';
import { InteractiveDots } from './interactive-dots';

const PARTNER_EMAIL = 'mailto:partners@klaro.tn?subject=Klaro%20Partner%20API%20access';

const EASE_OUT_QUART = [0.22, 1, 0.36, 1] as const;

const heroContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

const heroItem: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE_OUT_QUART } },
};

export function PartnerHero() {
  return (
    <section className="relative">
      <InteractiveDots className="z-0" accentColor="255,180,69" />
      <div className="relative z-10 mx-auto max-w-[1480px] pl-4 pr-4 sm:pl-8 sm:pr-6 lg:pl-12 lg:pr-6 pt-20 pb-24 sm:pt-28 sm:pb-28">
        <motion.div
          variants={heroContainer}
          initial="hidden"
          animate="show"
          className="grid gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:items-center"
        >
          <div className="space-y-8">
            <motion.div
              variants={heroItem}
              className="inline-flex items-center gap-2 hairline rounded-full px-3 py-1.5 bg-white/[0.03]"
            >
              <span className="status-dot" />
              <span className="mono text-[10.5px] tracking-[0.18em] uppercase text-white/65">
                For banks · lenders · fintech
              </span>
            </motion.div>

            <motion.h1
              variants={heroItem}
              className="text-[48px] leading-[0.98] sm:text-[64px] lg:text-[80px] xl:text-[92px] font-semibold tracking-[-0.025em] text-white"
            >
              Find your customer&apos;s
              <br />
              
              <span className="mono italic accent-text font-normal">needs</span>
            </motion.h1>

            <motion.p
              variants={heroItem}
              className="text-[16px] sm:text-[17px] text-white/55 max-w-lg leading-relaxed"
            >
              Score the 60% of Tunisians the bureau can&apos;t see. Klaro turns KYC,
              bank activity, and behavior into a programmable risk signal — with a
              partner console for your credit team.
            </motion.p>

            <motion.div variants={heroItem} className="flex flex-wrap items-center gap-3">
              <motion.a
                href={PARTNER_EMAIL}
                whileHover={{ y: -2 }}
                whileTap={{ y: 0 }}
                className="btn-mark-primary inline-flex items-center gap-2 px-5 py-3 text-[14px] font-medium"
              >
                Request API access
                <span aria-hidden>→</span>
              </motion.a>
              <motion.div whileHover={{ y: -2 }} whileTap={{ y: 0 }}>
                <Link
                  href="/#api"
                  className="btn-mark-ghost inline-flex items-center gap-2 px-5 py-3 text-[14px] font-medium"
                >
                  View API reference
                </Link>
              </motion.div>
            </motion.div>

            <motion.div
              variants={heroItem}
              className="flex flex-wrap items-center gap-x-5 gap-y-2 mono text-[11px] tracking-[0.12em] uppercase text-white/40 pt-4"
            >
              <span>REST · Webhooks · SDK</span>
              <span className="text-white/15">·</span>
              <span>SLA-backed</span>
              <span className="text-white/15">·</span>
              <span>Audit-logged</span>
            </motion.div>
          </div>

          <motion.div variants={heroItem} className="relative">
            <div
              aria-hidden
              className="absolute -inset-6 bg-gradient-to-br from-white/[0.03] via-[hsl(var(--marketing-accent)/0.04)] to-transparent rounded-3xl blur-2xl"
            />
            <InteractiveDashboard className="relative" />
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
