import { LCDClient, MnemonicKey, RawKey } from '@terra-money/terra.js';
import { Mirror } from '@mirror-protocol/mirror.js';
import { Anchor, columbus4, AddressProviderFromJson, MARKET_DENOMS, fabricateMarketClaimRewards, fabricateTerraswapSwapANC, queryMarketBorrowerInfo } from '@anchor-protocol/anchor.js'
import { queryTerraswapSimulation } from '@anchor-protocol/anchor.js/dist/queries/terraswap/simulation.js'

(await import('dotenv')).config()

const lcd = new LCDClient({URL: 'https://lcd.terra.dev', chainID: 'columbus-4'});
const key = new MnemonicKey({mnemonic: process.env.MNEMONIC});
const wallet = lcd.wallet(key);

const mirror = new Mirror({ lcd: lcd, key: key});

const addressProvider = new AddressProviderFromJson(columbus4);
const anchor = new Anchor(lcd, addressProvider);

const ancContractAddress = 'terra14z56l0fp2lsf86zy3hty2z47ezkhnthtr9yq76';

const terraswapANCPairContractAddress = 'terra1gm5p3ner9x9xpwugn9sp6gvhd0lwrtkyrecdn3';

console.dir(wallet.key.accAddress)


async function getClaimAndStakeMirrorMsgs(stakeOrSell) {
  const rewards = await mirror.staking.getRewardInfo(key.accAddress);

  console.dir(rewards.reward_infos, { depth: null, colors: true });

  const totalRewards = rewards.reward_infos.reduce((carry, item) => carry += Number(item.pending_reward), 0);
  console.dir(totalRewards, { depth: null, colors: true });

  const mirrorToken = mirror.assets['MIR'];


  if(stakeOrSell == 'stake') {
    return [mirror.staking.withdraw(), mirror.gov.stakeVotingTokens(mirrorToken.token, totalRewards), mirror.gov.stakeVotingRewards()];
  }
  else {
    return [mirror.staking.withdraw(), mirror.gov.withdrawVotingRewards()];
  }
 
}

async function getClaimAndSellAnchorMsgs() {
  
  const blockInfo = await lcd.tendermint.blockInfo();
  const info = await queryMarketBorrowerInfo(
    {
      lcd: lcd, 
      market: 'usd', 
      borrower: key.accAddress, 
      block_height: Number(blockInfo.block.header.height)
    })(addressProvider);
  
  console.dir(info, { depth: null, colors: true });

  const claimRewardsMsg = fabricateMarketClaimRewards({
    address: key.accAddress,
    market: 'usd',
    to: key.accAddress,

  })(addressProvider);

  const sellANCMsg = fabricateTerraswapSwapANC({
    address: key.accAddress,
    amount: Math.trunc(info.pending_rewards) / 1000000,
    to: key.accAddress
  })(addressProvider);

  return [].concat(claimRewardsMsg, sellANCMsg);
}


async function main() {

  let msgs = [];

  const mirrorMsgs = await getClaimAndStakeMirrorMsgs('stake');
  msgs = msgs.concat(mirrorMsgs);

  const anchorMsgs = await getClaimAndSellAnchorMsgs();
  msgs = msgs.concat(anchorMsgs);

  console.dir(msgs, { depth: null, colors: true });

  const tx = await wallet.createAndSignTx({
    msgs: msgs,
    gasPrices: '0.15uusd',
    gasAdjustment: 1.25
  });

  const result = await lcd.tx.broadcast(tx);
  console.dir(result, { depth: null, colors: true });
}

main().catch(console.error);