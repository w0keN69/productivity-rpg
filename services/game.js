import {localDateKey,yesterdayKey} from '../utils/date.js';

export const XP={easy:5,medium:10,hard:20};
export const COINS={easy:2,medium:5,hard:10};
export const DAILY_BONUS=25;

export function levelFromXp(xp){
  let level=1,total=0;
  while(total+levelRequirement(level)<=Math.max(0,xp)){
    total+=levelRequirement(level);
    level++;
  }
  return level;
}

export function levelRequirement(level){
  return 100+(Math.max(1,level)-1)*50;
}

export function xpAtLevel(level){
  let total=0;
  for(let n=1;n<Math.max(1,level);n++)total+=levelRequirement(n);
  return total;
}

export function xpForLevel(xp){
  const level=levelFromXp(xp);
  return Math.max(0,Math.max(0,xp)-xpAtLevel(level));
}

export function xpToNextLevel(xp){
  const level=levelFromXp(xp);
  return Math.max(0,levelRequirement(level)-xpForLevel(xp));
}

export function allTasks(data){
  return Object.values(data.routines).flat();
}

export function taskKey(id){
  return localDateKey()+'_'+id;
}

export function refreshDailyState(data){
  if(data.lastComplete&&data.lastComplete!==localDateKey()&&data.lastComplete!==yesterdayKey()){
    data.streak=0;
  }
  return data;
}

export function toggleTask(data,completed,id){
  const task=allTasks(data).find(t=>String(t.id)===String(id));
  if(!task)return {bonus:false,xpGain:0,coinGain:0,levelUp:false};
  const beforeLevel=levelFromXp(data.xp);
  const k=taskKey(id);

  if(completed[k]){
    delete completed[k];
    data.xp=Math.max(0,data.xp-XP[task.difficulty]);
    data.coins=Math.max(0,data.coins-COINS[task.difficulty]);
    repairBonus(data,completed);
    return {bonus:false,xpGain:-XP[task.difficulty],coinGain:-COINS[task.difficulty],levelUp:false};
  }

  completed[k]=true;
  data.xp+=XP[task.difficulty];
  data.coins+=COINS[task.difficulty];

  const tasks=allTasks(data);
  let bonus=false;
  let coinGain=COINS[task.difficulty];

  if(tasks.length&&tasks.every(t=>completed[taskKey(t.id)])&&data.lastDailyBonusDate!==localDateKey()){
    data.coins+=DAILY_BONUS;
    coinGain+=DAILY_BONUS;
    data.lastDailyBonusDate=localDateKey();
    data.streak=data.lastComplete===yesterdayKey()?data.streak+1:1;
    data.lastComplete=localDateKey();
    if(!data.history.some(h=>h.date===localDateKey())){
      data.history.push({
        date:localDateKey(),
        done:tasks.length,
        total:tasks.length,
        xp:data.xp,
        coins:data.coins,
        streak:data.streak
      });
    }
    bonus=true;
  }

  return {
    bonus,
    xpGain:XP[task.difficulty],
    coinGain,
    levelUp:levelFromXp(data.xp)>beforeLevel,
    newLevel:levelFromXp(data.xp)
  };
}

export function repairBonus(data,completed){
  const today=localDateKey(),tasks=allTasks(data);
  if(data.lastDailyBonusDate===today&&!(tasks.length&&tasks.every(t=>completed[taskKey(t.id)]))){
    data.coins=Math.max(0,data.coins-DAILY_BONUS);
    data.lastDailyBonusDate=null;
    if(data.lastComplete===today){
      data.streak=Math.max(0,data.streak-1);
      data.lastComplete=null;
    }
    data.history=data.history.filter(h=>h.date!==today);
  }
}

export function snapshot(data,completed){
  const tasks=allTasks(data),done=tasks.filter(t=>completed[taskKey(t.id)]).length;
  return {date:localDateKey(),done,total:tasks.length,xp:data.xp,coins:data.coins,streak:data.streak};
}