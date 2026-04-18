import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function HomePage() {
  return (
    <div className="container py-20">
      <section className="mx-auto max-w-3xl text-center">
        <span className="inline-block rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          Alternative credit scoring for Tunisia
        </span>
        <h1 className="mt-6 text-balance text-5xl font-bold tracking-tight sm:text-6xl">
          Your real financial story. Scored fairly.
        </h1>
        <p className="mt-6 text-pretty text-lg text-muted-foreground">
          Klaro builds a transparent, AI-powered credit score from your KYC, bank activity, and
          payment behavior — without the credit bureau gatekeeping.
        </p>
        <div className="mt-10 flex items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/register">Get my score</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/login">I already have an account</Link>
          </Button>
        </div>
      </section>

      <section className="mt-24 grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Own your KYC</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            100% open-source pipeline (PaddleOCR, MTCNN, AdaFace, MediaPipe). Your documents never
            leave our infrastructure.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Real bank insights</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Connect your bank or upload statements. Klaro normalizes, categorizes, and scores —
            transparently.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>An advisor that knows you</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            A Claude-powered financial advisor that understands your spending patterns and helps you
            improve your score with concrete actions.
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
