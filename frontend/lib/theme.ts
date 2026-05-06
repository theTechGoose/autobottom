/** Per-role accent colors for CSS variable overrides. */

export interface AccentTheme {
  accent: string;
  accentBg: string;
}

export const ROLE_THEMES: Record<string, AccentTheme> = {
  admin:    { accent: "#58a6ff", accentBg: "rgba(31,111,235,0.10)" },
  review:   { accent: "#8b5cf6", accentBg: "rgba(139,92,246,0.10)" },
  judge:    { accent: "#14b8a6", accentBg: "rgba(20,184,166,0.10)" },
  manager:  { accent: "#bc8cff", accentBg: "rgba(139,92,246,0.12)" },
  agent:    { accent: "#f97316", accentBg: "rgba(249,115,22,0.10)" },
  chat:     { accent: "#39d0d8", accentBg: "rgba(57,208,216,0.10)" },
};

export function getTheme(section: string): AccentTheme {
  return ROLE_THEMES[section] ?? ROLE_THEMES.admin;
}
