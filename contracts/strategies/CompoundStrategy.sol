// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

import "../IYieldStrategy.sol";

interface IComet {
    function supply(address asset, uint256 amount) external;
    function withdraw(address asset, uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
    function accrueAccount(address account) external;
}

interface ICmpIWETH {
    function deposit() external payable;
    function withdraw(uint256) external;
    function approve(address spender, uint256 amount) external returns (bool);
}

/**
 * @title CompoundStrategy
 * @notice Deposits ETH into Compound V3 to earn yield
 */
contract CompoundStrategy is IYieldStrategy {

    // ============ Custom Errors ============

    error OnlyVault();
    error ZeroAmount();
    error OnlyVaultRecipient();
    error ETHTransferFailed();

    // ============ State Variables ============

    IComet public immutable comet;
    ICmpIWETH public immutable weth;
    address public immutable vault;

    // ============ Constructor ============

    constructor(
        address _comet,
        address _weth,
        address _vault
    ) {
        comet = IComet(_comet);
        weth = ICmpIWETH(_weth);
        vault = _vault;
    }

    // ============ Modifiers ============

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    // ============ IYieldStrategy Implementation ============

    function deposit() external payable onlyVault returns (uint256 shares) {
        if (msg.value == 0) revert ZeroAmount();
        
        // Wrap ETH to WETH
        weth.deposit{value: msg.value}();
        
        // Approve Compound
        weth.approve(address(comet), msg.value);
        
        // Supply to Compound
        comet.supply(address(weth), msg.value);
        
        return msg.value;
    }
    
    function withdraw(uint256 amount) external onlyVault returns (uint256) {
        if (amount == 0) revert ZeroAmount();

        comet.accrueAccount(address(this));
        comet.withdraw(address(weth), amount);
        weth.withdraw(amount);

        (bool success, ) = payable(vault).call{value: amount}("");
        if (!success) revert ETHTransferFailed();

        return amount;
    }

    function balanceOf(address account) external view returns (uint256) {
        if (account != address(this)) return 0;
        return comet.balanceOf(address(this));
    }

    function convertToAssets(uint256 shares) external pure returns (uint256) {
        return shares;
    }

    function emergencyWithdraw(address recipient) external onlyVault returns (uint256) {
        if (recipient != vault) revert OnlyVaultRecipient();

        comet.accrueAccount(address(this));

        uint256 balance = comet.balanceOf(address(this));
        if (balance == 0) return 0;

        comet.withdraw(address(weth), balance);
        weth.withdraw(balance);

        (bool success, ) = payable(recipient).call{value: balance}("");
        if (!success) revert ETHTransferFailed();

        return balance;
    }
    
    // ============ Receive Function ============
    
    receive() external payable {}
}