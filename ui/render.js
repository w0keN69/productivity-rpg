import {createStore} from '../core/store.js';
import {defaultData,clone} from '../data/defaults.js';
import {loadState,saveState,exportBackup,persistStorage} from '../services/storage.js';
import {allTasks,levelFromXp,xpForLevel,xpToNextLevel,XP,toggleTask as gameToggle,refreshDailyState} from '../services/game.js';
import {localDateKey,formatDate} from '../utils/date.js';

const store=createStore();
let view='Today',timer,menuOpen=false,settingsOpen=false;

const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));

function toast(m){
  const e=$('#toast');
  e.textContent=m;
  e.classList.add('show');
  clearTimeout(toast.t);
  toast.t=setTimeout(()=>e.classList.remove('show'),2600);
}

function save(){
  clearTimeout(timer);
  const status=$('#saveStatus');
  if(status)status.textContent='Saving…';
  timer=setTimeout(async()=>{
    await saveState(store.get().data,store.get().completed);
    if($('#saveStatus'))$('#saveStatus').textContent='Saved';
  },150);
}

function done(t){
  return !!store.get().completed[localDateKey()+'_'+t.id];
}

function toggleMenu(force){
  menuOpen=typeof force==='boolean'?force:!menuOpen;
  const panel=$('#menuPanel'),backdrop=$('#menuBackdrop');
  if(panel)panel.classList.toggle('open',menuOpen);
  if(backdrop)backdrop.classList.toggle('open',menuOpen);
  $('#menuBtn')?.setAttribute('aria-expanded',String(menuOpen));
}

function render(){
  const s=store.get(),d=s.data;
  document.querySelector('#app').innerHTML=`<div class="app">
    <header class="top">
      <div><h1>In Track</h1></div>
      <div class="top-actions"><span class="save" id="saveStatus">Saved</span><button class="menu-btn" id="menuBtn" aria-expanded="${menuOpen}" aria-controls="menuPanel">Menu</button></div>
    </header>
    <div class="menu-backdrop ${menuOpen?'open':''}" id="menuBackdrop" aria-hidden="true"></div>
    <nav class="menu-panel ${menuOpen?'open':''}" id="menuPanel" aria-label="Main navigation">
      ${['Today','Rewards','History','Achievements','Data & Backup'].map(x=>`<button class="menu-item ${view===x?'active':''}" data-view="${x}">${x}</button>`).join('')}
    </nav>
    ${view==='Today'?today(s):view==='Rewards'?rewards(s):view==='History'?history(d):view==='Achievements'?achievements(s):backup(d)}
  </div>`;
  bind();
}

function today(s){
  const d=s.data,l=levelFromXp(d.xp),current=xpForLevel(d.xp),next=xpToNextLevel(d.xp);
  const routines=Object.entries(d.routines);
  const todayDone=allTasks(d).filter(done).length;
  const total=allTasks(d).length;
  return `<section class="stats">
    <div class="stat"><span>Level</span><b>${l}</b><small>${current} / ${current+next} XP to next level</small></div>
    <div class="stat"><span>XP</span><b>${d.xp}</b><div class="progress"><i style="width:${Math.min(100,current/(current+next||1)*100)}%"></i></div></div>
    <div class="stat"><span>Coins</span><b>${d.coins}</b><small>Earn by completing quests</small></div>
    <div class="stat"><span>Streak</span><b>${d.streak} days</b><small>${todayDone}/${total} quests complete today</small></div>
  </section>

  <section class="card">
    <div class="card-head"><div><h2>Today's Routines</h2><span class="sub">Complete your routines to build your streak.</span></div><button class="btn" id="settingsBtn">Settings</button></div>
    <div class="routine-list">${routines.map(([name,tasks])=>routineSection(name,tasks)).join('')||'<div class="empty">No routines yet. Open Settings to create one.</div>'}</div>
    <div class="legend"><span><i class="dot high"></i>High</span><span><i class="dot medium"></i>Medium</span><span><i class="dot low"></i>Low</span></div>
  </section>

  <div class="settings-backdrop ${settingsOpen?'open':''}" id="settingsBackdrop" aria-hidden="true"></div>
  <aside class="settings-panel ${settingsOpen?'open':''}" id="settings" aria-label="Settings">
    <div class="settings-panel-head"><div><h3>Settings</h3><span class="sub">Manage routines and tasks.</span></div><button class="icon-btn" id="settingsPanelClose">Close</button></div>
    <div class="form"><input class="input" id="newRoutine" placeholder="New routine name"><button class="btn primary" id="addRoutine">Add routine</button></div>
    <div class="form task-form">
      <select class="input" id="taskRoutine">${Object.keys(d.routines).map(r=>`<option value="${esc(r)}" ${r===d.selectedRoutine?'selected':''}>${esc(r)}</option>`).join('')}</select>
      <input class="input" id="taskName" placeholder="Task name">
      <select class="input" id="priority"><option value="high">High</option><option value="medium" selected>Medium</option><option value="low">Low</option></select>
      <select class="input" id="difficulty"><option value="easy">Easy · 5 XP</option><option value="medium" selected>Medium · 10 XP</option><option value="hard">Hard · 20 XP</option></select>
      <button class="btn primary" id="addTask">Add task</button>
    </div>
    <div class="form"><select class="input" id="deleteRoutineSelect">${Object.keys(d.routines).map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join('')}</select><button class="btn danger" id="deleteRoutine">Delete selected routine</button></div>
  </aside>`;
}

function routineSection(name,tasks){
  const doneN=tasks.filter(done).length,pct=tasks.length?Math.round(doneN/tasks.length*100):0;
  return `<section class="routine-section">
    <div class="routine-head"><div><h3>${esc(name)}</h3><span class="sub">${doneN}/${tasks.length} complete</span></div><span class="routine-percent">${pct}%</span></div>
    <div class="routine-progress"><i style="width:${pct}%"></i></div>
    ${tasks.length?tasks.map(taskRow).join(''):'<div class="routine-empty">No tasks in this routine.</div>'}
  </section>`;
}

function taskRow(t){
  return `<div class="task">
    <button class="check ${done(t)?'done':''}" data-task="${esc(t.id)}" aria-label="Complete ${esc(t.name)}"></button>
    <div class="task-main"><div class="task-name ${done(t)?'done':''}">${esc(t.name)}</div><div class="meta"><i class="dot ${t.priority}"></i>${t.priority} · ${t.difficulty} · ${XP[t.difficulty]} XP</div></div>
    <button class="icon-btn" data-edit="${esc(t.id)}">Edit</button><button class="icon-btn" data-delete="${esc(t.id)}">Delete</button>
  </div>`;
}

function rewards(s){
  const d=s.data;
  return `<section class="card">
    <div class="card-head"><div><h2>Rewards Shop</h2><span class="sub">Spend coins on rewards you choose.</span></div><b>${d.coins} coins</b></div>
    <div class="form"><input class="input" id="rewardName" placeholder="Reward name"><input class="input" id="rewardCost" type="number" min="1" placeholder="Coin cost"><input class="input" id="rewardTime" type="number" min="1" placeholder="Time limit (min)"><button class="btn primary" id="addReward">Add reward</button></div>
    <div class="list">${d.rewards.map(r=>`<div class="row"><div><b>${esc(r.name)}</b><div class="sub">${r.cost} coins${r.timeLimit?' · '+r.timeLimit+' min':''}</div></div><div><button class="btn" data-redeem="${esc(r.id)}">Redeem</button> <button class="icon-btn" data-reward-delete="${esc(r.id)}">Delete</button></div></div>`).join('')||'<div class="empty">No rewards yet.</div>'}</div>
    ${d.rewardHistory.length?'<h3 class="section-title">Recent redemptions</h3><div class="list">'+d.rewardHistory.slice(-5).reverse().map(x=>`<div class="row"><span>${esc(x.name)}<small>${formatDate(x.date)}${x.timeLimit?' · '+x.timeLimit+' min':''}</small></span><b>-${x.cost}</b></div>`).join('')+'</div>':''}
  </section>`;
}

function history(d){
  return `<section class="card"><div class="card-head"><div><h2>History</h2><span class="sub">Completed full days are recorded here.</span></div></div><div class="list">${d.history.slice().reverse().map(h=>`<div class="row"><span><b>${formatDate(h.date)}</b><small>${h.done}/${h.total} tasks complete</small></span><span>${h.xp} XP · ${h.coins} coins · ${h.streak} day streak</span></div>`).join('')||'<div class="empty">Complete all daily quests to start building history.</div>'}</div></section>`;
}

function achievements(s){
  const d=s.data;
  const items=[
    ['First Quest','Complete your first task.',d.xp>=5],
    ['Level 2','Reach level 2.',levelFromXp(d.xp)>=2],
    ['100 XP','Earn 100 XP.',d.xp>=100],
    ['500 XP','Earn 500 XP.',d.xp>=500],
    ['First Full Day','Complete every daily quest once.',d.history.length>=1],
    ['3 Day Streak','Reach a 3 day streak.',d.streak>=3],
    ['10 Day Streak','Reach a 10 day streak.',d.streak>=10],
    ['1,000 XP','Earn 1,000 XP.',d.xp>=1000]
  ];
  return `<section class="card"><div class="card-head"><div><h2>Achievements</h2><span class="sub">${items.filter(x=>x[2]).length}/${items.length} unlocked</span></div></div><div class="list">${items.map(x=>`<div class="achievement ${x[2]?'unlocked':''}"><div><b>${x[0]}</b><small>${x[1]}</small></div><strong>${x[2]?'Unlocked':'Locked'}</strong></div>`).join('')}</div></section>`;
}

function backup(d){
  return `<section class="card"><h2>Data & Backup</h2><p class="sub">Your progress is stored on this device. Export a backup before changing devices.</p><button class="btn primary" id="export">Export JSON</button> <label class="btn">Import JSON<input hidden id="import" type="file" accept="application/json"></label> <button class="btn danger" id="reset">Reset all data</button></section>`;
}

function bind(){
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;menuOpen=false;settingsOpen=false;render();});
  $('#menuBtn')?.addEventListener('click',e=>{e.stopPropagation();settingsOpen=false;toggleMenu();});
  $('#menuBackdrop')?.addEventListener('click',()=>toggleMenu(false));

  document.querySelectorAll('[data-task]').forEach(b=>b.onclick=()=>{
    const s=store.get(),r=gameToggle(s.data,s.completed,b.dataset.task);
    store.set(s);save();render();
    if(r.levelUp)toast('Level up! You reached Level '+r.newLevel);
    else if(r.bonus)toast('Daily complete! +'+r.xpGain+' XP and +'+r.coinGain+' coins');
    else if(r.xpGain>0)toast('Quest complete: +'+r.xpGain+' XP, +'+r.coinGain+' coins');
    else toast('Quest unchecked: rewards removed');
  });

  document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{
    const s=store.get(),t=allTasks(s.data).find(x=>String(x.id)===b.dataset.edit),n=prompt('Task name:',t?.name||'');
    if(n?.trim()){t.name=n.trim();save();render();}
  });

  document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>{
    const s=store.get(),routine=Object.values(s.data.routines).find(tasks=>tasks.some(t=>String(t.id)===b.dataset.delete)),i=routine?.findIndex(x=>String(x.id)===b.dataset.delete)??-1;
    if(i>=0&&confirm('Delete this task?')){routine.splice(i,1);save();render();}
  });

  $('#settingsBtn')?.addEventListener('click',()=>{settingsOpen=true;render();});
  $('#settingsBackdrop')?.addEventListener('click',()=>{settingsOpen=false;render();});
  $('#settingsPanelClose')?.addEventListener('click',()=>{settingsOpen=false;render();});
  $('#taskRoutine')?.addEventListener('change',e=>{store.get().data.selectedRoutine=e.target.value;save();});

  $('#addRoutine')?.addEventListener('click',()=>{
    const d=store.get().data,n=$('#newRoutine').value.trim();
    if(!n)return toast('Enter a routine name');
    if(d.routines[n])return toast('Routine already exists');
    d.routines[n]=[];d.selectedRoutine=n;save();render();toast('Routine added');
  });

  $('#deleteRoutine')?.addEventListener('click',()=>{
    const d=store.get().data,n=Object.keys(d.routines),name=$('#deleteRoutineSelect').value;
    if(n.length<=1)return toast('Keep at least one routine');
    if(confirm('Delete '+name+'?')){delete d.routines[name];d.selectedRoutine=Object.keys(d.routines)[0];save();render();toast('Routine deleted');}
  });

  $('#addTask')?.addEventListener('click',()=>{
    const d=store.get().data,r=$('#taskRoutine').value,n=$('#taskName').value.trim();
    if(!n)return toast('Enter a task name');
    d.selectedRoutine=r;d.routines[r].push({id:'t_'+Date.now(),name:n,priority:$('#priority').value,difficulty:$('#difficulty').value});
    save();render();toast('Task added');
  });

  $('#addReward')?.addEventListener('click',()=>{
    const d=store.get().data,n=$('#rewardName').value.trim(),c=Number($('#rewardCost').value),t=Number($('#rewardTime').value)||null;
    if(!n||c<1)return toast('Enter a reward name and valid cost');
    d.rewards.push({id:'r_'+Date.now(),name:n,cost:Math.round(c),timeLimit:t});save();render();toast('Reward added');
  });

  document.querySelectorAll('[data-redeem]').forEach(b=>b.onclick=()=>{
    const d=store.get().data,r=d.rewards.find(x=>String(x.id)===b.dataset.redeem);
    if(d.coins<r.cost)return toast('Not enough coins yet');
    d.coins-=r.cost;
    d.rewardHistory.push({id:'rh_'+Date.now(),name:r.name,cost:r.cost,timeLimit:r.timeLimit||null,date:localDateKey()});
    save();render();toast('Reward redeemed'+(r.timeLimit?' · '+r.timeLimit+' min':''));
  });

  document.querySelectorAll('[data-reward-delete]').forEach(b=>b.onclick=()=>{
    const d=store.get().data;d.rewards=d.rewards.filter(x=>String(x.id)!==b.dataset.rewardDelete);save();render();toast('Reward deleted');
  });

  $('#export')?.addEventListener('click',()=>{exportBackup(store.get().data,store.get().completed);toast('Backup exported');});
  $('#import')?.addEventListener('change',e=>{
    const f=e.target.files?.[0];if(!f)return;
    const r=new FileReader();
    r.onload=()=>{try{const p=JSON.parse(r.result);if(!p.data?.routines)throw Error();if(confirm('Import this backup?')){store.replace(p.data,p.completed);save();render();toast('Backup imported');}}catch{toast('Could not import backup');}};
    r.readAsText(f);
  });
  $('#reset')?.addEventListener('click',()=>{if(confirm('Reset all In Track data?')){store.replace(clone(defaultData),{});save();render();toast('All data reset');}});
}

async function init(){
  await persistStorage();
  const saved=await loadState();
  if(saved?.data){refreshDailyState(saved.data);store.replace(saved.data,saved.completed);}
  render();
}
init();