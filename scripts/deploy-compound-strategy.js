const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  // Existing TaxVault from prior deployment
  const TAX_VAULT = "0x5aE64F88F4157c88B1Ff534a7d51cFF4a70Ef63e";

  // Compound V3 Sepolia addresses
  const COMET = "0x2943ac1216979ad8db76d9147f64e61adc126e96";     // cWETHv3
  const WETH = "0x2D5ee574e710219a521449679A4A7f2B43f046ad";      // Compound's WETH on Sepolia

  // Step 1: Deploy CompoundStrategy
  console.log("\nDeploying CompoundStrategy...");
  const CompoundStrategy = await ethers.getContractFactory("CompoundStrategy");
  const compoundStrategy = await CompoundStrategy.deploy(COMET, WETH, TAX_VAULT);
  await compoundStrategy.waitForDeployment();
  const strategyAddress = await compoundStrategy.getAddress();
  console.log("CompoundStrategy deployed to:", strategyAddress);

  // Step 2: Register strategy with TaxVault
  console.log("\nAdding CompoundStrategy to TaxVault...");
  const taxVault = await ethers.getContractAt("TaxVault", TAX_VAULT);
  const tx = await taxVault.addStrategy(strategyAddress);
  await tx.wait();
  console.log("CompoundStrategy registered with TaxVault");

  // Update deployment file
  const fs = require("fs");
  const deploymentFile = "deployments-sepolia.json";
  const data = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
  data.compoundStrategy = strategyAddress;
  fs.writeFileSync(deploymentFile, JSON.stringify(data, null, 2));
  console.log("\nUpdated", deploymentFile);

  console.log("\n=== Done ===");
  console.log("CompoundStrategy:", strategyAddress);
  console.log("TaxVault:", TAX_VAULT);

  console.log("\nVerify with:");
  console.log(`npx hardhat verify --network sepolia ${strategyAddress} "${COMET}" "${WETH}" "${TAX_VAULT}"`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
