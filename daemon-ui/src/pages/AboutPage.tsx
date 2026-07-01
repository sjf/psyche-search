import { Info } from "lucide-react";

export default function AboutPage() {
  return (
    <div className="page">
      <header className="page-header">
        <div className="page-title-row">
          <span className="page-icon">
            <Info size={20} strokeWidth={1.7} />
          </span>
          <div>
            <h1>About</h1>
            <p className="page-subtitle">PsycheSeek is a Soulseek client you run from a browser.</p>
          </div>
        </div>
      </header>

      <div className="panel">
        <p>
          It gives you remote access to your media collection and lets you download Soulseek files
          straight to your home media server. It provides a web UI when a desktop environment isn’t
          available.
        </p>
      </div>
    </div>
  );
}
