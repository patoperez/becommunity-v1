import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Next.js 16 renamed the "middleware" file convention to "proxy".
export async function proxy(request: NextRequest) {
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
