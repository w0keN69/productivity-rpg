// Cloud gameplay adapter.
// Resolve stable local task IDs to Supabase UUIDs before trusted RPC calls.
import {getClient} from './auth.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function completeCloudTask(taskId,date){
  const client=await getClient();
  if(!client)throw new Error('Cloud is not configured.');
  let cloudTaskId=String(taskId||'');
  if(!UUID.test(cloudTaskId)){
    const {data,error}=await client.from('tasks').select('id').eq('local_id',cloudTaskId).eq('archived',false).maybeSingle();
    if(error)throw error;
    if(!data?.id)throw new Error('This task is not linked to a cloud task yet. Your local task was not changed. Finish cloud migration before completing tasks in cloud mode.');
    cloudTaskId=data.id;
  }
  const {data,error}=await client.rpc('complete_task',{p_task_id:cloudTaskId,p_completion_date:date});
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
