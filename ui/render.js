import {createStore} from '../core/store.js';
import {defaultData,clone} from '../data/defaults.js';
import {loadState,saveState,exportBackup,persistStorage} from '../services/storage.js';
import {allTasks,levelFromXp,xpForLevel,XP,toggleTask as gameToggle} from '../services/game.js';
import {localDateKey,formatDate} from '../utils/date.js';

const store=createStore();
let view='Today',timer,menuOpen=false;

const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));

function toast(m){
  const e=$('#toast');
  e.textContent=m;
  e.classList.add('show');
  clearTimeout(toast.t);
  toast.t=setTimeout(()=>e.classList.remove('show'),2200);
}

function save(){
  clearTimeout(timer);
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
  const panel=$('#menuPanel');
  const backdrop=$('#menuBackdrop');
  if(panel)panel.classList.toggle('open',menuOpen);
  if(backdrop)backdrop.classList.toggle('open',menuOpen);
  $('#menuBtn')?.setAttribute('aria-expanded',String(menuOpen));
}

function render(){
  const s=store.get(),d=s.data;
  document.querySelector('#app').innerHTML=`<div class="app">
    <header class="top">
      <div>
        <h1>Productivity RPG</h1>
        <div class="sub">Build consistency. Complete quests. Earn rewards.</div>
      </div>
      <div class="top-actions">
        <span class="save" id="saveStatus">Saved</span>
        <button class="menu-btn" id="menuBtn" aria-expanded="${menuOpen}" aria-controls="menuPanel">Menu</button>
      </div>
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
  const d=s.data;
  const routines=Object.entries(d.routines);
  const l=levelFromXp(d.xp),pct=xpForLevel(d.xp);

  return `<section class="stats">
    <div class="stat"><span>Level</span><b>${l}</b></div>
    <div class="stat"><span>XP</span><b>${d.xp}</b><div class="progress"><i style="width:${pct}%"></i></div></div>
    <div class="stat"><span>Coins</span><b>${d.coins}</b></div>
    <div class="stat"><span>Streak</span><b>${d.streak} days</b></div>
  </section>

  <section class="card">
    <div class="card-head">
      <div>
        <h2>Today's Routines</h2>
        <span class="sub">Complete your routines to build your streak.</span>
      </div>
      <button class="btn" id="settingsBtn">Settings</button>
    </div>

    <div class="routine-list">
      ${routines.map(([name,tasks])=>routineSection(name,tasks)).join('') || '<div class="empty">No routines yet. Open Settings to create one.</div>'}
    </div>

    <div class="legend">
      <span><i class="dot high"></i>High</span>
      <span><i class="dot medium"></i>Medium</span>
      <span><i class="dot low"></i>Low</span>
    </div>
  </section>

  <section class="card settings" id="settings">
    <div class="card-head">
      <div>
        <h3>Routine & Task Settings</h3>
        <span class="sub">Choose where new tasks are added.</span>
      </div>
    </div>

    <div class="form">
      <input class="input" id="newRoutine" placeholder="New routine name">
      <button class="btn primary" id="addRoutine">Add routine</button>
    </div>

    <div class="form task-form">
      <select class="input" id="taskRoutine">
        ${Object.keys(d.routines).map(r=>`<option value="${esc(r)}" ${r===d.selectedRoutine?'selected':''}>${esc(r)}</option>`).join('')}
      </select>
      <input class="input" id="taskName" placeholder="Task name">
      <select class="input" id="priority">
        <option value="high">High</option>
        <option value="medium" selected>Medium</option>
        <option value="low">Low</option>
      </select>
      <select class="input" id="difficulty">
        <option value="easy">Easy · 5 XP</option>
        <option value="medium" selected>Medium · 10 XP</option>
        <option value="hard">Hard · 20 XP</option>
      </select>
      <button class="btn primary" id="addTask">Add task</button>
    </div>

    <div class="form">
      <select class="input" id="deleteRoutineSelect">
        ${Object.keys(d.routines).map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join('')}
      </select>
      <button class="btn danger" id="deleteRoutine">Delete selected routine</button>
    </div>
  </section>`;
}

function routineSection(name,tasks){
  const doneN=tasks.filter(done).length;
  const pct=tasks.length?Math.round(doneN/tasks.length*100):0;

  return `<section class="routine-section">
    <div class="routine-head">
      <div>
        <h3>${esc(name)}</h3>
        <span class="sub">${doneN}/${tasks.length} complete</span>
      </div>
      <span class="routine-percent">${pct}%</span>
    </div>
    <div class="routine-progress"><i style="width:${pct}%"></i></div>
    ${tasks.length?tasks.map(t=>taskRow(t)).join(''):'<div class="routine-empty">No tasks in this routine.</div>'}
  </section>`;
}

function taskRow(t){
  return `<div class="task">
    <button class="check ${done(t)?'done':''}" data-task="${esc(t.id)}" aria-label="Complete ${esc(t.name)}"></button>
    <div class="task-main">
      <div class="task-name ${done(t)?'done':''}">${esc(t.name)}</div>
      <div class="meta"><i class="dot ${t.priority}"></i>${t.priority} · ${t.difficulty} · ${XP[t.difficulty]} XP</div>
    </div>
    <button class="icon-btn" data-edit="${esc(t.id)}">Edit</button>
    <button class="icon-btn" data-delete="${esc(t.id)}">Delete</button>
  </div>`;
}

function rewards(s){
  const d=s.data;
  return `<section class="card">
    <div class="card-head">
      <div><h2>Rewards Shop</h2><span class="sub">Spend coins on your rewards.</span></div>
      <b>${d.coins} coins</b>
    </div>
    <div class="form">
      <input class="input" id="rewardName" placeholder="Reward name">
      <input class="input" id="rewardCost" type="number" min="1" placeholder="Coin cost">
      <input class="input" id="rewardTime" type="number" min="1" placeholder="Time limit (min)">
      <button class="btn primary" id="addReward">Add reward</button>
    </div>
    <div class="list">${d.rewards.map(r=>`<div class="row">
      <div><b>${esc(r.name)}</b><div class="sub">${r.cost} coins${r.timeLimit?' · '+r.timeLimit+' min':''}</div></div>
      <div><button class="btn" data-redeem="${esc(r.id)}">Redeem</button> <button class="icon-btn" data-reward-delete="${esc(r.id)}">Delete</button></div>
    </div>`).join('')||'<div class="empty">No rewards yet.</div>'}</div>
  </section>`;
}

function history(d){
  return `<section class="card"><h2>History</h2><div class="list">${d.history.slice().reverse().map(h=>`<div class="row"><span>${formatDate(h.date)}<small>${h.done}/${h.total} tasks</small></span><span>${h.xp} XP · ${h.coins} coins · ${h.streak} day streak</span></div>`).join('')||'<div class="empty">Your daily history will appear here.</div>'}</div></section>`;
}

function achievements(s){
  const d=s.data,items=[['First Quest',d.xp>=5],['100 XP',d.xp>=100],['500 XP',d.xp>=500],['3 Day Streak',d.streak>=3],['10 Day Streak',d.streak>=10]];
  return `<section class="card"><h2>Achievements</h2><div class="list">${items.map(x=>`<div class="row"><span>${x[0]}</span><b>${x[1]?'Unlocked':'Locked'}</b></div>`).join('')}</div></section>`;
}

function backup(d){
  return `<section class="card"><h2>Data & Backup</h2><p class="sub">Export your progress or restore a previous backup.</p><button class="btn primary" id="export">Export JSON</button> <label class="btn">Import JSON<input hidden id="import" type="file" accept="application/json"></label> <button class="btn" id="reset">Reset all data</button></section>`;
}

function bind(){
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{
    view=b.dataset.view;
    menuOpen=false;
    render();
  });

  $('#menuBtn')?.addEventListener('click',e=>{
    e.stopPropagation();
    toggleMenu();
  });

  $('#menuBackdrop')?.addEventListener('click',()=>toggleMenu(false));

  document.querySelectorAll('[data-task]').forEach(b=>b.onclick=()=>{
    const s=store.get(),r=gameToggle(s.data,s.completed,b.dataset.task);
    store.set(s);
    save();
    render();
    if(r.bonus)toast('Daily completion bonus earned');
  });

  document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{
    const s=store.get(),t=allTasks(s.data).find(x=>String(x.id)===b.dataset.edit);
    const n=prompt('Task name:',t?.name||'');
    if(n?.trim()){t.name=n.trim();save();render();}
  });

  document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>{
    const s=store.get();
    const all=Object.values(s.data.routines);
    let routine=all.find(tasks=>tasks.some(t=>String(t.id)===b.dataset.delete));
    const i=routine?.findIndex(x=>String(x.id)===b.dataset.delete)??-1;
    if(i>=0&&confirm('Delete this task?')){routine.splice(i,1);save();render();}
  });

  $('#settingsBtn')?.addEventListener('click',()=>{
    const e=$('#settings');
    e.classList.toggle('open');
    if(e.classList.contains('open'))e.scrollIntoView({behavior:'smooth',block:'nearest'});
  });

  $('#taskRoutine')?.addEventListener('change',e=>{
    store.get().data.selectedRoutine=e.target.value;
    save();
  });

  $('#addRoutine')?.addEventListener('click',()=>{
    const d=store.get().data,n=$('#newRoutine').value.trim();
    if(!n)return toast('Enter a routine name');
    if(d.routines[n])return toast('Routine already exists');
    d.routines[n]=[];
    d.selectedRoutine=n;
    save();
    render();
  });

  $('#deleteRoutine')?.addEventListener('click',()=>{
    const d=store.get().data,n=Object.keys(d.routines),name=$('#deleteRoutineSelect').value;
    if(n.length<=1)return toast('Keep at least one routine');
    if(confirm('Delete '+name+'?')){
      delete d.routines[name];
      d.selectedRoutine=Object.keys(d.routines)[0];
      save();
      render();
    }
  });

  $('#addTask')?.addEventListener('click',()=>{
    const d=store.get().data,r=$('#taskRoutine').value,n=$('#taskName').value.trim();
    if(!n)return toast('Enter a task name');
    d.selectedRoutine=r;
    d.routines[r].push({id:'t_'+Date.now(),name:n,priority:$('#priority').value,difficulty:$('#difficulty').value});
    save();
    render();
  });

  $('#addReward')?.addEventListener('click',()=>{
    const d=store.get().data,n=$('#rewardName').value.trim(),c=Number($('#rewardCost').value),t=Number($('#rewardTime').value)||null;
    if(!n||c<1)return toast('Enter a reward name and valid cost');
    d.rewards.push({id:'r_'+Date.now(),name:n,cost:Math.round(c),timeLimit:t});
    save();render();
  });

  document.querySelectorAll('[data-redeem]').forEach(b=>b.onclick=()=>{
    const d=store.get().data,r=d.rewards.find(x=>String(x.id)===b.dataset.redeem);
    if(d.coins<r.cost)return toast('Not enough coins yet');
    d.coins-=r.cost;save();render();toast('Reward redeemed');
  });

  document.querySelectorAll('[data-reward-delete]').forEach(b=>b.onclick=()=>{
    const d=store.get().data;
    d.rewards=d.rewards.filter(x=>String(x.id)!==b.dataset.rewardDelete);
    save();render();
  });

  $('#export')?.addEventListener('click',()=>exportBackup(store.get().data,store.get().completed));

  $('#import')?.addEventListener('change',e=>{
    const f=e.target.files?.[0];
    if(!f)return;
    const r=new FileReader();
    r.onload=()=>{
      try{
        const p=JSON.parse(r.result);
        if(!p.data?.routines)throw Error();
        if(confirm('Import this backup?')){store.replace(p.data,p.completed);save();render();toast('Backup imported');}
      }catch{toast('Could not import backup');}
    };
    r.readAsText(f);
  });

  $('#reset')?.addEventListener('click',()=>{
    if(confirm('Reset all Productivity RPG data?')){store.replace(clone(defaultData),{});save();render();toast('All data reset');}
  });
}

async function init(){
  await persistStorage();
  const saved=await loadState();
  if(saved?.data)store.replace(saved.data,saved.completed);
  render();
}
init();