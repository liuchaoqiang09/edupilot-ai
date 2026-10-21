export function WorkspacePlaceholder({ title, description }: { title: string; description: string }) {
  return (
    <section>
      <h1 className="text-[28px] font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">{description}</p>
      <div className="mt-6 rounded-2xl border border-[var(--line)] bg-white px-6 py-12 text-center text-sm leading-7 text-[var(--muted)]">
        这一页只是工作空间外壳。学生、课表和报告会在后续阶段接入数据库，当前没有可展示的业务数据。
      </div>
    </section>
  );
}
