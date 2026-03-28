# HARBURGER

Harberger tax NFT. You buy the burger, set your own price, and pay continuous tax on that price. Anyone can force-buy it from you at the price you set. If you can't cover your taxes, anyone can take it for free. Deposited funds can optionally earn yield through Aave or Compound.

## Setup

```bash
npm install
cd frontend && npm install && cd ..
```

## Build & Test

```bash
npx hardhat compile
npx hardhat test
```

## Configuration

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Key settings:

- `PRIVATE_KEY` — deployer wallet private key (without `0x`)
- `SEPOLIA_URL` / `MAINNET_URL` — RPC endpoint (Alchemy, Infura, etc.)
- `TAX_RECEIVER` — address that receives tax payments
- `ANNUAL_TAX_PERCENT` — annual tax as a percentage of declared price (default: 10)
- `INITIAL_PRICE` — starting price in Wei (default: 0.001 ETH)

The deploy script converts `ANNUAL_TAX_PERCENT` to a per-second rate scaled by `RATE_PRECISION` (1e18). You can override this by setting `TAX_RATE` directly.

DeFi strategy addresses (`AAVE_POOL_ADDRESSES_PROVIDER`, `WETH_ADDRESS`, `AWETH_ADDRESS`, `COMPOUND_COMET`) are optional. Leave as zero addresses to skip strategy deployment.

## Deploy

```bash
npm run deploy:sepolia    # testnet
npm run deploy:mainnet    # production
```

Deployment addresses are saved to `deployments-<network>.json`.

## Verify

```bash
npx hardhat verify --network <network> \
  HARBURGER_ADDRESS \
  "NFT_NAME" "NFT_SYMBOL" \
  TAX_RATE TAX_RECEIVER INITIAL_PRICE TAXVAULT_ADDRESS
```

Constructor values are in the deployment JSON file.

## Frontend

```bash
cd frontend
cp .env.example .env
# Set VITE_CONTRACT_ADDRESS to your deployed Harburger address
npm run dev
```

## How It Works

1. The deployer mints the NFT and sets an initial price
2. The owner pays continuous taxes (per-second, proportional to their declared price)
3. Anyone can deposit ETH, then force-buy the NFT at the current price
4. The owner can earmark the NFT for a specific address with an optional deposit
5. If the owner runs out of funds, the NFT can be claimed for free
6. Deposited funds can optionally be routed through a TaxVault into yield strategies (Aave V3, Compound V3)

## Tax Receiver

`TAX_RECEIVER` is set as a plain address at deploy time. If you use an ENS name, resolve it to an address first. To change the tax receiver after deployment, the contract owner calls `updateTaxReceiver(newAddress)`.

## Commands

| Command | Description |
|---------|-------------|
| `npm run compile` | Compile contracts |
| `npm run test` | Run tests |
| `npm run node` | Start local node |
| `npm run deploy:localhost` | Deploy locally |
| `npm run deploy:sepolia` | Deploy to Sepolia |
| `npm run deploy:mainnet` | Deploy to mainnet |

## Project Structure

```
contracts/
  Harburger.sol              Main Harberger tax NFT contract
  TaxVault.sol               Multi-strategy yield vault for tax deposits
  ITaxVault.sol              TaxVault interface
  IYieldStrategy.sol         Yield strategy interface
  strategies/
    AaveStrategy.sol         Aave V3 strategy
    CompoundStrategy.sol     Compound V3 strategy
test/
  Harburger.test.js
  TaxVault.test.js
scripts/
  deploy.js
frontend/
  src/
    App-harburger.jsx
    contractABI.js
    main.jsx
    index.css
```
