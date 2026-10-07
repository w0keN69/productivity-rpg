// Cloud gameplay adapter.
// Gameplay mutations are executed by trusted Supabase RPCs.

import {getClient} from './auth.js';

export async function completeCloudTask(taskId,date){
  const client=await getClient();
  if(!client)throw new Error('Cloud is not configured.');
  const {data,error}=await client.rpc('complete_task',{p_task_id:taskId,p_completion_date:date});
  if(error)throw error;
  return data;
}

export async function getCloudPlayerState(){
  const client=await getClient();
  if(!client)throw new Error('Cloud is not configured.');
  const {data,error}=await client.rpc('get_player_state');
  if(error)throw error;
  return data;
}
