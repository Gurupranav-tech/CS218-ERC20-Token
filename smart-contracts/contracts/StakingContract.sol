// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./CS218Token.sol";

contract StakingContract is ReentrancyGuard, Ownable {
    CS218Token public token;

    struct StakeInfo {
        uint256 amount;
        uint256 lastClaimTimestamp;
    }

    uint256 public rewardRate = 100;

    mapping(address => StakeInfo) public stakes;

    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event RewardsClaimed(address indexed user, uint256 amount);
    event RewardRateUpdated(uint256 newRate);

    constructor(address _token) Ownable(msg.sender) {
        token = CS218Token(_token);
    }

    function stake(uint256 amount) external nonReentrant {
        require(amount > 0, "Cannot stake zero tokens");

        if (stakes[msg.sender].amount > 0) {
            uint256 pending = _calculateRewards(msg.sender);
            if (pending > 0) {
                stakes[msg.sender].lastClaimTimestamp = block.timestamp;
                token.mint(msg.sender, pending);
                emit RewardsClaimed(msg.sender, pending);
            }
        }

        token.transferFrom(msg.sender, address(this), amount);
        stakes[msg.sender].amount += amount;
        stakes[msg.sender].lastClaimTimestamp = block.timestamp;

        emit Staked(msg.sender, amount);
    }

    function unstake() external nonReentrant {
        StakeInfo memory s = stakes[msg.sender];
        require(s.amount > 0, "Nothing staked");

        uint256 pending = _calculateRewards(msg.sender);
        uint256 principal = s.amount;

        stakes[msg.sender].amount = 0;
        stakes[msg.sender].lastClaimTimestamp = 0;

        token.transfer(msg.sender, principal);

        if (pending > 0) {
            token.mint(msg.sender, pending);
            emit RewardsClaimed(msg.sender, pending);
        }

        emit Unstaked(msg.sender, principal);
    }

    function claimRewards() external nonReentrant {
        require(stakes[msg.sender].amount > 0, "Nothing staked");

        uint256 pending = _calculateRewards(msg.sender);
        require(pending > 0, "No rewards to claim");

        stakes[msg.sender].lastClaimTimestamp = block.timestamp;
        token.mint(msg.sender, pending);

        emit RewardsClaimed(msg.sender, pending);
    }

    function getPendingRewards(address user) external view returns (uint256) {
        return _calculateRewards(user);
    }

    function getStakedBalance(address user) external view returns (uint256) {
        return stakes[user].amount;
    }

    function setRewardRate(uint256 _rewardRate) external onlyOwner {
        rewardRate = _rewardRate;
        emit RewardRateUpdated(_rewardRate);
    }

    function _calculateRewards(address user) internal view returns (uint256) {
        StakeInfo memory s = stakes[user];
        if (s.amount == 0 || s.lastClaimTimestamp == 0) return 0;
        uint256 elapsed = (block.timestamp - s.lastClaimTimestamp) / 1 days;
        return (s.amount * rewardRate * elapsed) / 1000;
    }
}
