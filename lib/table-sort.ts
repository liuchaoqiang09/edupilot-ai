export type SortOrder = "asc" | "desc";

export type TableSort<Field extends string> = {
  sortBy: Field;
  order: SortOrder;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function readSort<Field extends string>(
  sortBy: string | string[] | undefined,
  order: string | string[] | undefined,
  allowed: readonly Field[],
): TableSort<Field> | null {
  const field = first(sortBy);
  const direction = first(order);
  if (!field || (direction !== "asc" && direction !== "desc")) return null;
  if (!allowed.includes(field as Field)) return null;
  return { sortBy: field as Field, order: direction };
}
