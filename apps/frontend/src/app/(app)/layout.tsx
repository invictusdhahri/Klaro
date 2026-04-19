import { requireUser } from '@/lib/auth';
import { Sidebar } from '@/components/app-shell/sidebar';
import { Topbar } from '@/components/app-shell/topbar';
import { BottomNav } from '@/components/app-shell/bottom-nav';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="app-gradient min-h-screen">
      {/* Ambient blobs — always visible */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden -z-10">
        <div className="absolute -top-32 -left-16 w-[36rem] h-[36rem] rounded-full bg-indigo-600/12 blur-[100px]" />
        <div className="absolute bottom-0 right-0 w-[40rem] h-[40rem] rounded-full bg-blue-600/10 blur-[120px]" />
        <div className="absolute top-1/3 right-1/4 w-64 h-64 rounded-full bg-violet-600/8 blur-[80px]" />
      </div>

      {/* Desktop sidebar */}
      <Sidebar />

      {/* Main column */}
      <div className="lg:pl-64 flex flex-col min-h-screen relative z-10 isolate min-w-0">
        <Topbar email={user.email} />
        <main className="flex-1 overflow-y-auto p-4 pb-24 lg:p-6 lg:pb-6">
          {children}
        </main>
      </div>

      {/* Mobile bottom nav */}
      <BottomNav />
    </div>
  );
}
