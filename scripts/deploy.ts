import { SPONSORED_FPC_SALT } from '@aztec/constants';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';
import { getPXEConfig } from '@aztec/pxe/server';
import { TestWallet } from '@aztec/test-wallet/server';
import fs from 'fs';
import path from 'path';

import { TokenContract } from '@aztec/noir-contracts.js/Token';
import { AMMContract } from '@aztec/noir-contracts.js/AMM';
import { deriveSigningKey } from '@aztec/stdlib/keys';
import { AztecAddress } from '@aztec/stdlib/aztec-address';
import { createAztecNodeClient, type AztecNode } from '@aztec/aztec.js/node';
import { getContractInstanceFromInstantiationParams } from '@aztec/stdlib/contract';
import { Fr } from '@aztec/foundation/fields';
import type { DeployAccountOptions } from '@aztec/aztec.js/wallet';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';

const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL || 'http://localhost:8080';
const PROVER_ENABLED = process.env.PROVER_ENABLED === 'false' ? false : true;
const WRITE_ENV_FILE = process.env.WRITE_ENV_FILE === 'false' ? false : true;

const MINT_TO = process.env.MINT_TO ? AztecAddress.fromString(process.env.MINT_TO) : undefined;

const PXE_STORE_DIR = path.join(import.meta.dirname, '.pxe-store');

const INITIAL_TOKEN_BALANCE = 1_000_000_000n;

async function setupWallet(aztecNode: AztecNode) {
  fs.rmSync(PXE_STORE_DIR, { recursive: true, force: true });

  const config = getPXEConfig();
  config.dataDirectory = PXE_STORE_DIR;
  config.proverEnabled = PROVER_ENABLED;

  return await TestWallet.create(aztecNode, config);
}

async function getSponsoredPFCContract() {
  const instance = await getContractInstanceFromInstantiationParams(SponsoredFPCContractArtifact, {
    salt: new Fr(SPONSORED_FPC_SALT),
  });

  return instance;
}

async function createAccount(wallet: TestWallet) {
  const salt = Fr.random();
  const secretKey = Fr.random();
  const signingKey = deriveSigningKey(secretKey);
  const accountManager = await wallet.createSchnorrAccount(secretKey, salt, signingKey);

  const deployMethod = await accountManager.getDeployMethod();
  const sponsoredPFCContract = await getSponsoredPFCContract();
  const paymentMethod = new SponsoredFeePaymentMethod(sponsoredPFCContract.address);
  const deployOpts: DeployAccountOptions = {
    from: AztecAddress.ZERO,
    fee: {
      paymentMethod,
    },
    skipClassPublication: true,
    skipInstancePublication: true,
  };
  await deployMethod.send(deployOpts).wait({ timeout: 120 });

  return {
    address: accountManager.address,
    salt,
    secretKey,
  };
}

async function deployContracts(wallet: TestWallet, deployer: AztecAddress) {
  const sponsoredPFCContract = await getSponsoredPFCContract();
  const paymentMethod = new SponsoredFeePaymentMethod(sponsoredPFCContract.address);

  const contractAddressSalt = Fr.random();

  const gregoCoin = await TokenContract.deploy(wallet, deployer, 'GregoCoin', 'GRG', 18)
    .send({ from: deployer, fee: { paymentMethod }, contractAddressSalt })
    .deployed({ timeout: 120 });

  const gregoCoinPremium = await TokenContract.deploy(wallet, deployer, 'GregoCoinPremium', 'GRGP', 18)
    .send({ from: deployer, fee: { paymentMethod }, contractAddressSalt })
    .deployed({ timeout: 120 });

  const liquidityToken = await TokenContract.deploy(wallet, deployer, 'LiquidityToken', 'LQT', 18)
    .send({ from: deployer, fee: { paymentMethod }, contractAddressSalt })
    .deployed({ timeout: 120 });

  const amm = await AMMContract.deploy(wallet, gregoCoin.address, gregoCoinPremium.address, liquidityToken.address)
    .send({ from: deployer, fee: { paymentMethod }, contractAddressSalt })
    .deployed({ timeout: 120 });

  await liquidityToken.methods.set_minter(amm.address, true).send({ from: deployer, fee: { paymentMethod } }).wait();

  await gregoCoin.methods
    .mint_to_private(deployer, INITIAL_TOKEN_BALANCE)
    .send({ from: deployer, fee: { paymentMethod } })
    .wait({ timeout: 120 });
  await gregoCoinPremium.methods
    .mint_to_private(deployer, INITIAL_TOKEN_BALANCE)
    .send({ from: deployer, fee: { paymentMethod } })
    .wait({ timeout: 120 });

  const nonceForAuthwits = Fr.random();
  const token0Authwit = await wallet.createAuthWit(deployer, {
    caller: amm.address,
    action: gregoCoin.methods.transfer_to_public_and_prepare_private_balance_increase(
      deployer,
      amm.address,
      INITIAL_TOKEN_BALANCE,
      nonceForAuthwits,
    ),
  });
  const token1Authwit = await wallet.createAuthWit(deployer, {
    caller: amm.address,
    action: gregoCoinPremium.methods.transfer_to_public_and_prepare_private_balance_increase(
      deployer,
      amm.address,
      INITIAL_TOKEN_BALANCE,
      nonceForAuthwits,
    ),
  });

  const addLiquidityInteraction = amm.methods
    .add_liquidity(
      INITIAL_TOKEN_BALANCE,
      INITIAL_TOKEN_BALANCE,
      INITIAL_TOKEN_BALANCE,
      INITIAL_TOKEN_BALANCE,
      nonceForAuthwits,
    )
    .with({ authWitnesses: [token0Authwit, token1Authwit] });
  await addLiquidityInteraction.send({ from: deployer, fee: { paymentMethod } }).wait({ timeout: 120 });

  if (MINT_TO) {
    await gregoCoin.methods
      .mint_to_private(MINT_TO, INITIAL_TOKEN_BALANCE)
      .send({ from: deployer, fee: { paymentMethod } })
      .wait({ timeout: 120 });
    await gregoCoinPremium.methods
      .mint_to_private(MINT_TO, INITIAL_TOKEN_BALANCE)
      .send({ from: deployer, fee: { paymentMethod } })
      .wait({ timeout: 120 });
    console.log(`Minted ${INITIAL_TOKEN_BALANCE} GRG and GRGP to ${MINT_TO.toString()}`);
  }

  return {
    gregoCoinAddress: gregoCoin.address.toString(),
    gregoCoinPremiumAddress: gregoCoinPremium.address.toString(),
    liquidityTokenAddress: liquidityToken.address.toString(),
    ammAddress: amm.address.toString(),
    contractAddressSalt: contractAddressSalt.toString(),
  };
}

async function writeEnvFile(deploymentInfo) {
  const envFilePath = path.join(import.meta.dirname, '../.env');
  const envConfig = Object.entries({
    VITE_GREGOCOIN_ADDRESS: deploymentInfo.gregoCoinAddress,
    VITE_GREGOCOIN_PREMIUM_ADDRESS: deploymentInfo.gregoCoinPremiumAddress,
    VITE_LIQUIDITY_TOKEN_ADDRESS: deploymentInfo.liquidityTokenAddress,
    VITE_AMM_ADDRESS: deploymentInfo.ammAddress,
    VITE_CONTRACT_ADDRESS_SALT: deploymentInfo.contractAddressSalt,
    VITE_DEPLOYER_ADDRESS: deploymentInfo.deployerAddress,
    VITE_AZTEC_NODE_URL: AZTEC_NODE_URL,
    VITE_CHAIN_ID: deploymentInfo.chainId,
    VITE_ROLLUP_VERSION: deploymentInfo.rollupVersion,
  })
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  fs.writeFileSync(envFilePath, envConfig);

  console.log(`
      \n\n\n
      Contracts deployed successfully. Config saved to ${envFilePath}
      IMPORTANT: Do not lose this file as you will not be able to recover the contract address if you lose it.
      \n\n\n
    `);
}

async function createAccountAndDeployContract() {
  const aztecNode = createAztecNodeClient(AZTEC_NODE_URL);
  const wallet = await setupWallet(aztecNode);

  const { rollupVersion, l1ChainId: chainId } = await aztecNode.getNodeInfo();

  // Register the SponsoredFPC contract (for sponsored fee payments)
  await wallet.registerContract(await getSponsoredPFCContract(), SponsoredFPCContractArtifact);

  // Create a new account
  const { address: deployer, salt, secretKey } = await createAccount(wallet);

  // Deploy the contract
  const contractDeploymentInfo = await deployContracts(wallet, deployer);
  const deploymentInfo = {
    ...contractDeploymentInfo,
    chainId: chainId.toString(),
    rollupVersion: rollupVersion.toString(),
    deployerAddress: deployer.toString(),
    deployerSalt: salt.toString(),
    deployerSecretKey: secretKey.toString(),
  };
  // Save the deployment info to app/public
  if (WRITE_ENV_FILE) {
    await writeEnvFile(deploymentInfo);
  }

  // Clean up the PXE store
  fs.rmSync(PXE_STORE_DIR, { recursive: true, force: true });
}

createAccountAndDeployContract().catch(error => {
  console.error(error);
  process.exit(1);
});

export { createAccountAndDeployContract };
