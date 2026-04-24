import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "../contexts/WalletContext";

export default function Home() {
  const { connect, isConnecting, address, error } = useWallet();
  const navigate = useNavigate();

  useEffect(() => {
    if (address) navigate("/dashboard");
  }, [address, navigate]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm fade-in">
        <div className="mb-12">
          <p className="mono text-xs text-[#6b6b6b] mb-4 tracking-widest uppercase">
            CS218 · ERC-20 Staking Protocol
          </p>
          <h1 className="text-3xl font-light tracking-tight text-[#f0f0f0] leading-tight">
            Stake tokens.<br />Earn rewards.
          </h1>
          <p className="mt-4 text-sm text-[#6b6b6b] leading-relaxed">
            A decentralised staking protocol built on Ethereum.
            Connect your wallet to get started.
          </p>
        </div>

        <div className="space-y-3">
          <button
            onClick={connect}
            disabled={isConnecting}
            className="btn-primary w-full py-3 text-sm"
          >
            {isConnecting ? "Connecting..." : "Connect Wallet"}
          </button>

          {error && (
            <p className="mono text-xs text-[#ef4444] fade-in">{error}</p>
          )}
        </div>

        <div className="mt-12 pt-8 border-t border-[#2a2a2a]">
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Token", value: "C218" },
              { label: "Network", value: "Sepolia" },
              { label: "Standard", value: "ERC-20" },
            ].map((item) => (
              <div key={item.label}>
                <p className="text-xs text-[#6b6b6b] mb-1">{item.label}</p>
                <p className="mono text-xs text-[#f0f0f0]">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
