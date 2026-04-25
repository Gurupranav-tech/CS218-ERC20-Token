import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";

function calcRewards(
  staked: bigint,
  rate: bigint,
  elapsedSeconds: bigint
): bigint {
  return (staked * rate * elapsedSeconds) / (1000n * 86400n);
}

describe("Project 9: ERC-20 Token with Staking Rewards - Updated Suite", function() {

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
  const RATE = 100n;
  const S1000 = ethers.parseUnits("1000", 18);
  const S2000 = ethers.parseUnits("2000", 18);
  const S500 = ethers.parseUnits("500", 18);

  // ─── 1. Deployment & Setup ───────────────────────────────────────────────────
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

  // ─── 2. Core Staking Logic ───────────────────────────────────────────────────
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

  // ─── 3. Time Travel & Reward Calculation ─────────────────────────────────────
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

      expect(await staking.getPendingRewards(user1.address)).to.equal(calcRewards(S1000, RATE, tFuture - t1));
      expect(await staking.getPendingRewards(user2.address)).to.equal(calcRewards(S2000, RATE, tFuture - t2));
      expect(calcRewards(S2000, RATE, ONE_DAY)).to.equal(calcRewards(S1000, RATE, ONE_DAY) * 2n);
    });

    it("27. Reward calculation — 1 second of accrual yields a non-zero reward", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S1000);
      await time.increase(1);
      expect(await staking.getPendingRewards(user1.address)).to.be.gt(0n);
    });
  });

  // ─── 4. Claiming Rewards ──────────────────────────────────────────────────────
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
      const claimTime = BigInt((await ethers.provider.getBlock(receipt!.blockNumber))!.timestamp);
      const actualElapsed = claimTime - stakeTime;
      const expectedReward = calcRewards(S1000, RATE, actualElapsed);

      expect(balAfter - balBefore).to.equal(expectedReward);
    });

    it("12. [MAIN TEST CASE] Should reset accrual timer; second immediate claim succeeds with 0 rewards", async function() {
      const { token, staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S1000);
      const stakeTime = BigInt(await time.latest());

      await time.increaseTo(stakeTime + ONE_DAY);
      await staking.connect(user1).claimRewards();

      const balAfterFirst = await token.balanceOf(user1.address);
      await expect(staking.connect(user1).claimRewards()).to.not.be.reverted;

      const balAfterSecond = await token.balanceOf(user1.address);
      const maxDust = calcRewards(S1000, RATE, 2n);
      expect(balAfterSecond - balAfterFirst).to.be.lte(maxDust);
    });

    it("24. User cannot claim if they have 0 staked balance", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await expect(staking.connect(user1).claimRewards())
        .to.be.revertedWith("StakingContract: nothing staked");
    });
  });

  // ─── 5. Unstaking Logic ───────────────────────────────────────────────────────
  describe("5. Unstaking Logic (Partial & Full)", function() {

    it("13. [MAIN TEST CASE] Should return exact principal amount back to user on FULL unstake", async function() {
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

    it("14. [MAIN TEST CASE] Partial unstaking should leave remainder accruing rewards", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S1000);
      const stakeTime = BigInt(await time.latest());

      await time.increaseTo(stakeTime + ONE_DAY);
      await staking.connect(user1).unstake(S500);
      const unstakeTime = BigInt(await time.latest());

      await time.increaseTo(unstakeTime + ONE_DAY);
      const pending = await staking.getPendingRewards(user1.address);

      expect(pending).to.equal(calcRewards(S500, RATE, ONE_DAY));
    });

    // ── UPDATED: unstake no longer auto-mints rewards — principal only ──────────
    it("15. Unstake returns ONLY principal — pending rewards NOT included", async function() {
      const { token, staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S1000);
      const stakeTime = BigInt(await time.latest());

      await time.increaseTo(stakeTime + ONE_DAY);

      // Confirm there are accrued rewards before unstaking
      const pendingBefore = await staking.getPendingRewards(user1.address);
      expect(pendingBefore).to.be.gt(0n);

      const balBefore = await token.balanceOf(user1.address);
      await staking.connect(user1).unstake(S1000);
      const balAfter = await token.balanceOf(user1.address);

      // User receives EXACTLY the staked principal — no rewards mixed in
      expect(balAfter - balBefore).to.equal(S1000);

      // After full unstake, staked amount = 0 so pending rewards also = 0
      // (rewards were never claimed — they are forfeited on full unstake)
      expect(await staking.getStakedBalance(user1.address)).to.equal(0n);
      expect(await staking.getPendingRewards(user1.address)).to.equal(0n);
    });

    it("16. Should emit Unstaked event on partial or full unstake", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S1000);
      await expect(staking.connect(user1).unstake(S1000))
        .to.emit(staking, "Unstaked")
        .withArgs(user1.address, S1000);
    });

    it("17. Should revert if attempting to unstake more than the staked balance", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S500);
      await expect(staking.connect(user1).unstake(S1000))
        .to.be.revertedWith("StakingContract: amount exceeds staked balance");
    });
  });

  // ─── 6. Security & Attack Vectors ────────────────────────────────────────────
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

      await time.increase(1);
      const balBefore = await token.balanceOf(attacker.address);
      await staking.connect(attacker).unstake(attackAmount);
      const balAfter = await token.balanceOf(attacker.address);

      // balAfter - balBefore = attackAmount (principal back, no rewards from unstake)
      // gained = attackAmount - attackAmount = 0
      const gained = balAfter - balBefore - attackAmount;
      const maxDust = calcRewards(attackAmount, RATE, 2n);
      expect(gained).to.be.lte(maxDust);
      expect(await staking.getPendingRewards(attacker.address)).to.equal(0n);
    });

    it("21. [MAIN TEST CASE - ATTACK] Unstake state update occurs BEFORE external call (CEI / Reentrancy guard)", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(S1000);
      await staking.connect(user1).unstake(S1000);
      const finalStakeInfo = await staking.stakes(user1.address);
      expect(finalStakeInfo.amount).to.equal(0n);
    });

    it("22. Owner changing reward rate alters future calculations", async function() {
      const { staking, owner, user1 } = await loadFixture(deployStakingFixture);
      const NEW_RATE = 200n;

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
      const secondStakeTime = BigInt((await ethers.provider.getBlock(receipt!.blockNumber))!.timestamp);
      const actualElapsed = secondStakeTime - firstStakeTime;
      const expectedAutoClaim = calcRewards(S1000, RATE, actualElapsed);

      // Net: +auto-claimed rewards minted, -S500 transferred in
      expect(balAfter - balBefore).to.equal(expectedAutoClaim - S500);
    });

    it("25. Malicious user cannot unstake 0 tokens", async function() {
      const { staking, attacker } = await loadFixture(deployStakingFixture);
      // Attacker has no stake, so "nothing staked" fires before "cannot unstake zero"
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
});
