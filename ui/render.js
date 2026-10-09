import {createStore} from '../core/store.js';
import {defaultData,clone} from '../data/defaults.js';
import {loadState,saveState,exportBackup,persistStorage,enqueueSync,clearSyncQueue} from '../services/storage.js';
import {allTasks,levelFromXp,xpForLevel,xpToNextLevel,XP,toggleTask as gameToggle,refreshDailyState,ACHIEVEMENTS,dailyQuestProgress,weeklyQuestProgress,weekKey} from '../services/game.js';
import {localDateKey,formatDate} from '../utils/date.js';
import {getSession,signUp,signIn,signOut,isCloudConfigured,onAuthStateChange} from '../services/auth.js';
import {inspectCloud,migrateLocalState} from '../services/migration.js';
import {loadCloudState,saveCloudProfile,saveCloudNote,deleteCloudNote,syncLocalContent} from '../services/cloudSync.js';
import {completeCloudTask} from '../services/cloudGame.js';
import {redeemCloudReward,completeCloudFocus} from '../services/cloudRewards.js';

const store=createStore();
let authSession=null,authLoading=false;
let view='Today',timer,menuOpen=false,settingsOpen=false;
let focusTimer=null,focusRemaining=0,focusTotal=0,focusRunning=false,focusMode='Focus',focusPlan=null,focusRound=1,rewardTimer=null;

const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));

function toast(m){const e=$('#toast');e.textContent=m;e.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove('show'),2800);}
function save(){clearTimeout(timer);const status=$('#saveStatus');if(status)status.textContent='Saving…';timer=setTimeout(async()=>{const snapshot=store.get();await saveState(snapshot.data,snapshot.completed);if(authSession){try{await syncLocalContent(authSession,snapshot.data);await clearSyncQueue();if($('#saveStatus'))$('#saveStatus').textContent='Synced';}catch(e){console.error('Cloud content sync failed',e);await enqueueSync({type:'content',version:snapshot.data.version});if($('#saveStatus'))$('#saveStatus').textContent='Offline';}}else{if($('#saveStatus'))$('#saveStatus').textContent='Saved';}},150);}
function done(t){return !!store.get().completed[localDateKey()+'_'+t.id];}
function toggleMenu(force){menuOpen=typeof force==='boolean'?force:!menuOpen;const p=$('#menuPanel'),b=$('#menuBackdrop');if(p)p.classList.toggle('open',menuOpen);if(b)b.classList.toggle('open',menuOpen);$('#menuBtn')?.setAttribute('aria-expanded',String(menuOpen));}

function render(){
  const s=store.get(),d=s.data;
  document.querySelector('#app').innerHTML=`<div class="app">
    <header class="top"><div><h1>In Track</h1></div><div class="top-actions"><span class="save" id="saveStatus">Saved</span><span class="coin-pill">${d.coins} coins</span><button class="menu-btn" id="menuBtn">Menu</button></div></header>
    <div class="menu-backdrop ${menuOpen?'open':''}" id="menuBackdrop"></div>
    <nav class="menu-panel ${menuOpen?'open':''}" id="menuPanel">${['Today','Rewards','History','Achievements','Notes','Focus','Account'].map(x=>`<button class="menu-item ${view===x?'active':''}" data-view="${x}">${x}</button>`).join('')}</nav>
    ${view==='Today'?today(s):view==='Rewards'?rewards(s):view==='History'?history(d):view==='Achievements'?achievements(s):view==='Notes'?notes(s):view==='Focus'?focus(s):account(d)}
  </div>`;
  bind();
}

function today(s){
  const d=s.data,l=levelFromXp(d.xp),current=xpForLevel(d.xp),next=xpToNextLevel(d.xp),routineEntries=Object.entries(d.routines),todayQ=dailyQuestProgress(d,s.completed),weekQ=weeklyQuestProgress(d);
  return `<section class="stats-card">
    <div class="player-stats">
      <div class="stat stat-main"><span>Level</span><b>${l}</b><small>${current} / ${current+next} XP</small></div>
      <div class="stat stat-main"><span>Streak</span><b>${d.streak} days</b><small>${todayQ.done}/${todayQ.total} today</small></div>
    </div>
    <div class="xp-stat"><div class="xp-head"><span>XP</span><b>${d.xp}</b></div><div class="progress"><i style="width:${Math.min(100,current/(current+next||1)*100)}%"></i></div></div>
  </section>
  <section class="card">
    <div class="card-head"><div><h2>Today's Routines</h2></div><button class="btn" id="settingsBtn">Settings</button></div>
    <div class="routine-list">${routines.map(([name,tasks])=>routineSection(name,tasks)).join('')||'<div class="empty">No routines yet.</div>'}</div>
    <div class="legend"><span><i class="dot high"></i>High</span><span><i class="dot medium"></i>Medium</span><span><i class="dot low"></i>Low</span></div>
  </section>
  <section class="card quest-card">
    <div class="card-head"><div><h2>Quests</h2><span class="sub">Short-term goals that keep your progress moving.</span></div></div>
    <div class="quest-list">
      <div class="quest-item"><div class="quest-copy"><div class="mini-head"><b>Daily Quest</b><span>${todayQ.done}/3</span></div><small>Complete 3 tasks today</small></div><div class="mini-progress"><i style="width:${Math.min(100,todayQ.done/3*100)}%"></i></div></div>
      <div class="quest-item"><div class="quest-copy"><div class="mini-head"><b>Weekly Quest</b><span>${weekQ.xpEarned}/100 XP</span></div><small>Earn 100 XP this week</small></div><div class="mini-progress"><i style="width:${Math.min(100,weekQ.xpEarned)}%"></i></div></div>
    </div>
  </section>
  <div class="settings-backdrop ${settingsOpen?'open':''}" id="settingsBackdrop"></div>
  <aside class="settings-panel ${settingsOpen?'open':''}" id="settings">
    <div class="settings-panel-head"><div><h3>Settings</h3><span class="sub">Manage routines and tasks.</span></div><button class="icon-btn" id="settingsPanelClose">Close</button></div>
    <div class="form"><input class="input" id="newRoutine" placeholder="New routine name"><button class="btn primary" id="addRoutine">Add routine</button></div>
    <div class="form task-form"><select class="input" id="taskRoutine">${Object.keys(d.routines).map(r=>`<option value="${esc(r)}" ${r===d.selectedRoutine?'selected':''}>${esc(r)}</option>`).join('')}</select><input class="input" id="taskName" placeholder="Task name"><select class="input" id="priority"><option value="high">High</option><option value="medium" selected>Medium</option><option value="low">Low</option></select><select class="input" id="difficulty"><option value="easy">Easy · 5 XP</option><option value="medium" selected>Medium · 10 XP</option><option value="hard">Hard · 20 XP</option></select><button class="btn primary" id="addTask">Add task</button></div>
    <div class="form"><select class="input" id="deleteRoutineSelect">${Object.keys(d.routines).map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join('')}</select><button class="btn danger" id="deleteRoutine">Delete selected routine</button></div>
  </aside>`;
}
function routineSection(name,tasks){const doneN=tasks.filter(done).length,pct=tasks.length?Math.round(doneN/tasks.length*100):0;return `<section class="routine-section"><div class="routine-head"><div><h3>${esc(name)}</h3><span class="sub">${doneN}/${tasks.length} complete</span></div><span class="routine-percent">${pct}%</span></div><div class="routine-progress"><i style="width:${pct}%"></i></div>${tasks.length?tasks.map(taskRow).join(''):'<div class="routine-empty">No tasks in this routine.</div>'}</section>`;}
function taskRow(t){return `<div class="task"><button class="check ${done(t)?'done':''}" data-task="${esc(t.id)}" data-cloud-id="${esc(t.cloudId||t.id)}" aria-label="Complete ${esc(t.name)}"></button><div class="task-main"><div class="task-name ${done(t)?'done':''}">${esc(t.name)}</div><div class="meta"><i class="dot ${t.priority}"></i>${t.priority} · ${t.difficulty} · ${XP[t.difficulty]} XP</div></div><button class="icon-btn" data-edit="${esc(t.id)}">Edit</button><button class="icon-btn" data-delete="${esc(t.id)}">Delete</button></div>`;}

function formatDateTime(iso){if(!iso)return '';const d=new Date(iso);if(Number.isNaN(d.getTime()))return '';return d.toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'})+' · '+d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});}
function formatRemaining(ms){const total=Math.max(0,Math.ceil(ms/1000)),h=Math.floor(total/3600),m=Math.floor((total%3600)/60),sec=total%60;return h?String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0'):String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0');}
function rewards(s){
  const d=s.data,spent=d.rewardHistory.reduce((n,x)=>n+(Number(x.cost)||0),0),count=d.rewardHistory.length,active=d.activeRewards.filter(x=>Number(x.expiresAt)>Date.now());
  return `<section class="card reward-card">
    <div class="card-head"><div><h2>Rewards Shop</h2><span class="sub">Turn earned coins into rewards you choose.</span></div><b>${d.coins} coins</b></div>
    <div class="reward-summary"><div><span>Redeemed</span><b>${count}</b></div><div><span>Coins spent</span><b>${spent}</b></div></div>
    ${active.length?`<div class="active-rewards"><div class="section-title active-title">Active rewards</div>${active.map(x=>`<div class="active-reward"><div><b>${esc(x.name)}</b><small>Started ${formatDateTime(x.startedAt)}</small></div><strong data-reward-timer="${esc(x.id)}">${formatRemaining(Number(x.expiresAt)-Date.now())}</strong></div>`).join('')}</div>`:''}
    <div class="form"><input class="input" id="rewardName" placeholder="Reward name"><input class="input" id="rewardCost" type="number" min="1" placeholder="Coin cost"><input class="input" id="rewardTime" type="number" min="1" placeholder="Time limit (min)"><button class="btn primary" id="addReward">Add reward</button></div>
    <div class="list">${d.rewards.map(r=>{const affordable=d.coins>=r.cost;return `<div class="row reward-row"><div><b>${esc(r.name)}</b><div class="sub">${r.cost} coins${r.timeLimit?' · '+r.timeLimit+' min':''}</div></div><div class="reward-actions"><button class="btn ${affordable?'primary':''}" data-redeem="${esc(r.id)}" ${affordable?'':'disabled'}>${affordable?'Redeem':'Need '+(r.cost-d.coins)+' more'}</button><button class="icon-btn" data-reward-delete="${esc(r.id)}">Delete</button></div></div>`;}).join('')||'<div class="empty">No rewards yet.</div>'}</div>
    ${d.rewardHistory.length?'<h3 class="section-title">Recent redemptions</h3><div class="list">'+d.rewardHistory.slice(-8).reverse().map(x=>`<div class="row reward-history-row"><div><b>${esc(x.name)}</b><small>${x.timeLimit?x.timeLimit+' min':''}</small></div><span class="reward-date">${formatDateTime(x.redeemedAt||x.date)}</span><b>-${x.cost}</b></div>`).join('')+'</div>':''}
  </section>`;
}
function history(d){
  const entries=d.history.slice().sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  const totalTasks=entries.reduce((n,h)=>n+(Number(h.done)||0),0);
  const totalXp=entries.reduce((n,h)=>n+(Number(h.xpEarned)||0),0);
  const totalCoins=entries.reduce((n,h)=>n+(Number(h.coinsEarned)||0),0);
  const longest=entries.reduce((n,h)=>Math.max(n,Number(h.streak)||0),0);
  const focusCount=d.focusSessions.length,totalFocus=d.focusSessions.reduce((n,x)=>n+(Number(x.minutes)||0),0);
  const currentWeek=weekKey(),weekEntries=entries.filter(h=>weekKey(new Date(h.date+'T00:00:00'))===currentWeek);
  const weekXp=weekEntries.reduce((n,h)=>n+(Number(h.xpEarned)||0),0),weekTasks=weekEntries.reduce((n,h)=>n+(Number(h.done)||0),0);
  return `<section class="card history-card">
    <div class="card-head"><div><h2>Progress</h2><span class="sub">A clear view of how In Track is helping you build consistency.</span></div></div>
    <div class="history-stats">
      <div class="history-stat"><span>Days completed</span><b>${entries.length}</b></div>
      <div class="history-stat"><span>Tasks completed</span><b>${totalTasks}</b></div>
      <div class="history-stat"><span>XP earned</span><b>${totalXp}</b></div>
      <div class="history-stat"><span>Longest streak</span><b>${longest} days</b></div>
      <div class="history-stat"><span>Focus sessions</span><b>${focusCount}</b></div>
      <div class="history-stat"><span>Focus time</span><b>${totalFocus} min</b></div>
    </div>
    <div class="history-week"><div><span>This week</span><b>${weekTasks} tasks · ${weekXp} XP</b></div><div class="mini-progress"><i style="width:${Math.min(100,weekXp)}%"></i></div><small>Weekly quest progress</small></div>
    <h3 class="section-title">Recent days</h3>
    <div class="list">${entries.slice(0,14).map(h=>`<div class="row"><span><b>${formatDate(h.date)}</b><small>${h.done}/${h.total} tasks · ${h.streak} day streak</small></span><span>${Number(h.xpEarned)||0} XP · ${Number(h.coinsEarned)||0} coins</span></div>`).join('')||'<div class="empty">Complete all daily tasks to start building history.</div>'}</div>
  </section>`;
}
function achievements(s){
  const d=s.data;
  const states=ACHIEVEMENTS.map(a=>({a,unlocked:!!({'first-quest':d.xp>=5,'level-2':levelFromXp(d.xp)>=2,'100-xp':d.xp>=100,'500-xp':d.xp>=500,'first-full-day':d.history.length>=1,'3-day-streak':d.streak>=3,'10-day-streak':d.streak>=10,'1000-xp':d.xp>=1000}[a.id]),claimed:d.achievementRewards.includes(a.id)}));
  const unlocked=states.filter(x=>x.unlocked).length,total=states.length,claimed=states.filter(x=>x.claimed).length;
  return `<section class="card achievement-card">
    <div class="card-head"><div><h2>Achievements</h2><span class="sub">Milestones that reward consistent progress.</span></div><b>${unlocked}/${total}</b></div>
    <div class="achievement-summary"><div class="achievement-summary-head"><span>${claimed} rewards earned</span><b>${Math.round(unlocked/total*100)}%</b></div><div class="mini-progress"><i style="width:${unlocked/total*100}%"></i></div></div>
    <div class="list">${states.map(({a,unlocked,claimed})=>`<div class="achievement ${unlocked?'unlocked':''}"><div class="achievement-main"><span class="achievement-mark">${claimed?'Done':unlocked?'Ready':'Locked'}</span><div><b>${a.name}</b><small>${a.description}</small><small>Reward: +${a.xp} XP · +${a.coins} coins</small></div></div><strong>${claimed?'Earned':unlocked?'Unlocked':'Locked'}</strong></div>`).join('')}</div>
  </section>`;
}
function notes(s){const d=s.data;return `<section class="card"><div class="card-head"><div><h2>Sticky Notes</h2><span class="sub">Keep quick thoughts and reminders close.</span></div></div><div class="form note-form"><input class="input" id="noteTitle" placeholder="Note title"><textarea class="input" id="noteBody" placeholder="Write a note..."></textarea><button class="btn primary" id="addNote">Add note</button></div><div class="notes-grid">${d.notes.map(n=>`<article class="note ${n.pinned?'pinned':''}"><div class="note-head"><b>${esc(n.title||'Untitled')}</b><button class="icon-btn" data-note-pin="${esc(n.id)}">${n.pinned?'Unpin':'Pin'}</button></div><p>${esc(n.body)}</p><small>${formatDate(n.date)}</small><div class="note-actions"><button class="icon-btn" data-note-edit="${esc(n.id)}">Edit</button><button class="icon-btn" data-note-delete="${esc(n.id)}">Delete</button></div></article>`).join('')||'<div class="empty">No notes yet.</div>'}</div></section>`;}

function focus(s){
  const d=s.data,mins=Math.floor(focusRemaining/60),secs=String(focusRemaining%60).padStart(2,'0');
  const display=focusRemaining?mins+':'+secs:(focusPlan?focusPlan.work+':00':focusMode==='Focus'?'25:00':'05:00');
  const phaseLabel=focusPlan?(focusMode==='Focus'?'Focus · Round '+focusRound+' of '+focusPlan.rounds:'Break · Next focus in '+Math.max(0,focusPlan.rounds-focusRound+1)):focusMode;
  return `<section class="card focus-card"><div class="focus-heading"><h2>Focus</h2><span class="sub">Build focused work sessions and planned breaks.</span></div>
  <div class="focus-mode"><button class="btn ${focusMode==='Focus'?'primary':''}" data-focus-mode="Focus">Focus</button><button class="btn ${focusMode==='Short Break'?'primary':''}" data-focus-mode="Short Break">Short Break</button></div>
  <div class="focus-phase">${phaseLabel}</div><div class="timer-display" id="focusDisplay">${display}</div>
  <div class="focus-presets"><span class="preset-label">Quick</span><button class="btn" data-focus-min="5">5 min</button><button class="btn" data-focus-min="15">15 min</button><button class="btn" data-focus-min="25">25 min</button><button class="btn" data-focus-min="50">50 min</button></div>
  <div class="focus-actions"><button class="btn primary" id="focusStart">${focusRunning?'Pause':'Start'}</button><button class="btn" id="focusReset">Reset</button>${focusPlan&&focusMode==='Short Break'?'<button class="btn" id="focusSkip">Skip break</button>':''}</div>
  <div class="preset-builder"><div class="section-title">Create focus preset</div><div class="form preset-form"><input class="input" id="presetName" placeholder="Preset name"><input class="input" id="presetWork" type="number" min="1" max="180" placeholder="Focus min"><input class="input" id="presetBreak" type="number" min="0" max="60" placeholder="Break min"><input class="input" id="presetRounds" type="number" min="1" max="20" placeholder="Rounds"><button class="btn primary" id="addPreset">Save preset</button></div></div>
  <div class="saved-presets"><div class="section-title">Saved presets</div><div class="list">${d.focusPresets.map(p=>`<div class="focus-preset-row"><div class="focus-preset-main"><b>${esc(p.name)}</b><small>${p.work} min focus · ${p.break} min break · ${p.rounds} rounds</small></div><div class="focus-preset-actions"><button class="btn" data-focus-preset="${esc(p.id)}">Start</button><button class="icon-btn" data-preset-delete="${esc(p.id)}">Delete</button></div></div>`).join('')||'<div class="empty">No saved presets.</div>'}</div></div>
  <small>Each completed focus block rewards 15 XP and 5 coins.</small><h3 class="section-title">Recent sessions</h3><div class="list">${d.focusSessions.slice(-5).reverse().map(x=>`<div class="row"><span><b>${x.minutes} minute focus</b><small>${formatDate(x.date)}</small></span><span>+${x.xp} XP · +${x.coins} coins</span></div>`).join('')||'<div class="empty">No completed sessions yet.</div>'}</div></section>`; }
function account(d){
  const hasProfile=!!d.profile?.name,cloud=isCloudConfigured(),email=authSession?.user?.email||'';
  const created=d.profile?.createdAt?formatDateTime(d.profile.createdAt):'Not created';
  const updated=d.profile?.updatedAt?formatDateTime(d.profile.updatedAt):'Not saved yet';
  return `<section class="card account-card">
    <div class="account-hero"><div class="profile-avatar">${hasProfile?esc(d.profile.name.trim().charAt(0).toUpperCase()):'I'}</div><div><h2>${hasProfile?esc(d.profile.name):'Your In Track Profile'}</h2><span class="sub">${hasProfile?'Local profile':'Create a profile to personalise your In Track experience.'}</span></div></div>
    <div class="account-section"><div class="section-title">Profile</div><div class="form account-form"><input class="input" id="profileName" maxlength="40" value="${esc(d.profile?.name||'')}" placeholder="Your name"><button class="btn primary" id="saveProfile">${hasProfile?'Save profile':'Create profile'}</button></div><div class="account-meta"><span>Profile created</span><b>${created}</b><span>Last updated</span><b>${updated}</b></div></div>
    <div class="account-section"><div class="section-title">Cloud account</div>
      ${authSession?`<div class="account-status"><span class="status-dot"></span><div><b>Signed in</b><small>${esc(email)}</small></div></div><button class="btn account-signout" id="signOut">Sign out</button>`:
      cloud?`<div class="auth-form"><input class="input" id="authEmail" type="email" autocomplete="email" placeholder="Email address"><input class="input" id="authPassword" type="password" autocomplete="current-password" placeholder="Password"><div class="auth-actions"><button class="btn primary" id="signIn">Sign in</button><button class="btn" id="signUp">Create account</button></div></div>`:
      `<div class="account-status"><span class="status-dot offline"></span><div><b>Cloud not configured</b><small>Local Mode is active. Your data remains on this device.</small></div></div><div class="account-coming">The database and authentication layer are ready. A Supabase project still needs to be connected before cloud sign-in can be enabled.</div>`}
    </div>
    <div class="account-section"><div class="section-title">Cloud migration</div>${authSession?`<p class="sub">Move this device's local routines, tasks, rewards, notes and focus presets into your signed-in account. Your XP, coins, streak and completion history are preserved for the protected migration step.</p><button class="btn primary" id="migrateCloud">Migrate local data to cloud</button>`:'<p class="sub">Sign in to move your local In Track data into the cloud.</p>'}</div>\n    <div class="account-section"><div class="section-title">Backup & Data</div><p class="sub">Export your In Track progress before changing devices, or restore a previous backup.</p><div class="account-actions"><button class="btn primary" id="export">Export backup</button><label class="btn">Import backup<input hidden id="import" type="file" accept="application/json"></label><button class="btn danger" id="reset">Reset all data</button></div></div>
  </section>`;
}

function startFocus(minutes){focusPlan=null;focusRound=1;focusMode='Focus';focusTotal=minutes*60;focusRemaining=focusTotal;runFocusTimer();render();}
function startPreset(p){focusPlan=p;focusRound=1;focusMode='Focus';focusTotal=p.work*60;focusRemaining=focusTotal;runFocusTimer();render();}
function runFocusTimer(){focusRunning=true;clearInterval(focusTimer);focusTimer=setInterval(()=>{focusRemaining--;updateFocusDisplay();if(focusRemaining<=0)completeFocusPhase();},1000);}
function updateFocusDisplay(){const e=$('#focusDisplay');if(e){const m=Math.floor(focusRemaining/60),s=String(focusRemaining%60).padStart(2,'0');e.textContent=m+':'+s;}}
async function completeFocusPhase(){
  clearInterval(focusTimer);
  focusRunning=false;
  if(focusMode==='Focus'){
    const d=store.get().data;
    try{
      let reward={xp_gain:15,coin_gain:5};
      if(authSession)reward=await completeCloudFocus(focusPlan?.cloudId||null,Math.round(focusTotal/60),focusRound);
      d.xp+=Number(reward.xp_gain)||0;
      d.coins+=Number(reward.coin_gain)||0;
      d.focusSessions.push({id:String(reward.id||'fs_'+Date.now()),minutes:Math.round(focusTotal/60),date:localDateKey(),xp:Number(reward.xp_gain)||15,coins:Number(reward.coin_gain)||5});
      save();
      toast('Focus block complete: +'+(Number(reward.xp_gain)||15)+' XP, +'+(Number(reward.coin_gain)||5)+' coins');
    }catch(e){
      console.error('Focus session could not be saved',e);
      toast(e.message||'Could not save focus session');
      focusRemaining=0;
      render();
      return;
    }
    if(focusPlan&&focusRound<focusPlan.rounds&&focusPlan.break>0){
      focusMode='Short Break';focusTotal=focusPlan.break*60;focusRemaining=focusTotal;runFocusTimer();render();return;
    }
    if(focusPlan&&focusRound<focusPlan.rounds){
      focusRound++;focusMode='Focus';focusTotal=focusPlan.work*60;focusRemaining=focusTotal;runFocusTimer();render();return;
    }
    if(focusPlan){focusPlan=null;focusRemaining=0;render();return;}
  }else if(focusPlan){
    focusRound++;focusMode='Focus';focusTotal=focusPlan.work*60;focusRemaining=focusTotal;runFocusTimer();render();return;
  }
  focusRemaining=0;
  render();
}
function bind(){
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;menuOpen=false;settingsOpen=false;render();});
  $('#menuBtn')?.addEventListener('click',e=>{e.stopPropagation();settingsOpen=false;toggleMenu();});
  $('#menuBackdrop')?.addEventListener('click',()=>toggleMenu(false));
  document.querySelectorAll('[data-task]').forEach(b=>b.onclick=async()=>{const s=store.get();if(authSession){try{const result=await completeCloudTask(b.dataset.cloudId||b.dataset.task,localDateKey());const cloud=await loadCloudState(authSession);store.set({data:{...s.data,...cloud.data},completed:cloud.completed});await saveState(store.get().data,store.get().completed);render();toast(result.completed?'Quest complete: +'+result.xp_gain+' XP, +'+result.coin_gain+' coins':'Quest unchecked: rewards removed');}catch(e){toast(e.message||'Could not update cloud task');}}else{const r=gameToggle(s.data,s.completed,b.dataset.task);store.set(s);save();render();if(r.newAchievements?.length){const names=r.newAchievements.map(a=>a.name).join(', ');toast('Achievement unlocked: '+names);}else if(r.levelUp)toast('Level up: '+r.newLevel);else if(r.bonus)toast('Daily complete: +'+r.coinGain+' coins');else if(r.xpGain>0)toast('Quest complete: +'+r.xpGain+' XP, +'+r.coinGain+' coins');else toast('Quest unchecked: rewards removed');}});
  document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{const s=store.get(),t=allTasks(s.data).find(x=>String(x.id)===b.dataset.edit),n=prompt('Task name:',t?.name||'');if(n?.trim()){t.name=n.trim();save();render();}});
  document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>{const s=store.get(),routine=Object.values(s.data.routines).find(tasks=>tasks.some(t=>String(t.id)===b.dataset.delete)),i=routine?.findIndex(x=>String(x.id)===b.dataset.delete)??-1;if(i>=0&&confirm('Delete this task?')){routine.splice(i,1);save();render();}});
  $('#settingsBtn')?.addEventListener('click',()=>{settingsOpen=true;render();});$('#settingsBackdrop')?.addEventListener('click',()=>{settingsOpen=false;render();});$('#settingsPanelClose')?.addEventListener('click',()=>{settingsOpen=false;render();});
  $('#taskRoutine')?.addEventListener('change',e=>{store.get().data.selectedRoutine=e.target.value;save();});
  $('#addRoutine')?.addEventListener('click',()=>{const d=store.get().data,n=$('#newRoutine').value.trim();if(!n)return toast('Enter a routine name');if(d.routines[n])return toast('Routine already exists');d.routines[n]=[];d.selectedRoutine=n;save();render();toast('Routine added');});
  $('#deleteRoutine')?.addEventListener('click',()=>{const d=store.get().data,n=Object.keys(d.routines),name=$('#deleteRoutineSelect').value;if(n.length<=1)return toast('Keep at least one routine');if(confirm('Delete '+name+'?')){delete d.routines[name];d.selectedRoutine=Object.keys(d.routines)[0];save();render();toast('Routine deleted');}});
  $('#addTask')?.addEventListener('click',()=>{const d=store.get().data,r=$('#taskRoutine').value,n=$('#taskName').value.trim();if(!n)return toast('Enter a task name');d.selectedRoutine=r;d.routines[r].push({id:'t_'+Date.now(),name:n,priority:$('#priority').value,difficulty:$('#difficulty').value});save();render();toast('Task added');});
  $('#addReward')?.addEventListener('click',()=>{const d=store.get().data,n=$('#rewardName').value.trim(),c=Number($('#rewardCost').value),t=Number($('#rewardTime').value)||null;if(!n||c<1)return toast('Enter a reward name and valid cost');d.rewards.push({id:'r_'+Date.now(),name:n,cost:Math.round(c),timeLimit:t});save();render();toast('Reward added');});
  document.querySelectorAll('[data-redeem]').forEach(b=>b.onclick=async()=>{const d=store.get().data,r=d.rewards.find(x=>String(x.id)===b.dataset.redeem);if(!r)return;if(authSession){try{const result=await redeemCloudReward(r.cloudId||b.dataset.redeem);const now=Date.now();d.coins=Math.max(0,d.coins-(Number(result.cost)||r.cost));d.rewardHistory.push({id:String(result.id),name:result.name,cost:Number(result.cost),timeLimit:result.time_limit||null,date:localDateKey(),redeemedAt:result.redeemed_at});if(result.expires_at)d.activeRewards.push({id:String(result.id),name:result.name,cost:Number(result.cost),timeLimit:Number(result.time_limit)||0,startedAt:result.redeemed_at,expiresAt:new Date(result.expires_at).getTime()});save();render();toast(result.time_limit?'Reward redeemed: timer started':'Reward redeemed');}catch(e){toast(e.message||'Could not redeem reward');}return;}if(d.coins<r.cost)return toast('Not enough coins yet');const now=Date.now(),timeLimit=Number(r.timeLimit)||0;d.coins-=r.cost;d.rewardHistory.push({id:'rh_'+now,name:r.name,cost:r.cost,timeLimit:r.timeLimit||null,date:localDateKey(),redeemedAt:new Date(now).toISOString()});if(timeLimit>0)d.activeRewards.push({id:'ar_'+now,name:r.name,cost:r.cost,timeLimit,startedAt:new Date(now).toISOString(),expiresAt:now+timeLimit*60000});save();render();toast(timeLimit?'Reward redeemed: timer started':'Reward redeemed');});
  document.querySelectorAll('[data-reward-delete]').forEach(b=>b.onclick=()=>{const d=store.get().data;d.rewards=d.rewards.filter(x=>String(x.id)!==b.dataset.rewardDelete);save();render();toast('Reward deleted');});
  document.querySelectorAll('[data-note-pin]').forEach(b=>b.onclick=()=>{const n=store.get().data.notes.find(x=>String(x.id)===b.dataset.notePin);if(n){n.pinned=!n.pinned;save();render();}});
  document.querySelectorAll('[data-note-delete]').forEach(b=>b.onclick=async()=>{const d=store.get().data;try{if(authSession)await deleteCloudNote(authSession,b.dataset.noteDelete);d.notes=d.notes.filter(x=>String(x.id)!==b.dataset.noteDelete);save();render();toast('Note deleted');}catch(e){toast(e.message||'Could not delete note');}});
  document.querySelectorAll('[data-note-edit]').forEach(b=>b.onclick=()=>{const d=store.get().data,n=d.notes.find(x=>String(x.id)===b.dataset.noteEdit);if(!n)return;const title=prompt('Note title:',n.title);const body=prompt('Note text:',n.body);if(title!==null&&body!==null){n.title=title.trim()||'Untitled';n.body=body.trim();save();render();}});
  $('#addNote')?.addEventListener('click',async()=>{const d=store.get().data,title=$('#noteTitle').value.trim(),body=$('#noteBody').value.trim();if(!title&&!body)return toast('Write something first');const note={id:'n_'+Date.now(),title:title||'Untitled',body,date:localDateKey(),pinned:false};try{if(authSession)await saveCloudNote(authSession,note);d.notes.unshift(note);save();render();toast('Note added');}catch(e){toast(e.message||'Could not save note');}});
  document.querySelectorAll('[data-focus-min]').forEach(b=>b.onclick=()=>startFocus(Number(b.dataset.focusMin)));
  document.querySelectorAll('[data-focus-mode]').forEach(b=>b.onclick=()=>{clearInterval(focusTimer);focusPlan=null;focusMode=b.dataset.focusMode;focusRound=1;focusRunning=false;focusRemaining=0;render();});
  document.querySelectorAll('[data-focus-preset]').forEach(b=>b.onclick=()=>{const p=store.get().data.focusPresets.find(x=>String(x.id)===b.dataset.focusPreset);if(p)startPreset(p);});
  document.querySelectorAll('[data-preset-delete]').forEach(b=>b.onclick=()=>{const d=store.get().data;if(d.focusPresets.length<=1)return toast('Keep at least one preset');d.focusPresets=d.focusPresets.filter(x=>String(x.id)!==b.dataset.presetDelete);save();render();});
  $('#addPreset')?.addEventListener('click',()=>{const d=store.get().data,n=$('#presetName').value.trim(),w=Number($('#presetWork').value),br=Number($('#presetBreak').value),ro=Number($('#presetRounds').value);if(!n||w<1||br<0||ro<1)return toast('Enter a name and valid preset values');d.focusPresets.push({id:'fp_'+Date.now(),name:n,work:Math.round(w),break:Math.round(br),rounds:Math.round(ro)});save();render();toast('Focus preset saved');});
  $('#focusStart')?.addEventListener('click',()=>{if(focusRunning){focusRunning=false;clearInterval(focusTimer);render();}else{if(!focusRemaining){focusPlan=null;focusRound=1;focusMode='Focus';focusTotal=25*60;focusRemaining=focusTotal;}runFocusTimer();render();}});
  $('#focusReset')?.addEventListener('click',()=>{focusRunning=false;focusPlan=null;focusRound=1;focusRemaining=0;clearInterval(focusTimer);render();});
  $('#focusSkip')?.addEventListener('click',()=>{clearInterval(focusTimer);focusRunning=false;focusMode='Focus';focusRound++;focusTotal=focusPlan.work*60;focusRemaining=focusTotal;runFocusTimer();render();});
  $('#saveProfile')?.addEventListener('click',async()=>{const d=store.get().data,name=$('#profileName').value.trim();if(!name)return toast('Enter your name first');const now=new Date().toISOString();if(!d.profile.createdAt)d.profile.createdAt=now;d.profile.name=name;d.profile.updatedAt=now;try{if(authSession)await saveCloudProfile(authSession,name);save();render();toast(authSession?'Profile saved to cloud':'Profile saved');}catch(e){toast(e.message||'Could not save profile');}});
  $('#signIn')?.addEventListener('click',async()=>{try{const email=$('#authEmail').value.trim(),password=$('#authPassword').value;if(!email||!password)return toast('Enter your email and password');const result=await signIn(email,password);if(result.error)throw result.error;authSession=result.data.session;render();toast('Signed in');}catch(e){toast(e.message||'Could not sign in');}});
  $('#signUp')?.addEventListener('click',async()=>{try{const email=$('#authEmail').value.trim(),password=$('#authPassword').value;if(!email||!password)return toast('Enter your email and password');if(password.length<6)return toast('Password must be at least 6 characters');const result=await signUp(email,password,store.get().data.profile?.name||'');if(result.error)throw result.error;authSession=result.data.session||null;render();toast(result.data.session?'Account created':'Check your email to confirm your account');}catch(e){toast(e.message||'Could not create account');}});
  $('#signOut')?.addEventListener('click',async()=>{try{const result=await signOut();if(result.error)throw result.error;authSession=null;render();toast('Signed out');}catch(e){toast(e.message||'Could not sign out');}});
  $('#signIn')?.addEventListener('click',async()=>{if(authLoading)return;const email=$('#authEmail').value.trim(),password=$('#authPassword').value;if(!email||password.length<6)return toast('Enter a valid email and password');authLoading=true;try{const result=await signIn(email,password);if(result.error)throw result.error;authSession=result.data.session;render();toast('Signed in');}catch(e){toast(e.message||'Could not sign in');}finally{authLoading=false;}});
  $('#signUp')?.addEventListener('click',async()=>{if(authLoading)return;const email=$('#authEmail').value.trim(),password=$('#authPassword').value,name=$('#profileName')?.value.trim()||'';if(!email||password.length<6)return toast('Use an email and a password of at least 6 characters');authLoading=true;try{const result=await signUp(email,password,name);if(result.error)throw result.error;toast(result.data.session?'Account created and signed in':'Account created. Check your email to confirm it.');if(result.data.session)authSession=result.data.session;render();}catch(e){toast(e.message||'Could not create account');}finally{authLoading=false;}});
  $('#signOut')?.addEventListener('click',async()=>{try{const result=await signOut();if(result.error)throw result.error;authSession=null;render();toast('Signed out');}catch(e){toast(e.message||'Could not sign out');}});

  $('#migrateCloud')?.addEventListener('click',async()=>{if(!authSession)return toast('Sign in first');if(authLoading)return;authLoading=true;try{const check=await inspectCloud(authSession);if(!check.empty){return toast('Cloud data already exists. A merge decision is required before migration.');}if(!confirm('Move this device data to your cloud account? Your local data will remain on this device.'))return;const s=store.get();const result=await migrateLocalState(authSession,s.data,s.completed);toast('Local data migrated to cloud.');console.info('In Track migration',result);}catch(e){console.error(e);toast(e.message||'Cloud migration failed');}finally{authLoading=false;}});
  $('#export')?.addEventListener('click',()=>{exportBackup(store.get().data,store.get().completed);toast('Backup exported');});
  $('#import')?.addEventListener('change',e=>{const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=()=>{try{const p=JSON.parse(r.result);if(p?.app!=='In Track'||!p.data?.routines||typeof p.data.routines!=='object')throw Error('Invalid backup');if(confirm('Import this In Track backup? Your current local progress will be replaced.')){store.replace(p.data,p.completed);save();render();toast('Backup imported');}}catch{toast('Could not import this backup.');}};r.readAsText(f);});
  $('#reset')?.addEventListener('click',()=>{if(confirm('Reset all In Track data?')){store.replace(clone(defaultData),{});save();render();toast('All data reset');}});
  startRewardTicker();
}
function startRewardTicker(){
  clearInterval(rewardTimer);
  rewardTimer=setInterval(()=>{
    const d=store.get().data,now=Date.now(),before=(d.activeRewards||[]).length;
    d.activeRewards=(d.activeRewards||[]).filter(x=>Number(x.expiresAt)>now);
    if(d.activeRewards.length!==before)save();
    document.querySelectorAll('[data-reward-timer]').forEach(e=>{const x=d.activeRewards.find(x=>String(x.id)===e.dataset.rewardTimer);if(x)e.textContent=formatRemaining(Number(x.expiresAt)-now);});
  },1000);
}

async function init(){
  // Load and display local data first. Cloud/CDN availability must never block the app UI.
  const saved=await loadState();
  if(saved?.data){
    refreshDailyState(saved.data);
    const completed=saved.completed&&typeof saved.completed==='object'?saved.completed:{};
    store.replace(saved.data,completed);
  }
  render();
  await persistStorage();
  if(isCloudConfigured()){
    try{
      authSession=await getSession();
      await onAuthStateChange(session=>{authSession=session;render();});
    }catch(e){console.error('Cloud authentication unavailable; continuing locally.',e);}
  }
  if(authSession){
    try{
      const cloud=await loadCloudState(authSession);
      const current=store.get();
      if(Object.keys(cloud.data.routines||{}).length){
        store.set({data:{...current.data,...cloud.data,profile:current.data.profile},completed:cloud.completed});
        await saveState(store.get().data,store.get().completed);
      }
    }catch(e){console.error('Cloud load failed',e);toast('Cloud data could not be loaded; local data is still available.');}
  }
  render();
}
window.addEventListener('error',e=>{console.error(e);toast('In Track encountered an error. Your saved data is unchanged.');});
window.addEventListener('unhandledrejection',e=>{console.error(e.reason);});
init();