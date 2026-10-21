import { redirect } from "next/navigation";
import { LoginScreen } from "@/components/login-screen";
import { getCurrentUser, workspaceHome } from "@/lib/auth";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(workspaceHome(user));
  return <LoginScreen />;
}
