import {STORAGE_KEY,clone} from '../data/defaults.js';
const DB='ProductivityRPGDB',STORE='state';
async function idbPut(value){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(value,'current');tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error);};});}
async function idbGet(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const tx=r.result.transaction(STORE,'readonly');const q=tx.objectStore(STORE).get('current');q.onsuccess=()=>resolve(q.result||null);q.onerror=()=>reject(q.error);};});}
export async function loadState(){try{const raw=localStorage.getItem(STORAGE_KEY);if(raw)return JSON.parse(raw);}catch{}try{const raw=await idbGet();if(raw)return raw;}catch{}return null;}
export async function saveState(data,completed){const payload={data:clone(data),completed:clone(completed),savedAt:new Date().toISOString()};try{localStorage.setItem(STORAGE_KEY,JSON.stringify(payload));}catch{}try{await idbPut(payload);}catch{}return payload.savedAt;}
export async function persistStorage(){try{if(navigator.storage?.persist)await navigator.storage.persist();}catch{}}
export function exportBackup(data,completed){const payload={app:'In Track',version:data.version,exportedAt:new Date().toISOString(),data,completed};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='in-track-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),500);}
// Offline sync journal. Keeps a small local record of content changes so the
// cloud layer can retry after connectivity returns.
const SYNC_DB='InTrackSyncDB',SYNC_STORE='queue';

async function syncDb(){
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open(SYNC_DB,1);
    r.onupgradeneeded=()=>r.result.createObjectStore(SYNC_STORE,{keyPath:'id'});
    r.onerror=()=>reject(r.error);
    r.onsuccess=()=>resolve(r.result);
  });
}
export async function enqueueSync(item){
  try{
    const db=await syncDb(),tx=db.transaction(SYNC_STORE,'readwrite');
    tx.objectStore(SYNC_STORE).put({
      id:item.id||'sync_'+Date.now()+'_'+Math.random().toString(36).slice(2),
      ...item,
      queuedAt:item.queuedAt||new Date().toISOString()
    });
    return true;
  }catch{return false;}
}
export async function readSyncQueue(){
  try{
    const db=await syncDb();
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(SYNC_STORE,'readonly'),q=tx.objectStore(SYNC_STORE).getAll();
      q.onsuccess=()=>resolve(q.result||[]);q.onerror=()=>reject(q.error);
    });
  }catch{return [];}
}
export async function clearSyncQueue(){
  try{
    const db=await syncDb(),tx=db.transaction(SYNC_STORE,'readwrite');
    tx.objectStore(SYNC_STORE).clear();
    return true;
  }catch{return false;}
}
