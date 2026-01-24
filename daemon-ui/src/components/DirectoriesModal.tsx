import Modal from "./Modal";

interface DirectoriesModalProps {
  open: boolean;
  onClose: () => void;
  downloadDir?: string;
  sharedDirs?: string[];
}

export default function DirectoriesModal({
  open,
  onClose,
  downloadDir = "",
  sharedDirs = []
}: DirectoriesModalProps) {
  return (
    <Modal open={open} title="Directories" onClose={onClose}>
      <div className="modal-section">
        <label className="field-label">Download</label>
        <div className="field-row">
          <input type="text" value={downloadDir} readOnly disabled />
        </div>
      </div>
      <div className="modal-section">
        <label className="field-label">Shared</label>
        <div className="modal-list">
          {sharedDirs.length === 0 ? (
            <div className="modal-list-item muted">No shared folders configured.</div>
          ) : (
            sharedDirs.map((dir) => (
              <div key={dir} className="modal-list-item">
                <input type="text" value={dir} readOnly disabled />
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
