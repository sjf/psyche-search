export default function UploadsPage() {
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Uploads</h1>
          <p className="page-subtitle">Recently active and in-progress uploads.</p>
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
