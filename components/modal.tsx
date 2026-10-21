export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-[#0f2022]/45 p-5" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-[560px] overflow-y-auto rounded-[18px] bg-white shadow-[0_28px_80px_#142b2b35]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-5">
          <h3 className="text-[17px] font-semibold">{title}</h3>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-[11px] border border-[var(--line)] bg-white text-[#51656a]" aria-label="关闭">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
