import { ReactNode, useEffect } from "react";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
}

export default function Modal({ open, title, onClose, children, className, footer }: ModalProps) {
  if (!open) {
    return null;
  }

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className={`modal${className ? ` ${className}` : ""}`}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button
            type="button"
            className="ghost-button icon-button"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} strokeWidth={1.6} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}
