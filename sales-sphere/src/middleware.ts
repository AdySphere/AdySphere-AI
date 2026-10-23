import { NextResponse, type NextRequest } from "next/server";

// HTTP basic auth over the whole app (any username, APP_PASSWORD as password).
// Cron endpoints authenticate with CRON_SECRET instead; the OAuth callback carries a signed state.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/cron/") || pathname === "/api/auth/microsoft/callback") return NextResponse.next();
  const password = process.env.APP_PASSWORD;
  if (!password) {
    if (process.env.NODE_ENV === "production") return new NextResponse("APP_PASSWORD is not set", { status: 500 });
    return NextResponse.next();
  }
  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    const given = decoded.slice(decoded.indexOf(":") + 1);
    if (given.length === password.length && timingSafe(given, password)) return NextResponse.next();
  }
  return new NextResponse("Authentication required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Sales Sphere"' } });
}

function timingSafe(a: string, b: string) {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
