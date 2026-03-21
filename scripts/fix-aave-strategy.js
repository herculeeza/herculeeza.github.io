const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Using account:", deployer.address);

  const TAX_VAULT = "0xA9d83d5d185cf10d9cB0840A290d6d098D94285e";
  const OLD_AAVE = "0x80f2F1B0Ea9Ba539a21910Bdd386b85EBe10f0C9";

  const AAVE_POOL_ADDRESSES_PROVIDER = "0x012bAC54348C0E635dCAc9D5FB99f06F24136C9A";
  const WETH = "0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c";
  const AWETH = "0x5b071b590a59395fE4025A0Ccc1FcC931AAc1830";

  const taxVault = await ethers.getContractAt("TaxVault", TAX_VAULT);

  // Step 1: Emergency drain old strategy to recover funds
  console.log("\nStep 1: Emergency drain old AaveStrategy...");
  const tx1 = await taxVault.emergencyWithdrawFromStrategy(OLD_AAVE);
  await tx1.wait();
  console.log("Old strategy drained");

  // Step 2: Remove old strategy
  console.log("\nStep 2: Removing old AaveStrategy...");
  const tx2 = await taxVault.removeStrategy(OLD_AAVE);
  await tx2.wait();
  console.log("Old strategy removed");

  // Step 3: Deploy new fixed AaveStrategy
  console.log("\nStep 3: Deploying fixed AaveStrategy...");
  const AaveStrategy = await ethers.getContractFactory("AaveStrategy");
  const newStrategy = await AaveStrategy.deploy(
    AAVE_POOL_ADDRESSES_PROVIDER, WETH, AWETH, TAX_VAULT
  );
  await newStrategy.waitForDeployment();
  const newAddr = await newStrategy.getAddress();
  console.log("New AaveStrategy deployed to:", newAddr);

  // Step 4: Add new strategy to vault
  console.log("\nStep 4: Adding new strategy to vault...");
  const tx3 = await taxVault.addStrategy(newAddr);
  await tx3.wait();
  console.log("New strategy registered");

  // Step 5: User should migrate from drained strategy
  console.log("\nStep 5: Migrating user funds from drained strategy...");
  const tx4 = await taxVault.migrateFromDrainedStrategy(OLD_AAVE);
  await tx4.wait();
  console.log("User funds migrated to idle balance");

  // Update deployment file
  const fs = require("fs");
  const data = JSON.parse(fs.readFileSync("deployments-sepolia.json", "utf8"));
  data.aaveStrategy = newAddr;
  data.oldAaveStrategy = OLD_AAVE;
  fs.writeFileSync("deployments-sepolia.json", JSON.stringify(data, null, 2));

  console.log("\n=== Done ===");
  console.log("New AaveStrategy:", newAddr);
  console.log("User funds should now be in idle vault balance — can be re-deposited to new strategy");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
