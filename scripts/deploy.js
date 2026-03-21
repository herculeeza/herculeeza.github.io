const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  console.log("Starting deployment...");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  // ============ Configuration ============
  
  // Harburger NFT configuration
  const NFT_NAME = process.env.NFT_NAME || "Harburger NFT";
  const NFT_SYMBOL = process.env.NFT_SYMBOL || "HBRG";

  // Tax rate: scaled per-second rate.  RATE_PRECISION = 1e18.
  // taxRate = (annualPercent / 100) / SECONDS_PER_YEAR * 1e18
  // Default: 10% annual → ~3_170_979_198
  const RATE_PRECISION = 10n ** 18n;
  const SECONDS_PER_YEAR = 365n * 24n * 60n * 60n;
  const ANNUAL_TAX_PERCENT = BigInt(process.env.ANNUAL_TAX_PERCENT || "10");
  const TAX_RATE = process.env.TAX_RATE
    ? BigInt(process.env.TAX_RATE)
    : (ANNUAL_TAX_PERCENT * RATE_PRECISION) / (100n * SECONDS_PER_YEAR);
  const TAX_RECEIVER = process.env.TAX_RECEIVER || deployer.address;
  // initialPrice in wei. Default: 0.001 ETH.
  const INITIAL_PRICE = process.env.INITIAL_PRICE || ethers.parseEther("0.001");

  // DeFi protocol addresses (mainnet/testnet)
  // For Sepolia testnet - replace with actual testnet addresses
  const AAVE_POOL_ADDRESSES_PROVIDER = process.env.AAVE_POOL_ADDRESSES_PROVIDER || "0x0000000000000000000000000000000000000000";
  const WETH_ADDRESS = process.env.WETH_ADDRESS || "0x0000000000000000000000000000000000000000";
  const AWETH_ADDRESS = process.env.AWETH_ADDRESS || "0x0000000000000000000000000000000000000000";
  const COMPOUND_COMET = process.env.COMPOUND_COMET || "0x0000000000000000000000000000000000000000";

  // ============ Step 1: Deploy Harburger with placeholder vault ============

  console.log("\nStep 1: Deploying Harburger with placeholder vault...");
  const Harburger = await ethers.getContractFactory("Harburger");
  const harburger = await Harburger.deploy(
    NFT_NAME,
    NFT_SYMBOL,
    TAX_RATE,
    TAX_RECEIVER,
    INITIAL_PRICE,
    ethers.ZeroAddress // Placeholder for TaxVault
  );
  await harburger.waitForDeployment();
  const harburgerAddress = await harburger.getAddress();
  console.log("Harburger deployed to:", harburgerAddress);

  // ============ Step 2: Deploy TaxVault with correct Harburger address ============

  console.log("\nStep 2: Deploying TaxVault with Harburger address...");
  const TaxVault = await ethers.getContractFactory("TaxVault");
  const taxVault = await TaxVault.deploy(
    harburgerAddress,
    TAX_RECEIVER // Manager
  );
  await taxVault.waitForDeployment();
  const taxVaultAddress = await taxVault.getAddress();
  console.log("TaxVault deployed to:", taxVaultAddress);

  // ============ Step 3: Deploy Yield Strategies (Optional) ============

  let aaveStrategy = null;
  let compoundStrategy = null;

  let aaveStrategyAddress = null;
  let compoundStrategyAddress = null;

  if (AAVE_POOL_ADDRESSES_PROVIDER !== "0x0000000000000000000000000000000000000000") {
    console.log("\nStep 3a: Deploying AaveStrategy...");
    const AaveStrategy = await ethers.getContractFactory("AaveStrategy");
    aaveStrategy = await AaveStrategy.deploy(
      AAVE_POOL_ADDRESSES_PROVIDER,
      WETH_ADDRESS,
      AWETH_ADDRESS,
      taxVaultAddress
    );
    await aaveStrategy.waitForDeployment();
    aaveStrategyAddress = await aaveStrategy.getAddress();
    console.log("AaveStrategy deployed to:", aaveStrategyAddress);

    // Add strategy to vault
    console.log("Adding AaveStrategy to TaxVault...");
    const tx1 = await taxVault.addStrategy(aaveStrategyAddress);
    await tx1.wait();
    console.log("AaveStrategy added to vault");
  }

  if (COMPOUND_COMET !== "0x0000000000000000000000000000000000000000") {
    console.log("\nStep 3b: Deploying CompoundStrategy...");
    const CompoundStrategy = await ethers.getContractFactory("CompoundStrategy");
    compoundStrategy = await CompoundStrategy.deploy(
      COMPOUND_COMET,
      WETH_ADDRESS,
      taxVaultAddress
    );
    await compoundStrategy.waitForDeployment();
    compoundStrategyAddress = await compoundStrategy.getAddress();
    console.log("CompoundStrategy deployed to:", compoundStrategyAddress);

    // Add strategy to vault
    console.log("Adding CompoundStrategy to TaxVault...");
    const tx2 = await taxVault.addStrategy(compoundStrategyAddress);
    await tx2.wait();
    console.log("CompoundStrategy added to vault");
  }

  // ============ Step 4: Update Harburger with TaxVault address ============

  console.log("\nStep 4: Updating Harburger with TaxVault address...");
  const updateTx = await harburger.updateTaxVault(taxVaultAddress);
  await updateTx.wait();
  console.log("Harburger updated with TaxVault address");

  // ============ Verification Summary ============

  console.log("\n============ Deployment Summary ============");
  console.log("Harburger:", harburgerAddress);
  console.log("TaxVault:", taxVaultAddress);
  if (aaveStrategyAddress) console.log("AaveStrategy:", aaveStrategyAddress);
  if (compoundStrategyAddress) console.log("CompoundStrategy:", compoundStrategyAddress);
  console.log("\nConfiguration:");
  console.log("- NFT Name:", NFT_NAME);
  console.log("- NFT Symbol:", NFT_SYMBOL);
  console.log("- Tax Rate (scaled):", TAX_RATE.toString(), `(${ANNUAL_TAX_PERCENT}% annual, RATE_PRECISION=1e18)`);
  console.log("- Tax Receiver:", TAX_RECEIVER);
  console.log("- Initial Price:", ethers.formatEther(INITIAL_PRICE), "ETH");

  console.log("\n============ Next Steps ============");
  console.log("1. Verify contracts on Etherscan:");
  console.log("   npx hardhat verify --network <network> <address> <constructor args>");
  console.log("\n2. Update frontend CONTRACT_ADDRESS in .env file:");
  console.log("   VITE_CONTRACT_ADDRESS=" + harburgerAddress);
  console.log("\n3. Test deposit/withdraw/vault/strategy functions");
  console.log("\n4. Consider running security audit with Slither or similar tools");

  // Save deployment addresses to file
  const fs = require('fs');
  const deploymentData = {
    network: hre.network.name,
    harburger: harburgerAddress,
    taxVault: taxVaultAddress,
    aaveStrategy: aaveStrategyAddress,
    compoundStrategy: compoundStrategyAddress,
    configuration: {
      nftName: NFT_NAME,
      nftSymbol: NFT_SYMBOL,
      taxRate: TAX_RATE.toString(),
      taxReceiver: TAX_RECEIVER,
      initialPrice: INITIAL_PRICE.toString()
    },
    timestamp: new Date().toISOString()
  };

  fs.writeFileSync(
    `deployments-${hre.network.name}.json`,
    JSON.stringify(deploymentData, null, 2)
  );
  console.log(`\nDeployment addresses saved to deployments-${hre.network.name}.json`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });