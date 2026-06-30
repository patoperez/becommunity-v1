import { redirect } from "next/navigation";

// The root path has no standalone content in Fase 1: send users into the portal.
// Middleware + the dashboard's own server-side check route unauthenticated
// users to /login (defense in depth, §6.4).
export default function Home() {
  redirect("/dashboard");
}
