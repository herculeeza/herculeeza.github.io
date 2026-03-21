const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  // Existing TaxVault from prior deployment
  const TAX_VAULT = "0x5aE64F88F4157c88B1Ff534a7d51cFF4a70Ef63e";

  // Aave V3 Sepolia addresses
  const AAVE_POOL_ADDRESSES_PROVIDER = "0x012bAC54348C0E635dCAc9D5FB99f06F24136C9A";
  const WETH = "0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c";
  const AWETH = "0x5b071b590a59395fE4025A0Ccc1FcC931AAc1830";

  // Step 1: Deploy AaveStrategy
  console.log("\nDeploying AaveStrategy...");
  const AaveStrategy = await ethers.getContractFactory("AaveStrategy");
  const aaveStrategy = await AaveStrategy.deploy(
    AAVE_POOL_ADDRESSES_PROVIDER,
    WETH,
    AWETH,
    TAX_VAULT
  );
  await aaveStrategy.waitForDeployment();
  const strategyAddress = await aaveStrategy.getAddress();
  console.log("AaveStrategy deployed to:", strategyAddress);

  // Step 2: Register strategy with TaxVault
  console.log("\nAdding AaveStrategy to TaxVault...");
  const taxVault = await ethers.getContractAt("TaxVault", TAX_VAULT);
  const tx = await taxVault.addStrategy(strategyAddress);
  await tx.wait();
  console.log("AaveStrategy registered with TaxVault");

  // Update deployment file
  const fs = require("fs");
  const deploymentFile = "deployments-sepolia.json";
  const data = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
  data.aaveStrategy = strategyAddress;
  fs.writeFileSync(deploymentFile, JSON.stringify(data, null, 2));
  console.log("\nUpdated", deploymentFile);

  console.log("\n=== Done ===");
  console.log("AaveStrategy:", strategyAddress);
  console.log("TaxVault:", TAX_VAULT);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
