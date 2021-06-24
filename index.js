import { LCDClient, MnemonicKey, RawKey } from '@terra-money/terra.js';
import { Mirror } from '@mirror-protocol/mirror.js';

(await import('dotenv')).config()

console.log(process.env.MNEMONIC);
// default -- uses Columbus-4 core contract addresses
const mirror = new Mirror({
                            lcd: new LCDClient({URL: 'https://lcd.terra.dev', chainID: 'columbus-4'}), 
                            key: new MnemonicKey({mnemonic: process.env.MNEMONIC})
                          });
const wallet = mirror.lcd.wallet(mirror.key);

console.dir(wallet.key.accAddress)


async function main() {
  const result = await mirror.staking.getRewardInfo(wallet.key.accAddress);
  // console.dir(result, { depth: null, colors: true });

  // const token = result.reward_infos[0];
  // const poolInfo = await mirror.staking.getPoolInfo(token.asset_token);
  // console.dir(poolInfo, { depth: null, colors: true });

  const rewards = await Promise.all(result.reward_infos.map(async(token) => {
    const poolInfo = await mirror.staking.getPoolInfo(token.asset_token);
    token.reward = (Number(poolInfo.reward_index) - Number(token.index)) * Number(token.bond_amount) + Number(token.pending_reward);
    return token;
  }));

  console.dir(rewards, { depth: null, colors: true });

  const totalRewards = rewards.reduce((carry, item) => carry+= item.reward, 0);
  console.dir(totalRewards, { depth: null, colors: true });

  const mirrorToken = mirror.assets['MIR'];
  // console.dir(mirror.assets['MIR'], { depth: null, colors: true });

 
  const tx = await wallet.createAndSignTx({
    msgs: [mirror.staking.withdraw(), mirror.gov.stakeVotingTokens(mirrorToken.token, totalRewards)],
    gasPrices: '0.15uusd',
    gasAdjustment: 1.2
  });

  console.dir(tx, { depth: null, colors: true });
  const wresult = await mirror.lcd.tx.broadcast(tx);
  console.dir(wresult, { depth: null, colors: true });
}

main().catch(console.error);