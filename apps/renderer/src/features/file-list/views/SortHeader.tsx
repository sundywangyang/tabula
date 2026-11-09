import { ChevronDown, ChevronUp } from 'lucide-react';
import type { SortField } from '../../../stores/file/types';

export function SortHeader({
  field,
  label,
  currentField,
  currentDir,
  onSort,
  className,
}: {
  field: SortField;
  label: string;
  currentField: SortField;
  currentDir: 'asc' | 'desc' | null;
  onSort: (f: SortField) => void;
  className: string;
}) {
  const active = currentField === field && currentDir !== null;
  const SortIcon = currentDir === 'asc' ? ChevronUp : ChevronDown;
  return (
    <button
      type="button"
      className={`${className} sort-header ${active ? 'sort-active' : ''}`}
      onClick={() => onSort(field)}
      title={`按${label}排序`}
    >
      {label}
      {active && <SortIcon size={12} className="sort-arrow" aria-hidden="true" />}
    </button>
  );
}
