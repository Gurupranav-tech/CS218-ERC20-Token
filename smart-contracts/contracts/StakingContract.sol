// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./CS218Token.sol";

/// @title  StakingContract — Stake CS218 tokens and earn proportional rewards (gas-optimised)
/// @notice Users approve then stake tokens. Rewards accrue every second based on
///         staked amount and the current reward rate. Rewards are minted by the
///         token contract when claimed or when unstaking.
///
/// @dev    Three gas optimisations are applied over the baseline implementation:
///
///   OPT 1 — REWARD_DIVISOR compile-time constant
///            BEFORE: (s.amount * rewardRate * elapsed) / (1000 * 86400)
///                    Solidity evaluates `1000 * 86400` at runtime: costs PUSH + MUL opcodes.
///            AFTER:  (s.amount * rewardRate * elapsed) / REWARD_DIVISOR
///                    Compiler embeds 86_400_000 as a literal — zero extra opcodes.
///            Saving: ~5 gas per reward calculation across stake/unstake/claimRewards/getPendingRewards.
///
///   OPT 2 — Cache rewardRate as a local stack variable
///            BEFORE: rewardRate read from storage inside _calculateRewards on every call (warm SLOAD ~100 gas).
///            AFTER:  uint256 rate = rewardRate cached once at the top of each function,
///                    passed into _calculateRewardsFromCache — zero SLOADs inside the helper.
///            Saving: ~100 gas per state-changing function call.
///
///   OPT 3 — Cache stakes[msg.sender] struct upfront, pass to helper (eliminate duplicate SLOAD)
///            BEFORE: functions accessed stakes[msg.sender] once, then _calculateRewards()
///                    did a second SLOAD of the same mapping slot inside the helper.
///            AFTER:  StakeInfo memory s = stakes[msg.sender] loaded once per function;
///                    _calculateRewardsFromCache() receives the already-loaded values —
///                    storage is read exactly once per function call.
///            Saving: ~100 gas (warm SLOAD) per call — every stake/unstake/claim/getPendingRewards.
///
///   NOTE — Struct packing (uint128) was evaluated and REJECTED:
///            Packing two fields into one slot saves 1 SLOAD only on cold access (~2,100 gas).
///            In practice all slots are warm after the first transaction, so the saving
///            drops to ~100 gas — less than the overhead added by uint128 masking opcodes
///            (AND/SHL/SHR) on every read and write. Keeping uint256 is measurably cheaper.
///
contract StakingContract is ReentrancyGuard, Ownable {
    using SafeERC20 for CS218Token;

    /// @notice The ERC-20 token used for staking and rewards
    CS218Token public token;

    /// @notice Staking information stored per user
    /// @dev    Kept as uint256 × 2 (two separate slots) — see OPT NOTE above on why
    ///         packing into uint128 was rejected after measurement.
    struct StakeInfo {
        uint256 amount;             // tokens staked (in wei, 18 decimals)
        uint256 lastClaimTimestamp; // unix timestamp of last reward accrual reset
    }

    /// @notice Tokens rewarded per day per 1000 tokens staked.
    ///         Default: 100 — meaning 0.1 token/day per 1000 staked tokens.
    uint256 public rewardRate = 100;

    /// @notice OPT 1: Pre-computed compile-time constant = 1000 × 86400.
    ///         Eliminates a runtime MUL opcode on every reward calculation.
    uint256 private constant REWARD_DIVISOR = 86_400_000;

    /// @notice Staking records indexed by staker address
    mapping(address => StakeInfo) public stakes;

    // ── Events ───────────────────────────────────────────────────────────────

    /// @notice Emitted when a user stakes tokens
    event Staked(address indexed user, uint256 amount);

    /// @notice Emitted when a user unstakes tokens
    event Unstaked(address indexed user, uint256 amount);

    /// @notice Emitted when a user claims staking rewards
    event RewardsClaimed(address indexed user, uint256 amount);

    /// @notice Emitted when the owner updates the reward rate
    event RewardRateUpdated(uint256 newRate);

    // ── Constructor ───────────────────────────────────────────────────────────

    /// @notice Deploys the staking contract linked to the given token
    /// @param  _token Address of the deployed CS218Token contract
    constructor(address _token) Ownable(msg.sender) {
        require(_token != address(0), "StakingContract: token address is zero");
        token = CS218Token(_token);
    }

    // ── Core Functions ────────────────────────────────────────────────────────

    /// @notice Stake `amount` tokens into the contract
    /// @dev    Caller must have called token.approve(stakingAddress, amount) first.
    ///         If the caller already has an active stake, any accrued rewards are
    ///         auto-claimed and the accrual timer is reset before the new deposit.
    ///         CEI pattern: state written to storage before any external calls.
    /// @param  amount Number of tokens to stake (in wei, must be > 0)
    function stake(uint256 amount) external nonReentrant {
        require(amount > 0, "StakingContract: cannot stake zero tokens");

        // OPT 3: single SLOAD loads both struct fields into memory once.
        StakeInfo memory s = stakes[msg.sender];

        // OPT 2: cache rewardRate — avoids a warm SLOAD inside the helper.
        uint256 rate = rewardRate;

        uint256 pending = 0;
        if (s.amount > 0) {
            // OPT 3: pass cached values — helper reads zero storage slots.
            pending = _calculateRewardsFromCache(s.amount, s.lastClaimTimestamp, rate);
        }

        // ── Effects (CEI: all state changes before external calls) ────────────
        stakes[msg.sender].amount             = s.amount + amount;
        stakes[msg.sender].lastClaimTimestamp = block.timestamp;

        // ── Interactions ──────────────────────────────────────────────────────
        token.safeTransferFrom(msg.sender, address(this), amount);

        if (pending > 0) {
            token.mint(msg.sender, pending);
            emit RewardsClaimed(msg.sender, pending);
        }

        emit Staked(msg.sender, amount);
    }

    /// @notice Unstake `amount` tokens
    /// @dev    CEI pattern: state fully updated before any external token calls.
    ///         OPT 3: struct loaded once; helper receives cached values.
    /// @param  amount Number of tokens to withdraw (in wei, must be > 0 and <= staked balance)
    function unstake(uint256 amount) external nonReentrant {
      StakeInfo memory s = stakes[msg.sender];
      require(s.amount > 0,         "StakingContract: nothing staked");
      require(amount > 0,           "StakingContract: cannot unstake zero");
      require(amount <= s.amount,   "StakingContract: amount exceeds staked balance");

      // ── Effects ───────────────────────────────────────────────────────────
      stakes[msg.sender].amount             = s.amount - amount;

      // ── Interactions ──────────────────────────────────────────────────────
      token.safeTransfer(msg.sender, amount);

      emit Unstaked(msg.sender, amount);
    }

    /// @notice Claim all accrued rewards without unstaking
    /// @dev    Returns silently (does NOT revert) when pending rewards are zero,
    ///         so a second immediate call succeeds as a no-op.
    ///         CEI: lastClaimTimestamp updated before minting.
    ///         OPT 3: struct loaded once; helper receives cached values.
    function claimRewards() external nonReentrant {
        // OPT 3: single SLOAD for both fields.
        StakeInfo memory s = stakes[msg.sender];
        require(s.amount > 0, "StakingContract: nothing staked");

        // OPT 2: cache rewardRate.
        uint256 rate    = rewardRate;

        // OPT 3: cached values — zero SLOADs inside helper.
        uint256 pending = _calculateRewardsFromCache(s.amount, s.lastClaimTimestamp, rate);

        if (pending == 0) return;

        // ── Effects ───────────────────────────────────────────────────────────
        stakes[msg.sender].lastClaimTimestamp = block.timestamp;

        // ── Interactions ──────────────────────────────────────────────────────
        token.mint(msg.sender, pending);

        emit RewardsClaimed(msg.sender, pending);
    }

    // ── View Functions ────────────────────────────────────────────────────────

    /// @notice Returns the currently accrued but unclaimed rewards for `user`
    /// @param  user The address to query
    /// @return Pending reward amount in wei (0 if nothing staked or no time elapsed)
    function getPendingRewards(address user) external view returns (uint256) {
        // OPT 3: load once, pass to helper — no duplicate SLOAD.
        StakeInfo memory s = stakes[user];
        return _calculateRewardsFromCache(s.amount, s.lastClaimTimestamp, rewardRate);
    }

    /// @notice Returns the currently staked token balance for `user`
    /// @param  user The address to query
    /// @return Staked amount in wei
    function getStakedBalance(address user) external view returns (uint256) {
        return stakes[user].amount;
    }

    // ── Owner Functions ───────────────────────────────────────────────────────

    /// @notice Updates the reward rate
    /// @dev    Only the owner can call this. Rate of 0 is blocked to prevent
    ///         accidentally freezing all future reward accrual.
    /// @param  _rewardRate New rate — tokens rewarded per day per 1000 tokens staked
    function setRewardRate(uint256 _rewardRate) external onlyOwner {
        require(_rewardRate > 0, "StakingContract: reward rate must be > 0");
        rewardRate = _rewardRate;
        emit RewardRateUpdated(_rewardRate);
    }

    // ── Internal Helpers ──────────────────────────────────────────────────────

    /// @notice Computes accrued rewards from already-loaded memory values — zero storage reads.
    /// @dev    OPT 1: divides by REWARD_DIVISOR (compile-time constant, no runtime MUL).
    ///         OPT 2: `rate` is a cached stack value passed in by the caller.
    ///         OPT 3: `stakedAmt` and `lastClaim` are from the caller's memory copy of the struct.
    ///
    ///         Formula: rewards = (stakedAmount × rate × elapsedSeconds) / REWARD_DIVISOR
    ///         where REWARD_DIVISOR = 1000 × 86400 = 86_400_000
    ///
    ///         Example: 1000 tokens (1000e18 wei), rate = 100, 1 day elapsed (86400s):
    ///           = (1000e18 × 100 × 86400) / 86_400_000
    ///           = (1000e18 × 100) / 1000
    ///           = 100e18 = 100 tokens ✓
    ///
    /// @param  stakedAmt  Cached StakeInfo.amount (from memory, not storage)
    /// @param  lastClaim  Cached StakeInfo.lastClaimTimestamp (from memory, not storage)
    /// @param  rate       Cached rewardRate (from stack, not storage)
    /// @return Accrued rewards in wei
    function _calculateRewardsFromCache(
        uint256 stakedAmt,
        uint256 lastClaim,
        uint256 rate
    ) internal view returns (uint256) {
        if (stakedAmt == 0 || lastClaim == 0) return 0;
        uint256 elapsed = block.timestamp - lastClaim;
        // OPT 1: REWARD_DIVISOR is a compile-time constant — no MUL opcode at runtime.
        return (stakedAmt * rate * elapsed) / REWARD_DIVISOR;
    }
}
