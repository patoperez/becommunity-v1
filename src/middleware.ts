import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Edge-runtime middleware. In Next 16 the `proxy` convention forces the Node.js
// runtime, which the Cloudflare / OpenNext adapter does NOT support
// ("Node.js middleware is not currently supported"). The `middleware` convention
// runs on the Edge runtime, which the adapter requires — so we use it here.
export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Run on all paths except static assets and image files so the session
     * cookie stays fresh everywhere it matters.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
