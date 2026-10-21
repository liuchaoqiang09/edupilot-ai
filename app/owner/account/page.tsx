import { AccountSecurity } from "@/components/account-security";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function OwnerAccountPage() {
  const user = await requireRole("OWNER", "owner");
  return (
    <AccountSecurity
      email={user.email}
      phone={user.phone}
      note="可以在「教师管理」收回老师的登录权限，在「学生管理」收回家长查看孩子的权限。收回不会查看或修改他们的密码。"
    />
  );
}
