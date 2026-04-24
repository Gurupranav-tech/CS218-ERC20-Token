import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";

describe("Project 9: ERC-20 Token with Staking Rewards", function() {

  async function deployStakingFixture() {
    const [owner, user1, user2] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("CS218Token");
    const token = await Token.deploy();
    const tokenAddress = await token.getAddress();

    const Staking = await ethers.getContractFactory("StakingContract");
    const staking = await Staking.deploy(tokenAddress);
    const stakingAddress = await staking.getAddress();

    await token.setMinter(stakingAddress);

    const decimals = await token.decimals();
    const initialFund = ethers.parseUnits("100000", decimals);
    await token.transfer(user1.address, initialFund);
    await token.transfer(user2.address, initialFund);

    await token.connect(user1).approve(stakingAddress, ethers.MaxUint256);
    await token.connect(user2).approve(stakingAddress, ethers.MaxUint256);

    return { token, staking, owner, user1, user2, stakingAddress, decimals };
  }

  describe("Core Logic & Requirements", function() {

    it("Requirement: Staking transfers tokens from user to contract (check both balances)", async function() {
      const { token, staking, user1, stakingAddress } = await loadFixture(deployStakingFixture);
      const stakeAmount = ethers.parseUnits("1000", 18);

      const userBalanceBefore = await token.balanceOf(user1.address);
      const contractBalanceBefore = await token.balanceOf(stakingAddress);

      await staking.connect(user1).stake(stakeAmount);

      const userBalanceAfter = await token.balanceOf(user1.address);
      const contractBalanceAfter = await token.balanceOf(stakingAddress);

      expect(userBalanceBefore - userBalanceAfter).to.equal(stakeAmount);
      expect(contractBalanceAfter - contractBalanceBefore).to.equal(stakeAmount);
      expect(await staking.getStakedBalance(user1.address)).to.equal(stakeAmount);
    });

    it("Requirement: Rewards after 1 day are half the rewards after 2 days (linear accrual)", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      const stakeAmount = ethers.parseUnits("1000", 18);
      await staking.connect(user1).stake(stakeAmount);

      await time.increase(24 * 3600);
      const pendingDay1 = await staking.getPendingRewards(user1.address);

      await time.increase(24 * 3600);
      const pendingDay2 = await staking.getPendingRewards(user1.address);

      expect(pendingDay2).to.equal(pendingDay1 * 2n);
    });

    it("Requirement: A user who stakes 2x as many tokens earns 2x the rewards in the same period", async function() {
      const { staking, user1, user2 } = await loadFixture(deployStakingFixture);

      const stakeUser1 = ethers.parseUnits("1000", 18);
      const stakeUser2 = ethers.parseUnits("2000", 18); // 2x the amount

      await staking.connect(user1).stake(stakeUser1);
      await staking.connect(user2).stake(stakeUser2);

      await time.increase(24 * 3600);

      const pendingUser1 = await staking.getPendingRewards(user1.address);
      const pendingUser2 = await staking.getPendingRewards(user2.address);

      expect(pendingUser2).to.equal(pendingUser1 * 2n);
    });

    it("Requirement: claimRewards resets the accrual timer", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      const stakeAmount = ethers.parseUnits("1000", 18);

      await staking.connect(user1).stake(stakeAmount);
      await time.increase(24 * 3600);

      await staking.connect(user1).claimRewards();

      expect(await staking.getPendingRewards(user1.address)).to.equal(0n);

      await expect(staking.connect(user1).claimRewards()).to.be.revertedWith("No rewards to claim");
    });

    it("Requirement: Unstaking returns exactly the staked amount (no rewards in principal)", async function() {
      const { token, staking, user1, stakingAddress } = await loadFixture(deployStakingFixture);
      const stakeAmount = ethers.parseUnits("1000", 18);

      await staking.connect(user1).stake(stakeAmount);
      await time.increase(24 * 3600);
      const contractBalanceBefore = await token.balanceOf(stakingAddress);

      await staking.connect(user1).unstake(); // Withdraws all

      const contractBalanceAfter = await token.balanceOf(stakingAddress);

      expect(contractBalanceBefore - contractBalanceAfter).to.equal(stakeAmount);

      expect(await staking.getStakedBalance(user1.address)).to.equal(0n);
    });
  });

  describe("Edge Cases & Access Control", function() {

    it("Requirement: Staking 0 tokens reverts", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await expect(staking.connect(user1).stake(0)).to.be.revertedWith("Cannot stake zero tokens");
    });

    it("Requirement: A non-owner cannot call setRewardRate", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await expect(staking.connect(user1).setRewardRate(200))
        .to.be.revertedWithCustomError(staking, "OwnableUnauthorizedAccount")
        .withArgs(user1.address);
    });

    it("Edge Case: Unstaking with 0 balance reverts", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await expect(staking.connect(user1).unstake()).to.be.revertedWith("Nothing staked");
    });

    it("Edge Case: Owner successfully updates reward rate", async function() {
      const { staking, owner } = await loadFixture(deployStakingFixture);
      await expect(staking.connect(owner).setRewardRate(500))
        .to.emit(staking, "RewardRateUpdated")
        .withArgs(500);

      expect(await staking.rewardRate()).to.equal(500);
    });
  });
});
