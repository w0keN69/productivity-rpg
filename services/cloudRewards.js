import {getClient} from './auth.js';

async function rpc(name,args){
  const client=await getClient(); if(!client)throw new Error('Cloud is not configured.');
  const {data,error}=await client.rpc(name,args); if(error)throw error; return data;
}
export function redeemCloudReward(rewardId){return rpc('redeem_reward',{p_reward_id:rewardId});}
export function completeCloudFocus(presetId,minutes,round=1){return rpc('complete_focus_session',{p_preset_id:presetId||null,p_minutes:minutes,p_round:round});}
export function unlockCloudAchievement(id){return rpc('unlock_achievement',{p_achievement_id:id});}
