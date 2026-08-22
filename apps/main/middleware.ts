import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/onboarding',
  // Public venue menu, linked from the AI's MENU reply. Opened by diners
  // straight from WhatsApp, who have no account and must not hit a
  // sign-in wall.
  '/m/(.*)',
  '/api/webhooks(.*)',
  '/api/cron(.*)',
  '/api/whatsapp(.*)',
  '/api/migrate(.*)',
]);

export default clerkMiddleware((auth, request) => {
  if (!isPublicRoute(request)) {
    auth().protect();
  }
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
