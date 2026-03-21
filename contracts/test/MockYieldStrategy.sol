// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

import "../IYieldStrategy.sol";

/// @dev Minimal mock for testing vault–strategy interactions.
///      1:1 ETH accounting, no actual yield. Simulates partial loss on demand.
contract MockYieldStrategy is IYieldStrategy {
    address public immutable vault;
    uint256 public totalDeposited;

    /// @dev Set > 0 to simulate a strategy that returns less than requested
    uint256 public shortfallBps; // basis points lost on withdraw (e.g. 500 = 5%)

    error OnlyVault();

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    constructor(address _vault) {
        vault = _vault;
    }

    function setShortfallBps(uint256 bps) external {
        shortfallBps = bps;
    }

    function deposit() external payable onlyVault returns (uint256) {
        totalDeposited += msg.value;
        return msg.value;
    }

    function withdraw(uint256 amount) external onlyVault returns (uint256) {
        uint256 loss = (amount * shortfallBps) / 10000;
        uint256 actual = amount - loss;
        if (actual > address(this).balance) actual = address(this).balance;
        totalDeposited = totalDeposited > amount ? totalDeposited - amount : 0;
        (bool ok, ) = payable(vault).call{value: actual}("");
        require(ok, "transfer failed");
        return actual;
    }

    function balanceOf(address) external view returns (uint256) {
        return address(this).balance;
    }

    function convertToAssets(uint256 shares) external pure returns (uint256) {
        return shares;
    }

    function emergencyWithdraw(address recipient) external onlyVault returns (uint256) {
        uint256 bal = address(this).balance;
        if (bal == 0) return 0;
        totalDeposited = 0;
        (bool ok, ) = payable(recipient).call{value: bal}("");
        require(ok, "transfer failed");
        return bal;
    }

    receive() external payable {}
}
