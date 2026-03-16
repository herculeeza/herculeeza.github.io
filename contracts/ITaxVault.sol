// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

/// @title ITaxVault
/// @notice Interface for the TaxVault contract used by Harburger for yield-bearing tax payments
interface ITaxVault {
    /// @notice Pay taxes on behalf of a user by withdrawing from their vault balance
    /// @param user The user whose vault balance to deduct from
    /// @param amount The tax amount in Wei
    /// @return success Whether the payment was successful (false if insufficient balance)
    function payTax(address user, uint256 amount) external returns (bool);

    /// @notice Get a user's total balance across all strategies
    /// @param user The user to query
    /// @return Total balance in Wei
    function getTotalBalance(address user) external view returns (uint256);
}
