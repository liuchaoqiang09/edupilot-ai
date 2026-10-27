import Link from "next/link";

export function ParentChildFilter({
  basePath,
  childrenList,
  selectedId,
  extraParams = {},
}: {
  basePath: string;
  childrenList: { id: string; name: string; status: string }[];
  selectedId: string;
  extraParams?: Record<string, string>;
}) {
  if (childrenList.length <= 1) return null;

  function href(studentId: string) {
    const query = new URLSearchParams(extraParams);
    if (studentId) query.set("student", studentId);
    else query.delete("student");
    const text = query.toString();
    return text ? `${basePath}?${text}` : basePath;
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-bold text-[var(--muted)]">孩子</span>
      <Link
        href={href("")}
        className={`rounded-full px-3 py-1.5 text-xs font-bold ${!selectedId ? "bg-[var(--teal)] text-white" : "border border-[var(--line)] bg-white text-[#385058]"}`}
      >
        全部
      </Link>
      {childrenList.map((child) => (
        <Link
          key={child.id}
          href={href(child.id)}
          className={`rounded-full px-3 py-1.5 text-xs font-bold ${selectedId === child.id ? "bg-[var(--teal)] text-white" : "border border-[var(--line)] bg-white text-[#385058]"}`}
        >
          {child.name}
          {child.status === "INACTIVE" ? <span className="ml-1 opacity-80">·停用</span> : null}
        </Link>
      ))}
    </div>
  );
}
