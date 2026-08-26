import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/onboarding',
  '/pricing',
  '/privacy',
  '/terms',
  // Public venue menu, linked from the AI's MENU reply. Opened by diners
  // straight from WhatsApp, who have no account and must not hit a
  // sign-in wall.
  '/m/(.*)',
  // Public magic-link claim page: opened on a prospect owner's phone, no
  // account required. The redeem page (/claim/redeem) is listed here too so
  // Clerk's middleware doesn't bounce it before the page's own auth check.
  '/claim/(.*)',
  '/api/webhooks(.*)',
  '/api/cron(.*)',
  '/api/whatsapp(.*)',
  '/api/migrate(.*)',
]);

export default clerkMiddleware((auth, request) => {
  if (!isPublicRoute(request)) {
    auth().protect();
  }

  // S4 — forward the explicit ?tenant= selection to server components as a
  // request header: App Router layouts never receive searchParams, and the
  // dashboard layout resolves its tenant through lib/tenant-resolver, which
  // reads this header as priority #1.
  const tenantParam = request.nextUrl.searchParams.get('tenant');
  if (tenantParam) {
    request.headers.set('x-tenant-param', tenantParam);
  }
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|json|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
