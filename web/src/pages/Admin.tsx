import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "../contexts/WalletContext";
import { executeTransaction } from "../lib/executeTransaction";
import type { TxState } from "../lib/executeTransaction";
import TxStatusBadge from "../components/TxStatusBadge";

export default function Admin() {
  const { address, stakingContract, tokenContract } = useWallet();
  const navigate = useNavigate();

  const [ownerAddress, setOwnerAddress] = useState<string | null>(null);
  const [minterAddress, setMinterAddress] = useState<string | null>(null);
  const [currentRate, setCurrentRate] = useState<string>("—");
  const [newRate, setNewRate] = useState("");
  const [isOwner, setIsOwner] = useState<boolean | null>(null);
  const [rateTx, setRateTx] = useState<TxState>({ status: "idle" });

  useEffect(() => {
    if (!address) navigate("/");
  }, [address, navigate]);

  const fetchAdminData = useCallback(async () => {
    if (!stakingContract || !tokenContract || !address) return;
    try {
      const [owner, minter, rate] = await Promise.all([
        stakingContract.owner(),
        tokenContract.minter(),
        stakingContract.rewardRate(),
      ]);
      setOwnerAddress(owner);
      setMinterAddress(minter);
      setCurrentRate(rate.toString());
      setIsOwner(owner.toLowerCase() === address.toLowerCase());
    } catch {
      setIsOwner(false);
    }
  }, [stakingContract, tokenContract, address]);

  useEffect(() => {
    fetchAdminData();
  }, [fetchAdminData]);

  async function handleSetRate() {
    if (!stakingContract || !newRate) return;
    await executeTransaction(
      () => stakingContract.setRewardRate(BigInt(newRate)),
      setRateTx,
      () => {
        setNewRate("");
        fetchAdminData();
      }
    );
  }

  if (isOwner === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="mono text-xs text-[#6b6b6b]">Checking access...</p>
      </div>
    );
  }

  if (isOwner === false) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center fade-in">
          <p className="mono text-xs text-[#ef4444] mb-2">Access Denied</p>
          <p className="text-sm text-[#6b6b6b]">
            This page is restricted to the contract owner.
          </p>
          <p className="mono text-xs text-[#2a2a2a] mt-4">
            {ownerAddress ?? "—"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-xl mx-auto px-6 py-10 fade-in">

        <div className="mb-8">
          <p className="mono text-xs text-[#6b6b6b] mb-1 tracking-widest uppercase">Admin Panel</p>
          <h1 className="text-xl font-light text-[#f0f0f0]">Contract Controls</h1>
        </div>

        {/* Contract Info */}
        <div className="card mb-4">
          <h2 className="text-sm font-medium text-[#f0f0f0] mb-4">Contract State</h2>
          <div className="space-y-3">
            {[
              { label: "Owner Address", value: ownerAddress ?? "—" },
              { label: "Authorised Minter", value: minterAddress ?? "—" },
              { label: "Current Reward Rate", value: `${currentRate} / 1000 / day` },
            ].map((item) => (
              <div key={item.label} className="flex flex-col gap-1 py-3 border-b border-[#2a2a2a] last:border-0 last:pb-0">
                <p className="text-xs text-[#6b6b6b]">{item.label}</p>
                <p className="mono text-xs text-[#f0f0f0] break-all">{item.value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Set Reward Rate */}
        <div className={`card ${rateTx.status === "pending" ? "tx-pending" : ""}`}>
          <h2 className="text-sm font-medium text-[#f0f0f0] mb-1">Set Reward Rate</h2>
          <p className="text-xs text-[#6b6b6b] mb-5">
            Rate is applied as{" "}
            <span className="mono">(staked × rate × days) / 1000</span>.
            Current rate: <span className="mono text-[#f0f0f0]">{currentRate}</span>.
          </p>

          <div className="flex gap-2">
            <input
              type="number"
              placeholder="e.g. 100"
              value={newRate}
              onChange={(e) => setNewRate(e.target.value)}
              className="input-field"
              min="0"
            />
            <button
              onClick={handleSetRate}
              disabled={!newRate || rateTx.status === "pending"}
              className="btn-primary whitespace-nowrap px-5"
            >
              {rateTx.status === "pending" ? "Setting..." : "Set Rate"}
            </button>
          </div>

          <TxStatusBadge state={rateTx} />
        </div>

      </div>
    </div>
  );
}
