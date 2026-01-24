import { X } from "lucide-react";

interface DirectoriesModalProps {
  open: boolean;
  onClose: () => void;
}

export default function DirectoriesModal({ open, onClose }: DirectoriesModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-header">
          <h2>Directories</h2>
          <button
            type="button"
            className="ghost-button icon-button"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} strokeWidth={1.6} />
          </button>
        </div>
        <div className="modal-body">
          <div className="modal-section">
            <label className="field-label">Download directory</label>
            <div className="field-row">
              <input type="text" defaultValue="/mnt/media/downloads" />
              <button type="button" disabled>
                Change
              </button>
            </div>
          </div>
          <div className="modal-section">
            <label className="field-label">Shared directories</label>
            <div className="field-row">
              <input type="text" placeholder="/mnt/media/music" />
              <button type="button" disabled>
                Add
              </button>
            </div>
            <div className="modal-list">
              <div className="modal-list-item">
                /mnt/media/music
                <button type="button" className="ghost-button" disabled>
                  Remove
                </button>
              </div>
              <div className="modal-list-item">
                /mnt/media/ambient
                <button type="button" className="ghost-button" disabled>
                  Remove
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
