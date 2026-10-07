// Cloud synchronization for In Track.
// Cloud is authoritative for signed-in content and protected player state.
// Local storage remains the offline cache.

import {getClient} from './auth.js';
import {localDateKey} from '../utils/date.js';

function requireClient(){
  return getClient().then(client=>{if(!client)throw new Error('Cloud is not configured.');return client;});
}

export async function loadCloudState(session){
  if(!session?.user?.id)throw new Error('Authentication required.');
  const client=await requireClient(), userId=session.user.id;

  const [{data:routines,error:rErr},{data:tasks,error:tErr},{data:rewards,error:rwErr},{data:presets,error:pErr},{data:notes,error:nErr},{data:player,error:psErr},{data:streak,error:sErr}]=await Promise.all([
    client.from('routines').select('*').eq('user_id',userId).eq('archived',false).order('sort_order'),
    client.from('tasks').select('*').eq('user_id',userId).eq('archived',false).order('sort_order'),
    client.from('rewards').select('*').eq('user_id',userId).eq('active',true).order('created_at'),
    client.from('focus_presets').select('*').eq('user_id',userId).order('created_at'),
    client.from('notes').select('*').eq('user_id',userId).eq('archived',false).order('pinned',{ascending:false}).order('updated_at',{ascending:false}),
    client.rpc('get_player_state'),
    client.from('streaks').select('*').eq('user_id',userId).maybeSingle()
  ]);
  for(const e of [rErr,tErr,rwErr,pErr,nErr,psErr,sErr])if(e)throw e;

  const {data:completions,error:cErr}=await client.from('task_completions')
    .select('task_id,completion_date').eq('user_id',userId).eq('completion_date',localDateKey());
  if(cErr)throw cErr;

  const routines={};
  for(const r of routinesRows(routines))routines[r.name]=[];
  for(const t of (tasks||[])){
    const routine=(routinesRows(routines).find(r=>r.id===t.routine_id));
    if(routine){
      if(!routines[routine.name])routines[routine.name]=[];
      routines[routine.name].push({
        id:t.local_id||t.id,cloudId:t.id,name:t.name,priority:t.priority,difficulty:t.difficulty
      });
    }
  }

  const d={
    routines,
    rewards:(rewards||[]).map(r=>({id:r.local_id||r.id,name:r.name,cost:r.coin_cost,timeLimit:r.time_limit_minutes})),
    focusPresets:(presets||[]).map(p=>({id:p.local_id||p.id,name:p.name,work:p.focus_minutes,break:p.break_minutes,rounds:p.rounds})),
    notes:(notes||[]).map(n=>({id:n.local_id||n.id,title:n.title,body:n.body,pinned:n.pinned,date:(n.created_at||'').slice(0,10)||localDateKey(n.created_at)})),
    xp:Number(player?.xp)||0,coins:Number(player?.coins)||0,
    streak:Number(streak?.current_streak)||0,lastComplete:streak?.last_completed_date||null,
    achievementRewards:[]
  };
  const completed={};
  for(const c of (completions||[]))completed[c.completion_date+'_'+c.task_id]=true;
  // Local task IDs are used by the UI; convert cloud UUID completion records
  // to local task IDs through the task rows.
  const taskMap=new Map((tasks||[]).map(t=>[t.id,t.local_id||t.id]));
  const normalizedCompleted={};
  for(const c of (completions||[])){
    const id=taskMap.get(c.task_id);
    if(id)normalizedCompleted[c.completion_date+'_'+id]=true;
  }
  return {data:d,completed:normalizedCompleted};
}

function routinesRows(rows){return Array.isArray(rows)?rows:[];}

export async function saveCloudProfile(session,name){
  if(!session?.user?.id)throw new Error('Authentication required.');
  const client=await requireClient();
  const {error}=await client.from('profiles').update({display_name:String(name||'').trim()}).eq('user_id',session.user.id);
  if(error)throw error;
}

export async function saveCloudNote(session,note){
  if(!session?.user?.id)throw new Error('Authentication required.');
  const client=await requireClient();
  const payload={user_id:session.user.id,local_id:String(note.id),title:String(note.title||''),body:String(note.body||''),pinned:!!note.pinned,archived:false};
  const {error}=await client.from('notes').upsert(payload,{onConflict:'user_id,local_id'});
  if(error)throw error;
}

export async function deleteCloudNote(session,localId){
  if(!session?.user?.id)throw new Error('Authentication required.');
  const client=await requireClient();
  const {error}=await client.from('notes').delete().eq('user_id',session.user.id).eq('local_id',localId);
  if(error)throw error;
}
