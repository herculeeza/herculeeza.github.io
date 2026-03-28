const { ethers } = require("hardhat");

async function main() {
  const vault = await ethers.getContractAt("TaxVault", "0x5aE64F88F4157c88B1Ff534a7d51cFF4a70Ef63e");
  console.log("Adding CompoundStrategy...");
  const tx = await vault.addStrategy("0x2331EFd34Ff98ee42E0fe1c10D794016dfD9d628");
  console.log("Tx sent:", tx.hash);
  await tx.wait();
  console.log("Done");
  const strats = await vault.getApprovedStrategies();
  console.log("Approved strategies:", strats);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
