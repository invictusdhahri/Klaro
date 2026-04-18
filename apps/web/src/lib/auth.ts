import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect('/login');
  return user;
}

export async function requireRole(role: 'user' | 'bank' | 'admin') {
  const user = await requireUser();
  const userRole = (user.app_metadata?.role as string | undefined) ?? 'user';
  if (userRole !== role && userRole !== 'admin') {
    redirect('/dashboard');
  }
  return user;
}
