import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ethers } from "ethers";
import { useWallet } from "../contexts/WalletContext";
import { formatTokenAmount } from "../lib/utils";
import { executeTransaction, } from "../lib/executeTransaction";
import type { TxState } from "../lib/executeTransaction";
import TxStatusBadge from "../components/TxStatusBadge";
import { ADDRESSES } from "../constants/contract";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Stats {
  walletBalance: bigint;
  stakedBalance: bigint;
  pendingRewards: bigint;
  rewardRate: bigint;
  lockSeconds: bigint;
}

const IDLE: TxState = { status: "idle" };

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatLock(seconds: bigint): string {
  if (seconds <= 0n) return "Unlocked";
  const m = seconds / 60n;
  const s = seconds % 60n;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

// ── Unstake Warning Dialog ─────────────────────────────────────────────────────

interface UnstakeDialogProps {
  amount: string;
  pendingRewards: bigint;
  stakedBalance: bigint;
  onConfirm: () => void;
  onCancel: () => void;
}

function UnstakeDialog({
  amount,
  pendingRewards,
  stakedBalance,
  onConfirm,
  onCancel,
}: UnstakeDialogProps) {
  let parsedAmount = 0n;
  try {
    parsedAmount = ethers.parseEther(amount || "0");
  } catch {
    parsedAmount = 0n;
  }
  const isFullUnstake = parsedAmount === stakedBalance && stakedBalance > 0n;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: "1.5rem",
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: "#1a1a1a",
          border: "1px solid #2a2a2a",
          borderRadius: "6px",
          padding: "1.75rem",
          width: "100%",
          maxWidth: "400px",
        }}
        className="fade-in"
      >
        {/* Header */}
        <div style={{ marginBottom: "1.25rem" }}>
          <p
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: "0.7rem",
              color: "#6b6b6b",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              marginBottom: "0.5rem",
            }}
          >
            Confirm Unstake
          </p>
          <h3 style={{ fontSize: "1rem", fontWeight: 500, color: "#f0f0f0", margin: 0 }}>
            {isFullUnstake ? "Full unstake" : "Partial unstake"}
          </h3>
        </div>

        <div style={{ borderTop: "1px solid #2a2a2a", marginBottom: "1.25rem" }} />

        {/* Amount row */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: "0.75rem",
          }}
        >
          <span style={{ fontSize: "0.8rem", color: "#6b6b6b" }}>You will receive</span>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.9rem", color: "#f0f0f0" }}>
            {amount} C218
          </span>
        </div>

        {/* Pending rewards row */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: "1.25rem",
          }}
        >
          <span style={{ fontSize: "0.8rem", color: "#6b6b6b" }}>Unclaimed rewards</span>
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: "0.9rem",
              color: pendingRewards > 0n ? "#e2e8f0" : "#6b6b6b",
            }}
          >
            {formatTokenAmount(pendingRewards)} C218
          </span>
        </div>

        {/* Warning box */}
        {pendingRewards > 0n && (
          <div
            style={{
              backgroundColor: "#0f0f0f",
              border: `1px solid ${isFullUnstake ? "#3a2a2a" : "#2a2a2a"}`,
              borderRadius: "6px",
              padding: "0.875rem",
              marginBottom: "1.25rem",
            }}
          >
            {isFullUnstake ? (
              <>
                <p style={{ fontSize: "0.78rem", color: "#ef4444", fontWeight: 500, marginBottom: "0.35rem" }}>
                  ⚠ Unclaimed rewards will be lost
                </p>
                <p style={{ fontSize: "0.75rem", color: "#6b6b6b", lineHeight: 1.6, margin: 0 }}>
                  You are fully unstaking. Your{" "}
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: "#f0f0f0" }}>
                    {formatTokenAmount(pendingRewards)} C218
                  </span>{" "}
                  in pending rewards will be forfeited.{" "}
                  <strong style={{ color: "#f0f0f0" }}>
                    Claim your rewards first before fully unstaking.
                  </strong>
                </p>
              </>
            ) : (
              <>
                <p style={{ fontSize: "0.78rem", color: "#e2e8f0", fontWeight: 500, marginBottom: "0.35rem" }}>
                  ℹ Rewards not included in unstake
                </p>
                <p style={{ fontSize: "0.75rem", color: "#6b6b6b", lineHeight: 1.6, margin: 0 }}>
                  You have{" "}
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: "#f0f0f0" }}>
                    {formatTokenAmount(pendingRewards)} C218
                  </span>{" "}
                  in pending rewards. Your remaining stake will keep accruing.
                  Claim separately using the Claim Rewards button.
                </p>
              </>
            )}
          </div>
        )}

        <div style={{ borderTop: "1px solid #2a2a2a", marginBottom: "1.25rem" }} />

        {/* Actions */}
        <div style={{ display: "flex", gap: "0.625rem" }}>
          <button onClick={onCancel} className="btn-ghost" style={{ flex: 1, padding: "0.625rem" }}>
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="btn-primary"
            style={{
              flex: 1,
              padding: "0.625rem",
              backgroundColor: isFullUnstake && pendingRewards > 0n ? "#ef4444" : "#f0f0f0",
              color: "#0f0f0f",
            }}
          >
            {isFullUnstake && pendingRewards > 0n ? "Unstake Anyway" : "Confirm Unstake"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Lockdown Banner ───────────────────────────────────────────────────────────

function LockdownBanner({ lockSeconds }: { lockSeconds: bigint }) {
  const [display, setDisplay] = useState(formatLock(lockSeconds));

  // Count down locally every second for a live timer feel
  useEffect(() => {
    if (lockSeconds <= 0n) {
      setDisplay("Unlocked");
      return;
    }
    setDisplay(formatLock(lockSeconds));
    let remaining = Number(lockSeconds);
    const interval = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        setDisplay("Unlocked");
        clearInterval(interval);
      } else {
        const m = Math.floor(remaining / 60);
        const s = remaining % 60;
        setDisplay(
          `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
        );
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [lockSeconds]);

  if (lockSeconds <= 0n) return null;

  return (
    <div
      style={{
        backgroundColor: "#0f0f0f",
        border: "1px solid #2a2a2a",
        borderRadius: "6px",
        padding: "0.75rem 1rem",
        marginBottom: "1rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
        <span style={{ fontSize: "0.8rem", color: "#6b6b6b" }}>
          🔒 Unstaking locked
        </span>
        <span style={{ fontSize: "0.75rem", color: "#6b6b6b" }}>
          — tokens are locked for 30 minutes after each stake
        </span>
      </div>
      <span
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: "0.85rem",
          color: "#f0f0f0",
          minWidth: "3.5rem",
          textAlign: "right",
        }}
      >
        {display}
      </span>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { address, tokenContract, stakingContract } = useWallet();
  const navigate = useNavigate();

  const [stats, setStats] = useState<Stats>({
    walletBalance: 0n,
    stakedBalance: 0n,
    pendingRewards: 0n,
    rewardRate: 0n,
    lockSeconds: 0n,
  });
  const [loading, setLoading] = useState(true);
  const [stakeAmount, setStakeAmount] = useState("");
  const [showUnstakeDialog, setShowUnstakeDialog] = useState(false);

  const [stakeTx, setStakeTx] = useState<TxState>(IDLE);
  const [unstakeTx, setUnstakeTx] = useState<TxState>(IDLE);
  const [claimTx, setClaimTx] = useState<TxState>(IDLE);

  useEffect(() => {
    if (!address) navigate("/");
  }, [address, navigate]);

  const fetchStats = useCallback(async () => {
    if (!tokenContract || !stakingContract || !address) return;
    try {
      const [wallet, staked, rewards, rate, lock] = await Promise.all([
        tokenContract.balanceOf(address),
        stakingContract.getStakedBalance(address),
        stakingContract.getPendingRewards(address),
        stakingContract.rewardRate(),
        stakingContract.getTimeUntilUnlock(address),
      ]);
      setStats({
        walletBalance: wallet,
        stakedBalance: staked,
        pendingRewards: rewards,
        rewardRate: rate,
        lockSeconds: lock,
      });
    } catch {
      // contracts not yet reachable
    } finally {
      setLoading(false);
    }
  }, [tokenContract, stakingContract, address]);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30_000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  // ── Handlers ────────────────────────────────────────────────────────────────

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

  function handleUnstakeClick() {
    if (!stakeAmount || stats.stakedBalance === 0n || stats.lockSeconds > 0n) return;
    setShowUnstakeDialog(true);
  }

  async function handleUnstakeConfirmed() {
    setShowUnstakeDialog(false);
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

  // ── Derived UI state ─────────────────────────────────────────────────────────

  const isLocked = stats.lockSeconds > 0n;
  const canUnstake = !!stakeAmount && stats.stakedBalance > 0n && !isLocked && unstakeTx.status !== "pending";
  const canClaim = stats.pendingRewards > 0n && claimTx.status !== "pending";

  const statItems = [
    {
      label: "Wallet Balance",
      value: formatTokenAmount(stats.walletBalance),
      unit: "C218",
    },
    {
      label: "Staked Balance",
      value: formatTokenAmount(stats.stakedBalance),
      unit: "C218",
    },
    {
      label: "Pending Rewards",
      value: formatTokenAmount(stats.pendingRewards),
      unit: "C218",
    },
    {
      label: "Reward Rate",
      value: stats.rewardRate.toString(),
      unit: "/ 1000 / day",
    },
  ];

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      {showUnstakeDialog && (
        <UnstakeDialog
          amount={stakeAmount}
          pendingRewards={stats.pendingRewards}
          stakedBalance={stats.stakedBalance}
          onConfirm={handleUnstakeConfirmed}
          onCancel={() => setShowUnstakeDialog(false)}
        />
      )}

      <div className="min-h-screen">
        <div className="max-w-3xl mx-auto px-6 py-10">

          {/* Stats Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px border border-[#2a2a2a] rounded overflow-hidden mb-6">
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

          {/* Lockdown Banner — only shown when locked */}
          <LockdownBanner lockSeconds={stats.lockSeconds} />

          <div className="grid md:grid-cols-2 gap-4">

            {/* ── Stake / Unstake Card ── */}
            <div
              className={`card ${stakeTx.status === "pending" || unstakeTx.status === "pending"
                ? "tx-pending"
                : ""
                }`}
            >
              <h2 className="text-sm font-medium text-[#f0f0f0] mb-1">
                Stake / Unstake
              </h2>
              <p className="text-xs text-[#6b6b6b] mb-5">
                Tokens are locked for 30 minutes after each stake.
                Partial unstaking supported.
              </p>

              <div className="space-y-3">
                {/* Amount input */}
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

                {/* Action buttons */}
                <div className="flex gap-2">
                  <button
                    onClick={handleStake}
                    disabled={!stakeAmount || stakeTx.status === "pending"}
                    className="btn-primary flex-1 py-2.5"
                  >
                    {stakeTx.status === "pending" ? "Staking..." : "Stake"}
                  </button>

                  <button
                    onClick={handleUnstakeClick}
                    disabled={!canUnstake}
                    className="btn-ghost flex-1 py-2.5"
                    title={
                      isLocked
                        ? `Locked — ${formatLock(stats.lockSeconds)} remaining`
                        : ""
                    }
                  >
                    {unstakeTx.status === "pending"
                      ? "Unstaking..."
                      : isLocked
                        ? `🔒 ${formatLock(stats.lockSeconds)}`
                        : "Unstake"}
                  </button>
                </div>

                {/* Staked balance hint */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <p className="text-xs text-[#6b6b6b]">
                    Staked:{" "}
                    <span className="mono text-[#f0f0f0]">
                      {formatTokenAmount(stats.stakedBalance)} C218
                    </span>
                  </p>
                  {isLocked && (
                    <p className="text-xs text-[#6b6b6b]">
                      Unlocks in{" "}
                      <span className="mono text-[#f0f0f0]">
                        {formatLock(stats.lockSeconds)}
                      </span>
                    </p>
                  )}
                </div>
              </div>

              <TxStatusBadge state={stakeTx} />
              <TxStatusBadge state={unstakeTx} />
            </div>

            {/* ── Claim Rewards Card ── */}
            <div
              className={`card flex flex-col justify-between ${claimTx.status === "pending" ? "tx-pending" : ""
                }`}
            >
              <div>
                <h2 className="text-sm font-medium text-[#f0f0f0] mb-1">Rewards</h2>
                <p className="text-xs text-[#6b6b6b] mb-6">
                  Claim without unstaking. Not affected by the lockdown period.
                  Resets the accrual timer.
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

                {/* Reward rate context */}
                <p className="text-xs text-[#6b6b6b]">
                  Rate:{" "}
                  <span className="mono text-[#f0f0f0]">
                    {stats.rewardRate.toString()}
                  </span>{" "}
                  tokens / 1000 staked / day
                </p>
              </div>

              <div style={{ marginTop: "1.25rem" }}>
                <button
                  onClick={handleClaim}
                  disabled={!canClaim}
                  className="btn-primary w-full py-2.5"
                >
                  {claimTx.status === "pending" ? "Claiming..." : "Claim Rewards"}
                </button>
                <TxStatusBadge state={claimTx} />
              </div>
            </div>

          </div>

          {/* Contract addresses */}
          <div
            style={{
              marginTop: "1.5rem",
              padding: "1rem",
              border: "1px solid #2a2a2a",
              borderRadius: "6px",
            }}
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem" }}>
              <div>
                <p
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: "0.7rem",
                    color: "#6b6b6b",
                    marginBottom: "0.25rem",
                  }}
                >
                  Token Contract
                </p>
                <p
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: "0.75rem",
                    color: "#f0f0f0",
                    wordBreak: "break-all",
                  }}
                >
                  {ADDRESSES.token}
                </p>
              </div>
              <div>
                <p
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: "0.7rem",
                    color: "#6b6b6b",
                    marginBottom: "0.25rem",
                  }}
                >
                  Staking Contract
                </p>
                <p
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: "0.75rem",
                    color: "#f0f0f0",
                    wordBreak: "break-all",
                  }}
                >
                  {ADDRESSES.staking}
                </p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
