import Link from 'next/link';
import { ConsumerHero } from '@/components/marketing/consumer-hero';
import { Section } from '@/components/marketing/section';
import { AdvisorPhone } from '@/components/marketing/advisor-phone';
import { FadeIn } from '@/components/motion/fade-in';
import { Stagger, StaggerItem } from '@/components/motion/stagger';
import { CountUp } from '@/components/motion/count-up';

export default function HomePage() {
  return (
    <>
      <ConsumerHero />
      <StatsBar />
      <HowItWorks />
      <AdvisorSection />
      <SignalsBreakdown />
      <UseCases />
      <ReassuranceStrip />
      <ConsumerCTA />
    </>
  );
}

function StatsBar() {
  const stats = [
    { kind: 'static' as const, value: '3 min', label: 'To your first score' },
    { kind: 'static' as const, value: 'Free', label: 'Cost to start' },
    { kind: 'count' as const, to: 1000, label: 'Score scale' },
    { kind: 'static' as const, value: 'Yours', label: 'Who owns the data' },
  ];
  return (
    <div className="hairline-t hairline-b">
      <div className="mx-auto max-w-6xl px-6">
        <Stagger
          stagger={0.06}
          className="grid grid-cols-2 gap-px bg-white/[0.06] sm:grid-cols-4"
        >
          {stats.map((s) => (
            <StaggerItem key={s.label}>
              <div className="bg-[hsl(var(--marketing-bg))] py-7 px-4 h-full">
                <div className="mono text-2xl sm:text-3xl font-semibold tracking-tight text-white tabular-nums">
                  {s.kind === 'count' ? (
                    <CountUp to={s.to} suffix={s.suffix} />
                  ) : (
                    s.value
                  )}
                </div>
                <div className="mt-1 mono text-[10px] tracking-[0.18em] uppercase text-white/40">
                  {s.label}
                </div>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: '01',
      title: 'Prove who you are',
      body: 'Snap your CIN and do a quick selfie check. We confirm it’s really you in under a minute, with no third-party KYC vendor in the loop.',
      tag: '60 seconds',
    },
    {
      n: '02',
      title: 'Connect your bank',
      body: 'Link your account or upload your last 3 statements. Klaro reads your salary, your spending, your savings — and translates them into signals you can see.',
      tag: 'Read-only access',
    },
    {
      n: '03',
      title: 'See your real score',
      body: 'A clear 0–1000 score with the exact reasons behind it. Then ask the AI advisor what to fix this month to push it higher.',
      tag: 'Yours forever',
    },
  ];

  return (
    <Section
      index="01"
      eyebrow="How it works"
      title="From phone to score in five minutes."
      description="No bureaus. No paperwork. Just the financial story you already live every day, finally counted."
      className="hairline-b"
    >
      <Stagger
        id="how"
        stagger={0.08}
        className="grid gap-px bg-white/[0.06] hairline"
      >
        {steps.map((s) => (
          <StaggerItem key={s.n}>
            <article className="bg-[hsl(var(--marketing-bg))] p-7 marketing-card-hover sm:grid sm:grid-cols-[auto_1fr_auto] sm:items-start sm:gap-8">
              <div className="mono text-[11px] tracking-[0.2em] text-white/40 sm:pt-1">
                {s.n}
              </div>
              <div className="mt-2 sm:mt-0">
                <h3 className="text-xl font-medium text-white">{s.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-white/55 max-w-xl">
                  {s.body}
                </p>
              </div>
              <div className="mt-3 sm:mt-1 mono text-[10px] tracking-[0.16em] uppercase text-white/40 hairline rounded-full px-2.5 py-1 inline-flex">
                {s.tag}
              </div>
            </article>
          </StaggerItem>
        ))}
      </Stagger>
    </Section>
  );
}

function SignalsBreakdown() {
  const layers = [
    {
      label: 'Who you are',
      weight: '15%',
      desc: 'A verified identity — not just a name on paper. Real ID + real selfie + liveness check.',
    },
    {
      label: 'How you earn',
      weight: '30%',
      desc: 'How regular your income is. How many sources. How steady it’s been over the last 6 months.',
    },
    {
      label: 'How you handle money',
      weight: '35%',
      desc: 'Bills paid on time. Recurring obligations honored. Spending that lines up with what you make.',
    },
    {
      label: 'How stable you are',
      weight: '20%',
      desc: 'A buffer at month-end. A bank you’ve been with for a while. A life that isn’t lurching every few weeks.',
    },
  ];

  return (
    <Section
      index="03"
      eyebrow="What we score"
      title="Four layers. Zero black boxes."
      description="Every point in your score traces back to a signal you can see, audit, and improve."
      className="hairline-b"
    >
      <Stagger
        stagger={0.06}
        className="grid gap-px bg-white/[0.06] hairline sm:grid-cols-2"
      >
        {layers.map((l) => (
          <StaggerItem key={l.label}>
            <div className="bg-[hsl(var(--marketing-bg))] p-6 marketing-card-hover h-full">
              <div className="flex items-baseline justify-between">
                <h3 className="text-[15px] font-medium text-white">{l.label}</h3>
                <span className="mono text-2xl font-semibold tabular-nums text-white">
                  {l.weight}
                </span>
              </div>
              <p className="mt-2 text-[13.5px] leading-relaxed text-white/50">
                {l.desc}
              </p>
            </div>
          </StaggerItem>
        ))}
      </Stagger>
    </Section>
  );
}

function AdvisorSection() {
  return (
    <Section
      index="02"
      eyebrow="The advisor"
      title="Don’t just see your score. Improve it."
      description="A built-in AI advisor that explains exactly what’s holding you back and gives you a 60-day plan written in plain language. Not a hotline. Not a quiz. A coach in your pocket."
      align="center"
      className="hairline-b"
    >
      <FadeIn className="mt-2">
        <div className="relative mx-auto flex max-w-5xl flex-col items-center gap-12 lg:gap-16">
          <div className="relative">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 -z-10 mx-auto h-[520px] w-[520px] -translate-y-6 rounded-full bg-[radial-gradient(ellipse_at_center,_rgba(255,122,69,0.10),_transparent_60%)] blur-2xl"
            />
            <AdvisorPhone />
          </div>

          <Stagger
            stagger={0.08}
            className="grid w-full gap-px bg-white/[0.06] hairline sm:grid-cols-3"
          >
            {[
              {
                label: 'Asks like a friend',
                body: 'Talk in your own words — Arabic, French, English. The advisor understands all three.',
              },
              {
                label: 'Explains every number',
                body: 'Tap any signal in your score and it tells you exactly why it landed there.',
              },
              {
                label: 'Gives you the next move',
                body: 'A short, doable plan for this month. No “build credit history,” no boilerplate.',
              },
            ].map((b) => (
              <StaggerItem key={b.label}>
                <div className="h-full bg-[hsl(var(--marketing-bg))] p-6">
                  <div className="mono text-[10px] tracking-[0.18em] uppercase text-white/40">
                    {b.label}
                  </div>
                  <p className="mt-2 text-[14px] leading-relaxed text-white/65">
                    {b.body}
                  </p>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </FadeIn>
    </Section>
  );
}

function UseCases() {
  const cases = [
    {
      tag: 'Loans',
      title: 'Apply for credit without the runaround',
      body: 'Walk into a partner bank with a verified Klaro score and skip the “bring 6 months of statements” loop.',
    },
    {
      tag: 'Renting',
      title: 'Prove you can afford the apartment',
      body: 'Share a one-page Klaro report instead of paystubs and family guarantees. Landlords get a number they trust.',
    },
    {
      tag: 'Freelancers',
      title: 'Finally get scored on what you actually earn',
      body: 'Multiple clients, mixed currencies, no fixed paycheck — Klaro models real income, not just W2-shaped lives.',
    },
    {
      tag: 'Visas & abroad',
      title: 'Build a financial story that travels',
      body: 'A portable, signed proof of identity and income — useful when an embassy or a foreign bank asks who you are.',
    },
  ];

  return (
    <Section
      index="04"
      eyebrow="What it unlocks"
      title="A score is the easy part. Doors open are the point."
      description="Klaro turns the financial life you already live into proof you can hand to the people gatekeeping the things you want."
      className="hairline-b"
    >
      <Stagger
        stagger={0.06}
        className="grid gap-px bg-white/[0.06] hairline sm:grid-cols-2"
      >
        {cases.map((c) => (
          <StaggerItem key={c.title}>
            <article className="group h-full bg-[hsl(var(--marketing-bg))] p-7 marketing-card-hover">
              <div className="mono text-[10.5px] tracking-[0.2em] uppercase text-[hsl(var(--marketing-accent))]">
                {c.tag}
              </div>
              <h3 className="mt-3 text-[18px] font-medium leading-snug text-white">
                {c.title}
              </h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-white/55">
                {c.body}
              </p>
            </article>
          </StaggerItem>
        ))}
      </Stagger>
    </Section>
  );
}

function ReassuranceStrip() {
  const items = [
    { label: 'Read-only', body: 'We can see your transactions. We can never move money.' },
    { label: 'Encrypted', body: 'Your statements live behind keys only you can authorize.' },
    { label: 'Revocable', body: 'Disconnect any bank in one tap. Data deleted on request.' },
    { label: 'Auditable', body: 'Every score has a paper trail. You can see how it was built.' },
  ];
  return (
    <section className="hairline-b">
      <FadeIn className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((it) => (
            <div key={it.label} className="space-y-1.5">
              <div className="mono text-[10.5px] tracking-[0.2em] uppercase text-white/45">
                {it.label}
              </div>
              <p className="text-[13.5px] leading-relaxed text-white/65">
                {it.body}
              </p>
            </div>
          ))}
        </div>
      </FadeIn>
    </section>
  );
}

function ConsumerCTA() {
  return (
    <section className="relative">
      <FadeIn className="mx-auto max-w-6xl px-6 py-24">
        <div className="hairline rounded-2xl p-10 sm:p-14 bg-white/[0.02] relative overflow-hidden">
          <div
            aria-hidden
            className="absolute -top-24 -right-20 h-64 w-64 rounded-full bg-[hsl(var(--marketing-accent))] opacity-[0.07] blur-3xl"
          />
          <div className="relative grid gap-6 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="space-y-3">
              <span className="mono text-[10.5px] tracking-[0.2em] uppercase text-white/45">
                Ready when you are
              </span>
              <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white">
                Know your real score.
                <br />
                <span className="text-white/45">In five minutes. Free to start.</span>
              </h2>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/register"
                className="btn-mark-primary inline-flex items-center gap-2 px-5 py-3 text-[14px] font-medium"
              >
                Get my score
                <span aria-hidden>→</span>
              </Link>
              <Link
                href="/login"
                className="btn-mark-ghost inline-flex items-center gap-2 px-5 py-3 text-[14px] font-medium"
              >
                I have an account
              </Link>
            </div>
          </div>
        </div>
      </FadeIn>
    </section>
  );
}
