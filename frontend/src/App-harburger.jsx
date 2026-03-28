import { useState, useEffect, useRef } from 'react';
import { ethers } from 'ethers';
import { AlertCircle, Wallet, DollarSign, Tag, Gift, TrendingUp, ExternalLink, Github, Twitter, ArrowDownUp, ArrowRightLeft, ChevronDown, Pencil, Check, X } from 'lucide-react';
import { CONTRACT_ADDRESS } from './contractABI';
import { useHarburger } from './hooks/useHarburger';

const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID || 1);
const EXPLORER_BASE = {
  1: 'https://etherscan.io',
  11155111: 'https://sepolia.etherscan.io',
  42161: 'https://arbiscan.io',
  421614: 'https://sepolia.arbiscan.io',
}[CHAIN_ID] || 'https://etherscan.io';


const ExplorerLink = ({ address, children }) => (
  <a
    href={`${EXPLORER_BASE}/address/${address}`}
    target="_blank"
    rel="noopener noreferrer"
    className="inline-flex items-center gap-1 text-orange-500 hover:text-orange-700"
    title={address}
  >
    {children}
    <ExternalLink size={12} />
  </a>
);

const App = () => {
  const {
    account, loading, error, setError, success,
    contractData, accountData, earmark,
    isOwner, isEarmarkReceiver, vaultBalance, walletBalance, topTaxpayers, vaultEnabled,
    strategies, strategyNames, vaultBreakdown,
    connectWallet,
    handleDeposit, handleWithdraw, handleSetPrice, handleBuyNFT,
    handleEarmark, handleClaimEarmark, handleCancelEarmark,
    handleEnableVault, handleDisableVault,
    handleMoveStrategy, handleMoveToVault, handleMoveFromVault,
    formatAddress, formatEther, annualTaxPercent
  } = useHarburger();

  // Keep toast visible for at least 1.5s so it doesn't flash
  const [showLoading, setShowLoading] = useState(false);
  const loadingSince = useRef(null);
  useEffect(() => {
    if (loading) {
      loadingSince.current = Date.now();
      setShowLoading(true);
    } else if (loadingSince.current) {
      const elapsed = Date.now() - loadingSince.current;
      const remaining = Math.max(0, 1500 - elapsed);
      const id = setTimeout(() => setShowLoading(false), remaining);
      return () => clearTimeout(id);
    }
  }, [loading]);

  const strategyLabel = (addr) => {
    if (addr === ethers.ZeroAddress) return 'Vault (Idle)';
    return strategyNames[addr] || `Strategy (${formatAddress(addr)})`;
  };

  // Form states (UI only — not contract logic)
  const [dwMode, setDwMode] = useState('deposit');
  const [depositAmount, setDepositAmount] = useState('');
  const [depositDest, setDepositDest] = useState('internal');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawSource, setWithdrawSource] = useState('internal');
  const [moveAmount, setMoveAmount] = useState('');
  const [moveFrom, setMoveFrom] = useState('internal');
  const [moveTo, setMoveTo] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [buyPrice, setBuyPrice] = useState('');
  const [earmarkReceiver, setEarmarkReceiver] = useState('');
  const [earmarkDeposit, setEarmarkDeposit] = useState('');
  const [claimPrice, setClaimPrice] = useState('');
  const [aboutOpen, setAboutOpen] = useState(false);
  const [vaultMgmtOpen, setVaultMgmtOpen] = useState(false);
  const [earmarkOpen, setEarmarkOpen] = useState(false);
  const [editingPrice, setEditingPrice] = useState(false);

  const isValidRecipient = (val) => {
    if (!val) return false;
    if (ethers.isAddress(val)) return true;
    if (/^[a-zA-Z0-9-]+\.eth$/.test(val)) return true;
    return false;
  };

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
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-3xl font-bold text-orange-600 whitespace-nowrap">🍔 HARBURGER</h1>
            </div>
            {!account ? (
              <button
                onClick={connectWallet}
                disabled={loading}
                className="flex items-center justify-center gap-2 bg-orange-500 text-white px-4 py-2 sm:px-6 sm:py-3 rounded-lg hover:bg-orange-600 disabled:bg-gray-400 transition-colors whitespace-nowrap shrink-0"
              >
                <Wallet size={18} />
                <span className="hidden sm:inline">Connect Wallet</span>
                <span className="sm:hidden">Connect</span>
              </button>
            ) : (
              <div className="text-right shrink-0">
                <div className="text-xs text-gray-500">Connected</div>
                <div className="font-mono font-bold text-xs sm:text-sm">{formatAddress(account)}</div>
              </div>
            )}
          </div>
        </div>

        {/* Hamburger Hero — click the burger to open it */}
        <div className="bg-gradient-to-br from-yellow-100 via-orange-100 to-red-100 rounded-lg shadow-lg mb-6 overflow-hidden">
          <div className="py-16 flex flex-col items-center justify-center">
            <button
              onClick={() => setAboutOpen(!aboutOpen)}
              className="leading-none focus:outline-none transition-transform hover:scale-105 active:scale-95 cursor-pointer select-none text-[80vw] sm:text-[14rem] lg:text-[28rem]"
              aria-label="Toggle about section"
            >
              <span className={aboutOpen ? '' : 'inline-block animate-bounce'}>🍔</span>
            </button>
            {!aboutOpen && (
              <p className="text-orange-400 font-semibold text-base mt-2 animate-pulse text-center drop-shadow-sm">
                this is HARBURGER<br />go ahead... click
              </p>
            )}
          </div>
          {aboutOpen && (
            <div className="px-6 pb-8 max-w-2xl mx-auto text-gray-700 space-y-5">
              <p className="text-sm leading-relaxed">
                <strong>HARBURGER</strong> is a well-done implementation of Harberger taxation—an idea from economist Arnold Harberger in 1962, popularized by Weyl & Posner's <em>Radical Markets</em>.
                Owners self-assess their price and pay continuous tax on it. Anyone can buy at the declared price. Set it too low, someone snatches your lunch. Too high,
                and the tax eats you alive. It's a rare medium for allocative efficiency.
              </p>
              <p className="text-sm leading-relaxed">
                <strong>For the first time ever in a Harberger implementation</strong> earn yield on your tax deposit instead of letting it sit idle.
              </p>
              <div className="text-xs text-gray-400 text-center space-y-1.5 pt-2">
                <p>
                  Standing on the sesame-seed buns of{' '}
                  <a href="https://thisartworkisalwaysonsale.com/" target="_blank" rel="noopener noreferrer" className="underline hover:text-orange-400">This Artwork Is Always On Sale</a>,{' '}
                  <a href="https://github.com/wildcards-world" target="_blank" rel="noopener noreferrer" className="underline hover:text-orange-400">Wildcards</a>, and{' '}
                  <a href="https://www.graffiteth.lol/" target="_blank" rel="noopener noreferrer" className="underline hover:text-orange-400">GraffitETH</a>.
                </p>
                <p className="italic">
                  created by <a href="https://aleeza.rocks" target="_blank" rel="noopener noreferrer" className="underline hover:text-orange-400">aleeza.rocks</a>
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Alerts */}
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg mb-6 flex items-start gap-2">
            <AlertCircle size={20} className="shrink-0 mt-0.5" />
            <span className="break-all text-sm sm:text-base">{error}</span>
            <button onClick={() => setError('')} className="ml-auto font-bold shrink-0">×</button>
          </div>
        )}

        {success && (
          <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded-lg mb-6">
            {success}
          </div>
        )}

        {showLoading && (
          <div className="fixed bottom-6 right-6 z-50 bg-white/90 border border-yellow-300 rounded-xl shadow-lg p-3 toast-enter">
            <div className="text-4xl flex flex-col-reverse items-center burger-stack">
              <span className="burger-layer-up" style={{ animationDelay: '0s' }}>🍞</span>
              <span className="burger-layer-up" style={{ animationDelay: '0.2s' }}>🥩</span>
              <span className="burger-layer-up" style={{ animationDelay: '0.4s' }}>🧀</span>
              <span className="burger-layer-up" style={{ animationDelay: '0.6s' }}>🥬</span>
              <span className="burger-layer-up" style={{ animationDelay: '0.8s' }}>🍞</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Harburger */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <Tag size={20} className="text-orange-500" />
              Harburger
            </h2>
            <div className="bg-orange-50 rounded-lg p-4 mb-4">
              <div className="text-sm text-orange-700">Current Price</div>
              <div className="flex items-center gap-2">
                <div className="font-bold text-2xl text-orange-600 font-mono">
                  {formatEther(contractData.currentPrice)} ETH
                </div>
                {isOwner && !editingPrice && (
                  <button
                    onClick={() => setEditingPrice(true)}
                    className="text-orange-400 hover:text-orange-600 transition-colors"
                    title="Change price"
                  >
                    <Pencil size={16} />
                  </button>
                )}
              </div>
              {isOwner && editingPrice && (
                <div className="flex gap-2 mt-2">
                  <input
                    type="number" min="0"
                    value={newPrice}
                    onChange={(e) => setNewPrice(e.target.value)}
                    placeholder="New price in ETH"
                    step="0.001"
                    className="flex-1 min-w-0 px-3 py-1.5 text-sm border rounded-lg placeholder:text-gray-300 focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                    autoFocus
                  />
                  <button
                    onClick={async () => { if (await handleSetPrice(newPrice)) { setNewPrice(''); setEditingPrice(false); } }}
                    disabled={loading || !newPrice || parseFloat(newPrice) <= 0}
                    className="bg-orange-500 text-white p-1.5 rounded-lg hover:bg-orange-600 disabled:bg-gray-400"
                  >
                    <Check size={16} />
                  </button>
                  <button
                    onClick={() => { setNewPrice(''); setEditingPrice(false); }}
                    className="text-gray-400 hover:text-gray-600 p-1.5"
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
              <div className="flex items-center gap-1 mt-2 text-xs text-gray-500">
                <span>Owner:</span>
                <ExplorerLink address={contractData.currentOwner}>
                  <span className="font-mono font-medium text-gray-700">{formatAddress(contractData.currentOwner)}</span>
                </ExplorerLink>
                {isOwner && <span className="text-green-600 font-semibold">← You!</span>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-xs text-gray-500">Tax Rate</div>
                <div className="font-bold font-mono mt-0.5">{annualTaxPercent(contractData.taxRate)}%<span className="text-xs font-normal text-gray-400"> /yr</span></div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-xs text-gray-500">Tax Receiver</div>
                <div className="mt-0.5">
                  <ExplorerLink address={contractData.taxReceiver}>
                    <span className="font-mono text-sm font-medium">{formatAddress(contractData.taxReceiver)}</span>
                  </ExplorerLink>
                </div>
              </div>
            </div>
          </div>

          {/* Top Taxpayers — visible without wallet */}
          {topTaxpayers.length > 0 && (
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <TrendingUp size={20} className="text-orange-500" />
                Patty Daddies
              </h2>
              <p className="text-xs text-gray-400 mb-4">Ranked by total taxes paid</p>
              <div className="space-y-2">
                {topTaxpayers.map((entry, i) => (
                  <div key={entry.address} className="flex items-center gap-3">
                    <div className="w-7 text-center font-bold text-sm shrink-0">
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : <span className="text-gray-400">{i + 1}</span>}
                    </div>
                    <div className="flex-1 min-w-0 flex items-center justify-between gap-2 bg-gray-50 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <ExplorerLink address={entry.address}>
                          <span className="font-mono text-sm">{formatAddress(entry.address)}</span>
                        </ExplorerLink>
                        {entry.address === account && <span className="text-xs text-green-600 font-semibold shrink-0">You</span>}
                      </div>
                      <span className="font-mono font-bold text-sm text-orange-600 shrink-0">{formatEther(entry.total)} ETH</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Connect wallet prompt — only when not connected */}
          {!account && (
            <div className="bg-white rounded-lg shadow-lg p-8 text-center lg:col-span-2">
              <Wallet size={48} className="mx-auto mb-3 text-gray-400" />
              <h2 className="text-xl font-bold mb-1">Connect Your Wallet</h2>
              <p className="text-gray-600 text-sm">Connect your wallet to buy, deposit, manage your vault, and more</p>
            </div>
          )}

          {account && (
            <>
            {/* Your Account */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <DollarSign size={20} className="text-green-500" />
                Your Account
              </h2>
              <div className="bg-green-50 rounded-lg p-4 mb-4">
                <div className="text-sm text-green-700">Balance</div>
                <div className="font-bold text-2xl text-green-600 font-mono">
                  {formatEther(accountData.netBalance)} ETH
                </div>
                {accountData.usesVault && (
                  <div className="flex gap-4 mt-2 text-xs text-gray-500">
                    <span>Internal: <span className="font-mono font-medium text-gray-700">{formatEther(accountData.rawBalance)}</span></span>
                    <span>Vault: <span className="font-mono font-medium text-purple-600">{formatEther(vaultBalance)}</span></span>
                  </div>
                )}
              </div>
              {accountData.debt !== '0' && (
                <div className="bg-red-50 rounded-lg p-3 mb-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-red-700">Outstanding Debt</span>
                    <span className="font-bold text-red-600 font-mono">{formatEther(accountData.debt)} ETH</span>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-500">Taxes Paid</div>
                  <div className="font-bold font-mono mt-0.5">
                    {formatEther((BigInt(accountData.totalTaxesPaid || '0') + BigInt(accountData.taxesOwed || '0')).toString())} ETH
                  </div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-500">Vault</div>
                  <div className="mt-0.5">
                    {accountData.usesVault ? (
                      <span className="text-sm font-semibold text-purple-600">Enabled</span>
                    ) : (
                      <span className="text-sm font-semibold text-gray-400">Disabled</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Deposit / Withdraw / Move */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <div className="flex items-center gap-3 mb-4">
                <ArrowDownUp size={20} className="text-green-500 shrink-0" />
                <div className="flex bg-gray-100 rounded-lg p-1 flex-1">
                  <button
                    onClick={() => setDwMode('deposit')}
                    className={`flex-1 py-1.5 text-sm font-semibold rounded-md transition-colors ${dwMode === 'deposit' ? 'bg-white shadow text-green-600' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    Deposit
                  </button>
                  <button
                    onClick={() => setDwMode('withdraw')}
                    className={`flex-1 py-1.5 text-sm font-semibold rounded-md transition-colors ${dwMode === 'withdraw' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    Withdraw
                  </button>
                  {vaultEnabled && (
                    <button
                      onClick={() => setDwMode('move')}
                      className={`flex-1 py-1.5 text-sm font-semibold rounded-md transition-colors ${dwMode === 'move' ? 'bg-white shadow text-purple-600' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      Move
                    </button>
                  )}
                </div>
              </div>

              {dwMode === 'deposit' && (
                <div>
                  {vaultEnabled && (
                    <select
                      value={depositDest}
                      onChange={(e) => setDepositDest(e.target.value)}
                      className="w-full mb-2 px-4 py-2 border rounded-lg bg-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                    >
                      <option value="internal">Internal Balance</option>
                      {strategies.map((s) => (
                        <option key={s} value={s}>{strategyLabel(s)}</option>
                      ))}
                    </select>
                  )}
                  <div className="flex gap-2">
                    <div className="flex-1 min-w-0">
                      <input
                        type="number" min="0"
                        value={depositAmount}
                        onChange={(e) => setDepositAmount(e.target.value)}
                        placeholder="Amount in ETH"
                        step="0.001"
                        className="w-full px-4 py-2 border rounded-lg placeholder:text-gray-300 focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                      />
                      <button
                        type="button"
                        onClick={() => setDepositAmount(formatEther(walletBalance))}
                        className="text-xs text-gray-400 hover:text-orange-500 mt-1"
                      >
                        max
                      </button>
                    </div>
                    <button
                      onClick={async () => { if (await handleDeposit(depositAmount, vaultEnabled ? depositDest : 'internal')) setDepositAmount(''); }}
                      disabled={loading || !depositAmount || parseFloat(depositAmount) <= 0}
                      className="bg-green-500 text-white px-6 py-2 rounded-lg hover:bg-green-600 disabled:bg-gray-400 whitespace-nowrap self-start"
                    >
                      Deposit
                    </button>
                  </div>
                </div>
              )}

              {dwMode === 'withdraw' && (
                <div>
                  {vaultEnabled && (
                    <select
                      value={withdrawSource}
                      onChange={(e) => setWithdrawSource(e.target.value)}
                      className="w-full mb-2 px-4 py-2 border rounded-lg bg-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                    >
                      <option value="internal">Internal Balance</option>
                      {strategies.map((s) => (
                        <option key={s} value={s}>{strategyLabel(s)}</option>
                      ))}
                      {vaultBreakdown.some(e => e.address === ethers.ZeroAddress) && (
                        <option value={ethers.ZeroAddress}>Vault (Idle)</option>
                      )}
                    </select>
                  )}
                  <div className="flex gap-2">
                    <div className="flex-1 min-w-0">
                      <input
                        type="number" min="0"
                        value={withdrawAmount}
                        onChange={(e) => setWithdrawAmount(e.target.value)}
                        placeholder="Amount in ETH"
                        step="0.001"
                        className="w-full px-4 py-2 border rounded-lg placeholder:text-gray-300 focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                      />
                      <button
                        type="button"
                        onClick={() => setWithdrawAmount(formatEther(accountData.rawBalance))}
                        className="text-xs text-gray-400 hover:text-orange-500 mt-1"
                      >
                        max
                      </button>
                    </div>
                    <button
                      onClick={async () => { if (await handleWithdraw(withdrawAmount, vaultEnabled ? withdrawSource : 'internal')) setWithdrawAmount(''); }}
                      disabled={loading || !withdrawAmount || parseFloat(withdrawAmount) <= 0}
                      className="bg-blue-500 text-white px-6 py-2 rounded-lg hover:bg-blue-600 disabled:bg-gray-400 whitespace-nowrap self-start"
                    >
                      Withdraw
                    </button>
                  </div>
                </div>
              )}

              {dwMode === 'move' && vaultEnabled && (
                <div className="space-y-3">
                  <div className="flex flex-col sm:grid sm:grid-cols-[1fr_auto_1fr] gap-2 sm:items-center">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1 sm:hidden">From</label>
                      <select
                        value={moveFrom}
                        onChange={(e) => setMoveFrom(e.target.value)}
                        className="w-full px-4 py-2 border rounded-lg bg-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                      >
                        <option value="internal">Internal Balance</option>
                        {strategies.map((s) => (
                          <option key={s} value={s}>{strategyLabel(s)}</option>
                        ))}
                        {vaultBreakdown.some(e => e.address === ethers.ZeroAddress) && (
                          <option value={ethers.ZeroAddress}>Vault (Idle)</option>
                        )}
                      </select>
                    </div>
                    <ArrowRightLeft size={16} className="text-gray-400 hidden sm:block" />
                    <div>
                      <label className="block text-xs text-gray-500 mb-1 sm:hidden">To</label>
                      <select
                        value={moveTo}
                        onChange={(e) => setMoveTo(e.target.value)}
                        className="w-full px-4 py-2 border rounded-lg bg-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                      >
                        <option value="">Select strategy</option>
                        <option value="internal">Internal Balance</option>
                        {strategies.map((s) => (
                          <option key={s} value={s}>{strategyLabel(s)}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1 min-w-0">
                      <input
                        type="number" min="0"
                        value={moveAmount}
                        onChange={(e) => setMoveAmount(e.target.value)}
                        placeholder="Amount in ETH"
                        step="0.001"
                        className="w-full px-4 py-2 border rounded-lg placeholder:text-gray-300 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (moveFrom === 'internal') {
                            setMoveAmount(formatEther(accountData.rawBalance));
                          } else {
                            const entry = vaultBreakdown.find(e => e.address === moveFrom);
                            if (entry) setMoveAmount(formatEther(entry.balance));
                          }
                        }}
                        className="text-xs text-gray-400 hover:text-purple-500 mt-1"
                      >
                        max
                      </button>
                    </div>
                    <button
                      onClick={async () => {
                        if (!moveTo || moveFrom === moveTo) return;
                        let ok;
                        if (moveFrom === 'internal') {
                          ok = await handleMoveToVault(moveAmount, moveTo);
                        } else if (moveTo === 'internal') {
                          ok = await handleMoveFromVault(moveAmount, moveFrom);
                        } else {
                          ok = await handleMoveStrategy(moveAmount, moveFrom, moveTo);
                        }
                        if (ok) setMoveAmount('');
                      }}
                      disabled={loading || !moveAmount || parseFloat(moveAmount) <= 0 || !moveTo || moveFrom === moveTo}
                      className="bg-purple-500 text-white px-6 py-2 rounded-lg hover:bg-purple-600 disabled:bg-gray-400 whitespace-nowrap self-start"
                    >
                      Move
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Vault Management */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <button
                onClick={() => setVaultMgmtOpen(!vaultMgmtOpen)}
                className="w-full flex items-center justify-between"
              >
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <TrendingUp size={20} className="text-purple-500" />
                  Vault Management
                </h2>
                <ChevronDown size={20} className={`text-gray-400 transition-transform ${vaultMgmtOpen ? 'rotate-180' : ''}`} />
              </button>
              {vaultMgmtOpen && (contractData.taxVault && contractData.taxVault !== '0x0000000000000000000000000000000000000000' ? (
                <div className="mt-4 space-y-4">
                  {accountData.usesVault ? (
                    <>
                      <p className="text-sm text-gray-600">
                        Taxes will be paid from your vault balance when possible.
                      </p>
                      {/* Strategy cards */}
                      <div className="space-y-2">
                        {strategies.map((s) => {
                          const entry = vaultBreakdown.find(e => e.address === s);
                          const bal = entry ? entry.balance : '0';
                          return (
                            <div key={s} className="bg-purple-50 p-3 rounded-lg">
                              <div className="flex items-center justify-between">
                                <div>
                                  <div className="text-sm font-semibold text-purple-700">
                                    Aave V3 WETH
                                  </div>
                                  <div className="text-xs text-gray-500 flex items-center gap-1">
                                    <ExplorerLink address={s}>
                                      <span>{formatAddress(s)}</span>
                                    </ExplorerLink>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className="font-mono font-bold text-sm">{formatEther(bal)} ETH</div>
                                  <div className="text-xs text-green-600">Variable APY</div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {/* Idle balance in vault */}
                        {(() => {
                          const idle = vaultBreakdown.find(e => e.address === ethers.ZeroAddress);
                          if (!idle || idle.balance === '0') return null;
                          return (
                            <div className="bg-gray-50 p-3 rounded-lg">
                              <div className="flex items-center justify-between">
                                <div className="text-sm font-semibold text-gray-600">Idle (No Yield)</div>
                                <div className="font-mono font-bold text-sm">{formatEther(idle.balance)} ETH</div>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                      <div className="text-xs text-gray-500 font-mono flex items-center gap-1">
                        TaxVault:{' '}
                        <ExplorerLink address={contractData.taxVault}>
                          <span>{formatAddress(contractData.taxVault)}</span>
                        </ExplorerLink>
                      </div>
                      <button
                        onClick={handleDisableVault}
                        disabled={loading}
                        className="w-full bg-gray-500 text-white px-6 py-3 rounded-lg hover:bg-gray-600 disabled:bg-gray-400 font-semibold"
                      >
                        Disable Vault
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="bg-purple-50 p-4 rounded-lg">
                        <p className="text-sm text-gray-700 mb-3">
                          Enable the vault to earn yield on your deposits through DeFi strategies.
                        </p>
                        {strategies.length > 0 && (
                          <div className="space-y-1.5">
                            <div className="text-xs font-semibold text-gray-500 uppercase">Available Strategies</div>
                            {strategies.map((s) => (
                              <div key={s} className="flex items-center justify-between text-sm">
                                <span className="text-purple-700 font-medium">Aave V3 WETH</span>
                                <span className="text-xs text-green-600">Variable APY</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={handleEnableVault}
                        disabled={loading}
                        className="w-full bg-purple-500 text-white px-6 py-3 rounded-lg hover:bg-purple-600 disabled:bg-gray-400 font-semibold"
                      >
                        Enable Vault (Earn Yield)
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <div className="mt-4 bg-gray-50 p-4 rounded-lg text-center text-gray-600">
                  <p className="text-sm">Vault not configured for this contract</p>
                </div>
              ))}
            </div>

            {/* Earmark System */}
            {isOwner && (
              <div className="bg-white rounded-lg shadow-lg p-6">
                <button
                  onClick={() => setEarmarkOpen(!earmarkOpen)}
                  className="w-full flex items-center justify-between"
                >
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <Gift size={20} className="text-purple-500" />
                    Earmark System
                  </h2>
                  <ChevronDown size={20} className={`text-gray-400 transition-transform ${earmarkOpen ? 'rotate-180' : ''}`} />
                </button>
                {earmarkOpen && (earmark.active ? (
                  <div className="mt-4 space-y-4">
                    <div className="bg-purple-50 p-4 rounded-lg">
                      <div className="text-sm text-gray-600">Active Earmark</div>
                      <div className="font-mono text-sm mb-2 flex items-center gap-1">
                        To:{' '}
                        <ExplorerLink address={earmark.receiver}>
                          <span>{formatAddress(earmark.receiver)}</span>
                        </ExplorerLink>
                      </div>
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
                  <div className="mt-4 space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">Receiver Address</label>
                      <input
                        type="text"
                        value={earmarkReceiver}
                        onChange={(e) => setEarmarkReceiver(e.target.value.trim())}
                        placeholder="0x... or name.eth"
                        className={`w-full px-4 py-2 border rounded-lg placeholder:text-gray-300 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 font-mono ${earmarkReceiver && !isValidRecipient(earmarkReceiver) ? 'border-red-400' : ''}`}
                      />
                      {earmarkReceiver && !isValidRecipient(earmarkReceiver) && (
                        <p className="text-xs text-red-500 mt-1">Enter a valid address (0x...) or ENS name (name.eth)</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">Gift deposit from your balance (ETH, optional)</label>
                      <input
                        type="number" min="0"
                        value={earmarkDeposit}
                        onChange={(e) => setEarmarkDeposit(e.target.value)}
                        placeholder="0.001"
                        step="0.001"
                        className="w-full px-4 py-2 border rounded-lg placeholder:text-gray-300 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                      />
                    </div>
                    <button
                      onClick={async () => {
                        if (await handleEarmark(earmarkReceiver, earmarkDeposit)) {
                          setEarmarkReceiver('');
                          setEarmarkDeposit('');
                        }
                      }}
                      disabled={loading || !isValidRecipient(earmarkReceiver)}
                      className="bg-purple-500 text-white px-6 py-2 rounded-lg hover:bg-purple-600 disabled:bg-gray-400"
                    >
                      Earmark NFT
                    </button>
                  </div>
                ))}
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
                      type="number" min="0"
                      value={buyPrice}
                      onChange={(e) => setBuyPrice(e.target.value)}
                      placeholder="0.002"
                      step="0.001"
                      className="w-full px-4 py-2 border rounded-lg placeholder:text-gray-300 focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
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

            {/* Claim Earmark */}
            {isEarmarkReceiver && earmark.active && (
              <div className="bg-white rounded-lg shadow-lg p-6">
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
                      type="number" min="0"
                      value={claimPrice}
                      onChange={(e) => setClaimPrice(e.target.value)}
                      placeholder="0.002"
                      step="0.001"
                      className="w-full px-4 py-2 border rounded-lg placeholder:text-gray-300 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
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
          </>
          )}
        </div>

        {/* Footer */}
        <div className="bg-white rounded-lg shadow-lg p-4 mt-6 mb-4 flex items-center justify-center gap-4 text-sm text-gray-500">
          <a
            href={`${EXPLORER_BASE}/address/${CONTRACT_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 hover:text-orange-600 transition-colors"
          >
            <ExternalLink size={14} />
            Contract
          </a>
          <span className="text-gray-300">|</span>
          <a
            href="https://x.com/HarburgerBot"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 hover:text-orange-600 transition-colors"
          >
            <Twitter size={14} />
            @HarburgerBot
          </a>
          <span className="text-gray-300">|</span>
          <a
            href="https://github.com/herculeeza/harburger"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 hover:text-orange-600 transition-colors"
          >
            <Github size={14} />
            GitHub
          </a>
        </div>
      </div>
    </div>
  );
};

export default App;
