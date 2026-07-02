import { UploadCloud } from "lucide-react";

export default function UploadsPage() {
  return (
    <div className="page">
      <header className="page-header">
        <div className="page-title-row">
          <span className="page-icon">
            <UploadCloud size={20} strokeWidth={1.7} />
          </span>
          <div>
            <h1>Uploads</h1>
            <p className="page-subtitle">Recently active and in-progress uploads.</p>
          </div>
        </div>
      </header>

      <div className="panel">
        <div className="empty-state">
          Uploads are not exposed in the daemon API yet. This panel will populate once an uploads
          endpoint is available.
        </div>
      </div>
    </div>
  );
}
