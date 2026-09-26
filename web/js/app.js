/* Full-body workout builder: app logic. Exercise data lives in web/data/exercises.json. */
/* ---------- Exercise library ---------- */
const DATA = window.WORKOUT_DATA;
// The JSON uses readable field names; the app uses short ones internally.
const FIELD_MAP={id:"id",name:"n",pattern:"p",also_pattern:"p2",level:"l",equipment:"e",reps:"r",steps:"s",cue:"c",avoid:"x",combo:"cb",slow_to_fast:"ct",partner:"pt"};
const LIB = DATA.exercises.map(x=>{const o={};for(const[k,v]of Object.entries(x)){if(FIELD_MAP[k])o[FIELD_MAP[k]]=v;}return o;});
const BY = Object.fromEntries(LIB.map(x=>[x.id,x]));

/* ---------- Equipment buttons (from data) ---------- */
document.querySelector('[data-key="equip"]').insertAdjacentHTML("beforeend",
  Object.entries(DATA.equipment).map(([k,v])=>`<button data-v="${k}">${v}</button>`).join(""));

/* ---------- Settings ---------- */
const DEF = {duration:30,level:2,plyo:"some",combos:"some",grip:"on",partner:"off",course:"one",equip:[]};
let S = load("fbw-settings", DEF);
let W = load("fbw-workout", null);
if(W){try{const ids=[...W.warm,...W.cool,...W.blocks.flatMap(b=>b.items.map(i=>i.id))];if(!ids.every(id=>BY[id])) W=null;}catch(e){W=null}}
function load(k,d){try{const v=localStorage.getItem(k);return v?Object.assign(Array.isArray(d)?[]:(d?{...d}:{}),JSON.parse(v)):d}catch(e){return d}}
function save(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}

document.querySelectorAll(".seg").forEach(g=>{
  const key=g.dataset.key, multi=!!g.dataset.multi;
  const sync=()=>g.querySelectorAll("button").forEach(b=>{
    const v=isNaN(b.dataset.v)?b.dataset.v:Number(b.dataset.v);
    b.setAttribute("aria-pressed", multi?S[key].includes(b.dataset.v):S[key]===v);
  });
  g.addEventListener("click",e=>{
    const b=e.target.closest("button"); if(!b) return;
    const v=isNaN(b.dataset.v)?b.dataset.v:Number(b.dataset.v);
    if(multi){const a=S[key]; S[key]=a.includes(v)?a.filter(x=>x!==v):[...a,v];} else S[key]=v;
    save("fbw-settings",S); sync();
  });
  sync();
});

const ALL_EQ=[...document.querySelectorAll('[data-key="equip"] button')].map(b=>b.dataset.v);
const allBtn=document.getElementById("allEq");
const syncAll=()=>allBtn.textContent=S.equip.length===ALL_EQ.length?"Clear all":"Select all";
allBtn.onclick=()=>{S.equip=S.equip.length===ALL_EQ.length?[]:[...ALL_EQ];save("fbw-settings",S);
  document.querySelectorAll('[data-key="equip"] button').forEach(b=>b.setAttribute("aria-pressed",S.equip.includes(b.dataset.v)));syncAll();};
document.querySelector('[data-key="equip"]').addEventListener("click",()=>setTimeout(syncAll));
syncAll();

/* ---------- Generator ---------- */
const RESTS=[{ex:30,round:90},{ex:20,round:75},{ex:15,round:60},{ex:10,round:60}];
const BLOCKS={20:2,30:3,45:4,60:5};
const TEMPL=[
  {slots:["plyoL","squat","push"],jump:true},
  {slots:["hinge","pull","core"],jump:false},
  {slots:["plyoX","lunge","core"],jump:true},
  {slots:["squatOrHinge","push","pull"],jump:false},
  {slots:["plyoL","lunge","core"],jump:true}
];
const reqs=x=>x.e?(Array.isArray(x.e)?x.e:[x.e]):[];
const ok=(x,s)=>(x.l||1)<=s.level && !(x.pt&&s.partner!=="on") && reqs(x).every(r=>r.split("|").some(q=>s.equip.includes(q)));
function pick(pattern,s,used,pref,prefPt){
  let c=LIB.filter(x=>(x.p===pattern||x.p2===pattern)&&ok(x,s)&&!(x.cb&&s.combos==="none"));
  if(prefPt){const pp=c.filter(x=>x.pt&&!used.has(x.id)); if(pp.length){c=pp;pref=false;}}
  if(pref){const cc=c.filter(x=>x.cb&&!used.has(x.id)); if(cc.length) c=cc;}
  const fresh=c.filter(x=>!used.has(x.id)); if(fresh.length) c=fresh;
  if(!c.length) return null;
  const w=c.map(x=>1+(x.l===s.level?2:0)+(x.l===s.level-1?1:0)+(x.e?1.5:0));
  let r=Math.random()*w.reduce((a,b)=>a+b,0);
  for(let i=0;i<c.length;i++){r-=w[i]; if(r<=0){used.add(c[i].id);return c[i].id}}
  used.add(c[0].id); return c[0].id;
}
function resolve(slot,s){
  if(slot==="plyoX") return (LIB.some(x=>x.p==="plyoU"&&ok(x,s))&&Math.random()<.5)?"plyoU":"plyoL";
  if(slot==="squatOrHinge") return Math.random()<.5?"squat":"hinge";
  return slot;
}
function shuffle(a){a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function generate(s){
  const used=new Set(), blocks=[];
  for(let i=0;i<BLOCKS[s.duration];i++){
    const t=TEMPL[i]; let slots=[...t.slots];
    if(!t.jump && s.plyo==="lots") slots.unshift("plyoX");
    const items=[], pats=slots.map(sl=>resolve(sl,s));
    let cbSlot=-1;
    if(s.combos==="max") cbSlot=-2;
    else if(s.combos==="lots"||(s.combos==="some"&&i%2===0)){
      const opts=pats.map((p,k)=>LIB.some(x=>x.cb&&x.p===p&&ok(x,s)&&!used.has(x.id))?k:-1).filter(k=>k>=0);
      if(opts.length) cbSlot=opts[Math.floor(Math.random()*opts.length)];
    }
    let ptSlot=-1;
    if(s.partner==="on"){
      const po=pats.map((p,k)=>LIB.some(x=>x.pt&&(x.p===p||x.p2===p)&&ok(x,s)&&!used.has(x.id))?k:-1).filter(k=>k>=0&&k!==cbSlot);
      if(po.length) ptSlot=po[Math.floor(Math.random()*po.length)];
    }
    pats.forEach((pat,k)=>{
      const id=pick(pat,s,used,cbSlot===-2||k===cbSlot,k===ptSlot)||pick("plyoL",s,used);
      if(id) items.push({id,pat});
    });
    blocks.push({name:"Block "+"ABCDE"[i],rounds:s.level===4?4:3,items});
  }
  if(s.course&&s.course!=="off"){
    const n=s.course==="two"?2:1, oc=[];
    for(let k=0;k<n;k++){const id=pick("course",s,used); if(id) oc.push({id,pat:"course"});}
    if(oc.length) blocks.unshift({name:"Obstacle course",rounds:1,course:true,items:oc});
  }
  if(s.grip==="on"){
    const g=[pick("grip",s,used),pick("grip",s,used)].filter(Boolean);
    if(g.length) blocks.push({name:"Grip finisher",rounds:2,items:g.map(id=>({id,pat:"grip"}))});
  }
  const warm=["jacks","inchworm","wgs",...shuffle(["squat-reach","leg-swings","arm-circles","cat-cow","bridge-w"]).slice(0,2)];
  const cool=["hip-flexor",...shuffle(["child","figure4","ham-fold","thread","chest-wall"]).slice(0,3)];
  return {settings:{...s,equip:[...s.equip]},warm,cool,blocks};
}
const reps=(id,lv)=>{const r=BY[id].r;return r[lv-1]||[...r].reverse().find(Boolean)};
const isJump=id=>/^plyo|^course/.test(BY[id].p);

/* ---------- Sequence for follow-along ---------- */
function sequence(w){
  const lv=w.settings.level, R=RESTS[lv-1], seq=[];
  w.warm.forEach(id=>seq.push({k:"timed",id,secs:40,sec:"Warm-up"}));
  w.blocks.forEach((b,bi)=>{
    for(let r=1;r<=b.rounds;r++){
      b.items.forEach((it,ii)=>{
        seq.push({k:"set",id:it.id,reps:reps(it.id,lv),sec:b.course?"Obstacle course: rest 60 to 90s between runs":`${b.name}, round ${r} of ${b.rounds}`});
        const lastItem=ii===b.items.length-1, lastRound=r===b.rounds, lastBlock=bi===w.blocks.length-1;
        if(!(lastItem&&lastRound&&lastBlock)) seq.push({k:"rest",secs:b.course?90:(lastItem?R.round:R.ex),sec:"Rest"});
      });
    }
  });
  w.cool.forEach(id=>seq.push({k:"timed",id,secs:45,sec:"Cool-down"}));
  return seq;
}
const SET_SECS=40;
function estimate(seq){return Math.round(seq.reduce((a,s)=>a+(s.k==="set"?SET_SECS:s.secs),0)/60)}

/* ---------- Equipment list ---------- */
const EQ_LABEL=DATA.equipment;
const EXTRA=DATA.extras;
const QTY=DATA.quantities;
function equipList(w){
  const ids=[...w.warm,...w.blocks.flatMap(b=>b.items.map(i=>i.id)),...w.cool];
  const map=new Map();
  const add=(label,ex)=>{if(!map.has(label)) map.set(label,new Set()); map.get(label).add(QTY[ex.id]?`${ex.n} (${QTY[ex.id]})`:ex.n);};
  [...new Set(ids)].forEach(id=>{
    const ex=BY[id];
    reqs(ex).forEach(r=>{
      const alts=r.split("|"), have=alts.filter(a=>w.settings.equip.includes(a));
      add((have.length?have:alts).map((a,i)=>{const l=EQ_LABEL[a]||a;return i&&!/^(TRX|BOSU)/.test(l)?l[0].toLowerCase()+l.slice(1):l}).join(" or "),ex);
    });
    (EXTRA[id]||[]).forEach(g=>add(g,ex));
  });
  return [...map.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
}

/* ---------- Render plan ---------- */
const plan=document.getElementById("plan");
function howHTML(ex){
  return `<div class="how"><ol>${ex.s.map(t=>`<li>${t}</li>`).join("")}</ol>
  <p><b>Cue:</b> ${ex.c}</p>${ex.x?`<p><b>Avoid:</b> ${ex.x}</p>`:""}</div>`;
}
function row(id,meta,swappable,where){
  const ex=BY[id], j=isJump(id);
  return `<details class="${j?"jumpbar":""}"><summary>
    <span class="nm">${ex.n}<small>${meta}</small></span>
    ${ex.pt?'<span class="tag cb">Partner</span>':""}${ex.ct?'<span class="tag cb">Slow + fast</span>':ex.cb?'<span class="tag cb">Combo</span>':""}${j?'<span class="tag">Plyo</span>':""}
    ${swappable?`<button class="swap" data-where="${where}" aria-label="Swap ${ex.n} for a similar move">Swap</button>`:""}
    <span class="chev" aria-hidden="true"></span></summary>${howHTML(ex)}</details>`;
}
function render(){
  if(!W){plan.hidden=true;return}
  const lv=W.settings.level, R=RESTS[lv-1], seq=sequence(W);
  const jumps=W.blocks.reduce((a,b)=>a+b.items.filter(i=>isJump(i.id)).length,0);
  // timeline strip
  let strip=`<span class="w" style="flex:${W.warm.length*40}"></span><span class="gap"></span>`;
  W.blocks.forEach(b=>{
    for(let r=0;r<b.rounds;r++) b.items.forEach(it=>strip+=`<span class="${isJump(it.id)?"j":"s"}" style="flex:${SET_SECS}"></span>`);
    strip+=`<span class="gap"></span>`;
  });
  strip+=`<span class="w" style="flex:${W.cool.length*45}"></span>`;

  let h=`<div class="strip" aria-hidden="true">${strip}</div>
  <div class="legend"><span><i style="background:var(--soft)"></i>Warm-up and cool-down</span><span><i style="background:var(--strength)"></i>Strength</span><span><i style="background:var(--jump)"></i>Plyometrics</span></div>
  <p class="summary">About ${estimate(seq)} minutes. ${W.blocks.length} blocks, ${jumps} plyo ${jumps===1?"move":"moves"}.</p>
  <div class="actions"><button class="go" id="start">Start workout</button><button id="again">New workout</button></div>
  <section class="sec"><h2>What you'll need</h2><p class="note">Tick items off as you set up.${W.settings.partner==="on"?" Plus your partner.":""}</p>
  ${(()=>{const g=equipList(W);return g.length?`<ul class="gear">${g.map(([lab,uses])=>`<li><label><input type="checkbox"><span><b>${lab}</b><small>${[...uses].join(", ")}</small></span></label></li>`).join("")}</ul>`:`<p class="note">Nothing but some floor space.</p>`})()}
  </section>
  <section class="sec"><h2>Warm-up</h2><p class="note">40 seconds each, one after another.</p>
  <div class="list">${W.warm.map(id=>row(id,"40 seconds",false)).join("")}</div></section>`;
  W.blocks.forEach((b,bi)=>{
    h+=b.course?`<section class="sec"><h2>${b.name}</h2><p class="note">Set up the course before you start. Rest 60 to 90 seconds between runs while you walk back. Quality beats speed: if a landing gets loud or wobbly, rest longer.</p>
    <div class="list">${b.items.map((it,ii)=>row(it.id,reps(it.id,lv),true,`${bi}-${ii}`)).join("")}</div></section>`:`<section class="sec"><h2>${b.name}</h2><p class="note">${b.rounds} rounds. Rest ${R.ex}s between moves and ${R.round}s after each round.${b.items.some(i=>isJump(i.id))?" Plyo moves come first while you're fresh.":""}${W.settings.partner==="on"?" Partner moves: switch roles after each set, so one works while the other holds or rests.":""}</p>
    <div class="list">${b.items.map((it,ii)=>row(it.id,reps(it.id,lv),true,`${bi}-${ii}`)).join("")}</div></section>`;
  });
  h+=`<section class="sec"><h2>Cool-down</h2><p class="note">45 seconds each. For one-sided stretches, switch halfway.</p>
  <div class="list">${W.cool.map(id=>row(id,"45 seconds",false)).join("")}</div></section>
  <p class="foot">On plyo moves, land softly and end the set when landings get loud or sloppy. Skip or swap jumps if you have joint pain, are recovering from injury, or have a condition that makes impact risky.</p>`;
  plan.innerHTML=h; plan.hidden=false;
  document.getElementById("start").onclick=startFollow;
  document.getElementById("again").onclick=build;
}
plan.addEventListener("click",e=>{
  const b=e.target.closest(".swap"); if(!b) return;
  e.preventDefault(); e.stopPropagation();
  const [bi,ii]=b.dataset.where.split("-").map(Number);
  const it=W.blocks[bi].items[ii];
  const used=new Set(W.blocks.flatMap(bl=>bl.items.map(x=>x.id)));
  const id=pick(it.pat,{combos:"some",partner:"off",...W.settings},used,!!BY[it.id].cb,!!BY[it.id].pt);
  if(id){it.id=id; save("fbw-workout",W); render();
    const nb=plan.querySelector(`.swap[data-where="${bi}-${ii}"]`); if(nb) nb.focus();}
  else {b.textContent="No other options"; setTimeout(()=>b.textContent="Swap",1500)}
});
function build(){
  W=generate(S); save("fbw-workout",W); render();
  plan.scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});
}
document.getElementById("build").onclick=build;
render();

/* ---------- Follow-along ---------- */
const F={seq:[],i:0,end:0,left:0,paused:false,t:null,lock:null};
const fEl=document.getElementById("follow"), fMain=document.getElementById("fmain"),
      fPos=document.getElementById("fpos"), fProg=document.getElementById("fprog"),
      fPrim=document.getElementById("fprimary");
let actx=null;
function beep(freq=880,dur=.15){
  try{actx=actx||new (window.AudioContext||window.webkitAudioContext)();
    const o=actx.createOscillator(),g=actx.createGain();o.frequency.value=freq;
    g.gain.setValueAtTime(.15,actx.currentTime);g.gain.exponentialRampToValueAtTime(.001,actx.currentTime+dur);
    o.connect(g).connect(actx.destination);o.start();o.stop(actx.currentTime+dur);}catch(e){}
}
function startFollow(){
  F.seq=sequence(W); F.i=0; fEl.classList.add("on"); document.body.style.overflow="hidden";
  try{navigator.wakeLock&&navigator.wakeLock.request("screen").then(l=>F.lock=l).catch(()=>{})}catch(e){}
  beep(660,.05); show();
}
function stopFollow(){
  clearInterval(F.t); fEl.classList.remove("on"); document.body.style.overflow="";
  try{F.lock&&F.lock.release()}catch(e){} F.lock=null;
}
const fmt=s=>{s=Math.max(0,Math.ceil(s));return s>=60?`${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`:String(s)};
function nextSetName(from){for(let k=from;k<F.seq.length;k++) if(F.seq[k].id) return BY[F.seq[k].id].n; return null}
function show(){
  clearInterval(F.t); F.paused=false;
  const st=F.seq[F.i];
  if(!st){fMain.innerHTML=`<p class="fkind">Finished</p><h2 class="fname">Nice work.</h2><p class="fcue">That's the whole session. Drink some water.</p>`;
    fPos.textContent="Done"; fProg.style.width="100%"; fPrim.textContent="Close"; fPrim.onclick=stopFollow; beep(990,.3); return;}
  fPos.textContent=`Step ${F.i+1} of ${F.seq.length}`;
  fProg.style.width=(F.i/F.seq.length*100)+"%";
  fMain.classList.toggle("isjump",!!(st.id&&isJump(st.id)));
  if(st.k==="rest"){
    const nx=nextSetName(F.i+1);
    fMain.innerHTML=`<p class="fkind">${st.sec}</p><h2 class="fname">Rest</h2><p class="fbig" id="fclock">${fmt(st.secs)}</p>
      ${nx?`<p class="fnext">Next up: <b>${nx}</b></p>`:""}`;
    fPrim.textContent="Skip rest"; fPrim.onclick=()=>{F.i++;show()};
    countdown(st.secs,true);
  } else {
    const ex=BY[st.id];
    fMain.innerHTML=`<p class="fkind">${st.sec}${isJump(st.id)?". Plyo: full effort, every rep":""}</p>
      <h2 class="fname">${ex.n}</h2>
      ${st.k==="timed"?`<p class="fbig" id="fclock">${fmt(st.secs)}</p>`:`<p class="fbig">${st.reps}</p>`}
      <p class="fcue">${ex.c}</p>
      <details${st.k==="set"?"":""}><summary>How to do it</summary>${howHTML(ex)}</details>`;
    if(st.k==="timed"){fPrim.textContent="Pause"; fPrim.onclick=togglePause; countdown(st.secs,true);}
    else {fPrim.textContent="Set done"; fPrim.onclick=()=>{F.i++;show()};}
  }
  fMain.scrollTop=0;
}
function countdown(secs){
  F.end=Date.now()+secs*1000;
  F.t=setInterval(()=>{
    const left=(F.end-Date.now())/1000, c=document.getElementById("fclock");
    if(c) c.textContent=fmt(left);
    if(left<=3.05&&left>2.8||left<=2.05&&left>1.8||left<=1.05&&left>.8) beep(660,.06);
    if(left<=0){clearInterval(F.t); beep(990,.2); F.i++; show();}
  },200);
}
function togglePause(){
  if(!F.paused){F.left=(F.end-Date.now())/1000; clearInterval(F.t); F.paused=true; fPrim.textContent="Resume";}
  else {F.paused=false; fPrim.textContent="Pause"; countdown(F.left);}
}
document.getElementById("fclose").onclick=stopFollow;
document.getElementById("fback").onclick=()=>{if(F.i>0){F.i--; if(F.seq[F.i].k==="rest"&&F.i>0) F.i--; show();}};
document.getElementById("fskip").onclick=()=>{if(F.i<F.seq.length){F.i++;show()}};
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&fEl.classList.contains("on")) stopFollow()});
