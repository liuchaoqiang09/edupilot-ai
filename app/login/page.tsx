import { redirect } from "next/navigation";
import { LoginScreen } from "@/components/login-screen";
import { getCurrentUser, workspaceHome } from "@/lib/auth";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(workspaceHome(user));
  // 内测：非生产环境展示三端演示入口；生产环境永不展示（PRODUCT_SPEC §11.3）。
  const showDemoAccounts = process.env.NODE_ENV !== "production";
  return <LoginScreen showDemoAccounts={showDemoAccounts} />;
}
