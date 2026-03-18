import { useState } from 'react';
import { AlertCircle, Wallet, DollarSign, Tag, Gift, TrendingUp, Loader2 } from 'lucide-react';
import { CONTRACT_ADDRESS } from './contractABI';
import { useHarburger } from './hooks/useHarburger';

const App = () => {
  const {
    account, loading, error, setError, success,
    contractData, accountData, earmark,
    isOwner, isEarmarkReceiver, vaultBalance,
    connectWallet,
    handleDeposit, handleWithdraw, handleSetPrice, handleBuyNFT,
    handleEarmark, handleClaimEarmark, handleCancelEarmark,
    handleEnableVault, handleDisableVault,
    formatAddress, formatEther, annualTaxPercent
  } = useHarburger();

  // Form states (UI only — not contract logic)
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [buyPrice, setBuyPrice] = useState('');
  const [earmarkReceiver, setEarmarkReceiver] = useState('');
  const [earmarkDeposit, setEarmarkDeposit] = useState('');
  const [claimPrice, setClaimPrice] = useState('');
  const [aboutOpen, setAboutOpen] = useState(false);

  return (
    <div
      className="min-h-screen p-4"
      style={{
        backgroundColor: '#fff3e0',
        backgroundImage: `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><text x="10" y="55" font-size="50">🍔</text></svg>')}")`,
        backgroundSize: '80px 80px',
      }}
    >
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-3xl font-bold text-orange-600 mb-2">🍔 HARBURGER</h1>
              <p className="text-gray-600">A Deliciously Taxing NFT</p>
            </div>
            {!account ? (
              <button
                onClick={connectWallet}
                disabled={loading}
                className="flex items-center gap-2 bg-orange-500 text-white px-6 py-3 rounded-lg hover:bg-orange-600 disabled:bg-gray-400 transition-colors"
              >
                <Wallet size={20} />
                Connect Wallet
              </button>
            ) : (
              <div className="text-right">
                <div className="text-sm text-gray-600">Connected</div>
                <div className="font-mono font-bold">{formatAddress(account)}</div>
              </div>
            )}
          </div>
        </div>

        {/* Hamburger Hero — click the burger to open it */}
        <div className="bg-gradient-to-br from-yellow-100 via-orange-100 to-red-100 rounded-lg shadow-lg mb-6 overflow-hidden">
          <div className="py-16 flex flex-col items-center justify-center">
            <button
              onClick={() => setAboutOpen(!aboutOpen)}
              className="leading-none focus:outline-none transition-transform hover:scale-105 active:scale-95 cursor-pointer select-none"
              style={{ fontSize: '20rem' }}
              aria-label="Toggle about section"
            >
              <span className={aboutOpen ? '' : 'inline-block animate-bounce'}>🍔</span>
            </button>
            {!aboutOpen && (
              <p className="text-orange-400 text-sm mt-2 animate-pulse">
                go ahead... click it
              </p>
            )}
          </div>
          {aboutOpen && (
            <div className="px-6 pb-8 max-w-3xl mx-auto text-sm text-gray-700 space-y-3">
              <p>
                <strong>HARBURGER</strong> is a well-done implementation of <em>Harberger taxation</em>—owners self-assess
                their price and pay continuous tax on it. Anyone can buy at the declared price. Set it too low, someone
                snatches your lunch. Too high, and the tax eats you alive. It's a rare medium for allocative efficiency.
              </p>
              <p>
                For the first time ever in a Harberger implementation: earn yield on your tax deposit instead of letting it sit idle.
              </p>
              <p>
                History: first was <em>This Artwork Is Always On Sale</em>, the <em>Wildcards</em> project, and <em>GraffitETH</em>.
                HARBURGER stands on the sesame-seed buns of these giants—with per-second tax accrual, an earmark system so you can 
                gift someone a burger with all the fixings, and vault yield via Aave V3/Compound V3.
              </p>
              <p className="text-xs text-gray-400 italic text-center">
                created by <a href="https://aleeza.rocks" target="_blank" rel="noopener noreferrer" className="underline hover:text-orange-400">aleeza.rocks</a>
              </p>
            </div>
          )}
        </div>

        {/* Alerts */}
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg mb-6 flex items-center gap-2">
            <AlertCircle size={20} />
            <span className="break-all">{error}</span>
            <button onClick={() => setError('')} className="ml-auto font-bold">×</button>
          </div>
        )}

        {success && (
          <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded-lg mb-6">
            {success}
          </div>
        )}

        {loading && (
          <div className="bg-yellow-50 border border-yellow-300 text-yellow-800 px-4 py-3 rounded-lg mb-6 flex items-center gap-3">
            <Loader2 size={20} className="animate-spin" />
            <span>Transaction pending — please confirm in your wallet and wait...</span>
          </div>
        )}

        {!account ? (
          <div className="bg-white rounded-lg shadow-lg p-12 text-center">
            <Wallet size={64} className="mx-auto mb-4 text-gray-400" />
            <h2 className="text-2xl font-bold mb-2">Connect Your Wallet</h2>
            <p className="text-gray-600">Connect your wallet to interact with the HARBURGER</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* NFT Info */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <Tag size={20} className="text-orange-500" />
                NFT Information
              </h2>
              <div className="space-y-3">
                <div>
                  <div className="text-sm text-gray-600">Collection</div>
                  <div className="font-bold">{contractData.nftName} ({contractData.nftSymbol})</div>
                </div>
                <div>
                  <div className="text-sm text-gray-600">Current Owner</div>
                  <div className="font-mono text-sm">{formatAddress(contractData.currentOwner)}</div>
                  {isOwner && <span className="text-green-600 text-sm">← You own this!</span>}
                </div>
                <div>
                  <div className="text-sm text-gray-600">Current Price</div>
                  <div className="font-bold text-2xl text-orange-600">
                    {formatEther(contractData.currentPrice)} ETH
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-600">Tax Rate</div>
                  <div className="font-bold">{annualTaxPercent(contractData.taxRate)}% per year</div>
                </div>
                <div>
                  <div className="text-sm text-gray-600">Tax Receiver</div>
                  <div className="font-mono text-sm">{formatAddress(contractData.taxReceiver)}</div>
                </div>
              </div>
            </div>

            {/* Account Info */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <DollarSign size={20} className="text-green-500" />
                Your Account
              </h2>
              <div className="space-y-3">
                <div>
                  <div className="text-sm text-gray-600">Net Balance</div>
                  <div className="font-bold text-2xl text-green-600">
                    {formatEther(accountData.netBalance)} ETH
                  </div>
                </div>
                {accountData.debt !== '0' && (
                  <div>
                    <div className="text-sm text-gray-600">Outstanding Debt</div>
                    <div className="font-bold text-lg text-red-600">
                      {formatEther(accountData.debt)} ETH
                    </div>
                  </div>
                )}
                <div className="bg-gray-50 p-3 rounded-lg">
                  <div className="text-xs text-gray-500 mb-1">Balance Breakdown</div>
                  <div className="text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Internal:</span>
                      <span className="font-mono font-bold">{formatEther(accountData.rawBalance)} ETH</span>
                    </div>
                    {accountData.usesVault && (
                      <div className="flex justify-between mt-1">
                        <span className="text-gray-600">Vault:</span>
                        <span className="font-mono font-bold text-purple-600">
                          {formatEther(vaultBalance)} ETH
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-sm text-gray-600">Vault Status:</div>
                  {accountData.usesVault ? (
                    <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded text-sm font-semibold">
                      ✓ Enabled
                    </span>
                  ) : (
                    <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-sm">
                      Disabled
                    </span>
                  )}
                </div>
                {isOwner && (
                  <div>
                    <div className="text-sm text-gray-600">Taxes Owed (pending)</div>
                    <div className="font-bold text-lg text-orange-600">
                      {formatEther(accountData.taxesOwed)} ETH
                    </div>
                  </div>
                )}
                <div>
                  <div className="text-sm text-gray-600">Total Taxes Paid</div>
                  <div className="font-bold">{formatEther(accountData.totalTaxesPaid)} ETH</div>
                </div>
              </div>
            </div>

            {/* Deposit/Withdraw */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-xl font-bold mb-4">Deposit & Withdraw</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Deposit (ETH)</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                      placeholder="0.001"
                      step="0.001"
                      className="flex-1 min-w-0 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                    />
                    <button
                      onClick={async () => { if (await handleDeposit(depositAmount)) setDepositAmount(''); }}
                      disabled={loading || !depositAmount || parseFloat(depositAmount) <= 0}
                      className="bg-green-500 text-white px-6 py-2 rounded-lg hover:bg-green-600 disabled:bg-gray-400 whitespace-nowrap"
                    >
                      Deposit
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Withdraw (ETH)</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(e.target.value)}
                      placeholder="0.001"
                      step="0.001"
                      className="flex-1 min-w-0 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                    />
                    <button
                      onClick={async () => { if (await handleWithdraw(withdrawAmount)) setWithdrawAmount(''); }}
                      disabled={loading || !withdrawAmount || parseFloat(withdrawAmount) <= 0}
                      className="bg-blue-500 text-white px-6 py-2 rounded-lg hover:bg-blue-600 disabled:bg-gray-400 whitespace-nowrap"
                    >
                      Withdraw
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Vault Management */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <TrendingUp size={20} className="text-purple-500" />
                Vault Management
              </h2>
              {contractData.taxVault && contractData.taxVault !== '0x0000000000000000000000000000000000000000' ? (
                <div className="space-y-4">
                  <div className="bg-purple-50 p-4 rounded-lg">
                    <p className="text-sm text-gray-700 mb-2">
                      {accountData.usesVault
                        ? 'Your deposits are earning yield through the TaxVault. Taxes will be paid from your vault balance when possible.'
                        : 'Enable the vault to earn yield on your deposits. Your funds will be deployed to yield-generating strategies.'}
                    </p>
                    <div className="text-xs text-gray-600 font-mono">
                      Vault: {formatAddress(contractData.taxVault)}
                    </div>
                  </div>
                  {accountData.usesVault ? (
                    <button
                      onClick={handleDisableVault}
                      disabled={loading}
                      className="w-full bg-gray-500 text-white px-6 py-3 rounded-lg hover:bg-gray-600 disabled:bg-gray-400 font-semibold"
                    >
                      Disable Vault
                    </button>
                  ) : (
                    <button
                      onClick={handleEnableVault}
                      disabled={loading}
                      className="w-full bg-purple-500 text-white px-6 py-3 rounded-lg hover:bg-purple-600 disabled:bg-gray-400 font-semibold"
                    >
                      Enable Vault (Earn Yield)
                    </button>
                  )}
                </div>
              ) : (
                <div className="bg-gray-50 p-4 rounded-lg text-center text-gray-600">
                  <p className="text-sm">Vault not configured for this contract</p>
                </div>
              )}
            </div>

            {/* Owner Actions */}
            {isOwner && (
              <div className="bg-white rounded-lg shadow-lg p-6">
                <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                  <TrendingUp size={20} className="text-orange-500" />
                  Owner Actions
                </h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Set New Price (ETH)</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={newPrice}
                        onChange={(e) => setNewPrice(e.target.value)}
                        placeholder="0.002"
                        step="0.001"
                        className="flex-1 min-w-0 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                      />
                      <button
                        onClick={async () => { if (await handleSetPrice(newPrice)) setNewPrice(''); }}
                        disabled={loading || !newPrice || parseFloat(newPrice) <= 0}
                        className="bg-orange-500 text-white px-6 py-2 rounded-lg hover:bg-orange-600 disabled:bg-gray-400 whitespace-nowrap"
                      >
                        Set Price
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Buy NFT */}
            {!isOwner && (
              <div className="bg-white rounded-lg shadow-lg p-6">
                <h2 className="text-xl font-bold mb-4">Buy This NFT</h2>
                <div className="space-y-4">
                  <div className="bg-orange-50 p-4 rounded-lg">
                    <div className="text-sm text-gray-600 mb-1">Purchase Price</div>
                    <div className="text-2xl font-bold text-orange-600">
                      {formatEther(contractData.currentPrice)} ETH
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Your New Price (ETH)</label>
                    <input
                      type="number"
                      value={buyPrice}
                      onChange={(e) => setBuyPrice(e.target.value)}
                      placeholder="0.002"
                      step="0.001"
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                    />
                  </div>
                  <p className="text-xs text-gray-500">
                    Payment comes from your deposited balance, not your wallet. Deposit at least {formatEther(contractData.currentPrice)} ETH first.
                  </p>
                  <button
                    onClick={async () => { if (await handleBuyNFT(buyPrice)) setBuyPrice(''); }}
                    disabled={loading || !buyPrice || parseFloat(buyPrice) <= 0}
                    className="w-full bg-orange-500 text-white px-6 py-3 rounded-lg hover:bg-orange-600 disabled:bg-gray-400 font-bold"
                  >
                    Buy NFT
                  </button>
                </div>
              </div>
            )}

            {/* Earmark System */}
            {isOwner && (
              <div className="bg-white rounded-lg shadow-lg p-6 lg:col-span-2">
                <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                  <Gift size={20} className="text-purple-500" />
                  Earmark System
                </h2>
                {earmark.active ? (
                  <div className="space-y-4">
                    <div className="bg-purple-50 p-4 rounded-lg">
                      <div className="text-sm text-gray-600">Active Earmark</div>
                      <div className="font-mono text-sm mb-2">To: {formatAddress(earmark.receiver)}</div>
                      <div className="font-bold">Deposit: {formatEther(earmark.depositAmount)} ETH</div>
                    </div>
                    <button
                      onClick={handleCancelEarmark}
                      disabled={loading}
                      className="bg-red-500 text-white px-6 py-2 rounded-lg hover:bg-red-600 disabled:bg-gray-400"
                    >
                      Cancel Earmark
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">Receiver Address</label>
                      <input
                        type="text"
                        value={earmarkReceiver}
                        onChange={(e) => setEarmarkReceiver(e.target.value)}
                        placeholder="0x..."
                        className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">Gift deposit from your balance (ETH, optional)</label>
                      <input
                        type="number"
                        value={earmarkDeposit}
                        onChange={(e) => setEarmarkDeposit(e.target.value)}
                        placeholder="0.001"
                        step="0.001"
                        className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                      />
                    </div>
                    <button
                      onClick={async () => {
                        if (await handleEarmark(earmarkReceiver, earmarkDeposit)) {
                          setEarmarkReceiver('');
                          setEarmarkDeposit('');
                        }
                      }}
                      disabled={loading || !earmarkReceiver}
                      className="bg-purple-500 text-white px-6 py-2 rounded-lg hover:bg-purple-600 disabled:bg-gray-400"
                    >
                      Earmark NFT
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Claim Earmark */}
            {isEarmarkReceiver && earmark.active && (
              <div className="bg-white rounded-lg shadow-lg p-6 lg:col-span-2">
                <h2 className="text-xl font-bold mb-4 text-purple-600">🎁 Claim Your Earmarked NFT!</h2>
                <div className="space-y-4">
                  <div className="bg-purple-50 p-4 rounded-lg">
                    <div className="text-sm text-gray-600">Deposit Included</div>
                    <div className="text-2xl font-bold text-purple-600">
                      {formatEther(earmark.depositAmount)} ETH
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Your New Price (ETH)</label>
                    <input
                      type="number"
                      value={claimPrice}
                      onChange={(e) => setClaimPrice(e.target.value)}
                      placeholder="0.002"
                      step="0.001"
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    />
                  </div>
                  <button
                    onClick={async () => { if (await handleClaimEarmark(claimPrice)) setClaimPrice(''); }}
                    disabled={loading || !claimPrice || parseFloat(claimPrice) <= 0}
                    className="w-full bg-purple-500 text-white px-6 py-3 rounded-lg hover:bg-purple-600 disabled:bg-gray-400 font-bold"
                  >
                    Claim Earmarked NFT
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-8 text-gray-600 text-sm pb-4">
          <p>HARBURGER - A Harberger Tax Implementation</p>
          <p className="mt-1 font-mono text-xs break-all">Contract: {CONTRACT_ADDRESS}</p>
        </div>
      </div>
    </div>
  );
};

export default App;
