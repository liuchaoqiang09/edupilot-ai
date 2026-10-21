import { WorkspacePlaceholder } from "@/components/workspace-placeholder";
import { pageMeta } from "@/lib/navigation";

export default function Page() {
  const page = pageMeta("owner", "/owner/stats");
  return <WorkspacePlaceholder title={page.label} description={page.description} />;
}
