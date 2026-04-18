'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';

interface Props {
  email?: string | null;
}

export function Topbar({ email }: Props) {
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="flex h-16 items-center justify-between border-b px-6">
      <div className="text-sm text-muted-foreground">{email}</div>
      <Button variant="outline" size="sm" onClick={signOut}>
        Sign out
      </Button>
    </header>
  );
}
