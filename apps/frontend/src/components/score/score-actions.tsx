'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  TrendingUp,
  CalendarCheck,
  CreditCard,
  FileCheck,
  Activity,
  Trophy,
} from 'lucide-react';
import { cn } from '@klaro/ui/cn';
import type { ScoreAction, ScoreActionCategory } from '@klaro/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  actions: ScoreAction[];
  onHoverCategory?: (category: ScoreActionCategory | null) => void;
}

// ---------------------------------------------------------------------------
// Category meta
// ---------------------------------------------------------------------------

const CATEGORY_META: Record<
  ScoreActionCategory,
  { icon: React.ElementType; label: string; color: string; glow: string }
> = {
  income: {
    icon: TrendingUp,
    label: 'Income',
    color: 'text-emerald-400',
    glow: 'shadow-emerald-500/20',
  },
  payments: {
    icon: CalendarCheck,
    label: 'Payments',
    color: 'text-blue-400',
    glow: 'shadow-blue-500/20',
  },
  debt: {
    icon: CreditCard,
    label: 'Debt',
    color: 'text-amber-400',
    glow: 'shadow-amber-500/20',
  },
  documents: {
    icon: FileCheck,
    label: 'Documents',
    color: 'text-violet-400',
    glow: 'shadow-violet-500/20',
  },
  behavior: {
    icon: Activity,
    label: 'Behavior',
    color: 'text-rose-400',
    glow: 'shadow-rose-500/20',
  },
};

// ---------------------------------------------------------------------------
// Count-up hook
// ---------------------------------------------------------------------------

function useCountUp(target: number, duration = 700, shouldAnimate = true) {
  const [value, setValue] = useState(shouldAnimate ? 0 : target);
  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (!shouldAnimate) {
      setValue(target);
      return;
    }
    setValue(0);
    startTimeRef.current = null;

    const animate = (timestamp: number) => {
      if (startTimeRef.current === null) startTimeRef.current = timestamp;
      const elapsed = timestamp - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * target));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration, shouldAnimate]);

  return value;
}

// ---------------------------------------------------------------------------
// Individual action card
// ---------------------------------------------------------------------------

function ActionCard({
  action,
  index,
  onMouseEnter,
  onMouseLeave,
}: {
  action: ScoreAction;
  index: number;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const prefersReduced = useReducedMotion();
  const meta = CATEGORY_META[action.category] ?? CATEGORY_META.behavior;
  const Icon = meta.icon;

  const displayImpact = useCountUp(
    action.expectedImpactPoints,
    700,
    !prefersReduced,
  );

  return (
    <motion.div
      key={action.id}
      initial={prefersReduced ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.06, ease: 'easeOut' }}
      whileHover={prefersReduced ? undefined : { y: -4, scale: 1.015 }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        'group relative flex flex-col gap-3 overflow-hidden rounded-xl border border-border/60',
        'bg-card p-4 transition-shadow duration-300',
        'hover:shadow-xl',
        meta.glow,
      )}
    >
      {/* Confidence sliver at the top */}
      <div className="absolute inset-x-0 top-0 h-0.5 bg-muted/40">
        <div
          className={cn('h-full rounded-full transition-all', meta.color.replace('text-', 'bg-'))}
          style={{ width: `${Math.round(action.impactConfidence * 100)}%` }}
        />
      </div>

      {/* Header: icon + category label */}
      <div className="flex items-center gap-2">
        <div className={cn('rounded-md p-1.5 bg-muted/60 transition-colors group-hover:bg-muted', meta.color)}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <span className={cn('text-xs font-medium uppercase tracking-wider', meta.color)}>
          {meta.label}
        </span>
      </div>

      {/* Hero: impact number */}
      <div className="flex items-baseline gap-1">
        <span className="text-xs text-muted-foreground">expected</span>
        <span className={cn('text-3xl font-bold tabular-nums leading-none', meta.color)}>
          +{displayImpact}
        </span>
        <span className="text-base font-semibold text-muted-foreground">pts</span>
      </div>

      {/* Title */}
      <p className="text-sm font-semibold leading-snug">{action.title}</p>

      {/* Rationale */}
      <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
        {action.rationale}
      </p>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Celebration card (no remaining actions / top-tier score)
// ---------------------------------------------------------------------------

function CelebrationCard() {
  const prefersReduced = useReducedMotion();

  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.45, ease: 'easeOut' }}
      className="flex flex-col items-center gap-3 rounded-xl border border-border/60 bg-card p-6 text-center"
    >
      <div className="rounded-full bg-amber-500/10 p-3">
        <Trophy className="h-6 w-6 text-amber-400" />
      </div>
      <p className="text-sm font-semibold">You are in the top tier — keep it up</p>
      <p className="text-xs text-muted-foreground">
        Your Klaro score is excellent. Continue your current habits to maintain your standing.
      </p>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function ScoreActions({ actions, onHoverCategory }: Props) {
  return (
    <AnimatePresence mode="wait">
      {actions.length === 0 ? (
        <CelebrationCard />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {actions.map((action, i) => (
            <ActionCard
              key={action.id}
              action={action}
              index={i}
              onMouseEnter={() => onHoverCategory?.(action.category)}
              onMouseLeave={() => onHoverCategory?.(null)}
            />
          ))}
        </div>
      )}
    </AnimatePresence>
  );
}
