import {getClient} from './auth.js';

export async function getCloudProgressSummary(startDate){
  const client=await getClient();
  if(!client)throw new Error('Cloud is not configured.');
  const {data,error}=await client.rpc('get_progress_summary',{p_start:startDate});
  if(error)throw error;
  return data||{daily_progress:[],task_completions:[],reward_redemptions:[],focus_sessions:[],achievements:[]};
}


export function mapCloudHistory(summary){
  return {
    dailyProgress:Array.isArray(summary?.daily_progress)?summary.daily_progress:[],
    taskCompletions:Array.isArray(summary?.task_completions)?summary.task_completions:[],
    rewardRedemptions:Array.isArray(summary?.reward_redemptions)?summary.reward_redemptions:[],
    focusSessions:Array.isArray(summary?.focus_sessions)?summary.focus_sessions:[],
    achievements:Array.isArray(summary?.achievements)?summary.achievements:[]
  };
}
