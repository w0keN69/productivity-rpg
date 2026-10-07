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


export async function syncLocalContent(session,localData){
  if(!session?.user?.id)throw new Error('Authentication required.');
  const client=await requireClient(), userId=session.user.id;
  const routines=Object.entries(localData.routines||{});
  const routineRows=routines.map(([name],index)=>({
    user_id:userId,local_id:'routine_'+index+'_'+String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48),
    name:String(name).trim(),sort_order:index,archived:false
  }));

  const {data:oldRoutines,error:oldRoutineError}=await client.from('routines').select('id,local_id').eq('user_id',userId);
  if(oldRoutineError)throw oldRoutineError;
  const wantedRoutineIds=new Set(routineRows.map(r=>r.local_id));
  const staleRoutines=(oldRoutines||[]).filter(r=>r.local_id&&!wantedRoutineIds.has(r.local_id)).map(r=>r.id);
  if(staleRoutines.length){
    const {error}=await client.from('routines').delete().eq('user_id',userId).in('id',staleRoutines);
    if(error)throw error;
  }
  if(routineRows.length){
    const {error}=await client.from('routines').upsert(routineRows,{onConflict:'user_id,local_id'});
    if(error)throw error;
  }

  const {data:cloudRoutines,error:crError}=await client.from('routines').select('id,local_id').eq('user_id',userId);
  if(crError)throw crError;
  const routineMap=new Map((cloudRoutines||[]).map(r=>[r.local_id,r.id]));
  const taskRows=[];
  routines.forEach(([name,tasks],ri)=>{
    const rid=routineMap.get(routineRows[ri].local_id);
    (tasks||[]).forEach((t,i)=>taskRows.push({
      user_id:userId,local_id:String(t.id),routine_id:rid,name:String(t.name||'').trim(),
      priority:t.priority||'medium',difficulty:t.difficulty||'easy',
      xp_reward:t.difficulty==='hard'?20:t.difficulty==='medium'?10:5,
      coin_reward:t.difficulty==='hard'?10:t.difficulty==='medium'?5:2,
      sort_order:i,archived:false
    }));
  });

  const {data:oldTasks,error:oldTaskError}=await client.from('tasks').select('id,local_id').eq('user_id',userId);
  if(oldTaskError)throw oldTaskError;
  const wantedTaskIds=new Set(taskRows.map(t=>t.local_id));
  const staleTasks=(oldTasks||[]).filter(t=>t.local_id&&!wantedTaskIds.has(t.local_id)).map(t=>t.id);
  if(staleTasks.length){
    const {error}=await client.from('tasks').delete().eq('user_id',userId).in('id',staleTasks);
    if(error)throw error;
  }
  if(taskRows.length){
    const {error}=await client.from('tasks').upsert(taskRows,{onConflict:'user_id,local_id'});
    if(error)throw error;
  }

  const collections=[
    ['rewards',(localData.rewards||[]).map((r,i)=>({user_id:userId,local_id:String(r.id||'r_'+i),name:String(r.name||'').trim(),coin_cost:Number(r.cost)||1,time_limit_minutes:Number(r.timeLimit)||null,active:true}))],
    ['focus_presets',(localData.focusPresets||[]).map((p,i)=>({user_id:userId,local_id:String(p.id||'fp_'+i),name:String(p.name||'').trim(),focus_minutes:Number(p.work)||1,break_minutes:Number(p.break)||0,rounds:Number(p.rounds)||1}))],
    ['notes',(localData.notes||[]).map((n,i)=>({user_id:userId,local_id:String(n.id||'n_'+i),title:String(n.title||'').slice(0,120),body:String(n.body||''),pinned:!!n.pinned,archived:false}))]
  ];
  for(const [table,rows] of collections){
    const {data:old,error:oldError}=await client.from(table).select('id,local_id').eq('user_id',userId);
    if(oldError)throw oldError;
    const wanted=new Set(rows.map(x=>x.local_id));
    const stale=(old||[]).filter(x=>x.local_id&&!wanted.has(x.local_id)).map(x=>x.id);
    if(stale.length){const {error}=await client.from(table).delete().eq('user_id',userId).in('id',stale);if(error)throw error;}
    if(rows.length){const {error}=await client.from(table).upsert(rows,{onConflict:'user_id,local_id'});if(error)throw error;}
  }
  return {synced:true,routines:routineRows.length,tasks:taskRows.length};
}
