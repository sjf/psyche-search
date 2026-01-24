import { NavLink } from "react-router-dom";
import StatusIndicator from "./StatusIndicator";

const navItems = [
  { to: "/search", label: "Search" },
  { to: "/downloads", label: "Downloads" },
  { to: "/files", label: "Files" },
  { to: "/chat", label: "Chat" },
  { to: "/settings", label: "Settings" },
  { to: "/about", label: "About" }
];

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <img className="sidebar-logo" src="/nseek-bird.png" alt="Mseek logo" />
        <div className="sidebar-brand">
          <span className="brand-name">Mseek</span>
          <span className="brand-tag">control plane</span>
          <StatusIndicator />
        </div>
      </div>
      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `nav-link${isActive ? " nav-link-active" : ""}`}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
