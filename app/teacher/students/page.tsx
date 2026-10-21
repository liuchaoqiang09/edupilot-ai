import { WorkspacePlaceholder } from "@/components/workspace-placeholder";
import { pageMeta } from "@/lib/navigation";

export default function Page() {
  const page = pageMeta("teacher", "/teacher/students");
  return <WorkspacePlaceholder title={page.label} description={page.description} />;
}
