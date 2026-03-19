// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

/**
 * @title IYieldStrategy
 * @notice Interface for yield-generating strategies
 * @dev All strategies must implement this interface to work with TaxVault
 */
interface IYieldStrategy {
    /**
     * @notice Deposit ETH into the strategy
     * @return shares Number of shares minted (for tracking)
     */
    function deposit() external payable returns (uint256 shares);
    
    /**
     * @notice Withdraw a specific amount from the strategy
     * @param amount Amount in Wei to withdraw
     * @return Amount actually withdrawn
     */
    function withdraw(uint256 amount) external returns (uint256);
    
    /**
     * @notice Get the balance of an account in the strategy
     * @param account Address to check
     * @return Balance in strategy-specific units
     */
    function balanceOf(address account) external view returns (uint256);
    
    /**
     * @notice Convert strategy shares to underlying asset value
     * @param shares Amount of shares
     * @return Equivalent value in Wei
     */
    function convertToAssets(uint256 shares) external view returns (uint256);
    
    /**
     * @notice Emergency withdraw all funds back to vault
     * @dev Only callable by vault in emergency situations
     * @param recipient Address to send recovered funds to (should be vault)
     * @return Amount recovered
     */
    function emergencyWithdraw(address recipient) external returns (uint256);
}