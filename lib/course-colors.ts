export const coursePalettes = [
  { background: "#e7f6f1", border: "#8fd0c0", accent: "#146b62" },
  { background: "#e8f3fb", border: "#9ec4e4", accent: "#2d6494" },
  { background: "#f3eef8", border: "#c9b6e0", accent: "#6b4e8a" },
  { background: "#fff3e6", border: "#e8c59a", accent: "#9a6729" },
  { background: "#f7f6df", border: "#ddd78f", accent: "#746a28" },
  { background: "#fdeff3", border: "#e7b7c6", accent: "#8d4d63" },
  { background: "#eef6ea", border: "#b7d6aa", accent: "#4e7544" },
  { background: "#eef4f4", border: "#b3c9cc", accent: "#3d656c" },
] as const;

export function coursePalette(courseId: string) {
  let hash = 0;
  for (let index = 0; index < courseId.length; index += 1) {
    hash = (hash * 31 + courseId.charCodeAt(index)) >>> 0;
  }
  return coursePalettes[hash % coursePalettes.length];
}
