import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden bg-primary/5 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <Link href="/" className="text-lg font-bold tracking-tight">
          Klaro
        </Link>
        <div className="max-w-md">
          <p className="text-2xl font-semibold leading-snug">
            &ldquo;Klaro told me exactly why my score was low and what to fix. Three weeks later, I
            got my first loan approved.&rdquo;
          </p>
          <p className="mt-4 text-sm text-muted-foreground">— Beta tester, Tunis</p>
        </div>
        <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} Klaro</p>
      </div>
      <div className="flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
