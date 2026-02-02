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
import { Fr } from '@aztec/foundation/curves/bn254';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';

import { ProofOfPasswordContract } from '../contracts/target/ProofOfPassword.ts';
import { createLogger } from '@aztec/foundation/log';
import { BatchCall } from '@aztec/aztec.js/contracts';

// Parse network from CLI args (--network <name>)
function getNetworkFromArgs(): string {
  const args = process.argv.slice(2);
  const networkIndex = args.indexOf('--network');
  if (networkIndex === -1 || networkIndex === args.length - 1) {
    console.error('Usage: node deploy.ts --network <local|devnet|nextnet>');
    process.exit(1);
  }
  const network = args[networkIndex + 1];
  if (!['local', 'devnet', 'nextnet'].includes(network)) {
    console.error(`Invalid network: ${network}. Must be 'local', 'devnet' or 'nextnet'`);
    process.exit(1);
  }
  return network;
}

const NETWORK = getNetworkFromArgs();

// Network-specific node URLs (hardcoded, not configurable)
const NETWORK_URLS: Record<string, string> = {
  local: 'http://localhost:8080',
  devnet: 'https://next.devnet.aztec-labs.com',
  nextnet: 'https://nextnet.aztec-labs.com',
};

const AZTEC_NODE_URL = NETWORK_URLS[NETWORK];
const PROVER_ENABLED = process.env.PROVER_ENABLED === 'false' ? false : true;

const PASSWORD = process.env.PASSWORD ? process.env.PASSWORD : undefined;

if (!PASSWORD) {
  throw new Error('Please specify a PASSWORD');
}

const PXE_STORE_DIR = path.join(import.meta.dirname, '.pxe-store');

const INITIAL_TOKEN_BALANCE = 1_000_000_000n;

async function setupWallet(aztecNode: AztecNode) {
  fs.rmSync(PXE_STORE_DIR, { recursive: true, force: true });

  const config = getPXEConfig();
  //config.dataDirectory = PXE_STORE_DIR;
  config.proverEnabled = PROVER_ENABLED;

  return await TestWallet.create(aztecNode, config, {
    proverOrOptions: {
      logger: createLogger('bb:native'),
    },
  });
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
  const deployOpts = {
    from: AztecAddress.ZERO,
    fee: {
      paymentMethod,
    },
    skipClassPublication: true,
    skipInstancePublication: true,
    wait: { timeout: 120 },
  };
  await deployMethod.send(deployOpts);

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

  const gregoCoin = await TokenContract.deploy(wallet, deployer, 'GregoCoin', 'GRG', 18).send({
    from: deployer,
    fee: { paymentMethod },
    contractAddressSalt,
    wait: { timeout: 120 },
  });

  const gregoCoinPremium = await TokenContract.deploy(wallet, deployer, 'GregoCoinPremium', 'GRGP', 18).send({
    from: deployer,
    fee: { paymentMethod },
    contractAddressSalt,
    wait: { timeout: 120 },
  });

  const liquidityToken = await TokenContract.deploy(wallet, deployer, 'LiquidityToken', 'LQT', 18).send({
    from: deployer,
    fee: { paymentMethod },
    contractAddressSalt,
    wait: { timeout: 120 },
  });

  const amm = await AMMContract.deploy(
    wallet,
    gregoCoin.address,
    gregoCoinPremium.address,
    liquidityToken.address,
  ).send({ from: deployer, fee: { paymentMethod }, contractAddressSalt, wait: { timeout: 120 } });

  await new BatchCall(wallet, [
    liquidityToken.methods.set_minter(amm.address, true),
    gregoCoin.methods.mint_to_private(deployer, INITIAL_TOKEN_BALANCE),
    gregoCoinPremium.methods.mint_to_private(deployer, INITIAL_TOKEN_BALANCE),
  ]).send({ from: deployer, fee: { paymentMethod }, wait: { timeout: 120 } });

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

  await new BatchCall(wallet, [
    liquidityToken.methods.set_minter(amm.address, true),
    gregoCoin.methods.mint_to_private(deployer, INITIAL_TOKEN_BALANCE),
    gregoCoinPremium.methods.mint_to_private(deployer, INITIAL_TOKEN_BALANCE),
    amm.methods
      .add_liquidity(
        INITIAL_TOKEN_BALANCE,
        INITIAL_TOKEN_BALANCE,
        INITIAL_TOKEN_BALANCE,
        INITIAL_TOKEN_BALANCE,
        nonceForAuthwits,
      )
      .with({ authWitnesses: [token0Authwit, token1Authwit] }),
  ]).send({ from: deployer, fee: { paymentMethod }, wait: { timeout: 120 } });

  const popDeployMethod = ProofOfPasswordContract.deploy(wallet, gregoCoin.address, PASSWORD);

  // Address is computed lazily. This is bad
  await popDeployMethod.getInstance();

  const pop = ProofOfPasswordContract.at(popDeployMethod.address, wallet);

  await new BatchCall(wallet, [
    await popDeployMethod.request({ contractAddressSalt, deployer }),
    gregoCoin.methods.set_minter(pop.address, true),
  ]).send({
    from: deployer,
    fee: { paymentMethod },
    wait: { timeout: 120 },
  });

  return {
    gregoCoinAddress: gregoCoin.address.toString(),
    gregoCoinPremiumAddress: gregoCoinPremium.address.toString(),
    liquidityTokenAddress: liquidityToken.address.toString(),
    ammAddress: amm.address.toString(),
    popAddress: pop.address.toString(),
    sponsoredFPCAddress: sponsoredPFCContract.address,
    contractAddressSalt: contractAddressSalt.toString(),
  };
}

async function writeNetworkConfig(network: string, deploymentInfo: any) {
  const configDir = path.join(import.meta.dirname, '../src/config/networks');
  fs.mkdirSync(configDir, { recursive: true });

  const configPath = path.join(configDir, `${network}.json`);
  const config = {
    id: network,
    nodeUrl: AZTEC_NODE_URL,
    chainId: deploymentInfo.chainId,
    rollupVersion: deploymentInfo.rollupVersion,
    contracts: {
      gregoCoin: deploymentInfo.gregoCoinAddress,
      gregoCoinPremium: deploymentInfo.gregoCoinPremiumAddress,
      amm: deploymentInfo.ammAddress,
      liquidityToken: deploymentInfo.liquidityTokenAddress,
      pop: deploymentInfo.popAddress,
      sponsoredFPC: deploymentInfo.sponsoredFPCAddress,
      salt: deploymentInfo.contractAddressSalt,
    },
    deployer: {
      address: deploymentInfo.deployerAddress,
    },
    deployedAt: new Date().toISOString(),
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  console.log(`
      \n\n\n
      Contracts deployed successfully to ${network}!
      Network config saved to: ${configPath}

      Deployed contracts:
      - GregoCoin: ${deploymentInfo.gregoCoinAddress}
      - GregoCoinPremium: ${deploymentInfo.gregoCoinPremiumAddress}
      - AMM: ${deploymentInfo.ammAddress}
      - Liquidity Token: ${deploymentInfo.liquidityTokenAddress}
      - Proof of password: ${deploymentInfo.popAddress}

      Deployer: ${deploymentInfo.deployerAddress}
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
  const { address: deployer } = await createAccount(wallet);

  // Deploy the contract
  const contractDeploymentInfo = await deployContracts(wallet, deployer);
  const deploymentInfo = {
    ...contractDeploymentInfo,
    chainId: chainId.toString(),
    rollupVersion: rollupVersion.toString(),
    deployerAddress: deployer.toString(),
  };

  // Save the network config to src/config/networks/
  await writeNetworkConfig(NETWORK, deploymentInfo);

  // Clean up the PXE store
  fs.rmSync(PXE_STORE_DIR, { recursive: true, force: true });
  process.exit(0);
}

createAccountAndDeployContract().catch(error => {
  console.error(error);
  process.exit(1);
});

export { createAccountAndDeployContract };
