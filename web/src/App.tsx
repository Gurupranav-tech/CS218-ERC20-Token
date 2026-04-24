import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { WalletProvider, useWallet } from "./contexts/WalletContext";
import Navbar from "./components/Navbar";
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import Admin from "./pages/Admin";

function Layout() {
  const { address } = useWallet();

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-[#f0f0f0]">
      {address && <Navbar />}
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

export default function App() {
  return (
    <WalletProvider>
      <BrowserRouter>
        <Layout />
      </BrowserRouter>
    </WalletProvider>
  );
}
