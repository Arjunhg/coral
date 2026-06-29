import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

// ...existing code...
const isProtectedRoute = createRouteMatcher(['/workspace(.*)'])

export default clerkMiddleware(async (auth, req) => {
  // Skip Clerk handshake requests to avoid large header/cookie redirects (431)
  const searchParams = (req as any).nextUrl?.searchParams ?? new URL(req.url).searchParams
  if (searchParams.has('__clerk_handshake')) return

  const { userId } = await auth()
  const { pathname } = req.nextUrl

  // If user is signed in and visits home page, redirect to workspace
  if (userId && pathname === '/') {
    return NextResponse.redirect(new URL('/workspace', req.url))
  }

  if (isProtectedRoute(req)) await auth.protect()
})
// ...existing code...
export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}