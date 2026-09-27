/* Full-body workout builder: app logic. Exercise data: web/data/exercises.json, served from the database by tools/serve.py. */
/* ---------- Exercise library ---------- */
const DATA = window.WORKOUT_DATA;
// Saving and evaluating need the database API of tools/serve.py; switched on at the end if it answers.
const API={on:false};
// The JSON uses readable field names; the app uses short ones internally.
const FIELD_MAP={id:"id",name:"n",pattern:"p",also_pattern:"p2",level:"l",equipment:"e",reps:"r",steps:"s",cue:"c",avoid:"x",combo:"cb",slow_to_fast:"ct",partner:"pt",sprint:"sp",secs:"t",switch_sides:"sw",retired:"rt"};
const LIB = DATA.exercises.map(x=>{const o={};for(const[k,v]of Object.entries(x)){if(FIELD_MAP[k])o[FIELD_MAP[k]]=v;}return o;});
const BY = Object.fromEntries(LIB.map(x=>[x.id,x]));

/* ---------- Equipment buttons (from data) ---------- */
document.querySelector('[data-key="equip"]').insertAdjacentHTML("beforeend",
  Object.entries(DATA.equipment).map(([k,v])=>`<button data-v="${k}">${v}</button>`).join(""));

/* ---------- Settings ---------- */
const DEF = {duration:30,level:2,plyo:"some",sprints:"some",combos:"some",grip:"on",partner:"off",course:"one",equip:[]};
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
// Rest per level: from the database when served by tools/serve.py, otherwise these defaults.
const RESTS=DATA.levels?DATA.levels.map(l=>({ex:l.ex,round:l.round})):[{ex:30,round:90},{ex:20,round:75},{ex:15,round:60},{ex:10,round:60}];
const LEVEL_NAMES=["Beginner","Intermediate","Advanced","Beast"];
const BLOCKS={20:2,30:3,45:4,60:5};
const YIN={20:1,30:2,45:2,60:3}; // yin holds in the cool-down, by workout length
const TEMPL=[
  {slots:["plyoL","squat","push"],jump:true},
  {slots:["hinge","pull","core"],jump:false},
  {slots:["plyoX","lunge","core"],jump:true},
  {slots:["squatOrHinge","push","pull"],jump:false},
  {slots:["plyoL","lunge","core"],jump:true}
];
const reqs=x=>x.e?(Array.isArray(x.e)?x.e:[x.e]):[];
const ok=(x,s)=>!x.rt && (x.l||1)<=s.level && !(x.pt&&s.partner!=="on") && !(x.sp&&s.sprints==="none") && reqs(x).every(r=>r.split("|").some(q=>s.equip.includes(q)));
// Selected equipment is a menu, not a checklist: each workout draws a small kit from it and reuses it.
const KIT={20:3,30:4,45:5,60:6}; // most equipment types in one workout, by length
// For each requirement the kit doesn't cover yet, the options the user has (one of them gets added).
const newGear=(x,s,kit)=>reqs(x).map(r=>r.split("|").filter(q=>s.equip.includes(q))).filter(a=>!a.some(q=>kit.have.has(q)));
function kitOf(ids,s){
  const kit={have:new Set(),max:KIT[s.duration]||5};
  // Single-option requirements first, so "plate|barbell" is covered by a barbell that's needed anyway.
  const need=ids.flatMap(id=>newGear(BY[id],s,kit)).sort((a,b)=>a.length-b.length);
  need.forEach(a=>{if(!a.some(q=>kit.have.has(q))) kit.have.add(a[0])});
  return kit;
}
function pick(pattern,s,used,pref,prefPt,kit,prefSp){
  let c=LIB.filter(x=>(x.p===pattern||x.p2===pattern)&&ok(x,s)&&!(x.cb&&s.combos==="none"));
  if(kit&&c.length){
    // Stay within the kit's size; if nothing fits, add as little new equipment as possible.
    const n=c.map(x=>newGear(x,s,kit).length), least=Math.min(...n), room=kit.max-kit.have.size;
    c=c.filter((x,k)=>n[k]<=Math.max(room,least));
  }
  if(prefPt){const pp=c.filter(x=>x.pt&&!used.has(x.id)); if(pp.length){c=pp;pref=false;}}
  // A repeated sprint beats no sprint, so fall back to already-used ones.
  if(prefSp){let sp=c.filter(x=>x.sp&&!used.has(x.id)); if(!sp.length) sp=c.filter(x=>x.sp); if(sp.length){c=sp;pref=false;}}
  if(pref){const cc=c.filter(x=>x.cb&&!used.has(x.id)); if(cc.length) c=cc;}
  const fresh=c.filter(x=>!used.has(x.id)); if(fresh.length) c=fresh;
  if(!c.length) return null;
  // Equipment moves get a bonus, a bigger one when they reuse what's already in the kit.
  const w=c.map(x=>1+(x.l===s.level?2:0)+(x.l===s.level-1?1:0)+(x.e?(kit&&newGear(x,s,kit).length?.5:1.5):0));
  let r=Math.random()*w.reduce((a,b)=>a+b,0), i=0;
  while(i<c.length-1&&(r-=w[i])>0) i++;
  const x=c[i]; used.add(x.id);
  if(kit) newGear(x,s,kit).forEach(a=>kit.have.add(a[Math.floor(Math.random()*a.length)]));
  return x.id;
}
function resolve(slot,s){
  if(slot==="plyoX") return (LIB.some(x=>x.p==="plyoU"&&ok(x,s))&&Math.random()<.5)?"plyoU":"plyoL";
  if(slot==="squatOrHinge") return Math.random()<.5?"squat":"hinge";
  return slot;
}
function shuffle(a){a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function generate(s){
  const used=new Set(), blocks=[], kit={have:new Set(),max:KIT[s.duration]||5};
  // Course and grip finisher first: their equipment starts the kit, and the blocks reuse it.
  const oc=[];
  if(s.course&&s.course!=="off") for(let k=0;k<(s.course==="two"?2:1);k++){const id=pick("course",s,used,false,false,kit); if(id) oc.push({id,pat:"course"});}
  const g=s.grip==="on"?[pick("grip",s,used,false,false,kit),pick("grip",s,used,false,false,kit)].filter(Boolean):[];
  for(let i=0;i<BLOCKS[s.duration];i++){
    const t=TEMPL[i]; let slots=[...t.slots];
    if(!t.jump && s.plyo==="lots") slots.unshift("plyoX");
    const items=[], pats=slots.map(sl=>resolve(sl,s));
    // Sprints "One per block": the block's plyo slot becomes a sprint, or a sprint slot is added.
    let spSlot=-1;
    if(s.sprints==="lots"){
      spSlot=pats.findIndex(p=>p==="plyoL"||p==="plyoU");
      if(spSlot<0){pats.unshift("plyoL"); spSlot=0;} else pats[spSlot]="plyoL";
    }
    let cbSlot=-1;
    if(s.combos==="max") cbSlot=-2;
    else if(s.combos==="lots"||(s.combos==="some"&&i%2===0)){
      const opts=pats.map((p,k)=>LIB.some(x=>x.cb&&x.p===p&&ok(x,s)&&!used.has(x.id))?k:-1).filter(k=>k>=0&&k!==spSlot);
      if(opts.length) cbSlot=opts[Math.floor(Math.random()*opts.length)];
    }
    let ptSlot=-1;
    if(s.partner==="on"){
      const po=pats.map((p,k)=>LIB.some(x=>x.pt&&(x.p===p||x.p2===p)&&ok(x,s)&&!used.has(x.id))?k:-1).filter(k=>k>=0&&k!==cbSlot&&k!==spSlot);
      if(po.length) ptSlot=po[Math.floor(Math.random()*po.length)];
    }
    pats.forEach((pat,k)=>{
      const id=pick(pat,s,used,cbSlot===-2||k===cbSlot,k===ptSlot,kit,k===spSlot)||pick("plyoL",s,used,false,false,kit);
      if(id) items.push({id,pat});
    });
    blocks.push({name:"Block "+"ABCDE"[i],rounds:s.level===4?4:3,items});
  }
  if(oc.length) blocks.unshift({name:"Obstacle course",rounds:1,course:true,items:oc});
  if(g.length) blocks.push({name:"Grip finisher",rounds:2,items:g.map(id=>({id,pat:"grip"}))});
  // Warm-up: pulse raiser, full-body flow, two mobility drills, then a second pulse raiser.
  const pulse=shuffle(["jacks","high-knees","butt-kicks","lat-shuffle","seal-jacks","skip-in-place","a-skip","rope-easy"].filter(id=>ok(BY[id],s))),
        flow=shuffle(["inchworm","wgs","dog-cobra","bear-squat","spiderman-reach"]),
        mob=shuffle(["squat-reach","leg-swings","arm-circles","cat-cow","bridge-w","hip-circles","hip-9090","knee-hug","open-book","scap-pushup","ankle-rocks","lunge-rotate","calf-raises","tib-raises","band-dislocate","band-pull-apart-w"].filter(id=>ok(BY[id],s)));
  const warm=[pulse[0],flow[0],mob[0],mob[1],pulse[1]];
  // Cool-down: two short stretches, yin holds (more for longer workouts), then a calm finish.
  const stretch=shuffle(["hip-flexor","figure4","ham-fold","thread","chest-wall","quad-stretch","calf-wall","shoulder-cross","seated-twist","neck-side","cobra-stretch","wrist-stretch"]),
        yin=shuffle(["child","yin-butterfly","yin-caterpillar","yin-dragon","yin-swan","yin-sphinx","yin-twist","yin-happy-baby","yin-frog","yin-shoelace","yin-banana"]),
        calm=shuffle(["savasana","legs-wall","box-breath","croc-breath","reclined-butterfly"]);
  const cool=[stretch[0],stretch[1],...yin.slice(0,YIN[s.duration]||2),calm[0]];
  return {settings:{...s,equip:[...s.equip]},warm,cool,blocks};
}
const WARM_SECS=40, COOL_SECS=45;
const holdSecs=(id,d)=>BY[id].t||d;
const holdLabel=(id,d)=>{const t=holdSecs(id,d);return (t%60?`${t} seconds`:t===60?"1 minute":`${t/60} minutes`)+(BY[id].sw?", switch sides halfway":"")};
const reps=(id,lv)=>{const r=BY[id].r;return r[lv-1]||[...r].reverse().find(Boolean)};
const isJump=id=>/^plyo|^course/.test(BY[id].p);

/* ---------- Sequence for follow-along ---------- */
function sequence(w){
  const lv=w.settings.level, R=RESTS[lv-1], seq=[];
  w.warm.forEach(id=>seq.push({k:"timed",id,secs:holdSecs(id,WARM_SECS),sec:"Warm-up"}));
  w.blocks.forEach((b,bi)=>{
    for(let r=1;r<=b.rounds;r++){
      b.items.forEach((it,ii)=>{
        seq.push({k:"set",id:it.id,reps:reps(it.id,lv),sec:b.course?"Obstacle course: rest 60 to 90s between runs":`${b.name}, round ${r} of ${b.rounds}`});
        const lastItem=ii===b.items.length-1, lastRound=r===b.rounds, lastBlock=bi===w.blocks.length-1;
        if(!(lastItem&&lastRound&&lastBlock)) seq.push({k:"rest",secs:b.course?90:(lastItem?R.round:R.ex),sec:"Rest"});
      });
    }
  });
  w.cool.forEach(id=>seq.push({k:"timed",id,secs:holdSecs(id,COOL_SECS),sec:BY[id].t>=120?"Cool-down: yin hold":"Cool-down"}));
  return seq;
}
const SET_SECS=40;
// "an 8-minute", "an 11-minute", "a 6-minute"
const an=n=>(/^(8\d*|11|18)$/.test(String(n))?"an ":"a ")+n;
function estimate(seq,f=()=>true){return Math.round(seq.filter(f).reduce((a,s)=>a+(s.k==="set"?SET_SECS:s.secs),0)/60)}

/* ---------- Equipment list ---------- */
const EQ_LABEL=DATA.equipment;
const EXTRA=DATA.extras;
const QTY=DATA.quantities;
function equipList(w){
  const ids=[...w.warm,...w.blocks.flatMap(b=>b.items.map(i=>i.id)),...w.cool];
  const map=new Map(), kit=kitOf(w.blocks.flatMap(b=>b.items.map(i=>i.id)),w.settings).have;
  const add=(label,ex)=>{if(!map.has(label)) map.set(label,new Set()); map.get(label).add(QTY[ex.id]?`${ex.n} (${QTY[ex.id]})`:ex.n);};
  [...new Set(ids)].forEach(id=>{
    const ex=BY[id];
    reqs(ex).forEach(r=>{
      const alts=r.split("|"), inKit=alts.filter(a=>kit.has(a)), have=inKit.length?inKit.slice(0,1):alts.filter(a=>w.settings.equip.includes(a));
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
    ${ex.pt?'<span class="tag cb">Partner</span>':""}${ex.t>=120&&ex.p==="cool"?'<span class="tag">Yin</span>':""}${ex.ct?'<span class="tag cb">Slow + fast</span>':ex.cb?'<span class="tag cb">Combo</span>':""}${ex.sp?'<span class="tag">Sprint</span>':j?'<span class="tag">Plyo</span>':""}
    ${swappable?`<button class="swap" data-where="${where}" aria-label="Swap ${ex.n} for a similar move">Swap</button>`:""}
    <span class="chev" aria-hidden="true"></span></summary>${howHTML(ex)}</details>`;
}
function render(){
  if(!W){plan.hidden=true;return}
  const lv=W.settings.level, R=RESTS[lv-1], seq=sequence(W);
  const jumps=W.blocks.reduce((a,b)=>a+b.items.filter(i=>isJump(i.id)).length,0);
  // timeline strip
  let strip=`<span class="w" style="flex:${W.warm.reduce((a,id)=>a+holdSecs(id,WARM_SECS),0)}"></span><span class="gap"></span>`;
  W.blocks.forEach(b=>{
    for(let r=0;r<b.rounds;r++) b.items.forEach(it=>strip+=`<span class="${isJump(it.id)?"j":"s"}" style="flex:${SET_SECS}"></span>`);
    strip+=`<span class="gap"></span>`;
  });
  strip+=`<span class="w" style="flex:${W.cool.reduce((a,id)=>a+holdSecs(id,COOL_SECS),0)}"></span>`;

  const total=estimate(seq), wm=estimate(seq,s=>s.sec==="Warm-up"), cm=estimate(seq,s=>s.sec.startsWith("Cool-down"));
  let h=`<div class="timebox"><p class="hard"><b>About ${total-wm-cm} min</b> of hard work</p>
  <p>Plus ${an(wm)}-minute warm-up and ${an(cm)}-minute cool-down, so set aside about ${total} minutes in total. The time you pick counts only the hard part.</p></div>
  <div class="strip" aria-hidden="true">${strip}</div>
  <div class="legend"><span><i style="background:var(--soft)"></i>Warm-up and cool-down</span><span><i style="background:var(--strength)"></i>Strength</span><span><i style="background:var(--jump)"></i>Plyometrics</span></div>
  <p class="summary">${W.blocks.length} blocks, ${jumps} plyo ${jumps===1?"move":"moves"}.</p>
  <div class="actions"><button class="go" id="start">Start workout</button><button id="again">New workout</button></div>
  ${saveHTML()}
  <section class="sec"><h2>What you'll need</h2><p class="note">Tick items off as you set up.${W.settings.partner==="on"?" Plus your partner.":""}</p>
  ${(()=>{const g=equipList(W);return g.length?`<ul class="gear">${g.map(([lab,uses])=>`<li><label><input type="checkbox"><span><b>${lab}</b><small>${[...uses].join(", ")}</small></span></label></li>`).join("")}</ul>`:`<p class="note">Nothing but some floor space.</p>`})()}
  </section>
  ${evalsHTML()}
  <section class="sec"><h2>Warm-up</h2><p class="note">One after another, no rest.</p>
  <div class="list">${W.warm.map(id=>row(id,holdLabel(id,WARM_SECS),false)).join("")}</div></section>`;
  W.blocks.forEach((b,bi)=>{
    h+=b.course?`<section class="sec"><h2>${b.name}</h2><p class="note">Set up the course before you start. Rest 60 to 90 seconds between runs while you walk back. Quality beats speed: if a landing gets loud or wobbly, rest longer.</p>
    <div class="list">${b.items.map((it,ii)=>row(it.id,reps(it.id,lv),true,`${bi}-${ii}`)).join("")}</div></section>`:`<section class="sec"><h2>${b.name}</h2><p class="note">${b.rounds} rounds. Rest ${R.ex}s between moves and ${R.round}s after each round.${b.items.some(i=>isJump(i.id))?" Plyo moves come first while you're fresh.":""}${W.settings.partner==="on"?" Partner moves: switch roles after each set, so one works while the other holds or rests.":""}</p>
    <div class="list">${b.items.map((it,ii)=>row(it.id,reps(it.id,lv),true,`${bi}-${ii}`)).join("")}</div></section>`;
  });
  h+=`<section class="sec"><h2>Cool-down</h2><p class="note">A couple of short stretches, then longer yin holds: settle into each pose at about 70% of your range, stay still and let gravity do the work. Finish by breathing slowly.</p>
  <div class="list">${W.cool.map(id=>row(id,holdLabel(id,COOL_SECS),false)).join("")}</div></section>
  <p class="foot">On plyo moves, land softly and end the set when landings get loud or sloppy. Skip or swap jumps if you have joint pain, are recovering from injury, or have a condition that makes impact risky.</p>`;
  plan.innerHTML=h; plan.hidden=false;
  document.getElementById("start").onclick=startFollow;
  document.getElementById("again").onclick=build;
  const sf=document.getElementById("saveForm"); if(sf) sf.onsubmit=saveCurrent;
  const eb=document.getElementById("evalBtn"); if(eb) eb.onclick=()=>openEval(W.savedId,W.name,estimateSecs(W));
}
plan.addEventListener("click",e=>{
  const b=e.target.closest(".swap"); if(!b) return;
  e.preventDefault(); e.stopPropagation();
  const [bi,ii]=b.dataset.where.split("-").map(Number);
  const it=W.blocks[bi].items[ii];
  const used=new Set(W.blocks.flatMap(bl=>bl.items.map(x=>x.id)));
  const ss={combos:"some",partner:"off",...W.settings};
  // Swap within the kit the rest of the workout already uses.
  const kit=kitOf(W.blocks.flatMap((bl,bj)=>bl.items.filter((x,xj)=>bj!==bi||xj!==ii).map(x=>x.id)),ss);
  const id=pick(it.pat,ss,used,!!BY[it.id].cb,!!BY[it.id].pt,kit,!!BY[it.id].sp&&ss.sprints==="lots");
  if(id){it.id=id; if(W.savedId){W.editedFrom=W.name; delete W.savedId; delete W.name; delete W.sessions; delete W.lastRun}
    save("fbw-workout",W); render();
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
const F={seq:[],i:0,end:0,left:0,half:null,done:null,paused:false,t:null,lock:null};
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
  F.seq=sequence(W); F.i=0; F.run={start:Date.now(),paused:0}; fEl.classList.add("on"); document.body.style.overflow="hidden";
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
  clearInterval(F.t); F.paused=false; F.half=null; F.done=null;
  const st=F.seq[F.i];
  if(!st){
    // Remember how long the run really took, so the evaluation can be pre-filled.
    if(F.run){W.lastRun={started_at:new Date(F.run.start).toISOString(),minutes:Math.max(1,Math.round((Date.now()-F.run.start-F.run.paused)/60000))}; F.run=null; save("fbw-workout",W);}
    const mins=W.lastRun?` It took about ${W.lastRun.minutes} minutes.`:"";
    fMain.innerHTML=`<p class="fkind">Finished</p><h2 class="fname">Nice work.</h2><p class="fcue">That's the whole session.${mins} Drink some water.</p>
      ${API.on?(W.savedId?`<button class="evalnow" id="evalNow">Evaluate this workout</button>`:`<p class="fnext">Save the workout with a name to evaluate it.</p>`):""}`;
    const en=document.getElementById("evalNow"); if(en) en.onclick=()=>{stopFollow(); openEval(W.savedId,W.name,estimateSecs(W))};
    fPos.textContent="Done"; fProg.style.width="100%"; fPrim.textContent="Close"; fPrim.onclick=()=>{stopFollow(); render()}; beep(990,.3); return;}
  fPos.textContent=`Step ${F.i+1} of ${F.seq.length}`;
  fProg.style.width=(F.i/F.seq.length*100)+"%";
  fMain.classList.toggle("isjump",!!(st.id&&isJump(st.id)));
  if(st.k==="rest"){
    const nx=nextSetName(F.i+1);
    fMain.innerHTML=`<p class="fkind">${st.sec}</p><h2 class="fname">Rest</h2><p class="fbig" id="fclock">${fmt(st.secs)}</p>
      ${nx?`<p class="fnext">Next up: <b>${nx}</b></p>`:""}`;
    fPrim.textContent="Skip rest"; fPrim.onclick=()=>{F.i++;show()};
    countdown(st.secs);
  } else {
    const ex=BY[st.id];
    fMain.innerHTML=`<p class="fkind">${st.sec}${isJump(st.id)?". Plyo: full effort, every rep":""}</p>
      <h2 class="fname">${ex.n}</h2>
      ${st.k==="timed"?`<p class="fbig" id="fclock">${fmt(st.secs)}</p>${ex.sw?'<p class="fnext" id="fswitch">Switch sides halfway</p>':""}`:`<p class="fbig" id="fclock">${st.reps}</p><p class="fnext" id="fswitch"></p>`}
      <p class="fcue">${ex.c}</p>
      <details${st.k==="set"?"":""}><summary>How to do it</summary>${howHTML(ex)}</details>`;
    if(st.k==="timed"){F.half=ex.sw?st.secs/2:null; fPrim.textContent="Pause"; fPrim.onclick=togglePause; countdown(st.secs);}
    else {
      // Timed holds ("30s", "20s each side") get a timer: 5 s to get in position, then the hold.
      const m=/^(\d+)s( each side)?$/.exec(st.reps||"");
      if(m){
        const secs=m[1]*(m[2]?2:1), note=document.getElementById("fswitch"), clock=document.getElementById("fclock");
        fPrim.textContent=`Start ${m[1]}s timer`;
        fPrim.onclick=()=>{
          note.textContent="Get in position"; clock.textContent=fmt(5); fPrim.textContent="Pause"; fPrim.onclick=togglePause;
          countdown(5,()=>{
            F.half=m[2]?secs/2:null; note.textContent=m[2]?"Switch sides halfway":"Hold it!"; clock.textContent=fmt(secs);
            countdown(secs,()=>{F.i++;show()});
          });
        };
      } else {fPrim.textContent="Set done"; fPrim.onclick=()=>{F.i++;show()};}
    }
  }
  fMain.scrollTop=0;
}
function countdown(secs,done){
  if(done) F.done=done;
  F.end=Date.now()+secs*1000;
  F.t=setInterval(()=>{
    const left=(F.end-Date.now())/1000, c=document.getElementById("fclock");
    if(c) c.textContent=fmt(left);
    if(F.half&&left<=F.half){F.half=null; beep(880,.25); const w=document.getElementById("fswitch"); if(w) w.innerHTML="<b>Switch sides now</b>";}
    if(left<=3.05&&left>2.8||left<=2.05&&left>1.8||left<=1.05&&left>.8) beep(660,.06);
    if(left<=0){clearInterval(F.t); beep(990,.2); if(F.done){const d=F.done;F.done=null;d()} else {F.i++; show();}}
  },200);
}
function togglePause(){
  if(!F.paused){F.left=(F.end-Date.now())/1000; clearInterval(F.t); F.paused=true; F.pausedAt=Date.now(); fPrim.textContent="Resume";}
  else {F.paused=false; if(F.run) F.run.paused+=Date.now()-F.pausedAt; fPrim.textContent="Pause"; countdown(F.left);}
}
document.getElementById("fclose").onclick=stopFollow;
document.getElementById("fback").onclick=()=>{if(F.i>0){F.i--; if(F.seq[F.i].k==="rest"&&F.i>0) F.i--; show();}};
document.getElementById("fskip").onclick=()=>{if(F.i<F.seq.length){F.i++;show()}};
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&fEl.classList.contains("on")) stopFollow()});

/* ---------- Saved workouts and evaluations (needs the database API of tools/serve.py) ---------- */
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
async function call(method,path,body){
  const r=await fetch("api/"+path,{method,headers:{"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
  const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.error||`${r.status} ${r.statusText}`); return j;
}
const estimateSecs=w=>sequence(w).reduce((a,x)=>a+(x.k==="set"?SET_SECS:x.secs),0);
const dateLabel=iso=>new Date(iso).toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"});
const stars=n=>n?"★".repeat(Math.round(n))+"☆".repeat(5-Math.round(n)):"";
const FEEL={too_short:"Too short",about_right:"About right",too_long:"Too long"};

// The workout in the shape api.save_workout expects: blocks in order, each move with its
// prescription, time estimate and the equipment option it uses.
function toDB(w,name){
  const lv=w.settings.level, R=RESTS[lv-1], kit=kitOf(w.blocks.flatMap(b=>b.items.map(i=>i.id)),w.settings).have;
  const gear=id=>reqs(BY[id]).map(r=>{const a=r.split("|");return a.find(q=>kit.has(q))||a.find(q=>w.settings.equip.includes(q))||a[0]});
  const timed=(id,d)=>({id,pat:BY[id].p,prescription:`${holdSecs(id,d)}s`,hold:holdSecs(id,d),est:holdSecs(id,d),equipment:gear(id)});
  const set=it=>{const p=reps(it.id,lv),m=/^(\d+)s( each side)?$/.exec(p||"");return {id:it.id,pat:it.pat,prescription:p,hold:m?+m[1]:null,est:SET_SECS,equipment:gear(it.id)}};
  return {name,estimated_seconds:estimateSecs(w),settings:w.settings,blocks:[
    {kind:"warmup",name:"Warm-up",rounds:1,items:w.warm.map(id=>timed(id,WARM_SECS))},
    ...w.blocks.map(b=>({kind:b.course?"course":b.name==="Grip finisher"?"grip":"main",name:b.name,rounds:b.rounds,
      rest_ex:b.course?0:R.ex,rest_round:b.course?90:R.round,items:b.items.map(set)})),
    {kind:"cooldown",name:"Cool-down",rounds:1,items:w.cool.map(id=>timed(id,COOL_SECS))}]};
}

function saveHTML(){
  if(!API.on) return "";
  if(W.savedId) return `<p class="saveline">Saved as <b>${esc(W.name)}</b>. <button class="linkbtn" id="evalBtn">Evaluate it</button></p>`;
  return `<form class="saveform" id="saveForm"><label for="wname">${W.editedFrom?`Changed since you saved it as “${esc(W.editedFrom)}”. Save as a new workout:`:"Like it? Save it to do again and evaluate later."}</label>
    <div><input id="wname" name="name" required maxlength="80" autocomplete="off" placeholder="Name, e.g. Tuesday legs"><button>Save workout</button></div>
    <p class="err" id="saveErr" role="alert"></p></form>`;
}
async function saveCurrent(e){
  e.preventDefault();
  const name=document.getElementById("wname").value.trim(), err=document.getElementById("saveErr");
  if(!name){err.textContent="Give the workout a name first."; return}
  try{
    const {id}=await call("POST","workouts",toDB(W,name));
    W.savedId=id; W.name=name; W.sessions=[]; delete W.editedFrom; save("fbw-workout",W); render(); loadSaved();
  }catch(x){err.textContent=x.message}
}

function evalsHTML(){
  if(!API.on||!W.savedId||!W.sessions||!W.sessions.length) return "";
  const crit=DATA.criteria||[];
  return `<section class="sec"><h2>Your evaluations</h2><ul class="evals">${W.sessions.map(s=>{
    const d=s.delta_seconds, mins=s.active_seconds?Math.round(s.active_seconds/60):null;
    return `<li><b>${dateLabel(s.started_at)}</b> ${s.stars?`<span class="stars" aria-label="${s.stars} of 5 stars">${stars(s.stars)}</span>`:""}
      <small>${mins?`${mins} min (${d>0?"+":""}${Math.round(d/60)} vs estimate)`:"Time not recorded"}${s.time_feel?`, felt ${FEEL[s.time_feel].toLowerCase()}`:""}${s.completed?"":", not finished"}</small>
      ${crit.filter(c=>s.scores[c.code]).length?`<small>${crit.filter(c=>s.scores[c.code]).map(c=>`${esc(c.name)} ${s.scores[c.code]}/5`).join(" · ")}</small>`:""}
      ${s.comments.map(c=>`<q>${esc(c)}</q>`).join("")}</li>`}).join("")}</ul></section>`;
}

const savedEl=document.getElementById("saved");
let savedOpen=false;
async function loadSaved(){
  if(!API.on) return;
  let list;
  try{list=await call("GET","workouts")}catch(x){savedEl.hidden=false; savedEl.innerHTML=`<p class="err">Couldn't load saved workouts: ${esc(x.message)}</p>`; return}
  savedEl.hidden=false;
  savedEl.innerHTML=`<details id="savedBox"${savedOpen?" open":""}><summary><span class="nm">Saved workouts<small>${list.length?`${list.length} saved`:"Nothing saved yet"}</small></span><span class="chev" aria-hidden="true"></span></summary>
    ${list.length?`<ul class="savedlist">${list.map(w=>`<li><div class="nm">${esc(w.name)}<small>${dateLabel(w.created_at)} · ${LEVEL_NAMES[w.level-1]} · ${w.duration} min hard work<br>${w.sessions?`${w.sessions} evaluation${w.sessions>1?"s":""}${w.avg_stars?` · <span class="stars">${stars(w.avg_stars)}</span> ${w.avg_stars}`:""}`:"Not evaluated yet"}</small></div>
      <div class="rowbtns"><button data-open="${w.id}">Open</button><button data-eval="${w.id}" data-name="${esc(w.name)}" data-est="${w.estimated_seconds}">Evaluate</button><button data-del="${w.id}" data-name="${esc(w.name)}" class="del">Delete</button></div></li>`).join("")}</ul>`
      :`<p class="note">Build a workout and save it with a name; it will show up here.</p>`}</details>`;
  document.getElementById("savedBox").addEventListener("toggle",e=>savedOpen=e.target.open);
}
savedEl.addEventListener("click",async e=>{
  const b=e.target.closest("button"); if(!b) return;
  try{
    if(b.dataset.open) await openSaved(+b.dataset.open);
    else if(b.dataset.eval) openEval(+b.dataset.eval,b.dataset.name,+b.dataset.est);
    else if(b.dataset.del&&confirm(`Delete “${b.dataset.name}” and its evaluations?`)){
      await call("DELETE",`workouts/${b.dataset.del}`);
      if(W&&W.savedId===+b.dataset.del){delete W.savedId; delete W.name; delete W.sessions; save("fbw-workout",W); render()}
      loadSaved();
    }
  }catch(x){alert(x.message)}
});
async function openSaved(id){
  const w=await call("GET",`workouts/${id}`);
  W={settings:w.settings,warm:w.warm,cool:w.cool,blocks:w.blocks,savedId:w.id,name:w.name,sessions:w.sessions};
  save("fbw-workout",W); render();
  plan.scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});
}

/* Evaluation dialog: date, actual time, how the length felt, stars, a 1-5 score per criterion, comment. */
const dlg=document.getElementById("evalDlg");
function pickHTML(name,opts,label){
  return `<fieldset class="pick"><legend>${label}</legend><div class="seg">${opts.map(([v,t])=>`<label><input type="radio" name="${name}" value="${v}"><span>${t}</span></label>`).join("")}</div></fieldset>`;
}
function openEval(id,name,estSecs){
  const run=W&&W.savedId===id&&W.lastRun, today=new Date(), iso=d=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
  dlg.innerHTML=`<form method="dialog" id="evalForm">
    <h2 id="evalTitle">Evaluate “${esc(name)}”</h2>
    <div class="row2"><label>Date<input type="date" name="date" required value="${iso(run?new Date(run.started_at):today)}" max="${iso(today)}"></label>
      <label>Actual time, minutes<input type="number" name="minutes" min="1" max="300" inputmode="numeric" value="${run?run.minutes:""}" placeholder="${Math.round(estSecs/60)}"></label></div>
    <p class="hint">Estimated about ${Math.round(estSecs/60)} minutes in total.${run?" Pre-filled from your follow-along run.":""}</p>
    <label class="check"><input type="checkbox" name="completed" checked> I finished the whole workout</label>
    ${pickHTML("feel",Object.entries(FEEL),"The length felt")}
    ${pickHTML("stars",[1,2,3,4,5].map(n=>[n,`${n} ★`]),"Overall rating, 1 to 5 stars")}
    ${(DATA.criteria||[]).map(c=>`<fieldset class="pick crit"><legend>${esc(c.name)}</legend><div class="scale"><div class="seg">${[1,2,3,4,5].map(n=>`<label><input type="radio" name="c_${c.code}" value="${n}"><span>${n}</span></label>`).join("")}</div><div class="ends"><small>1: ${esc(c.low)}</small><small>5: ${esc(c.high)}</small></div></div></fieldset>`).join("")}
    <label>Comment<textarea name="comment" rows="3" maxlength="2000" placeholder="What worked, what didn't, what to change next time"></textarea></label>
    <p class="err" id="evalErr" role="alert"></p>
    <div class="actions"><button type="button" id="evalCancel">Cancel</button><button class="go" value="save">Save evaluation</button></div></form>`;
  document.getElementById("evalCancel").onclick=()=>dlg.close();
  document.getElementById("evalForm").onsubmit=async e=>{
    e.preventDefault();
    const f=new FormData(e.target), scores={};
    (DATA.criteria||[]).forEach(c=>{if(f.get("c_"+c.code)) scores[c.code]=+f.get("c_"+c.code)});
    const day=f.get("date"), started=run&&iso(new Date(run.started_at))===day?run.started_at:new Date(day+"T12:00:00").toISOString();
    try{
      await call("POST",`workouts/${id}/evaluations`,{started_at:started,active_minutes:f.get("minutes")||null,completed:f.get("completed")==="on",
        time_feel:f.get("feel")||null,stars:f.get("stars")?+f.get("stars"):null,scores,comment:f.get("comment")});
      dlg.close();
      if(W&&W.savedId===id){W.sessions=(await call("GET",`workouts/${id}`)).sessions; delete W.lastRun; save("fbw-workout",W); render()}
      loadSaved();
    }catch(x){document.getElementById("evalErr").textContent=x.message}
  };
  dlg.showModal();
}

// Turn the database features on only when the local server's API answers.
call("GET","workouts").then(()=>{API.on=true; loadSaved(); render()}).catch(()=>{});
