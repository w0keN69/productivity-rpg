import {localDateKey,yesterdayKey} from '../utils/date.js';

export const XP={easy:5,medium:10,hard:20};
export const COINS={easy:2,medium:5,hard:10};
export const DAILY_BONUS=25;

export const ACHIEVEMENTS=[
  {id:'first-quest',name:'First Quest',description:'Complete your first task.',xp:10,coins:10},
  {id:'level-2',name:'Level 2',description:'Reach level 2.',xp:20,coins:20},
  {id:'100-xp',name:'100 XP',description:'Earn 100 XP.',xp:25,coins:25},
  {id:'500-xp',name:'500 XP',description:'Earn 500 XP.',xp:50,coins:50},
  {id:'first-full-day',name:'First Full Day',description:'Complete every daily task once.',xp:50,coins:50},
  {id:'3-day-streak',name:'3 Day Streak',description:'Reach a 3 day streak.',xp:50,coins:50},
  {id:'10-day-streak',name:'10 Day Streak',description:'Reach a 10 day streak.',xp:100,coins:100},
  {id:'1000-xp',name:'1,000 XP',description:'Earn 1,000 XP.',xp:150,coins:150}
];

export function levelFromXp(xp){
  let level=1,total=0;
  while(total+levelRequirement(level)<=Math.max(0,xp)){total+=levelRequirement(level);level++;}
  return level;
}
export function levelRequirement(level){return 100+(Math.max(1,level)-1)*50;}
export function xpAtLevel(level){let total=0;for(let n=1;n<Math.max(1,level);n++)total+=levelRequirement(n);return total;}
export function xpForLevel(xp){const level=levelFromXp(xp);return Math.max(0,Math.max(0,xp)-xpAtLevel(level));}
export function xpToNextLevel(xp){const level=levelFromXp(xp);return Math.max(0,levelRequirement(level)-xpForLevel(xp));}
export function allTasks(data){return Object.values(data.routines).flat();}
export function taskKey(id){return localDateKey()+'_'+id;}
export function weekKey(date=new Date()){
  const d=new Date(date); const day=d.getDay()||7; d.setDate(d.getDate()-day+1);
  return localDateKey(d);
}
export function refreshDailyState(data){
  if(data.lastComplete&&data.lastComplete!==localDateKey()&&data.lastComplete!==yesterdayKey())data.streak=0;
  return data;
}
export function milestoneBonus(streak){
  if(streak>=30)return 100;
  if(streak>=14)return 50;
  if(streak>=7)return 25;
  if(streak>=3)return 10;
  return 0;
}
export function dailyQuestProgress(data,completed){
  const tasks=allTasks(data),done=tasks.filter(t=>completed[taskKey(t.id)]).length;
  return {done,total:tasks.length,completeThree:Math.min(done,3)};
}
export function weeklyQuestProgress(data){
  const current=weekKey(),days=data.history.filter(h=>weekKey(new Date(h.date+'T00:00:00'))===current).length;
  const xpEarned=data.history.filter(h=>weekKey(new Date(h.date+'T00:00:00'))===current).reduce((sum,h)=>sum+h.xp,0);
  return {days,xpEarned};
}
export function achievementUnlocked(data,id){
  const level=levelFromXp(data.xp);
  return {
    'first-quest':data.xp>=5,'level-2':level>=2,'100-xp':data.xp>=100,'500-xp':data.xp>=500,
    'first-full-day':data.history.length>=1,'3-day-streak':data.streak>=3,'10-day-streak':data.streak>=10,'1000-xp':data.xp>=1000
  }[id]||false;
}
export function grantNewAchievementRewards(data){
  const newly=[];
  for(const a of ACHIEVEMENTS){
    if(achievementUnlocked(data,a.id)&&!data.achievementRewards.includes(a.id)){
      data.achievementRewards.push(a.id); data.xp+=a.xp; data.coins+=a.coins; newly.push(a);
    }
  }
  return newly;
}
export function toggleTask(data,completed,id){
  const task=allTasks(data).find(t=>String(t.id)===String(id));
  if(!task)return {bonus:false,xpGain:0,coinGain:0,levelUp:false,newAchievements:[]};
  const beforeLevel=levelFromXp(data.xp),k=taskKey(id);
  if(completed[k]){
    delete completed[k]; data.xp=Math.max(0,data.xp-XP[task.difficulty]); data.coins=Math.max(0,data.coins-COINS[task.difficulty]); repairBonus(data,completed);
    return {bonus:false,xpGain:-XP[task.difficulty],coinGain:-COINS[task.difficulty],levelUp:false,newAchievements:[]};
  }
  completed[k]=true; data.xp+=XP[task.difficulty]; data.coins+=COINS[task.difficulty];
  const tasks=allTasks(data); let bonus=false; let coinGain=COINS[task.difficulty]; let streakBonus=0;
  if(tasks.length&&tasks.every(t=>completed[taskKey(t.id)])&&data.lastDailyBonusDate!==localDateKey()){
    data.coins+=DAILY_BONUS; coinGain+=DAILY_BONUS; data.lastDailyBonusDate=localDateKey();
    data.streak=data.lastComplete===yesterdayKey()?data.streak+1:1; data.lastComplete=localDateKey();
    streakBonus=milestoneBonus(data.streak); data.coins+=streakBonus; coinGain+=streakBonus;
    if(!data.history.some(h=>h.date===localDateKey()))data.history.push({date:localDateKey(),done:tasks.length,total:tasks.length,xp:data.xp,coins:data.coins,streak:data.streak});
    bonus=true;
  }
  const newAchievements=grantNewAchievementRewards(data);
  return {bonus,xpGain:XP[task.difficulty],coinGain,streakBonus,levelUp:levelFromXp(data.xp)>beforeLevel,newLevel:levelFromXp(data.xp),newAchievements};
}
export function repairBonus(data,completed){
  const today=localDateKey(),tasks=allTasks(data);
  if(data.lastDailyBonusDate===today&&!(tasks.length&&tasks.every(t=>completed[taskKey(t.id)]))){
    data.coins=Math.max(0,data.coins-DAILY_BONUS); data.lastDailyBonusDate=null;
    if(data.lastComplete===today){data.streak=Math.max(0,data.streak-1);data.lastComplete=null;}
    data.history=data.history.filter(h=>h.date!==today);
  }
}
export function snapshot(data,completed){
  const tasks=allTasks(data),done=tasks.filter(t=>completed[taskKey(t.id)]).length;
  return {date:localDateKey(),done,total:tasks.length,xp:data.xp,coins:data.coins,streak:data.streak};
}