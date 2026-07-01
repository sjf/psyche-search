import { NavLink } from "react-router-dom";
import { Download, FolderTree, Info, MessageSquare, Search, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import StatusIndicator from "./StatusIndicator";

const navItems: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/search", label: "Search", icon: Search },
  { to: "/downloads", label: "Downloads", icon: Download },
  { to: "/files", label: "Files", icon: FolderTree },
  { to: "/chat", label: "Chat", icon: MessageSquare },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/about", label: "About", icon: Info }
];

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <img className="sidebar-logo" src="/logo-small.png" alt="Psyche Seek canary" />
        <div className="sidebar-brand">
          <span className="brand-name">PSEEK</span>
          <span className="brand-tag">Psyche Seek</span>
          <StatusIndicator />
        </div>
      </div>
      <nav className="sidebar-nav">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-link${isActive ? " nav-link-active" : ""}`}
            >
              <Icon size={17} strokeWidth={1.7} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
