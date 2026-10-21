import { redirect } from "next/navigation";
import { getCurrentUser, redirectToLogin, workspaceHome } from "@/lib/auth";

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) redirectToLogin();
  redirect(workspaceHome(user));
}
