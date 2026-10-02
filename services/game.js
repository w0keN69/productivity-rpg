import {localDateKey,yesterdayKey} from '../utils/date.js';
export const XP={easy:5,medium:10,hard:20};
export const COINS={easy:2,medium:5,hard:10};
export const LEVEL_XP=100;
export function levelFromXp(xp){return Math.floor(Math.max(0,xp)/LEVEL_XP)+1;}
export function xpForLevel(xp){return Math.max(0,xp)%LEVEL_XP;}
export function allTasks(data){return Object.values(data.routines).flat();}
export function taskKey(id){return localDateKey()+'_'+id;}
export function toggleTask(data,completed,id){const task=allTasks(data).find(t=>String(t.id)===String(id));if(!task)return {bonus:false};const k=taskKey(id);if(completed[k]){delete completed[k];data.xp=Math.max(0,data.xp-XP[task.difficulty]);data.coins=Math.max(0,data.coins-COINS[task.difficulty]);repairBonus(data,completed);return {bonus:false};}completed[k]=true;data.xp+=XP[task.difficulty];data.coins+=COINS[task.difficulty];const tasks=allTasks(data);let bonus=false;if(tasks.length&&tasks.every(t=>completed[taskKey(t.id)])&&data.lastDailyBonusDate!==localDateKey()){data.coins+=25;data.lastDailyBonusDate=localDateKey();data.streak=data.lastComplete===yesterdayKey()?data.streak+1:1;data.lastComplete=localDateKey();bonus=true;}return {bonus};}
export function repairBonus(data,completed){const today=localDateKey(),tasks=allTasks(data);if(data.lastDailyBonusDate===today&&!(tasks.length&&tasks.every(t=>completed[taskKey(t.id)]))){data.coins=Math.max(0,data.coins-25);data.lastDailyBonusDate=null;if(data.lastComplete===today){data.streak=Math.max(0,data.streak-1);data.lastComplete=null;}}}
export function snapshot(data,completed){const tasks=allTasks(data),done=tasks.filter(t=>completed[taskKey(t.id)]).length;return {date:localDateKey(),done:done,total:tasks.length,xp:data.xp,coins:data.coins,streak:data.streak};}