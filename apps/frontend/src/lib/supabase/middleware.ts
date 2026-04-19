import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { Database } from '@klaro/shared';
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/', '/login', '/register', '/verify-email', '/api/auth/callback'];

// Paths that are part of the onboarding flow — don't gate them
const ONBOARDING_PATHS = ['/kyc', '/onboarding', '/connect-bank', '/documents'];

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

  // Authenticated on login/register → redirect to app
  if (user && (pathname === '/login' || pathname === '/register')) {
    const url = request.nextUrl.clone();
    const role = (user.app_metadata?.role as string | undefined) ?? 'user';
    if (role === 'bank') {
      url.pathname = '/bank/clients';
      return NextResponse.redirect(url);
    }
    // Check onboarding progress via profile
    const { data: profileRaw } = await supabase
      .from('profiles')
      .select('kyc_status')
      .eq('id', user.id)
      .maybeSingle();
    const profile = profileRaw as { kyc_status: string } | null;

    if (!profile || profile.kyc_status === 'pending') {
      url.pathname = '/kyc';
    } else {
      url.pathname = '/dashboard';
    }
    return NextResponse.redirect(url);
  }

  // Bank role guard
  if (user && pathname.startsWith(BANK_PREFIX)) {
    const role = (user.app_metadata?.role as string | undefined) ?? 'user';
    if (role !== 'bank' && role !== 'admin') {
      const url = request.nextUrl.clone();
      url.pathname = '/dashboard';
      return NextResponse.redirect(url);
    }
  }

  // Gate /dashboard: if KYC not done, push to /kyc
  // (skip check for onboarding paths to avoid redirect loops)
  if (user && pathname === '/dashboard') {
    const isOnboarding = ONBOARDING_PATHS.some(
      (p) => pathname === p || pathname.startsWith(p + '/'),
    );
    if (!isOnboarding) {
      const { data: profileRaw2 } = await supabase
        .from('profiles')
        .select('kyc_status')
        .eq('id', user.id)
        .maybeSingle();
      const profile2 = profileRaw2 as { kyc_status: string } | null;

      if (!profile2 || profile2.kyc_status === 'pending') {
        const url = request.nextUrl.clone();
        url.pathname = '/kyc';
        return NextResponse.redirect(url);
      }
    }
  }

  return supabaseResponse;
}
