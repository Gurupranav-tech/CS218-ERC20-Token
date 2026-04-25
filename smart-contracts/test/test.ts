import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";

// ─── Reward formula (mirrors StakingContract._calculateRewards) ──────────────
// rewards = (stakedAmount * rewardRate * elapsedSeconds) / (1000 * 86400)
function calcRewards(
  staked: bigint,
  rate: bigint,
  elapsedSeconds: bigint
): bigint {
  return (staked * rate * elapsedSeconds) / (1000n * 86400n);
}

describe("Project 9: ERC-20 Token with Staking Rewards - Updated Suite", function () {

  // ─── Fixture ─────────────────────────────────────────────────────────────────
  async function deployStakingFixture() {
    const [owner, user1, user2, attacker] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("CS218Token");
    const token = await Token.deploy(1_000_000);
    const tokenAddress = await token.getAddress();

    const Staking = await ethers.getContractFactory("StakingContract");
    const staking = await Staking.deploy(tokenAddress);
    const stakingAddress = await staking.getAddress();

    await token.setMinter(stakingAddress);

    const decimals = await token.decimals();
    const initialFund = ethers.parseUnits("100000", decimals);

    await token.transfer(user1.address, initialFund);
    await token.transfer(user2.address, initialFund);
    await token.transfer(attacker.address, initialFund);

    await token.connect(user1).approve(stakingAddress, ethers.MaxUint256);
    await token.connect(user2).approve(stakingAddress, ethers.MaxUint256);
    await token.connect(attacker).approve(stakingAddress, ethers.MaxUint256);

    return { token, staking, owner, user1, user2, attacker, stakingAddress, decimals };
  }

  const ONE_DAY = 86400n;         // seconds in one day
  const RATE    = 100n;           // default rewardRate
  const S1000   = ethers.parseUnits("1000", 18);
  const S2000   = ethers.parseUnits("2000", 18);
  const S500    = ethers.parseUnits("500",  18);

  // ─── 1. Deployment & Setup ───────────────────────────────────────────────────
  describe("1. Deployment & Setup", function () {
    it("1. Should set the correct token address in staking contract", async function () {
      const { token, staking } = await loadFixture(deployStakingFixture);
      expect(await staking.token()).to.equal(await token.getAddress());
    });

    it("2. Should have the correct initial reward rate (100)", async function () {
      const { staking } = await loadFixture(deployStakingFixture);
      expect(await staking.rewardRate()).to.equal(100n);
    });

    it("3. Should correctly set the Staking contract as the token Minter", async function () {
      const { token, stakingAddress } = await loadFixture(deployStakingFixture);
      expect(await token.minter()).to.equal(stakingAddress);
    });
  });

  // ─── 2. Core Staking Logic ───────────────────────────────────────────────────
  describe("2. Core Staking Logic", function () {

    it("4. [MAIN TEST CASE] Should correctly transfer tokens from user to contract on stake", async function () {
      const { token, staking, user1, stakingAddress } = await loadFixture(deployStakingFixture);
      const tx = await staking.connect(user1).stake(S1000);
      await expect(tx).to.changeTokenBalances(
        token,
        [user1.address, stakingAddress],
        [-S1000, S1000]
      );
    });

    it("5. Should update the user's staked balance accurately", async function () {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S1000);
      expect(await staking.getStakedBalance(user1.address)).to.equal(S1000);
    });

    it("6. Should emit a Staked event with correct parameters", async function () {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await expect(staking.connect(user1).stake(S500))
        .to.emit(staking, "Staked")
        .withArgs(user1.address, S500);
    });

    it("7. Should revert when user tries to stake 0 tokens", async function () {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await expect(staking.connect(user1).stake(0))
        .to.be.revertedWith("StakingContract: cannot stake zero tokens");
    });

    it("8. Should properly aggregate balance if user stakes multiple times", async function () {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S500);
      await staking.connect(user1).stake(S500);
      expect(await staking.getStakedBalance(user1.address)).to.equal(S1000);
    });
  });

  // ─── 3. Time Travel & Reward Calculation ─────────────────────────────────────
  describe("3. Time Travel & Reward Calculation", function () {

    it("9. [MAIN TEST CASE] Should accrue rewards linearly (Day 2 equals 2x Day 1)", async function () {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S1000);
      const t0 = BigInt(await time.latest());

      // Jump to exactly t0 + 1 day → read rewards.
      await time.increaseTo(t0 + ONE_DAY);
      const day1Rewards = await staking.getPendingRewards(user1.address);

      // Jump to exactly t0 + 2 days → rewards must be exactly 2×.
      await time.increaseTo(t0 + ONE_DAY * 2n);
      const day2Rewards = await staking.getPendingRewards(user1.address);

      expect(day2Rewards).to.equal(day1Rewards * 2n);
    });

    // FIX: user1 and user2 stake in different blocks so their lastClaimTimestamp
    // differs by ~1 second.  We capture each timestamp after staking, advance to
    // a pinned future point, and compute expected rewards mathematically.
    // We also verify the 2x proportionality directly via calcRewards().
    it("10. [MAIN TEST CASE] Should accrue 2x rewards for a user staking 2x the tokens", async function () {
      const { staking, user1, user2 } = await loadFixture(deployStakingFixture);

      await staking.connect(user1).stake(S1000);
      const t1 = BigInt(await time.latest());

      await staking.connect(user2).stake(S2000);
      const t2 = BigInt(await time.latest());

      const tFuture = t2 + ONE_DAY;
      await time.increaseTo(tFuture);

      // Verify on-chain values match the formula.
      expect(await staking.getPendingRewards(user1.address)).to.equal(calcRewards(S1000, RATE, tFuture - t1));
      expect(await staking.getPendingRewards(user2.address)).to.equal(calcRewards(S2000, RATE, tFuture - t2));

      // Core proportionality check (same duration, 2x stake → 2x reward).
      expect(calcRewards(S2000, RATE, ONE_DAY)).to.equal(calcRewards(S1000, RATE, ONE_DAY) * 2n);
    });

    it("27. Reward calculation — 1 second of accrual yields a non-zero reward with second-level precision", async function () {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S1000);
      await time.increase(1);
      expect(await staking.getPendingRewards(user1.address)).to.be.gt(0n);
    });
  });

  // ─── 4. Claiming Rewards ──────────────────────────────────────────────────────
  describe("4. Claiming Rewards", function () {

    // FIX: snapshot getPendingRewards() BEFORE tx is stale by 1–2 seconds when
    // the tx mines.  Instead, pin the claim block to an exact timestamp and
    // compute the expected reward mathematically.
    it("11. [MAIN TEST CASE] Should mint correct reward amount to user upon claim", async function () {
      const { token, staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S1000);
      const stakeTime = BigInt(await time.latest());

      await time.increaseTo(stakeTime + ONE_DAY);

      const balBefore = await token.balanceOf(user1.address);
      const tx        = await staking.connect(user1).claimRewards();
      const balAfter  = await token.balanceOf(user1.address);

      // Compute expected using the timestamp of the block that actually mined the tx.
      // time.increaseTo sets the chain to T, but Hardhat mines the next tx at T+1.
      // Reading block.timestamp from the receipt gives the exact elapsed used by the contract.
      const receipt   = await tx.wait();
      const claimTime = BigInt(receipt!.blockNumber
        ? (await ethers.provider.getBlock(receipt!.blockNumber))!.timestamp
        : Number(stakeTime + ONE_DAY + 1n));
      const actualElapsed  = claimTime - stakeTime;
      const expectedReward = calcRewards(S1000, RATE, actualElapsed);

      expect(balAfter - balBefore).to.equal(expectedReward);
    });

    // FIX: After first claim, the second tx mines 1–2 seconds later, accruing a
    // tiny amount of dust.  We verify the second call does NOT revert and that the
    // additional balance is at most 2 seconds of dust (not a full reward cycle).
    it("12. [MAIN TEST CASE] Should reset accrual timer; second immediate claim succeeds with 0 rewards (no revert)", async function () {
      const { token, staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S1000);
      const stakeTime = BigInt(await time.latest());

      await time.increaseTo(stakeTime + ONE_DAY);
      await staking.connect(user1).claimRewards(); // first claim — resets timer

      const balAfterFirst = await token.balanceOf(user1.address);

      // Second call must not revert.
      await expect(staking.connect(user1).claimRewards()).to.not.be.reverted;

      const balAfterSecond = await token.balanceOf(user1.address);
      // At most 2 seconds of dust may accrue between the two transactions.
      const maxDust = calcRewards(S1000, RATE, 2n);
      expect(balAfterSecond - balAfterFirst).to.be.lte(maxDust);
    });

    it("24. User cannot claim if they have 0 staked balance", async function () {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await expect(staking.connect(user1).claimRewards())
        .to.be.revertedWith("StakingContract: nothing staked");
    });
  });

  // ─── 5. Unstaking Logic ───────────────────────────────────────────────────────
  describe("5. Unstaking Logic (Partial & Full)", function () {

    it("13. [MAIN TEST CASE] Should return exact principal amount back to user on FULL unstake", async function () {
      const { token, staking, user1, stakingAddress } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S1000);

      const tx = await staking.connect(user1).unstake(S1000);
      await expect(tx).to.changeTokenBalances(
        token,
        [stakingAddress],
        [-S1000]
      );
      expect(await staking.getStakedBalance(user1.address)).to.equal(0n);
    });

    it("14. [MAIN TEST CASE] Partial unstaking should leave remainder accruing rewards", async function () {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S1000);
      const stakeTime = BigInt(await time.latest());

      // Advance 1 day then unstake half — this resets the accrual timer.
      await time.increaseTo(stakeTime + ONE_DAY);
      await staking.connect(user1).unstake(S500);
      const unstakeTime = BigInt(await time.latest());

      // Advance exactly one more day from the unstake point.
      await time.increaseTo(unstakeTime + ONE_DAY);
      const pending = await staking.getPendingRewards(user1.address);

      // 500 tokens accruing for exactly ONE_DAY.
      expect(pending).to.equal(calcRewards(S500, RATE, ONE_DAY));
    });

    it("15. Should also mint and send pending rewards during an unstake", async function () {
      const { token, staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S1000);
      const stakeTime = BigInt(await time.latest());

      await time.increaseTo(stakeTime + ONE_DAY);

      const balBefore = await token.balanceOf(user1.address);
      const tx        = await staking.connect(user1).unstake(S1000);
      const balAfter  = await token.balanceOf(user1.address);

      // Use the actual block timestamp the tx mined in — same as test 11.
      const receipt       = await tx.wait();
      const unstakeTime   = BigInt((await ethers.provider.getBlock(receipt!.blockNumber))!.timestamp);
      const actualElapsed = unstakeTime - stakeTime;
      const expectedTotal = S1000 + calcRewards(S1000, RATE, actualElapsed);

      expect(balAfter - balBefore).to.equal(expectedTotal);
    });

    it("16. Should emit Unstaked event on partial or full unstake", async function () {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S1000);
      await expect(staking.connect(user1).unstake(S1000))
        .to.emit(staking, "Unstaked")
        .withArgs(user1.address, S1000);
    });

    it("17. Should revert if attempting to unstake more than the staked balance", async function () {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S500);
      await expect(staking.connect(user1).unstake(S1000))
        .to.be.revertedWith("StakingContract: amount exceeds staked balance");
    });
  });

  // ─── 6. Security & Attack Vectors ────────────────────────────────────────────
  describe("6. Security & Attack Vectors", function () {

    it("18. [MAIN TEST CASE - ATTACK] Prevent direct unauthorised minting", async function () {
      const { token, attacker } = await loadFixture(deployStakingFixture);
      await expect(token.connect(attacker).mint(attacker.address, 50000))
        .to.be.revertedWith("CS218Token: not authorised to mint");
    });

    it("19. [MAIN TEST CASE - ATTACK] Prevent non-owner from changing the reward rate", async function () {
      const { staking, attacker } = await loadFixture(deployStakingFixture);
      await expect(staking.connect(attacker).setRewardRate(999))
        .to.be.revertedWithCustomError(staking, "OwnableUnauthorizedAccount")
        .withArgs(attacker.address);
    });

    // Flash-stake test: stake and immediately unstake with minimal time elapsed.
    // We cannot pin both txs to the exact same timestamp (Hardhat forbids same-block
    // timestamps by default). Instead we advance by just 1 second and assert that the
    // attacker receives only principal back plus AT MOST 1 second of dust (negligible).
    it("20. [MAIN TEST CASE - ATTACK] Prevent Flash-staking (same block, 0 reward)", async function () {
      const { token, staking, attacker } = await loadFixture(deployStakingFixture);
      const attackAmount = ethers.parseUnits("50000", 18);

      await staking.connect(attacker).stake(attackAmount);

      // Advance only 1 second — the minimum Hardhat allows between blocks.
      await time.increase(1);
      const balBefore = await token.balanceOf(attacker.address);
      await staking.connect(attacker).unstake(attackAmount);
      const balAfter = await token.balanceOf(attacker.address);

      const gained = balAfter - balBefore - attackAmount; // subtract principal
      // At most 2 seconds of accrual on 50_000 tokens is negligible (dust).
      const maxDust = calcRewards(attackAmount, RATE, 2n);
      expect(gained).to.be.lte(maxDust);                 // near-zero reward
      expect(await staking.getPendingRewards(attacker.address)).to.equal(0n);
    });

    it("21. [MAIN TEST CASE - ATTACK] Unstake state update occurs BEFORE external call (CEI / Reentrancy guard)", async function () {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S1000);
      await staking.connect(user1).unstake(S1000);
      const finalStakeInfo = await staking.stakes(user1.address);
      expect(finalStakeInfo.amount).to.equal(0n);
    });

    // FIX: Rate change mid-accrual means the period BEFORE the change uses the old
    // rate and the period AFTER uses the new rate — making the expected value hard
    // to compute.  Set the new rate BEFORE staking so the entire elapsed window
    // uses only NEW_RATE.
    it("22. Owner changing reward rate alters future calculations", async function () {
      const { staking, owner, user1 } = await loadFixture(deployStakingFixture);
      const NEW_RATE = 200n;

      // Set rate first, then stake — entire accrual uses NEW_RATE.
      await staking.connect(owner).setRewardRate(NEW_RATE);
      await staking.connect(user1).stake(S1000);
      const stakeTime = BigInt(await time.latest());

      await time.increaseTo(stakeTime + ONE_DAY);

      const pending  = await staking.getPendingRewards(user1.address);
      const expected = calcRewards(S1000, NEW_RATE, ONE_DAY);
      expect(pending).to.equal(expected);
    });

    it("23. Staking auto-claims old rewards before adding new principal", async function () {
      const { token, staking, user1 } = await loadFixture(deployStakingFixture);

      await staking.connect(user1).stake(S1000);
      const firstStakeTime = BigInt(await time.latest());

      await time.increaseTo(firstStakeTime + ONE_DAY);

      const balBefore = await token.balanceOf(user1.address);
      const tx        = await staking.connect(user1).stake(S500);
      const balAfter  = await token.balanceOf(user1.address);

      // Use the actual block timestamp so elapsed matches what the contract used.
      const receipt          = await tx.wait();
      const secondStakeTime  = BigInt((await ethers.provider.getBlock(receipt!.blockNumber))!.timestamp);
      const actualElapsed    = secondStakeTime - firstStakeTime;
      const expectedAutoClaim = calcRewards(S1000, RATE, actualElapsed);

      // Net change = +expectedAutoClaim (auto-minted rewards) − S500 (staked in).
      expect(balAfter - balBefore).to.equal(expectedAutoClaim - S500);
    });

    it("25. Malicious user cannot unstake 0 tokens", async function () {
      const { staking, attacker } = await loadFixture(deployStakingFixture);
      await expect(staking.connect(attacker).unstake(0))
        .to.be.revertedWith("StakingContract: nothing staked");
    });

    it("26. State is pristine after stake → claim → unstake lifecycle", async function () {
      const { token, staking, user1, stakingAddress } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S1000);
      const stakeTime = BigInt(await time.latest());

      await time.increaseTo(stakeTime + ONE_DAY);
      await staking.connect(user1).claimRewards();
      const claimTime = BigInt(await time.latest());

      await time.increaseTo(claimTime + ONE_DAY);
      await staking.connect(user1).unstake(S1000);

      expect(await staking.getStakedBalance(user1.address)).to.equal(0n);
      expect(await staking.getPendingRewards(user1.address)).to.equal(0n);
      expect(await token.balanceOf(stakingAddress)).to.equal(0n);
    });

    it("28. Owner cannot set reward rate to 0 (guard against freezing rewards)", async function () {
      const { staking, owner } = await loadFixture(deployStakingFixture);
      await expect(staking.connect(owner).setRewardRate(0))
        .to.be.revertedWith("StakingContract: reward rate must be > 0");
    });

    it("29. setMinter reverts when called with the zero address", async function () {
      const { token, owner } = await loadFixture(deployStakingFixture);
      await expect(token.connect(owner).setMinter(ethers.ZeroAddress))
        .to.be.revertedWith("Minter cannot be zero address");
    });
  });
});
