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
  const arrow = currentField === field ? (currentDir === 'asc' ? '▲' : currentDir === 'desc' ? '▼' : '') : '';
  return (
    <button
      type="button"
      className={`${className} sort-header ${active ? 'sort-active' : ''}`}
      onClick={() => onSort(field)}
      title={`按${label}排序`}
    >
      {label}
      {arrow && <span className="sort-arrow">{arrow}</span>}
    </button>
  );
}
