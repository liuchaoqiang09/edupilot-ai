type Blocker = () => boolean;

let blocker: Blocker | null = null;

/** Register a leave-confirm callback for in-app navigation (sidebar links). */
export function setUnsavedBlocker(next: Blocker | null) {
  blocker = next;
}

/** Returns false when the user cancels leaving a dirty form. */
export function confirmLeaveIfDirty() {
  if (!blocker) return true;
  return blocker();
}
