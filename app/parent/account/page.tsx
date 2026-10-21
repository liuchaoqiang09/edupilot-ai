import { WorkspacePlaceholder } from "@/components/workspace-placeholder";
import { pageMeta } from "@/lib/navigation";

export default function Page() {
  const page = pageMeta("parent", "/parent/account");
  return <WorkspacePlaceholder title={page.label} description={page.description} />;
}
