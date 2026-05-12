import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { Database } from '@klaro/shared';
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = [
  '/',
  '/partners',
  '/login',
  '/register',
  '/bank/login',
  '/bank/register',
  '/api/auth/callback',
];

const BANK_PREFIX = '/bank';

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
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
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

  // Unauthenticated → login
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // Authenticated bank user landing on bank/login → go straight to portal
  if (user && pathname === '/bank/login') {
    const role = (user.app_metadata?.role as string | undefined) ?? 'user';
    const url = request.nextUrl.clone();
    url.pathname = role === 'bank' || role === 'admin' ? '/bank' : '/login';
    return NextResponse.redirect(url);
  }

  // Authenticated on login/register → redirect to app (KYC routing runs in RSC, not Edge)
  if (user && (pathname === '/login' || pathname === '/register')) {
    const url = request.nextUrl.clone();
    const role = (user.app_metadata?.role as string | undefined) ?? 'user';
    if (role === 'bank') {
      url.pathname = '/bank';
      return NextResponse.redirect(url);
    }
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  // Bank role guard (skip public bank auth pages)
  const bankPublicPaths = ['/bank/login', '/bank/register'];
  if (user && pathname.startsWith(BANK_PREFIX) && !bankPublicPaths.includes(pathname)) {
    const role = (user.app_metadata?.role as string | undefined) ?? 'user';
    if (role !== 'bank' && role !== 'admin') {
      const url = request.nextUrl.clone();
      url.pathname = '/dashboard';
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
