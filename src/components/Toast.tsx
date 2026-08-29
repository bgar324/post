import { AlertCircle, CheckCircle2, X } from "lucide-react";
import type { Toast as ToastState } from "../model";

type ToastProps = {
  toast: ToastState;
  onClose: () => void;
};

export function Toast({ toast, onClose }: ToastProps) {
  return (
    <div className={`toast toast--${toast.kind}`} role="status" aria-live="polite">
      {toast.kind === "success" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
      <span>{toast.message}</span>
      <button type="button" onClick={onClose} aria-label="Dismiss notification"><X size={15} /></button>
    </div>
  );
}
