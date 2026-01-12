export default function AboutPage() {
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>About</h1>
          <p className="page-subtitle">Nseek is a control plane for Soulseek servers.</p>
        </div>
      </header>

      <div className="panel">
        <p>
          Nseek provides a modern interface for Nicotine+ running on headless servers. It focuses on
          search, downloads, library management, and playback while keeping your transfers running in
          the background.
        </p>
      </div>
    </div>
  );
}
