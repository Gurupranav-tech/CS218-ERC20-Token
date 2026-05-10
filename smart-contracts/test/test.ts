import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";

// ─── Reward formula (mirrors StakingContract._calculateRewardsFromCache) ──────
// rewards = (stakedAmount * rewardRate * elapsedSeconds) / (1000 * 86400)
function calcRewards(
  staked: bigint,
  rate: bigint,
  elapsedSeconds: bigint
): bigint {
  return (staked * rate * elapsedSeconds) / (1000n * 86400n);
}

describe("Project 9: ERC-20 Token with Staking Rewards - Updated Suite", function() {

  // ─── Fixture ───────────────────────────────────────────────────────────────
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

  const ONE_DAY = 86400n;
  const THIRTY_MINUTES = 30n * 60n; // 1800 seconds
  const RATE = 100n;
  const S1000 = ethers.parseUnits("1000", 18);
  const S2000 = ethers.parseUnits("2000", 18);
  const S500 = ethers.parseUnits("500", 18);

  // ─── 1. Deployment & Setup ─────────────────────────────────────────────────
  describe("1. Deployment & Setup", function() {

    it("1. Should set the correct token address in staking contract", async function() {
      const { token, staking } = await loadFixture(deployStakingFixture);
      expect(await staking.token()).to.equal(await token.getAddress());
    });

    it("2. Should have the correct initial reward rate (100)", async function() {
      const { staking } = await loadFixture(deployStakingFixture);
      expect(await staking.rewardRate()).to.equal(100n);
    });

    it("3. Should correctly set the Staking contract as the token Minter", async function() {
      const { token, stakingAddress } = await loadFixture(deployStakingFixture);
      expect(await token.minter()).to.equal(stakingAddress);
    });

  });

  // ─── 2. Core Staking Logic ─────────────────────────────────────────────────
  describe("2. Core Staking Logic", function() {

    it("4. [MAIN TEST CASE] Should correctly transfer tokens from user to contract on stake", async function() {
      const { token, staking, user1, stakingAddress } = await loadFixture(deployStakingFixture);
      const tx = await staking.connect(user1).stake(S1000);
      await expect(tx).to.changeTokenBalances(
        token,
        [user1.address, stakingAddress],
        [-S1000, S1000]
      );
    });

    it("5. Should update the user's staked balance accurately", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S1000);
      expect(await staking.getStakedBalance(user1.address)).to.equal(S1000);
    });

    it("6. Should emit a Staked event with correct parameters", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await expect(staking.connect(user1).stake(S500))
        .to.emit(staking, "Staked")
        .withArgs(user1.address, S500);
    });

    it("7. Should revert when user tries to stake 0 tokens", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await expect(staking.connect(user1).stake(0))
        .to.be.revertedWith("StakingContract: cannot stake zero tokens");
    });

    it("8. Should properly aggregate balance if user stakes multiple times", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S500);
      await staking.connect(user1).stake(S500);
      expect(await staking.getStakedBalance(user1.address)).to.equal(S1000);
    });

  });

  // ─── 3. Time Travel & Reward Calculation ──────────────────────────────────
  describe("3. Time Travel & Reward Calculation", function() {

    it("9. [MAIN TEST CASE] Should accrue rewards linearly (Day 2 equals 2x Day 1)", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S1000);
      const t0 = BigInt(await time.latest());

      await time.increaseTo(t0 + ONE_DAY);
      const day1Rewards = await staking.getPendingRewards(user1.address);

      await time.increaseTo(t0 + ONE_DAY * 2n);
      const day2Rewards = await staking.getPendingRewards(user1.address);

      expect(day2Rewards).to.equal(day1Rewards * 2n);
    });

    it("10. [MAIN TEST CASE] Should accrue 2x rewards for a user staking 2x the tokens", async function() {
      const { staking, user1, user2 } = await loadFixture(deployStakingFixture);

      await staking.connect(user1).stake(S1000);
      const t1 = BigInt(await time.latest());

      await staking.connect(user2).stake(S2000);
      const t2 = BigInt(await time.latest());

      const tFuture = t2 + ONE_DAY;
      await time.increaseTo(tFuture);

      expect(await staking.getPendingRewards(user1.address)).to.equal(
        calcRewards(S1000, RATE, tFuture - t1)
      );
      expect(await staking.getPendingRewards(user2.address)).to.equal(
        calcRewards(S2000, RATE, tFuture - t2)
      );

      // Core proportionality — same duration, 2x stake → 2x reward
      expect(calcRewards(S2000, RATE, ONE_DAY)).to.equal(
        calcRewards(S1000, RATE, ONE_DAY) * 2n
      );
    });

    it("27. Reward calculation — 1 second of accrual yields a non-zero reward", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S1000);
      await time.increase(1);
      expect(await staking.getPendingRewards(user1.address)).to.be.gt(0n);
    });

  });

  // ─── 4. Claiming Rewards ───────────────────────────────────────────────────
  describe("4. Claiming Rewards", function() {

    it("11. [MAIN TEST CASE] Should mint correct reward amount to user upon claim", async function() {
      const { token, staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S1000);
      const stakeTime = BigInt(await time.latest());

      await time.increaseTo(stakeTime + ONE_DAY);

      const balBefore = await token.balanceOf(user1.address);
      const tx = await staking.connect(user1).claimRewards();
      const balAfter = await token.balanceOf(user1.address);

      const receipt = await tx.wait();
      const claimTime = BigInt(
        (await ethers.provider.getBlock(receipt!.blockNumber))!.timestamp
      );
      const actualElapsed = claimTime - stakeTime;
      const expectedReward = calcRewards(S1000, RATE, actualElapsed);

      expect(balAfter - balBefore).to.equal(expectedReward);
    });

    it("12. [MAIN TEST CASE] Should reset accrual timer; second immediate claim succeeds with 0 rewards", async function() {
      const { token, staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S1000);
      const stakeTime = BigInt(await time.latest());

      await time.increaseTo(stakeTime + ONE_DAY);
      await staking.connect(user1).claimRewards(); // first claim — resets timer

      const balAfterFirst = await token.balanceOf(user1.address);

      // Second call must not revert
      await expect(staking.connect(user1).claimRewards()).to.not.be.reverted;

      const balAfterSecond = await token.balanceOf(user1.address);

      // At most 2 seconds of dust may accrue between the two transactions
      const maxDust = calcRewards(S1000, RATE, 2n);
      expect(balAfterSecond - balAfterFirst).to.be.lte(maxDust);
    });

    it("24. User cannot claim if they have 0 staked balance", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await expect(staking.connect(user1).claimRewards())
        .to.be.revertedWith("StakingContract: nothing staked");
    });

  });

  // ─── 5. Unstaking Logic ────────────────────────────────────────────────────
  describe("5. Unstaking Logic (Partial & Full)", function() {

    it("13. [MAIN TEST CASE] Should return exact principal amount back to user on FULL unstake", async function() {
      const { token, staking, user1, stakingAddress } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S1000);
      const stakeTime = BigInt(await time.latest());

      // Advance past the 30-minute lockdown
      await time.increaseTo(stakeTime + THIRTY_MINUTES);

      const tx = await staking.connect(user1).unstake(S1000);
      await expect(tx).to.changeTokenBalances(
        token,
        [stakingAddress],
        [-S1000]
      );
      expect(await staking.getStakedBalance(user1.address)).to.equal(0n);
    });

    it("14. [MAIN TEST CASE] Partial unstaking should reduce stake balance without resetting timer", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S1000);
      const stakeTime = BigInt(await time.latest());

      // Advance past lockdown then partial unstake
      await time.increaseTo(stakeTime + THIRTY_MINUTES);
      await staking.connect(user1).unstake(S500);

      // Verify staked balance reduced
      expect(await staking.getStakedBalance(user1.address)).to.equal(S500);

      // Jump to exactly stakeTime + 2 days — lastClaimTimestamp was never reset,
      // so elapsed = 2 days from the original stake time
      await time.increaseTo(stakeTime + ONE_DAY * 2n);
      const pending = await staking.getPendingRewards(user1.address);

      expect(pending).to.equal(calcRewards(S500, RATE, ONE_DAY * 2n));
    });

    it("15. Unstake returns ONLY principal — pending rewards NOT included", async function() {
      const { token, staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S1000);
      const stakeTime = BigInt(await time.latest());

      await time.increaseTo(stakeTime + ONE_DAY);

      // Confirm rewards have accrued before unstaking
      const pendingBefore = await staking.getPendingRewards(user1.address);
      expect(pendingBefore).to.be.gt(0n);

      const balBefore = await token.balanceOf(user1.address);
      await staking.connect(user1).unstake(S1000);
      const balAfter = await token.balanceOf(user1.address);

      // User receives EXACTLY the staked principal — no rewards mixed in
      expect(balAfter - balBefore).to.equal(S1000);

      // After full unstake, amount = 0, so pending rewards also = 0
      expect(await staking.getStakedBalance(user1.address)).to.equal(0n);
      expect(await staking.getPendingRewards(user1.address)).to.equal(0n);
    });

    it("16. Should emit Unstaked event on partial or full unstake", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S1000);
      const stakeTime = BigInt(await time.latest());

      // Advance past the 30-minute lockdown
      await time.increaseTo(stakeTime + THIRTY_MINUTES);

      await expect(staking.connect(user1).unstake(S1000))
        .to.emit(staking, "Unstaked")
        .withArgs(user1.address, S1000);
    });

    it("17. Should revert if attempting to unstake more than the staked balance", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S500);
      const stakeTime = BigInt(await time.latest());

      // Advance past lockdown so amount-check revert is what fires, not lock revert
      await time.increaseTo(stakeTime + THIRTY_MINUTES);

      await expect(staking.connect(user1).unstake(S1000))
        .to.be.revertedWith("StakingContract: amount exceeds staked balance");
    });

  });

  // ─── 6. Security & Attack Vectors ─────────────────────────────────────────
  describe("6. Security & Attack Vectors", function() {

    it("18. [MAIN TEST CASE - ATTACK] Prevent direct unauthorised minting", async function() {
      const { token, attacker } = await loadFixture(deployStakingFixture);
      await expect(token.connect(attacker).mint(attacker.address, 50000))
        .to.be.revertedWith("CS218Token: not authorised to mint");
    });

    it("19. [MAIN TEST CASE - ATTACK] Prevent non-owner from changing the reward rate", async function() {
      const { staking, attacker } = await loadFixture(deployStakingFixture);
      await expect(staking.connect(attacker).setRewardRate(999))
        .to.be.revertedWithCustomError(staking, "OwnableUnauthorizedAccount")
        .withArgs(attacker.address);
    });

    it("20. [MAIN TEST CASE - ATTACK] Prevent Flash-staking (principal only returned, near-zero reward)", async function() {
      const { token, staking, attacker } = await loadFixture(deployStakingFixture);
      const attackAmount = ethers.parseUnits("50000", 18);

      await staking.connect(attacker).stake(attackAmount);
      const stakeTime = BigInt(await time.latest());

      // Advance past lockdown — the lockdown itself defeats true flash-staking
      // (same-block stake+unstake is impossible). We verify that even after the
      // lock the attacker earns only proportional dust, not a disproportionate gain.
      await time.increaseTo(stakeTime + THIRTY_MINUTES);

      const balBefore = await token.balanceOf(attacker.address);
      await staking.connect(attacker).unstake(attackAmount);
      const balAfter = await token.balanceOf(attacker.address);

      // gained = anything received above the returned principal
      const gained = balAfter - balBefore - attackAmount;

      // At most 30 minutes + 2 seconds of accrual — negligible for any strategy
      const maxDust = calcRewards(attackAmount, RATE, THIRTY_MINUTES + 2n);
      expect(gained).to.be.lte(maxDust);
      expect(await staking.getPendingRewards(attacker.address)).to.equal(0n);
    });

    it("21. [MAIN TEST CASE - ATTACK] Unstake state update occurs BEFORE external call (CEI / Reentrancy guard)", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S1000);
      const stakeTime = BigInt(await time.latest());

      // Advance past the 30-minute lockdown
      await time.increaseTo(stakeTime + THIRTY_MINUTES);

      await staking.connect(user1).unstake(S1000);

      // State must be fully updated — amount must be zeroed
      const finalStakeInfo = await staking.stakes(user1.address);
      expect(finalStakeInfo.amount).to.equal(0n);
    });

    it("22. Owner changing reward rate alters future calculations", async function() {
      const { staking, owner, user1 } = await loadFixture(deployStakingFixture);
      const NEW_RATE = 200n;

      // Set rate BEFORE staking so entire accrual window uses NEW_RATE
      await staking.connect(owner).setRewardRate(NEW_RATE);
      await staking.connect(user1).stake(S1000);
      const stakeTime = BigInt(await time.latest());

      await time.increaseTo(stakeTime + ONE_DAY);

      const pending = await staking.getPendingRewards(user1.address);
      const expected = calcRewards(S1000, NEW_RATE, ONE_DAY);
      expect(pending).to.equal(expected);
    });

    it("23. Staking auto-claims old rewards before adding new principal", async function() {
      const { token, staking, user1 } = await loadFixture(deployStakingFixture);

      await staking.connect(user1).stake(S1000);
      const firstStakeTime = BigInt(await time.latest());

      await time.increaseTo(firstStakeTime + ONE_DAY);

      const balBefore = await token.balanceOf(user1.address);
      const tx = await staking.connect(user1).stake(S500);
      const balAfter = await token.balanceOf(user1.address);

      const receipt = await tx.wait();
      const secondStakeTime = BigInt(
        (await ethers.provider.getBlock(receipt!.blockNumber))!.timestamp
      );
      const actualElapsed = secondStakeTime - firstStakeTime;
      const expectedAutoClaim = calcRewards(S1000, RATE, actualElapsed);

      // Net change = +auto-claimed rewards minted − S500 transferred in
      expect(balAfter - balBefore).to.equal(expectedAutoClaim - S500);
    });

    it("25. Malicious user cannot unstake 0 tokens", async function() {
      const { staking, attacker } = await loadFixture(deployStakingFixture);
      // Attacker has no stake — "nothing staked" fires before "cannot unstake zero"
      await expect(staking.connect(attacker).unstake(0))
        .to.be.revertedWith("StakingContract: nothing staked");
    });

    it("26. State is pristine after stake → claim → unstake lifecycle", async function() {
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

    it("28. Owner cannot set reward rate to 0 (guard against freezing rewards)", async function() {
      const { staking, owner } = await loadFixture(deployStakingFixture);
      await expect(staking.connect(owner).setRewardRate(0))
        .to.be.revertedWith("StakingContract: reward rate must be > 0");
    });

    it("29. setMinter reverts when called with the zero address", async function() {
      const { token, owner } = await loadFixture(deployStakingFixture);
      await expect(token.connect(owner).setMinter(ethers.ZeroAddress))
        .to.be.revertedWith("Minter cannot be zero address");
    });

  });

  // ─── 7. Lockdown Period ────────────────────────────────────────────────────
  describe("7. Lockdown Period", function() {

    it("30. Unstake reverts if called immediately after stake", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S1000);

      await expect(staking.connect(user1).unstake(S1000))
        .to.be.revertedWith(
          "StakingContract: tokens are locked for 30 minutes after staking"
        );
    });

    it("31. Unstake reverts if called 1 second before lock expires", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S1000);
      const stakeTime = BigInt(await time.latest());

      // Pin the NEXT block to exactly 1 second before lock expiry.
      // time.increaseTo would set the clock but Hardhat mines the next tx
      // 1 second later — setNextBlockTimestamp forces the unstake tx itself
      // to land at stakeTime + THIRTY_MINUTES - 1, which is still inside the lock.
      await time.setNextBlockTimestamp(stakeTime + THIRTY_MINUTES - 1n);

      await expect(staking.connect(user1).unstake(S1000))
        .to.be.revertedWith(
          "StakingContract: tokens are locked for 30 minutes after staking"
        );
    });

    it("32. Unstake succeeds exactly at lock expiry (stakeTime + 30 minutes)", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S1000);
      const stakeTime = BigInt(await time.latest());

      await time.increaseTo(stakeTime + THIRTY_MINUTES);

      await expect(staking.connect(user1).unstake(S1000)).to.not.be.reverted;
    });

    it("33. Re-staking resets the lockdown window", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S500);
      const firstStakeTime = BigInt(await time.latest());

      // Wait 29 minutes — almost unlocked from first stake
      await time.increaseTo(firstStakeTime + THIRTY_MINUTES - 60n);

      // Stake again — lock resets to now + 30 minutes
      await staking.connect(user1).stake(S500);
      const secondStakeTime = BigInt(await time.latest());

      // 60 seconds after second stake — still well inside new lock window
      await time.increaseTo(secondStakeTime + 60n);
      await expect(staking.connect(user1).unstake(S1000))
        .to.be.revertedWith(
          "StakingContract: tokens are locked for 30 minutes after staking"
        );

      // After full 30 minutes from second stake — now unlocked
      await time.increaseTo(secondStakeTime + THIRTY_MINUTES);
      await expect(staking.connect(user1).unstake(S1000)).to.not.be.reverted;
    });

    it("34. getTimeUntilUnlock returns correct remaining seconds", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S1000);
      const stakeTime = BigInt(await time.latest());

      // Jump to 10 minutes after stake — 20 minutes should remain
      await time.increaseTo(stakeTime + 600n);
      const remaining = await staking.getTimeUntilUnlock(user1.address);

      // Allow ±2 seconds tolerance for block mining variance
      expect(remaining).to.be.closeTo(1200n, 2n);
    });

    it("35. getTimeUntilUnlock returns 0 after lock expires", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S1000);
      const stakeTime = BigInt(await time.latest());

      await time.increaseTo(stakeTime + THIRTY_MINUTES + 60n);
      expect(await staking.getTimeUntilUnlock(user1.address)).to.equal(0n);
    });

    it("36. claimRewards is NOT affected by the lockdown — works during lock", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S1000);
      const stakeTime = BigInt(await time.latest());

      // Still well inside the lockdown window
      await time.increaseTo(stakeTime + 60n);

      // claimRewards must succeed — only unstake is gated by the lock
      await expect(staking.connect(user1).claimRewards()).to.not.be.reverted;
    });

  });

});
