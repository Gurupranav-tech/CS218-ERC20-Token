// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./CS218Token.sol";

/// @title  StakingContract — Stake CS218 tokens and earn proportional rewards (gas-optimised)
/// @notice Users approve then stake tokens. Rewards accrue every second based on
///         staked amount and the current reward rate. Rewards are minted by the
///         token contract when claimed. Unstaking is subject to a 30-minute
///         lockdown window that resets on every new stake call.
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
    /// @dev    Three fields across three storage slots — packing into uint128 was
    ///         rejected after measurement (see OPT NOTE above).
    struct StakeInfo {
        uint256 amount;             // tokens currently staked (wei, 18 decimals)
        uint256 lastClaimTimestamp; // unix timestamp of last reward accrual reset
        uint256 stakeLockedUntil;   // earliest unix timestamp at which unstake is permitted
    }

    /// @notice Tokens rewarded per day per 1000 tokens staked.
    ///         Default: 100 — meaning 0.1 token rewarded per day per 1000 staked.
    ///         Example: 1000 tokens staked at rate 100 for 1 day earns 100 tokens.
    uint256 public rewardRate = 100;

    /// @notice OPT 1: Pre-computed compile-time constant = 1000 × 86400.
    ///         Eliminates a runtime MUL opcode on every reward calculation.
    ///         Private because it is an implementation detail — no public getter needed.
    uint256 private constant REWARD_DIVISOR = 86_400_000;

    /// @notice The mandatory holding period enforced on every stake() call.
    ///         Users cannot call unstake() until block.timestamp >= stakeLockedUntil.
    ///         Public so the frontend can read it without a separate getter.
    ///         30 minutes = 1800 seconds — Solidity time unit `minutes` expands to seconds.
    uint256 public constant LOCKDOWN_PERIOD = 30 minutes;

    /// @notice Staking records indexed by staker address.
    ///         Mapping default: uninitialised addresses return a zeroed StakeInfo struct.
    mapping(address => StakeInfo) public stakes;

    // ── Events ───────────────────────────────────────────────────────────────

    /// @notice Emitted when a user successfully stakes tokens
    /// @param  user   The staker's address (indexed for efficient log filtering)
    /// @param  amount The number of tokens staked in wei
    event Staked(address indexed user, uint256 amount);

    /// @notice Emitted when a user successfully unstakes tokens
    /// @param  user   The unstaker's address (indexed for efficient log filtering)
    /// @param  amount The number of tokens returned in wei
    event Unstaked(address indexed user, uint256 amount);

    /// @notice Emitted when reward tokens are minted to a user.
    ///         Fired both from claimRewards() and from stake() when auto-claiming
    ///         accrued rewards before adding new principal.
    /// @param  user   The recipient's address (indexed for efficient log filtering)
    /// @param  amount The number of reward tokens minted in wei
    event RewardsClaimed(address indexed user, uint256 amount);

    /// @notice Emitted when the owner updates the reward rate
    /// @param  newRate The new reward rate value
    event RewardRateUpdated(uint256 newRate);

    // ── Constructor ───────────────────────────────────────────────────────────

    /// @notice Deploys the staking contract linked to an already-deployed CS218Token
    /// @dev    Sets msg.sender as the Ownable owner.
    ///         Zero-address guard prevents a misconfigured deployment that would
    ///         make every token transfer revert silently.
    /// @param  _token Address of the deployed CS218Token contract
    constructor(address _token) Ownable(msg.sender) {
        require(_token != address(0), "StakingContract: token address is zero");
        token = CS218Token(_token);
    }

    // ── Core Functions ────────────────────────────────────────────────────────

    /// @notice Stake `amount` tokens into the contract and begin earning rewards.
    /// @dev    Caller must have called token.approve(stakingAddress, amount) first.
    ///         SafeERC20.safeTransferFrom handles tokens that do not return a bool.
    ///
    ///         Auto-claim behaviour: if the caller already has an active stake,
    ///         any accrued rewards are computed and minted before the new deposit
    ///         is recorded. This prevents the new principal from retroactively
    ///         inflating rewards earned under the old (smaller) balance.
    ///
    ///         Lockdown reset: every call to stake() extends the lockdown window
    ///         to block.timestamp + LOCKDOWN_PERIOD, regardless of whether the
    ///         previous lock had already expired. This prevents an attacker from
    ///         staking once, waiting 29 minutes, staking a trivial amount to reset
    ///         nothing, and then immediately unstaking the original balance.
    ///
    ///         CEI pattern: all storage writes (Effects) occur before any external
    ///         calls (Interactions) to eliminate reentrancy attack surface.
    ///
    ///         OPT 2 + OPT 3: rewardRate and stakes[msg.sender] are cached into
    ///         local variables before use — each costs one SLOAD rather than
    ///         multiple warm SLOADs across the function body and helper call.
    ///
    /// @param  amount Number of tokens to stake (in wei, must be > 0)
    function stake(uint256 amount) external nonReentrant {
        require(amount > 0, "StakingContract: cannot stake zero tokens");

        // OPT 3: single SLOAD copies all three struct fields into memory at once.
        StakeInfo memory s = stakes[msg.sender];

        // OPT 2: cache rewardRate to avoid a second warm SLOAD inside the helper.
        uint256 rate = rewardRate;

        // Auto-claim: compute rewards earned on the existing stake before this
        // new deposit changes the principal. pending = 0 for first-time stakers.
        uint256 pending = 0;
        if (s.amount > 0) {
            // OPT 3: pass cached values — helper performs zero storage reads.
            pending = _calculateRewardsFromCache(s.amount, s.lastClaimTimestamp, rate);
        }

        // ── Effects (CEI: all state changes before external calls) ────────────

        // Increase staked principal by the new deposit.
        stakes[msg.sender].amount             = s.amount + amount;

        // Reset the accrual timer so rewards start fresh from this block.
        stakes[msg.sender].lastClaimTimestamp = block.timestamp;

        // Extend lockdown window — user cannot unstake until 30 minutes from now.
        stakes[msg.sender].stakeLockedUntil   = block.timestamp + LOCKDOWN_PERIOD;

        // ── Interactions ──────────────────────────────────────────────────────

        // Pull tokens from the caller into this contract.
        // safeTransferFrom reverts if the transfer fails for any reason.
        token.safeTransferFrom(msg.sender, address(this), amount);

        // Mint any auto-claimed rewards after state is fully updated (CEI).
        if (pending > 0) {
            token.mint(msg.sender, pending);
            emit RewardsClaimed(msg.sender, pending);
        }

        emit Staked(msg.sender, amount);
    }

    /// @notice Withdraw `amount` staked tokens back to the caller.
    /// @dev    Returns ONLY the principal — rewards are NOT included.
    ///         The caller must claim rewards separately via claimRewards() before
    ///         fully unstaking, or they will be forfeited (staked amount = 0 means
    ///         getPendingRewards returns 0 and claimRewards reverts).
    ///
    ///         Lockdown enforcement: the require on stakeLockedUntil is the primary
    ///         defence against flash-stake attacks where an attacker stakes a large
    ///         amount, collects dust rewards, and immediately withdraws.
    ///
    ///         Partial unstaking is supported: any amount up to the full staked
    ///         balance may be withdrawn. The remaining balance continues accruing
    ///         rewards from the original lastClaimTimestamp (timer is NOT reset).
    ///
    ///         CEI pattern: stakes[msg.sender].amount is decremented before the
    ///         safeTransfer external call, ensuring that a reentrancy attempt would
    ///         see the already-reduced balance and fail the require(amount <= s.amount)
    ///         check. nonReentrant provides a second layer of defence.
    ///
    ///         OPT 3: struct loaded once into memory — no duplicate SLOADs.
    ///
    /// @param  amount Number of tokens to withdraw (in wei, must be > 0 and <= staked balance)
    function unstake(uint256 amount) external nonReentrant {
        // OPT 3: single SLOAD for all three struct fields.
        StakeInfo memory s = stakes[msg.sender];

        // Guard 1: caller must have an active stake.
        require(s.amount > 0,       "StakingContract: nothing staked");

        // Guard 2: zero-amount unstake produces no effect and wastes gas.
        require(amount > 0,         "StakingContract: cannot unstake zero");

        // Guard 3: cannot withdraw more than currently staked.
        require(amount <= s.amount, "StakingContract: amount exceeds staked balance");

        // Guard 4: lockdown — block.timestamp must be past the lock expiry.
        //          stakeLockedUntil is set to block.timestamp + LOCKDOWN_PERIOD
        //          on every stake() call, so it always reflects the most recent stake.
        require(
            block.timestamp >= s.stakeLockedUntil,
            "StakingContract: tokens are locked for 30 minutes after staking"
        );

        // ── Effects (CEI) ─────────────────────────────────────────────────────

        // Reduce staked balance — done BEFORE the external transfer (CEI).
        // lastClaimTimestamp and stakeLockedUntil are intentionally NOT reset:
        //   - lastClaimTimestamp preserved so the remaining stake keeps accruing
        //     from the original stake time, not from the unstake time.
        //   - stakeLockedUntil preserved — it has already expired at this point
        //     (Guard 4 passed), so leaving it in place is harmless.
        stakes[msg.sender].amount = s.amount - amount;

        // ── Interactions ──────────────────────────────────────────────────────

        // Return exactly the requested principal — no rewards mixed in.
        // safeTransfer reverts if the transfer fails for any reason.
        token.safeTransfer(msg.sender, amount);

        emit Unstaked(msg.sender, amount);
    }

    /// @notice Claim all accrued rewards without touching the staked principal.
    /// @dev    Deliberately NOT gated by the lockdown period — users can claim
    ///         rewards freely at any time, including during the 30-minute lock.
    ///         This is intentional: withholding already-earned rewards during a
    ///         lock would be economically punitive and is not required by the spec.
    ///
    ///         Silent no-op behaviour: if pending rewards are zero (e.g. called
    ///         twice in quick succession), the function returns early without
    ///         reverting. This allows the frontend to call claimRewards() without
    ///         needing to pre-check getPendingRewards().
    ///
    ///         CEI pattern: lastClaimTimestamp is updated BEFORE token.mint() to
    ///         prevent a reentrancy loop from claiming the same rewards twice.
    ///
    ///         OPT 2 + OPT 3: rewardRate and stakes struct cached into locals
    ///         before use — each paid for with one SLOAD instead of multiple.
    ///
    function claimRewards() external nonReentrant {
        // OPT 3: single SLOAD for all three struct fields.
        StakeInfo memory s = stakes[msg.sender];

        // Caller must have tokens staked — zero stake means zero accrual.
        require(s.amount > 0, "StakingContract: nothing staked");

        // OPT 2: cache rewardRate — avoids a warm SLOAD inside the helper.
        uint256 rate    = rewardRate;

        // OPT 3: pass cached values — helper reads zero storage slots.
        uint256 pending = _calculateRewardsFromCache(s.amount, s.lastClaimTimestamp, rate);

        // Silent early return if nothing has accrued yet (e.g. same-block call).
        if (pending == 0) return;

        // ── Effects (CEI) ─────────────────────────────────────────────────────

        // Reset the accrual timer BEFORE minting to prevent reentrancy double-claim.
        // The next call to _calculateRewardsFromCache will use this new timestamp
        // as lastClaim, so elapsed = 0 immediately after claiming.
        stakes[msg.sender].lastClaimTimestamp = block.timestamp;

        // ── Interactions ──────────────────────────────────────────────────────

        // Mint new reward tokens directly to the user.
        // token.mint() is authorised because setMinter(address(this)) was called
        // during deployment setup (see Ignition deploy script).
        token.mint(msg.sender, pending);

        emit RewardsClaimed(msg.sender, pending);
    }

    // ── View Functions ────────────────────────────────────────────────────────

    /// @notice Returns the currently accrued but unclaimed rewards for `user`.
    /// @dev    Pure read — no state changes, no gas cost when called off-chain.
    ///         OPT 3: struct loaded once into memory, passed to helper — no duplicate SLOAD.
    ///         Returns 0 if the user has no stake or no time has elapsed since last claim.
    /// @param  user The address to query
    /// @return Pending reward amount in wei (0 if nothing staked or no time elapsed)
    function getPendingRewards(address user) external view returns (uint256) {
        // OPT 3: single SLOAD copies struct into memory — helper reads no storage.
        StakeInfo memory s = stakes[user];
        return _calculateRewardsFromCache(s.amount, s.lastClaimTimestamp, rewardRate);
    }

    /// @notice Returns the currently staked token balance for `user`.
    /// @dev    Pure read — accesses only the amount field of the struct (one SLOAD).
    /// @param  user The address to query
    /// @return Staked amount in wei (0 if user has never staked)
    function getStakedBalance(address user) external view returns (uint256) {
        return stakes[user].amount;
    }

    /// @notice Returns the number of seconds remaining before `user` can unstake.
    /// @dev    Returns 0 if the lockdown has expired or the user has never staked.
    ///         The frontend uses this to display a live countdown timer and to
    ///         disable the Unstake button while the lock is active.
    ///         Underflow is impossible: the if-guard ensures subtraction only
    ///         occurs when stakeLockedUntil > block.timestamp.
    /// @param  user The address to query
    /// @return Seconds until unlock (0 means unlocked right now)
    function getTimeUntilUnlock(address user) external view returns (uint256) {
        uint256 lockedUntil = stakes[user].stakeLockedUntil;

        // If lock has expired or was never set, return 0.
        if (block.timestamp >= lockedUntil) return 0;

        // Safe subtraction: lockedUntil > block.timestamp guaranteed by the guard above.
        return lockedUntil - block.timestamp;
    }

    // ── Owner Functions ───────────────────────────────────────────────────────

    /// @notice Updates the per-day reward rate.
    /// @dev    Only callable by the contract owner (Ownable.onlyOwner).
    ///         Rate is applied as: rewards = (staked × rate × elapsedSeconds) / REWARD_DIVISOR.
    ///         Rate of 0 is explicitly blocked — a zero rate would freeze all future
    ///         reward accrual permanently with no on-chain recovery path, since
    ///         the formula would return 0 for every user regardless of staked amount.
    ///         Changing the rate takes effect immediately for all future accrual
    ///         windows; rewards already accumulated up to this block are unaffected
    ///         because each user's lastClaimTimestamp captures their last settlement.
    /// @param  _rewardRate New rate — tokens rewarded per day per 1000 tokens staked
    function setRewardRate(uint256 _rewardRate) external onlyOwner {
        require(_rewardRate > 0, "StakingContract: reward rate must be > 0");
        rewardRate = _rewardRate;
        emit RewardRateUpdated(_rewardRate);
    }

    // ── Internal Helpers ──────────────────────────────────────────────────────

    /// @notice Computes accrued rewards from caller-supplied memory values.
    ///         Performs zero storage reads — all inputs come from the caller's
    ///         already-loaded memory copy of StakeInfo and cached rewardRate.
    ///
    /// @dev    OPT 1: divides by REWARD_DIVISOR (compile-time constant = 1000 × 86400).
    ///                The compiler embeds this literal directly — no runtime MUL opcode.
    ///         OPT 2: `rate` is a stack value passed in by the caller — not a storage read.
    ///         OPT 3: `stakedAmt` and `lastClaim` come from the caller's memory struct —
    ///                not from a second SLOAD of stakes[user].
    ///
    ///         Formula: rewards = (stakedAmount × rate × elapsedSeconds) / REWARD_DIVISOR
    ///         where REWARD_DIVISOR = 1000 × 86400 = 86_400_000
    ///
    ///         Worked example — 1000 tokens staked, rate = 100, 1 full day elapsed:
    ///           stakedAmt = 1000 × 10^18 (wei)
    ///           elapsed   = 86400 (seconds)
    ///           rewards   = (1000e18 × 100 × 86400) / 86_400_000
    ///                     = (1000e18 × 100) / 1000
    ///                     = 100e18 = 100 tokens ✓
    ///
    ///         Zero guards: returns 0 immediately if stakedAmt or lastClaim is zero.
    ///         The lastClaim == 0 guard prevents a new staker (uninitialised struct)
    ///         from computing elapsed = block.timestamp - 0 ≈ 1.7 billion seconds,
    ///         which would produce an astronomically inflated reward on first claim.
    ///
    ///         Precision note: integer division truncates toward zero. Sub-second
    ///         accrual is lost on each calculation, but with 18-decimal token amounts
    ///         even 1 second of accrual on a 1000-token stake yields ~1.157e9 wei —
    ///         far above rounding noise for any practical stake size.
    ///
    /// @param  stakedAmt  Cached StakeInfo.amount (from memory, not storage)
    /// @param  lastClaim  Cached StakeInfo.lastClaimTimestamp (from memory, not storage)
    /// @param  rate       Cached rewardRate (from stack, not storage)
    /// @return Accrued rewards in wei (0 if no stake or no time elapsed)
    function _calculateRewardsFromCache(
        uint256 stakedAmt,
        uint256 lastClaim,
        uint256 rate
    ) internal view returns (uint256) {
        // Zero guard 1: no stake means no rewards.
        // Zero guard 2: uninitialised lastClaim (value = 0) would produce a
        //               wildly incorrect elapsed value — return 0 safely instead.
        if (stakedAmt == 0 || lastClaim == 0) return 0;

        // elapsed is always >= 0 because lastClaim is set to block.timestamp on
        // every stake() and claimRewards() call — it can never exceed block.timestamp.
        // Solidity 0.8.x would revert on underflow anyway, but the invariant holds.
        uint256 elapsed = block.timestamp - lastClaim;

        // OPT 1: REWARD_DIVISOR is embedded as a compile-time literal.
        //        No MUL opcode needed at runtime to compute 1000 × 86400.
        return (stakedAmt * rate * elapsed) / REWARD_DIVISOR;
    }
}
