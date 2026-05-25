/** EquippedName — renders a user's display name with their equipped
 *  cosmetics (name color + flair + optional title underneath).
 *  Pure SSR component; consume the resolved cosmetics from
 *  `frontend/lib/cosmetics.ts` or pass them directly. */

interface EquippedNameProps {
  email: string;
  /** Resolved cosmetics from `resolveCosmetics(gameState)`. */
  cosmetics?: {
    title?: string | null;
    nameColor?: string;
    flair?: string | null;
  };
  /** Display variant. "inline" = name only; "stacked" = name + title under. */
  variant?: "inline" | "stacked";
  /** Override font weight. Defaults to 600. */
  weight?: number;
}

export function EquippedName(props: EquippedNameProps) {
  const c = props.cosmetics ?? {};
  const color = c.nameColor && c.nameColor !== "currentColor" ? c.nameColor : "var(--text-bright)";
  const weight = props.weight ?? 600;

  if (props.variant === "stacked") {
    return (
      <div style="display:flex;flex-direction:column;gap:1px;line-height:1.1;">
        <span style={`color:${color};font-weight:${weight};`}>
          {props.email}
          {c.flair && <span style="margin-left:4px;">{c.flair}</span>}
        </span>
        {c.title && (
          <span style="font-size:10px;color:var(--text-dim);font-style:italic;">{c.title}</span>
        )}
      </div>
    );
  }

  return (
    <span style={`color:${color};font-weight:${weight};`}>
      {props.email}
      {c.flair && <span style="margin-left:4px;">{c.flair}</span>}
      {c.title && (
        <span style="margin-left:8px;font-size:10px;color:var(--text-dim);font-style:italic;font-weight:400;">
          {c.title}
        </span>
      )}
    </span>
  );
}
