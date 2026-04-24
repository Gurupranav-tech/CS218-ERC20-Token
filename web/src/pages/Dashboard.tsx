import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ethers } from "ethers";
import { useWallet } from "../contexts/WalletContext";
import { formatTokenAmount } from "../lib/utils";
import {
  executeTransaction,
} from "../lib/executeTransaction";
import type { TxState } from "../lib/executeTransaction";
import TxStatusBadge from "../components/TxStatusBadge";
import { ADDRESSES } from "../constants/contract";

interface Stats {
  walletBalance: bigint;
  stakedBalance: bigint;
  pendingRewards: bigint;
  rewardRate: bigint;
}

const IDLE: TxState = { status: "idle" };

export default function Dashboard() {
  const { address, tokenContract, stakingContract } = useWallet();
  const navigate = useNavigate();

  const [stats, setStats] = useState<Stats>({
    walletBalance: 0n,
    stakedBalance: 0n,
    pendingRewards: 0n,
    rewardRate: 0n,
  });
  const [loading, setLoading] = useState(true);
  const [stakeAmount, setStakeAmount] = useState("");

  const [stakeTx, setStakeTx] = useState<TxState>(IDLE);
  const [unstakeTx, setUnstakeTx] = useState<TxState>(IDLE);
  const [claimTx, setClaimTx] = useState<TxState>(IDLE);

  useEffect(() => {
    if (!address) navigate("/");
  }, [address, navigate]);

  const fetchStats = useCallback(async () => {
    if (!tokenContract || !stakingContract || !address) return;
    try {
      const [wallet, staked, rewards, rate] = await Promise.all([
        tokenContract.balanceOf(address),
        stakingContract.getStakedBalance(address),
        stakingContract.getPendingRewards(address),
        stakingContract.rewardRate(),
      ]);
      setStats({
        walletBalance: wallet,
        stakedBalance: staked,
        pendingRewards: rewards,
        rewardRate: rate,
      });
    } catch {
      // Contract not yet deployed — stats stay at zero
    } finally {
      setLoading(false);
    }
  }, [tokenContract, stakingContract, address]);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30_000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  async function handleStake() {
    if (!stakingContract || !tokenContract || !stakeAmount) return;
    const amount = ethers.parseEther(stakeAmount);

    await executeTransaction(
      async () => {
        const allowance = await tokenContract.allowance(address, ADDRESSES.staking);
        if (allowance < amount) {
          const approveTx = await tokenContract.approve(ADDRESSES.staking, amount);
          setStakeTx({ status: "pending", hash: approveTx.hash });
          await approveTx.wait();
        }
        return stakingContract.stake(amount);
      },
      setStakeTx,
      () => {
        setStakeAmount("");
        fetchStats();
      }
    );
  }

  async function handleUnstake() {
    if (!stakingContract || !stakeAmount) return;
    const amount = ethers.parseEther(stakeAmount);
    await executeTransaction(
      () => stakingContract.unstake(amount),
      setUnstakeTx,
      () => {
        setStakeAmount("");
        fetchStats();
      }
    );
  }

  async function handleClaim() {
    if (!stakingContract) return;
    await executeTransaction(
      () => stakingContract.claimRewards(),
      setClaimTx,
      fetchStats
    );
  }

  function setMax() {
    setStakeAmount(ethers.formatEther(stats.walletBalance));
  }

  const statItems = [
    { label: "Wallet Balance", value: formatTokenAmount(stats.walletBalance), unit: "C218" },
    { label: "Staked Balance", value: formatTokenAmount(stats.stakedBalance), unit: "C218" },
    { label: "Pending Rewards", value: formatTokenAmount(stats.pendingRewards), unit: "C218" },
    { label: "Reward Rate", value: stats.rewardRate.toString(), unit: "/ 1000 / day" },
  ];

  return (
    <div className="min-h-screen">
      <div className="max-w-3xl mx-auto px-6 py-10">

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px border border-[#2a2a2a] rounded overflow-hidden mb-8">
          {statItems.map((item, i) => (
            <div key={i} className="bg-[#1a1a1a] p-4">
              <p className="text-xs text-[#6b6b6b] mb-2">{item.label}</p>
              {loading ? (
                <div className="h-7 w-24 bg-[#2a2a2a] rounded animate-pulse" />
              ) : (
                <div className="flex items-baseline gap-1.5">
                  <span className="stat-value text-xl">{item.value}</span>
                  <span className="text-xs text-[#6b6b6b] mono">{item.unit}</span>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="grid md:grid-cols-2 gap-4">

          {/* Stake / Unstake Card */}
          <div className={`card ${stakeTx.status === "pending" || unstakeTx.status === "pending" ? "tx-pending" : ""}`}>
            <h2 className="text-sm font-medium text-[#f0f0f0] mb-1">Stake / Unstake</h2>
            <p className="text-xs text-[#6b6b6b] mb-5">
              Partial unstaking is supported — remaining stake keeps accruing.
            </p>

            <div className="space-y-3">
              <div className="relative">
                <input
                  type="number"
                  placeholder="0.00"
                  value={stakeAmount}
                  onChange={(e) => setStakeAmount(e.target.value)}
                  className="input-field pr-14"
                  min="0"
                />
                <button
                  onClick={setMax}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#6b6b6b] hover:text-[#f0f0f0] transition-colors mono"
                >
                  MAX
                </button>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleStake}
                  disabled={!stakeAmount || stakeTx.status === "pending"}
                  className="btn-primary flex-1 py-2.5"
                >
                  {stakeTx.status === "pending" ? "Staking..." : "Stake"}
                </button>
                <button
                  onClick={handleUnstake}
                  disabled={!stakeAmount || stats.stakedBalance === 0n || unstakeTx.status === "pending"}
                  className="btn-ghost flex-1 py-2.5"
                >
                  {unstakeTx.status === "pending" ? "Unstaking..." : "Unstake"}
                </button>
              </div>

              <p className="text-xs text-[#6b6b6b]">
                Staked:{" "}
                <span className="mono text-[#f0f0f0]">
                  {formatTokenAmount(stats.stakedBalance)} C218
                </span>
              </p>
            </div>

            <TxStatusBadge state={stakeTx} />
            <TxStatusBadge state={unstakeTx} />
          </div>

          {/* Claim Rewards Card */}
          <div className={`card flex flex-col justify-between ${claimTx.status === "pending" ? "tx-pending" : ""}`}>
            <div>
              <h2 className="text-sm font-medium text-[#f0f0f0] mb-1">Rewards</h2>
              <p className="text-xs text-[#6b6b6b] mb-6">
                Accrued since last claim or stake. Resets timer on claim.
              </p>

              <div className="py-4 border-t border-b border-[#2a2a2a] mb-5">
                <p className="text-xs text-[#6b6b6b] mono mb-1">Claimable Now</p>
                {loading ? (
                  <div className="h-9 w-32 bg-[#2a2a2a] rounded animate-pulse" />
                ) : (
                  <div className="flex items-baseline gap-2">
                    <span className="stat-value text-3xl">
                      {formatTokenAmount(stats.pendingRewards)}
                    </span>
                    <span className="text-sm text-[#6b6b6b] mono">C218</span>
                  </div>
                )}
              </div>
            </div>

            <div>
              <button
                onClick={handleClaim}
                disabled={stats.pendingRewards === 0n || claimTx.status === "pending"}
                className="btn-primary w-full py-2.5"
              >
                {claimTx.status === "pending" ? "Claiming..." : "Claim Rewards"}
              </button>
              <TxStatusBadge state={claimTx} />
            </div>
          </div>

        </div>

        {/* Info footer */}
        <div className="mt-6 p-4 border border-[#2a2a2a] rounded">
          <div className="flex flex-wrap gap-6">
            <div>
              <p className="text-xs text-[#6b6b6b] mono mb-1">Token Contract</p>
              <p className="text-xs mono text-[#f0f0f0]">{ADDRESSES.token}</p>
            </div>
            <div>
              <p className="text-xs text-[#6b6b6b] mono mb-1">Staking Contract</p>
              <p className="text-xs mono text-[#f0f0f0]">{ADDRESSES.staking}</p>
            </div>
          </div>
        </div>

      </div>
    </div >
  );
}
