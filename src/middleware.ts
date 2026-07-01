import { NextRequest, NextResponse } from "next/server";

/**
 * Rewrites the IndexNow key file `/{32-hex}.txt` to the SDK route
 * (app/api/indexnow-key) so search engines can verify ownership.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (/^\/[a-f0-9]{32}\.txt$/.test(pathname)) {
    return NextResponse.rewrite(new URL("/api/indexnow-key", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/|favicon.ico).*)"],
};
