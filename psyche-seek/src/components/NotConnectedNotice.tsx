import { Link } from "react-router-dom";

export default function NotConnectedNotice() {
  return (
    <Link to="/settings" className="warning-link not-connected-notice">
      Not connected to Soulseek.
    </Link>
  );
}
