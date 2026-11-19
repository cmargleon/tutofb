import { Check } from 'lucide-react';

interface PoseOption { id: string; label: string; shotType?: string }
export function PoseSelectionChips({ groups, selectedIds, onToggle, disabled = false }: {
  groups: Array<{ group: string; options: PoseOption[] }>;
  selectedIds: readonly string[];
  onToggle: (id: string) => void;
  disabled?: boolean;
}) {
  return <div className="space-y-4">{groups.map(({ group, options }) => <div key={group}>
    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{group}</p>
    <div className="flex flex-wrap gap-2">{options.map(pose => {
      const selected = selectedIds.includes(pose.id);
      return <button key={pose.id} type="button" aria-pressed={selected} disabled={disabled} title={pose.shotType}
        onClick={() => onToggle(pose.id)}
        className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50 ${selected
          ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]'
          : 'border-[var(--color-border-default)] bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]'}`}>
        <Check aria-hidden="true" className={`h-3 w-3 shrink-0 ${selected ? 'opacity-100' : 'opacity-0'}`} />{pose.label}
      </button>;
    })}</div>
  </div>)}</div>;
}
