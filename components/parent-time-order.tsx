import Link from "next/link";

/** 家长列表共用的时间排序切换，筛选参数通过 extraParams 保留。 */
export function ParentTimeOrder({
  basePath,
  order,
  extraParams = {},
}: {
  basePath: string;
  order: "asc" | "desc";
  extraParams?: Record<string, string>;
}) {
  function href(next: "asc" | "desc") {
    const query = new URLSearchParams(extraParams);
    if (next === "asc") query.set("order", "asc");
    else query.delete("order");
    const text = query.toString();
    return text ? `${basePath}?${text}` : basePath;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-bold text-[var(--muted)]">时间</span>
      <Link
        href={href("desc")}
        className={`rounded-full px-3 py-1.5 text-xs font-bold ${
          order === "desc" ? "bg-[var(--teal)] text-white" : "border border-[var(--line)] bg-white text-[#385058]"
        }`}
      >
        从新到旧
      </Link>
      <Link
        href={href("asc")}
        className={`rounded-full px-3 py-1.5 text-xs font-bold ${
          order === "asc" ? "bg-[var(--teal)] text-white" : "border border-[var(--line)] bg-white text-[#385058]"
        }`}
      >
        从旧到新
      </Link>
    </div>
  );
}

export function parseTimeOrder(raw: string | undefined): "asc" | "desc" {
  return raw === "asc" ? "asc" : "desc";
}
