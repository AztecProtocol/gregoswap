import {
  AztecAddress,
  createAztecNodeClient,
  type DeployAccountOptions,
  DeployMethod,
  Fr,
  getContractInstanceFromInstantiationParams,
  PublicKeys,
  SponsoredFeePaymentMethod,
  type Wallet,
} from '@aztec/aztec.js';
import { type AztecNode } from '@aztec/aztec.js/interfaces';
import { SPONSORED_FPC_SALT } from '@aztec/constants';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';
import { getPXEConfig } from '@aztec/pxe/server';
import { TestWallet } from '@aztec/test-wallet/server';
import fs from 'fs';
import path from 'path';

import { TokenContract } from '@aztec/noir-contracts.js/Token';
import { AMMContract } from '@aztec/noir-contracts.js/AMM';
import { deriveSigningKey } from '@aztec/stdlib/keys';

const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL || 'http://localhost:8080';
const PROVER_ENABLED = process.env.PROVER_ENABLED === 'false' ? false : true;
const WRITE_ENV_FILE = process.env.WRITE_ENV_FILE === 'false' ? false : true;

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
  const provenInteraction = await deployMethod.prove(deployOpts);
  await provenInteraction.send().wait({ timeout: 120 });

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
    DEPLOYER_SALT: deploymentInfo.deployerSalt,
    DEPLOYER_SECRET_KEY: deploymentInfo.deployerSecretKey,
    VITE_AZTEC_NODE_URL: AZTEC_NODE_URL,
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

  // Register the SponsoredFPC contract (for sponsored fee payments)
  await wallet.registerContract(await getSponsoredPFCContract(), SponsoredFPCContractArtifact);

  // Create a new account
  const { address: deployer, salt, secretKey } = await createAccount(wallet);

  // Deploy the contract
  const contractDeploymentInfo = await deployContracts(wallet, deployer);
  const deploymentInfo = {
    ...contractDeploymentInfo,
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
