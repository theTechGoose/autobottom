/** Reusable stat card — label, big number, optional subtitle, color. */

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  color?: "blue" | "green" | "red" | "yellow" | "purple" | "cyan";
}

export function StatCard({ label, value, sub, color = "blue" }: StatCardProps) {
  return (
    <div class={`stat-card ${color}`}>
      <div class="stat-label">{label}</div>
      <div class="stat-value">{value}</div>
      {sub && <div class="stat-sub">{sub}</div>}
    </div>
  );
}
