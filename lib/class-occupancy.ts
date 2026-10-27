export function classIsFull(capacity: number | null, enrolled: number) {
  return capacity != null && enrolled >= capacity;
}

export function distinctEnrolled(rows: { classGroupId: string | null; studentId: string }[]) {
  const map = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.classGroupId) continue;
    const set = map.get(row.classGroupId) ?? new Set<string>();
    set.add(row.studentId);
    map.set(row.classGroupId, set);
  }
  return map;
}
