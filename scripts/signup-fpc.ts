/**
 * Calls sign_up on the SubscriptionFPC for each configured function (PoP + AMM).
 * Uses the same deployer wallet as deploy-subscription-fpc.ts.
 *
 * Usage: node --experimental-transform-types scripts/signup-fpc.ts
 */

import fs from 'fs';
import path from 'path';
import { AztecAddress } from '@aztec/stdlib/aztec-address';
import { FunctionSelector } from '@aztec/stdlib/abi';
import { SubscriptionFPCContract } from '@gregojuice/contracts/artifacts/SubscriptionFPC';
import { ProofOfPasswordContractArtifact } from '../contracts/target/ProofOfPassword.ts';
import { AMMContractArtifact } from '../contracts/target/AMM.ts';
import { setupWallet, getOrCreateDeployer } from './utils.ts';

async function main() {
  const configPath = path.join(import.meta.dirname, '../src/config/networks/local.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  const { wallet, node, paymentMethod } = await setupWallet('http://localhost:8080', 'local');
  const adminAddress = await getOrCreateDeployer(wallet, paymentMethod);

  const fpcAddress = AztecAddress.fromString(config.subscriptionFPC.address);

  // Register the FPC contract in this PXE so it can interact with it
  const { SubscriptionFPCContractArtifact } = await import('@gregojuice/contracts/artifacts/SubscriptionFPC');
  const fpcInstance = await node.getContract(fpcAddress);
  if (!fpcInstance) throw new Error('FPC contract not found on-chain');
  await wallet.registerContract(fpcInstance, SubscriptionFPCContractArtifact);

  const fpc = SubscriptionFPCContract.at(fpcAddress, wallet);
  console.log('Admin:', adminAddress.toString());
  console.log('FPC:', fpcAddress.toString());

  // sign_up params: generous for local dev
  const maxUses = 100;
  const maxFee = BigInt('1000000000000000000000'); // 1000 FJ in wei
  const maxUsers = 100;

  // 1. Sign up PoP.check_password_and_mint
  const popFn = ProofOfPasswordContractArtifact.functions.find(f => f.name === 'check_password_and_mint');
  const popSelector = await FunctionSelector.fromNameAndParameters(popFn!.name, popFn!.parameters);
  const popAddress = AztecAddress.fromString(config.contracts.pop);
  const popConfigIndex = config.subscriptionFPC.functions[config.contracts.pop][popSelector.toString()];

  console.log(`\nSigning up PoP (${popAddress}) selector ${popSelector} at index ${popConfigIndex}...`);
  await fpc.methods
    .sign_up(popAddress, popSelector, popConfigIndex, maxUses, maxFee, maxUsers)
    .send({ from: adminAddress, fee: { paymentMethod } });
  console.log('PoP sign_up done!');

  // 2. Sign up AMM.swap_tokens_for_exact_tokens_from
  const ammFn = AMMContractArtifact.functions.find(f => f.name === 'swap_tokens_for_exact_tokens_from');
  const ammSelector = await FunctionSelector.fromNameAndParameters(ammFn!.name, ammFn!.parameters);
  const ammAddress = AztecAddress.fromString(config.contracts.amm);
  const ammConfigIndex = config.subscriptionFPC.functions[config.contracts.amm][ammSelector.toString()];

  console.log(`\nSigning up AMM (${ammAddress}) selector ${ammSelector} at index ${ammConfigIndex}...`);
  await fpc.methods
    .sign_up(ammAddress, ammSelector, ammConfigIndex, maxUses, maxFee, maxUsers)
    .send({ from: adminAddress, fee: { paymentMethod } });
  console.log('AMM sign_up done!');

  console.log('\nAll functions signed up successfully!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
