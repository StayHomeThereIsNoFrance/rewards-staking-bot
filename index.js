import { LCDClient, MnemonicKey, RawKey, Dec } from '@terra-money/terra.js';
import { Mirror, UST } from '@mirror-protocol/mirror.js';
import { Anchor, columbus5, AddressProviderFromJson, MARKET_DENOMS, fabricateMarketClaimRewards, fabricateTerraswapSwapANC, queryMarketBorrowerInfo, fabricateTerraswapProvideLiquidityANC, fabricateStakingBond, fabricateGovStakeVoting, fabricateStakingWithdraw } from '@anchor-protocol/anchor.js'
import { queryTerraswapSimulation } from '@anchor-protocol/anchor.js/dist/queries/terraswap/simulation.js'
import { queryTerraswapPool } from '@anchor-protocol/anchor.js/dist/queries/terraswap/pool.js'


(await import('dotenv')).config()

const lcd = new LCDClient({URL: 'https://lcd.terra.dev', chainID: 'columbus-5'});
const key = new MnemonicKey({mnemonic: process.env.MNEMONIC});
const wallet = lcd.wallet(key);

const mirror = new Mirror({ lcd: lcd, key: key});

const addressProvider = new AddressProviderFromJson(columbus5);
const anchor = new Anchor(lcd, addressProvider);

const ancContractAddress = 'terra14z56l0fp2lsf86zy3hty2z47ezkhnthtr9yq76';

const terraswapANCPairContractAddress = 'terra1gm5p3ner9x9xpwugn9sp6gvhd0lwrtkyrecdn3';

const million = 1000000;

console.dir(wallet.key.accAddress)

async function getUnstakeMirrorMsgs() {
  // const assetToken = mirror.assets[assetName];
  const info = await mirror.factory.getDistributionInfo();
  const tokens = info.weights.map((w) => w[0]);
  console.dir(tokens, { depth: 3, colors: true });
  // const rewardInfo = await mirror.staking.getRewardInfo(wallet.key.accAddress, assetToken.token.contractAddress);
  
  const msgs = await Promise.all(tokens.map(async (token) => {
    // console.dir(assetToken.name, { depth: 2, colors: true });
    const rewardInfo = await mirror.staking.getRewardInfo(wallet.key.accAddress, token);
    console.dir(rewardInfo, { depth: 3, colors: true });

    if (rewardInfo.reward_infos === undefined || rewardInfo.reward_infos.length == 0) {
      return null;
    }

    const amount = rewardInfo.reward_infos[0].bond_amount;
    return amount > 0 ? mirror.staking.unbond(token, amount) : null;
  }));

  const realMsgs = msgs.filter((msg) => msg);
  console.dir(realMsgs, { depth: 2, colors: true }); 
  
  return realMsgs;

  // const unstakeMsg = mirror.staking.unbond(assetToken.token.contractAddress, )
}


async function getClaimAndStakeMirrorMsgs(stakeOrSell) {
  const rewards = await mirror.staking.getRewardInfo(key.accAddress);

  console.dir(rewards.reward_infos, { depth: null, colors: true });

  const stakingRewards = rewards.reward_infos.reduce((carry, item) => carry += Number(item.pending_reward), 0);
  console.dir(stakingRewards, { depth: null, colors: true });

  const votingInfo = await mirror.gov.getStaker(key.accAddress);
  const votingRewards = votingInfo.pending_voting_rewards;

  const totalRewards = Math.floor(Number(stakingRewards) + Number(votingRewards));

  console.dir(votingInfo, { depth: null, colors: true });
  

  const mirrorToken = mirror.assets['MIR'];
  // console.dir(mirrorToken, { depth: null, colors: true });

  // process.exit();

  const pool = await mirrorToken.pair.getPool();
  console.dir(pool, { depth: null, colors: true });

  const price = Number(pool.assets[0].amount) / Number(pool.assets[1].amount);
  // console.dir(price, { depth: null, colors: true });

  const lptokens = Math.floor( totalRewards / (Number(pool.assets[1].amount) + totalRewards) * Number(pool.total_share) );
  console.dir(lptokens, { depth: null, colors: true });
  // process.exit();

  const increaseAllowance = mirrorToken.token.increaseAllowance(mirrorToken.pair.contractAddress, totalRewards);


  const provideLiquidityMsg = mirrorToken.pair.provideLiquidity([
    {
      info: {
        token: {
          contract_addr: mirrorToken.token.contractAddress
        }
      },
      amount: totalRewards.toString()
    },
    {
      info: UST,
      amount: Math.floor(totalRewards * price).toString()
    } 
  ]);

  const stakeLpMsg = mirror.staking.bond(mirrorToken.token.contractAddress, lptokens, mirrorToken.lpToken);

  let msgs = [mirror.staking.withdraw()];


  if(stakeOrSell == 'stake') {


    if(votingRewards > 0) {
      msgs = msgs.concat(mirror.gov.stakeVotingRewards())
    }

    return [...msgs, ...[mirror.gov.stakeVotingTokens(mirrorToken.token, totalRewards)]]
    
  }
  else {

    if(votingRewards > 0) {
      msgs = msgs.concat(mirror.gov.withdrawVotingRewards())
    }


    return [...msgs, ...[
      increaseAllowance, 
      provideLiquidityMsg, 
      stakeLpMsg
    ]];
  }
 
}

async function getClaimAndSellAnchorMsgs(stakeOrSell) {
  
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

  const ANCAmount = Math.trunc(info.pending_rewards) / 1000000;

  if(stakeOrSell == 'sell') {

    const sellANCMsg = fabricateTerraswapSwapANC({
      address: key.accAddress,
      amount: ANCAmount,
      to: key.accAddress
    })(addressProvider);

    return [].concat(claimRewardsMsg, sellANCMsg);
  }
  else if(stakeOrSell == 'stake') {
    const govStakeVotingMsg = fabricateGovStakeVoting({
      address: key.accAddress,
      amount: ANCAmount
    })(addressProvider);

    return [].concat(claimRewardsMsg, govStakeVotingMsg);
  }
  else {

    const pool = await queryTerraswapPool({
      lcd: lcd, 
      pair_contract_address: 'terra1gm5p3ner9x9xpwugn9sp6gvhd0lwrtkyrecdn3'
    })(addressProvider);

    console.dir(pool, { depth: null, colors: true });
    

    const price = Number(pool.assets[1].amount) / Number(pool.assets[0].amount); 
    console.dir(price, { depth: null, colors: true });

    console.dir('ANCAmount ' + ANCAmount, { depth: null, colors: true });

    const ancAmountFull = new Dec(ANCAmount).mul(million);
    console.dir('ancAmountFull ' + ancAmountFull, { depth: null, colors: true });

    const lptokens = Math.trunc(ancAmountFull / (Number(pool.assets[0].amount) + ancAmountFull) * ( Number(pool.total_share) + ancAmountFull));
    console.dir('lptokens ' + lptokens, { depth: null, colors: true });
    // process.exit();

    const provideLiquidityANCMsg = fabricateTerraswapProvideLiquidityANC({
      address: key.accAddress,
      slippage_tolerance: "0.01",
      token_amount: ANCAmount,
      native_amount: ANCAmount * price,
      quote: 'uusd'
    })(addressProvider);

    const stakeANC_LP = fabricateStakingBond({
      address: key.accAddress,
      amount: lptokens / million
    })(addressProvider);

    return [].concat(claimRewardsMsg, provideLiquidityANCMsg, stakeANC_LP);
  }
}


async function main() {

  let msgs = [];

  // const unstakeMsgs = await getUnstakeMirrorMsgs();
  // msgs = msgs.concat(unstakeMsgs);
  // const mirrorMsgs = await getClaimAndStakeMirrorMsgs('stake');
  // msgs = msgs.concat(mirrorMsgs);

  const anchorMsgs = await getClaimAndSellAnchorMsgs('provide');
  msgs = msgs.concat(anchorMsgs);

  console.dir(msgs, { depth: 7, colors: true });

  const tx = await wallet.createAndSignTx({
    msgs: msgs,
    gasPrices: '0.456uusd',
    gasAdjustment: 1.25
  });

  const result = await lcd.tx.broadcast(tx);
  console.dir(result, { depth: null, colors: true });
}

main().catch(console.error);