import { ReactNode } from "react";
import PlayerBar from "./PlayerBar";
import Sidebar from "./Sidebar";

interface AppLayoutProps {
  children: ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <div className="app-content">{children}</div>
        <PlayerBar />
      </div>
    </div>
  );
}
