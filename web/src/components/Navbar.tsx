import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useWallet } from "../contexts/WalletContext";
import { truncateAddress, copyToClipboard } from "../lib/utils";

export default function Navbar() {
  const { address, disconnect } = useWallet();
  const location = useLocation();
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (!address) return;
    copyToClipboard(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <nav className="border-b border-[#2a2a2a] px-6 py-4 flex items-center justify-between">
      <div className="flex items-center gap-8">
        <Link to="/dashboard" className="mono text-sm font-medium tracking-tight text-[#f0f0f0]">
          CS218 — Staking
        </Link>
        <div className="flex items-center gap-1">
          <Link
            to="/dashboard"
            className={`text-sm px-3 py-1.5 rounded transition-colors ${location.pathname === "/dashboard"
              ? "text-[#f0f0f0]"
              : "text-[#6b6b6b] hover:text-[#f0f0f0]"
              }`}
          >
            Dashboard
          </Link>
          <Link
            to="/admin"
            className={`text-sm px-3 py-1.5 rounded transition-colors ${location.pathname === "/admin"
              ? "text-[#f0f0f0]"
              : "text-[#6b6b6b] hover:text-[#f0f0f0]"
              }`}
          >
            Admin
          </Link>
        </div>
      </div>

      {address && (
        <div className="flex items-center gap-3">
          <button
            onClick={handleCopy}
            className="mono text-xs text-[#6b6b6b] hover:text-[#f0f0f0] transition-colors px-3 py-1.5 border border-[#2a2a2a] rounded"
          >
            {copied ? "Copied" : truncateAddress(address)}
          </button>
          <button onClick={disconnect} className="btn-ghost text-xs py-1.5">
            Disconnect
          </button>
        </div>
      )}
    </nav>
  );
}
