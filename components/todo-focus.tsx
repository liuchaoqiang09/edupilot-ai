"use client";

import { useEffect } from "react";

export function TodoFocus({ group }: { group: string | null }) {
  useEffect(() => {
    if (!group) return;
    const section = document.getElementById(`todo-${group}`);
    const row = section?.querySelector("li");
    (row ?? section)?.scrollIntoView({ block: "start" });
  }, [group]);
  return null;
}
