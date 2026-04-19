import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

/**
 * Server component — finds or creates the user's most recent chat session and
 * immediately redirects to /chat/[id] so the URL always reflects a session.
 */
export default async function ChatPage() {
  const user = await requireUser();
  const supabase = await createClient();

  // Try to find the most recent non-archived session.
  const { data: sessions } = await supabase
    .from('chat_sessions')
    .select('id')
    .eq('user_id', user.id)
    .is('archived_at', null)
    .order('updated_at', { ascending: false })
    .limit(1);

  const firstSession = (sessions as Array<{ id: string }> | null)?.[0];
  if (firstSession?.id) {
    redirect(`/chat/${firstSession.id}`);
  }

  // No session yet — create one via the backend API (uses the access token).
  const {
    data: { session: authSession },
  } = await supabase.auth.getSession();

  if (authSession?.access_token) {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
    const res = await fetch(`${apiBase}/api/chat/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authSession.access_token}`,
        'Content-Type': 'application/json',
      },
    });
    if (res.ok) {
      const newSession = (await res.json()) as { id: string };
      redirect(`/chat/${newSession.id}`);
    }
  }

  // Fallback: redirect to a fresh chat without a specific session (handled gracefully).
  redirect('/chat/new');
}
