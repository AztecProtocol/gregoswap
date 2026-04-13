/**
 * Deploys the SubscriptionFPC contract to the local sandbox and updates local.json config.
 *
 * Usage: node --experimental-transform-types scripts/deploy-subscription-fpc.ts
 */

import fs from 'fs';
import path from 'path';
import { SubscriptionFPC } from '@gregojuice/contracts/subscription-fpc';
import { FunctionSelector } from '@aztec/stdlib/abi';
import { L1FeeJuicePortalManager } from '@aztec/aztec.js/ethereum';
import { waitForL1ToL2MessageReady } from '@aztec/aztec.js/messaging';
import { createExtendedL1Client } from '@aztec/ethereum/client';
import { createLogger } from '@aztec/foundation/log';
import { foundry } from 'viem/chains';
import { Fr } from '@aztec/foundation/curves/bn254';
import { ProofOfPasswordContractArtifact } from '../contracts/target/ProofOfPassword.ts';
import { AMMContractArtifact } from '../contracts/target/AMM.ts';
import { TokenContractArtifact } from '../contracts/target/Token.ts';
import { setupWallet, getOrCreateDeployer } from './utils.ts';

// Well-known Anvil account #0 — used to sign the L1 bridge transaction on local sandbox
const ANVIL_KEY_0 = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

async function main() {
  const { wallet, node, paymentMethod } = await setupWallet('http://localhost:8080', 'local');
  const deployer = await getOrCreateDeployer(wallet, paymentMethod);

  console.log('Deploying SubscriptionFPC...');
  const { deployment, secretKey } = await SubscriptionFPC.deployWithKeys(wallet, deployer);
  const receipt = await deployment.send({ from: deployer, fee: { paymentMethod } });
  const fpcAddress = receipt.contract.address.toString();
  console.log('SubscriptionFPC deployed at:', fpcAddress);
  console.log('Secret key:', secretKey.toString());

  // Compute function selectors
  const popFn = ProofOfPasswordContractArtifact.functions.find(f => f.name === 'check_password_and_mint');
  const popSelector = await FunctionSelector.fromNameAndParameters(popFn!.name, popFn!.parameters);

  const ammFn = AMMContractArtifact.functions.find(f => f.name === 'swap_tokens_for_exact_tokens_from');
  const ammSelector = await FunctionSelector.fromNameAndParameters(ammFn!.name, ammFn!.parameters);

  const transferOffchainFn = TokenContractArtifact.functions.find(f => f.name === 'transfer_in_private_deliver_offchain');
  const transferOffchainSelector = await FunctionSelector.fromNameAndParameters(
    transferOffchainFn!.name,
    transferOffchainFn!.parameters,
  );

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
      [config.contracts.gregoCoin]: {
        [transferOffchainSelector.toString()]: 0,
      },
      [config.contracts.gregoCoinPremium]: {
        [transferOffchainSelector.toString()]: 0,
      },
    },
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`\nUpdated ${configPath} with subscriptionFPC config.`);

  // Re-register the FPC contract with its secret key so PXE can compute tagging secrets
  const { SubscriptionFPCContractArtifact: fpcArtifact } = await import('@gregojuice/contracts/artifacts/SubscriptionFPC');
  const fpcInstance = await node.getContract(receipt.contract.address);
  if (!fpcInstance) throw new Error('FPC contract not found on-chain after deploy');
  await wallet.registerContract(fpcInstance, fpcArtifact, secretKey);

  // Start the L1 bridge early so the message can propagate while we do sign_up on L2.
  // On local sandbox, the fee asset handler mints a fixed amount per call (1000 FJ).
  // When mint=true, bridgeTokensPublic must match this exact amount.
  const bridgeAmount: bigint = BigInt('1000000000000000000000'); // 1000 FJ

  console.log(`\nBridging ${bridgeAmount} wei of fee juice to FPC...`);
  const l1Client = createExtendedL1Client(['http://localhost:8545'], ANVIL_KEY_0, foundry);
  const portalManager = await L1FeeJuicePortalManager.new(node, l1Client, createLogger('bridge'));
  const claim = await portalManager.bridgeTokensPublic(receipt.contract.address, bridgeAmount, true);
  console.log('L1 bridge tx mined.');

  // Sign up functions so users can subscribe. These L2 txs also advance the L2 chain,
  // which helps the sequencer include the pending L1->L2 bridge message.
  const { SubscriptionFPCContract } = await import('@gregojuice/contracts/artifacts/SubscriptionFPC');
  const fpc = SubscriptionFPCContract.at(receipt.contract.address, wallet);

  const maxUses = 100;
  const maxFee = BigInt('1000000000000000000000'); // 1000 FJ
  const maxUsers = 100;

  const popAddress = config.contracts.pop;
  console.log(`\nSigning up PoP selector ${popSelector} at index 0...`);
  await fpc.methods
    .sign_up(popAddress, popSelector, 0, maxUses, maxFee, maxUsers)
    .send({ from: deployer, fee: { paymentMethod } });
  console.log('PoP sign_up done!');

  const ammAddress = config.contracts.amm;
  console.log(`Signing up AMM selector ${ammSelector} at index 0...`);
  await fpc.methods
    .sign_up(ammAddress, ammSelector, 0, maxUses, maxFee, maxUsers)
    .send({ from: deployer, fee: { paymentMethod } });
  console.log('AMM sign_up done!');

  // Sign up transfer_in_private_deliver_offchain on both token contracts
  for (const tokenKey of ['gregoCoin', 'gregoCoinPremium'] as const) {
    const tokenAddress = config.contracts[tokenKey];
    console.log(`Signing up ${tokenKey}.transfer_in_private_deliver_offchain at index 0...`);
    await fpc.methods
      .sign_up(tokenAddress, transferOffchainSelector, 0, maxUses, maxFee, maxUsers)
      .send({ from: deployer, fee: { paymentMethod } });
    console.log(`${tokenKey} sign_up done!`);
  }

  // Wait for the L1->L2 bridge message and claim the FJ to credit the FPC's balance.
  console.log('\nWaiting for L1->L2 message sync...');
  const messageHash = Fr.fromHexString(claim.messageHash);
  await waitForL1ToL2MessageReady(node, messageHash, { timeoutSeconds: 120 });
  console.log('Message ready');

  const { FeeJuiceContract } = await import('@aztec/aztec.js/protocol');
  const feeJuice = FeeJuiceContract.at(wallet);
  console.log('Claiming fee juice on L2 for FPC...');
  await feeJuice.methods
    .claim(receipt.contract.address, claim.claimAmount, claim.claimSecret, claim.messageLeafIndex)
    .send({ from: deployer, fee: { paymentMethod } });
  console.log('FPC funded!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
