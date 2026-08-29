import { Command, X } from "lucide-react";
import { useFocusTrap } from "../useFocusTrap";

const SHORTCUTS = [
  ["j / k", "Next / previous conversation"],
  ["r", "Reply"],
  ["c", "New message"],
  ["e", "Archive"],
  ["#", "Move to trash"],
  ["s", "Star or unstar"],
  ["u", "Mark unread"],
  ["/", "Search every account"],
  ["?", "Show this guide"],
] as const;

type ShortcutHelpProps = {
  onClose: () => void;
};

export function ShortcutHelp({ onClose }: ShortcutHelpProps) {
  const dialogRef = useFocusTrap<HTMLElement>(true);
  return (
    <div className="dialog-scrim" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="shortcut-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
        tabIndex={-1}
      >
        <header>
          <span className="shortcut-dialog__icon"><Command size={19} /></span>
          <h2 id="shortcut-dialog-title">Keyboard shortcuts</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close shortcut guide" data-initial-focus>
            <X size={18} />
          </button>
        </header>
        <div className="shortcut-list">
          {SHORTCUTS.map(([keys, label]) => (
            <div key={keys}><span>{label}</span><kbd>{keys}</kbd></div>
          ))}
        </div>
      </section>
    </div>
  );
}
