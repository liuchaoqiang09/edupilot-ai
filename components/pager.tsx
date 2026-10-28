import Link from "next/link";

export const pageSize = 20;
export const billingPageSize = 10;

export function pageOf(value: string | undefined, total: number, size = pageSize) {
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(1, Number(value) || 1), pages);
  return { page, pages, start: (page - 1) * size, size };
}

export function Pager({
  page,
  pages,
  href,
  size = pageSize,
}: {
  page: number;
  pages: number;
  href: (page: number) => string;
  size?: number;
}) {
  if (pages <= 1) return null;
  return (
    <nav className="flex items-center justify-end gap-3 border-t border-[#eef1ee] px-4 py-3 text-xs">
      <span className="text-[var(--muted)]">
        第 {page} / {pages} 页，每页 {size} 条
      </span>
      {page > 1 ? (
        <Link href={href(page - 1)} className="font-bold text-[var(--teal)]">
          上一页
        </Link>
      ) : (
        <span className="text-[#b7c2be]">上一页</span>
      )}
      {page < pages ? (
        <Link href={href(page + 1)} className="font-bold text-[var(--teal)]">
          下一页
        </Link>
      ) : (
        <span className="text-[#b7c2be]">下一页</span>
      )}
    </nav>
  );
}
