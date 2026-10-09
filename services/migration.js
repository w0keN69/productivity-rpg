// Safe local -> Supabase migration for In Track.
// Content tables are client-writable under RLS.
// Protected gameplay state is stored as a private migration snapshot until
// trusted server-side gameplay/import RPCs are available.

import {getClient} from './auth.js';

function requireUser(session){
  const user=session?.user;
  if(!user?.id)throw new Error('You must be signed in before migrating data.');
  return user;
}

function routineLocalId(name,index){return 'routine_'+index+'_'+String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48);}
function now(){return new Date().toISOString();}

async function countRows(client,table){
  const {count,error}=await client.from(table).select('id',{count:'exact',head:true});
  if(error)throw error;
  return Number(count||0);
}

export async function inspectCloud(session){
  const client=await getClient();
  if(!client)throw new Error('Cloud is not configured.');
  requireUser(session);
  const tables=['routines','tasks','rewards','focus_presets','notes','user_migrations'];
  const counts={};
  for(const table of tables)counts[table]=await countRows(client,table);
  const {data:migration,error}=await client.from('user_migrations').select('status,source_version,updated_at').maybeSingle();
  if(error)throw error;
  return {counts,migration,empty:tables.every(t=>counts[t]===0)};
}

async function upsertTable(client,table,rows){
  if(!rows.length)return;
  const {error}=await client.from(table).upsert(rows,{onConflict:'user_id,local_id'});
  if(error)throw error;
}

export async function migrateLocalContent(session,localData){
  const user=requireUser(session),client=await getClient();
  if(!client)throw new Error('Cloud is not configured.');
  const before=await inspectCloud(session);
  if(!before.empty && !['pending','content_migrated'].includes(before.migration?.status))
    throw new Error('This cloud account already contains migrated data. Choose a merge strategy before replacing it.');

  const routines=Object.entries(localData.routines||{});
  const routineRows=routines.map(([name,tasks],index)=>({
    user_id:user.id,local_id:routineLocalId(name,index),name:String(name).trim(),sort_order:index,archived:false
  }));
  await upsertTable(client,'routines',routineRows);

  const {data:cloudRoutines,error:routineError}=await client.from('routines').select('id,local_id').eq('user_id',user.id);
  if(routineError)throw routineError;
  const routineMap=new Map((cloudRoutines||[]).map(r=>[r.local_id,r.id]));

  const taskRows=[];
  routines.forEach(([name,tasks],routineIndex)=>{
    const routineId=routineMap.get(routineLocalId(name,routineIndex));
    (tasks||[]).forEach((task,index)=>{
      taskRows.push({
        user_id:user.id,local_id:String(task.id),routine_id:routineId,name:String(task.name||'').trim(),
        priority:task.priority||'medium',difficulty:task.difficulty||'easy',
        xp_reward:task.difficulty==='hard'?20:task.difficulty==='medium'?10:5,
        coin_reward:task.difficulty==='hard'?10:task.difficulty==='medium'?5:2,
        sort_order:index,archived:false
      });
    });
  });
  await upsertTable(client,'tasks',taskRows);

  await upsertTable(client,'rewards',(localData.rewards||[]).map((r,i)=>({
    user_id:user.id,local_id:String(r.id||'r_'+i),name:String(r.name||'').trim(),
    coin_cost:Number(r.cost)||1,time_limit_minutes:Number(r.timeLimit)||null,active:true
  })));

  await upsertTable(client,'focus_presets',(localData.focusPresets||[]).map((p,i)=>({
    user_id:user.id,local_id:String(p.id||'fp_'+i),name:String(p.name||'').trim(),
    focus_minutes:Number(p.work)||1,break_minutes:Number(p.break)||0,rounds:Number(p.rounds)||1
  })));

  await upsertTable(client,'notes',(localData.notes||[]).map((n,i)=>({
    user_id:user.id,local_id:String(n.id||'n_'+i),title:String(n.title||'').slice(0,120),
    body:String(n.body||''),pinned:!!n.pinned,archived:false
  })));

  const protectedSnapshot={
    xp:Number(localData.xp)||0,coins:Number(localData.coins)||0,streak:Number(localData.streak)||0,
    lastComplete:localData.lastComplete||null,lastDailyBonusDate:localData.lastDailyBonusDate||null,
    history:Array.isArray(localData.history)?localData.history:[],
    rewardHistory:Array.isArray(localData.rewardHistory)?localData.rewardHistory:[],
    activeRewards:Array.isArray(localData.activeRewards)?localData.activeRewards:[],
    focusSessions:Array.isArray(localData.focusSessions)?localData.focusSessions:[],
    achievementRewards:Array.isArray(localData.achievementRewards)?localData.achievementRewards:[],
    completed:localData.__completed||{}
  };

  const {error:migrationError}=await client.from('user_migrations').upsert({
    user_id:user.id,source_app:'In Track',source_version:Number(localData.version)||1,
    status:'content_migrated',protected_snapshot:protectedSnapshot
  },{onConflict:'user_id'});
  if(migrationError)throw migrationError;

  const {data:finalized,error:finalizeError}=await client.rpc('finalize_local_migration');
  if(finalizeError)throw new Error('Your content and progress snapshot were saved, but the database restore step is not installed yet. Keep your local data and backup. Details: '+finalizeError.message);

  return {status:'completed',finalized,routines:routineRows.length,tasks:taskRows.length,rewards:(localData.rewards||[]).length,focusPresets:(localData.focusPresets||[]).length,notes:(localData.notes||[]).length};
}

export async function migrateLocalState(session,localData,completed={}){
  const copy=structuredClone?structuredClone(localData):JSON.parse(JSON.stringify(localData));
  copy.__completed=completed||{};
  return migrateLocalContent(session,copy);
}
