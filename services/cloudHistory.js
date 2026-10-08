import {getClient} from './auth.js';

export async function getCloudProgressSummary(startDate){
  const client=await getClient();
  if(!client)throw new Error('Cloud is not configured.');
  const {data,error}=await client.rpc('get_progress_summary',{p_start:startDate});
  if(error)throw error;
  return data||{daily_progress:[],task_completions:[],reward_redemptions:[],focus_sessions:[],achievements:[]};
}
