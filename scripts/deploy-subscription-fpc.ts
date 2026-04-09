/**
 * Deploys the SubscriptionFPC contract to the local sandbox and updates local.json config.
 *
 * Usage: node --experimental-transform-types scripts/deploy-subscription-fpc.ts
 */

import fs from 'fs';
import path from 'path';
import { SubscriptionFPC } from '@gregojuice/contracts/subscription-fpc';
import { FunctionSelector } from '@aztec/stdlib/abi';
import { ProofOfPasswordContractArtifact } from '../contracts/target/ProofOfPassword.ts';
import { AMMContractArtifact } from '../contracts/target/AMM.ts';
import { setupWallet, getOrCreateDeployer } from './utils.ts';

async function main() {
  const { wallet, paymentMethod } = await setupWallet('http://localhost:8080', 'local');
  const deployer = await getOrCreateDeployer(wallet, paymentMethod);

  console.log('Deploying SubscriptionFPC...');
  const { deployment, secretKey } = await SubscriptionFPC.deployWithKeys(wallet, deployer);
  const receipt = await deployment.send({ fee: { paymentMethod } });
  const fpcAddress = receipt.contract.address.toString();
  console.log('SubscriptionFPC deployed at:', fpcAddress);
  console.log('Secret key:', secretKey.toString());

  // Compute function selectors
  const popFn = ProofOfPasswordContractArtifact.functions.find(f => f.name === 'check_password_and_mint');
  const popSelector = await FunctionSelector.fromNameAndParameters(popFn!.name, popFn!.parameters);

  const ammFn = AMMContractArtifact.functions.find(f => f.name === 'swap_tokens_for_exact_tokens_from');
  const ammSelector = await FunctionSelector.fromNameAndParameters(ammFn!.name, ammFn!.parameters);

  // Update local.json
  const configPath = path.join(import.meta.dirname, '../src/config/networks/local.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  config.subscriptionFPC = {
    address: fpcAddress,
    secretKey: secretKey.toString(),
    functions: {
      [config.contracts.pop]: {
        [popSelector.toString()]: 0,
      },
      [config.contracts.amm]: {
        [ammSelector.toString()]: 0,
      },
    },
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`\nUpdated ${configPath} with subscriptionFPC config.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
