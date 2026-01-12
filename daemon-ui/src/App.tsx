import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "./components/AppLayout";
import AboutPage from "./pages/AboutPage";
import ChatPage from "./pages/ChatPage";
import DownloadsPage from "./pages/DownloadsPage";
import FilesPage from "./pages/FilesPage";
import SearchPage from "./pages/SearchPage";
import SearchResultsPage from "./pages/SearchResultsPage";
import SettingsPage from "./pages/SettingsPage";
import UploadsPage from "./pages/UploadsPage";
import { FooterProvider } from "./state/footer";
import { PlayerProvider } from "./state/player";
import { ToastProvider } from "./state/toast";

export default function App() {
  return (
    <ToastProvider>
      <PlayerProvider>
        <FooterProvider>
          <BrowserRouter>
            <AppLayout>
              <Routes>
                <Route path="/" element={<Navigate to="/search" replace />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/search/:term" element={<SearchResultsPage />} />
                <Route path="/downloads" element={<DownloadsPage />} />
                <Route path="/files" element={<FilesPage />} />
                <Route path="/uploads" element={<UploadsPage />} />
                <Route path="/chat" element={<ChatPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/about" element={<AboutPage />} />
                <Route path="*" element={<Navigate to="/search" replace />} />
              </Routes>
            </AppLayout>
          </BrowserRouter>
        </FooterProvider>
      </PlayerProvider>
    </ToastProvider>
  );
}
