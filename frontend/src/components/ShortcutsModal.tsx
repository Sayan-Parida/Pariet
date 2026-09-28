import { X } from 'lucide-react';
import { shortcutLabel } from '../utils/platform';

interface Props {
  onClose: () => void;
}

const getShortcuts = () => [
  { key: shortcutLabel('K'), description: 'Focus command search bar' },
  { key: shortcutLabel('B'), description: 'Toggle left workspace sidebar' },
  { key: 'F', description: 'Fit research graph to screen' },
  { key: 'Drag', description: 'Move the map around (start on empty space)' },
  { key: 'Hold Space, then drag', description: 'Move the map when starting on a node' },
  { key: 'Scroll Wheel', description: 'Zoom in / zoom out' }
];

export default function ShortcutsModal({ onClose }: Props) {
  const shortcuts = getShortcuts();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs select-none">
      <div 
        className="w-full max-w-sm rounded-lg border shadow-panel overflow-hidden"
        style={{
          backgroundColor: 'var(--surface-base)',
          borderColor: 'var(--border-medium)',
        }}
      >
        <div 
          className="h-10 px-4 border-b flex items-center justify-between"
          style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface-subtle)' }}
        >
          <span className="text-xs font-semibold text-[var(--text-primary)]">
            Shortcuts Guide
          </span>
          <button onClick={onClose} className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 divide-y divide-[var(--border-subtle)] text-xs">
          {shortcuts.map((s, i) => (
            <div key={i} className="py-2 flex items-center justify-between">
              <span className="text-[var(--text-secondary)]">{s.description}</span>
              <kbd className="px-1.5 py-0.5 rounded font-mono text-[10px] text-[var(--text-primary)] bg-[var(--surface-subtle)] border border-[var(--border-subtle)]">
                {s.key}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
