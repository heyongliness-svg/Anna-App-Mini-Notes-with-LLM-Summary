export type ThemeName = "light" | "dark";

export function readHostTheme(): ThemeName {
  return new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light";
}

export function applyTheme(theme: string | null | undefined): void {
  const next: ThemeName = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  document.documentElement.style.colorScheme = next;
}
