import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { Topbar } from '@/components/app-shell/topbar';

export default async function BankLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole('bank');

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r lg:block">
        <div className="flex h-16 items-center border-b px-6">
          <Link href="/bank/clients" className="text-lg font-bold tracking-tight">
            Klaro · Bank
          </Link>
        </div>
        <nav className="space-y-1 p-3">
          <Link
            href="/bank/clients"
            className="block rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Clients
          </Link>
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <Topbar email={user.email} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
