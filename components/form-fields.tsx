export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <span className="text-xs font-medium text-[#b94d4d]">{message}</span>;
}

export function TextField({
  label,
  name,
  defaultValue,
  placeholder,
  required,
  type = "text",
  error,
  onChange,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  placeholder?: string;
  required?: boolean;
  type?: "text" | "password";
  error?: string;
  onChange?: () => void;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-bold">
      <span>
        {label}
        {required ? <span className="ml-1 font-medium text-[#9a6729]">必填</span> : null}
      </span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        required={required}
        onChange={onChange}
        className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]"
      />
      <FieldError message={error} />
    </label>
  );
}
