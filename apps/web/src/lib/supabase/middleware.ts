import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { Database } from '@klaro/shared';
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/', '/login', '/register', '/verify-email', '/api/auth/callback'];

const BANK_PREFIX = '/bank';
const APP_PREFIX = '/app';

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[],
        ) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          supabaseResponse = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname.startsWith(BANK_PREFIX)) {
    const role = (user.app_metadata?.role as string | undefined) ?? 'user';
    if (role !== 'bank' && role !== 'admin') {
      const url = request.nextUrl.clone();
      url.pathname = '/dashboard';
      return NextResponse.redirect(url);
    }
  }

  if (user && (pathname === '/login' || pathname === '/register')) {
    const url = request.nextUrl.clone();
    const role = (user.app_metadata?.role as string | undefined) ?? 'user';
    url.pathname = role === 'bank' ? '/bank/clients' : '/dashboard';
    return NextResponse.redirect(url);
  }

  // Avoid unused var warning for APP_PREFIX in case of future use.
  void APP_PREFIX;

  return supabaseResponse;
}
