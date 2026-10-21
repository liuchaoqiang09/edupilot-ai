import { redirect } from "next/navigation";
import { getCurrentUser, workspaceHome } from "@/lib/auth";

export default async function HomePage() {
  const user = await getCurrentUser();
  redirect(user ? workspaceHome(user) : "/login");
}
