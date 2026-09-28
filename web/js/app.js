/* Full-body workout builder: app logic. All data comes from the database: GET /api/catalog from tools/serve.py, or inlined by tools/build.py. */
/* ---------- Exercise library ---------- */
const DATA = window.WORKOUT_DATA;
// Saving and evaluating need the database API of tools/serve.py; switched on at the end if it answers.
const API={on:false};
// The catalogue uses readable field names; the app uses short ones internally.
const FIELD_MAP={id:"id",name:"n",pattern:"p",also_pattern:"p2",level:"l",equipment:"e",reps:"r",steps:"s",cue:"c",avoid:"x",combo:"cb",slow_to_fast:"ct",partner:"pt",sprint:"sp",secs:"t",switch_sides:"sw",retired:"rt"};
const LIB = DATA.exercises.map(x=>{const o={};for(const[k,v]of Object.entries(x)){if(FIELD_MAP[k])o[FIELD_MAP[k]]=v;}return o;});
const BY = Object.fromEntries(LIB.map(x=>[x.id,x]));

/* ---------- Level and equipment buttons (from data) ---------- */
document.querySelector('[data-key="level"]').innerHTML=DATA.levels.map(l=>`<button data-v="${l.id}">${l.name}</button>`).join("");
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
// Rest seconds and rounds per block, by level.
const RESTS=DATA.levels.map(l=>({ex:l.ex,round:l.round,rounds:l.rounds}));
const LEVEL_NAMES=DATA.levels.map(l=>l.name);
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
    blocks.push({name:"Block "+"ABCDE"[i],rounds:RESTS[s.level-1].rounds,items});
  }
  if(oc.length) blocks.unshift({name:"Obstacle course",rounds:1,course:true,items:oc});
  if(g.length) blocks.push({name:"Grip finisher",rounds:2,items:g.map(id=>({id,pat:"grip"}))});
  // Warm-up: pulse raiser, full-body flow, two mobility drills, then a second pulse raiser.
  // The id lists per role come from the database (exercise_phase_role); moves the settings rule out are dropped.
  const role=r=>shuffle((DATA.phases[r]||[]).filter(id=>BY[id]&&ok(BY[id],s)));
  const pulse=role("pulse"),flow=role("flow"),mob=role("mob");
  const warm=[pulse[0],flow[0],mob[0],mob[1],pulse[1]];
  // Cool-down: two short stretches, yin holds (more for longer workouts), then a calm finish.
  const stretch=role("stretch"),yin=role("yin"),calm=role("calm");
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

/* ---------- Figures: movement drawings from pose data (DATA.poses, DATA.figures) ----------
   Self-contained between these markers: tools/figures.py copies this section into its review pages.
   World units are about cm, y points up, the floor is y=0 and the figure faces +x.
   Limb angles: 0 down, 90 forward, 180 up, -90 back. Torso and head: 0 upright, positive leans forward.
   A limb is {to:[x,y],bend} (two-bone IK, joint bends f/b/u/d), {a:[upper,lower]} (angles) or {j,to} (joints given).
   front:true draws the figure facing you (both sides in the near colour, legs from the hips' sides, arms from the shoulders' ends).
   hold: bb (bar on back), fr (bar across the front of the shoulders), bbh (bar in the hands), kb / kb2 (bell hangs along the forearm),
   kbr / kbr2 (one / two bells racked at the chest), zbb / zsb (bar / sandbag in the crook of the elbows, Zercher), eq (bells hung from the bar ends), goblet, db1 / db2 (dumbbell in one / both hands), sb (sandbag), med (ball), pl (plate edge-on),
   vest, band (feet to hands), trx / rope (anchor to hands), lm (landmine; needs anchor), bbl (bar seen lengthwise, plates edge-on),
   hammer (sledgehammer along the forearm), jr (jump rope).
   Scene items (scene.items; one kind per item): fig (pose name or {pose,x,y,...overrides}; x/y shift everything, overrides included; +ghost),
   bike [crankX,handleAngle,tilt] (echo/air bike: crank at y=38, seat top y=101, handle pivot at crankX+22,70 with a 60-long handle, fan in front; tilt>0 tips it onto its front wheels), rower [rearX,seatX,dir] (rowing machine: rail from rearX, flywheel 200 away in direction dir, seat top at y=28), kb [x,y], db [x,y] (dumbbell lying on the floor, centre at x,y; y=8 rests it on the floor), plate [x,y] (+r), box [x,w,h], bench [x,w,h], rack {x,top,hook,pin}, bar [x,y] (pull-up bar), wall [x,side], bosu [x,flatSideUp],
   ball [x,y,r], sled [x,handleHeight], tire [x,angle,w,h], ghd [x,rollerDist], slab [x,y,len,angle] (plate or towel edge-on), sb [x,y], medb [x,y],
   bbl [x,y] (bar lengthwise), anchor [x,y], line [[x,y],...] (strap/band/rope), guide [[x,y],...] (dashed), arrow [[x,y],...] (+dash/faint),
   swap [x,y], label [x,y,text]. Top view (scene.top): pb [x,y,angle] (parallette), sq [x,y,size] (box), me [x,y] (person). */
const FIG=(()=>{
  const L={th:43,sh:42,ft:17,ua:29,fa:27,to:50,nk:4,hr:10.5}, POSES=DATA.poses||{}, FIGS=DATA.figures||{};
  const rad=d=>d*Math.PI/180, dir=a=>[Math.sin(rad(a)),-Math.cos(rad(a))], upv=t=>[Math.sin(rad(t)),Math.cos(rad(t))];
  const add=(p,v,k=1)=>[p[0]+v[0]*k,p[1]+v[1]*k], sub=(a,b)=>[a[0]-b[0],a[1]-b[1]], len=v=>Math.hypot(v[0],v[1]);
  const unit=v=>{const d=len(v)||1;return [v[0]/d,v[1]/d]}, perp=v=>[-v[1],v[0]], isPt=o=>Array.isArray(o)&&o.length===2&&typeof o[0]==="number";
  const mapPts=(o,f,k)=>k==="a"?o:isPt(o)?f(o):Array.isArray(o)?o.map(x=>mapPts(x,f)):o&&typeof o==="object"?Object.fromEntries(Object.entries(o).map(([k,v])=>[k,mapPts(v,f,k)])):o;
  const mapAll=(o,f)=>isPt(o)?f(o):o&&typeof o==="object"?Object.fromEntries(Object.entries(o).map(([k,v])=>[k,mapAll(v,f)])):o; // solved joints: every point, ankles (a) included
  const r1=v=>Math.round(v*10)/10, P=p=>`${r1(p[0])},${r1(p[1])}`;
  const pl=(pts,c)=>`<polyline class="${c}" points="${pts.map(P).join(" ")}"/>`, circ=(c,r,k)=>`<circle class="${k}" cx="${r1(c[0])}" cy="${r1(c[1])}" r="${r}"/>`;
  // A figure is a pose name, {pose,x,y,...overrides} (x/y shift the whole pose) or a full pose with its own hip.
  const pose=f=>{if(typeof f==="string") f={pose:f};const {pose:n,x=0,y=0,...o}=f,p={...(n?POSES[n]:{}),...o};return x||y?mapPts(p,q=>[q[0]+x,q[1]+y]):p};
  function ik(R,T,l1,l2,b){
    const u=unit(sub(T,R)),d=len(sub(T,R)); if(d>=l1+l2) return [add(R,u,l1),add(R,u,l1+l2)];
    const dd=Math.max(d,Math.abs(l1-l2)+.01),a=(l1*l1-l2*l2+dd*dd)/(2*dd),h=Math.sqrt(Math.max(0,l1*l1-a*a)),m=add(R,u,a),c=[add(m,perp(u),h),add(m,perp(u),-h)];
    const k={f:j=>j[0],b:j=>-j[0],u:j=>j[1],d:j=>-j[1]}[b]; return [k(c[0])>=k(c[1])?c[0]:c[1],T];
  }
  const limb=(R,s,l1,l2,b)=>s.j?[s.j,s.to]:s.a?(j=>[j,add(j,dir(s.a[1]),l2)])(add(R,dir(s.a[0]),l1)):ik(R,s.to,l1,l2,s.bend||b);
  // Front view: the far side is the near side mirrored, unless given.
  const mir=(s,c)=>s&&(s.j||s.to?{...s,to:s.to&&[2*c-s.to[0],s.to[1]],j:s.j&&[2*c-s.j[0],s.j[1]],toe:s.toe&&[2*c-s.toe[0],s.toe[1]],bend:{f:"b",b:"f"}[s.bend]||s.bend||"b",ft:s.ft!=null?-s.ft:undefined}:s.a?{...s,a:[-s.a[0],-s.a[1]]}:s);
  function solve(p){
    const H=p.hip,t=p.t||0,S=add(H,upv(t),L.to),fv=!!p.front,w=fv?9:0,sw=fv?17:0;
    const ln=p.ln||{to:[H[0]+(fv?12:0),0],ft:fv?80:90}, lf=p.lf||(fv?mir(ln,H[0]):ln), an=p.an||(fv?{a:[8,4]}:{a:[0,0]}), af=p.af||(fv?mir(an,S[0]):an);
    const leg=(s,R)=>{const [k,a]=limb(R,s,L.th,L.sh,"f");return {k,a,toe:s.toe||add(a,dir(s.ft??90),fv?8:L.ft),R}}, arm=(s,R,b)=>{const [e,h]=limb(R,s,L.ua,L.fa,b);return {e,h,R}};
    let J={H,S,t,fv,Hd:add(S,upv(t+(p.hd||0)),L.nk+L.hr),ln:leg(ln,add(H,[w,0])),lf:leg(lf,add(H,[-w,0])),an:arm(an,add(S,[sw,0]),fv?"f":"b"),af:arm(af,add(S,[-sw,0]),"b"),
      bar:add(S,[-Math.cos(rad(t)),Math.sin(rad(t))],7),fr:add(S,[Math.cos(rad(t)),-Math.sin(rad(t))],9)};
    return p.flip?mapAll(J,q=>[2*H[0]-q[0],q[1]]):J;
  }
  // Bounds are collected while drawing, so all drawings of one exercise can share a scale.
  function Box(){this.lo=[1e9,1e9];this.hi=[-1e9,-1e9];this.txt=[]}
  Box.prototype.pt=function(p,r=0){this.lo=[Math.min(this.lo[0],p[0]-r),Math.min(this.lo[1],p[1]-r)];this.hi=[Math.max(this.hi[0],p[0]+r),Math.max(this.hi[1],p[1]+r)]};
  const plate=(c,r,B)=>(B.pt(c,r),circ(c,r,"fg-eq")+circ(c,3.2,"fg-eqf"));
  const kb=(h,v,B)=>{const c=add(h,v,15),w=perp(v);B.pt(c,10.5);return pl([add(add(h,w,6),v,4),h,add(add(h,w,-6),v,4)],"fg-eqs")+pl([h,add(h,v,6)],"fg-eqs")+circ(c,10.5,"fg-eq")};
  const db=(h,v,B)=>{const w=perp(v),head=q=>{const s=[[-4.5,8],[4.5,8],[4.5,-8],[-4.5,-8]].map(([i,j])=>add(add(q,v,i),w,j));s.forEach(x=>B.pt(x));return `<polygon class="fg-eq" points="${s.map(P).join(" ")}"/>`};
    return pl([add(h,v,-12),add(h,v,12)],"fg-eqs")+head(add(h,v,-12))+head(add(h,v,12))};
  const sandbag=(c,B)=>(B.pt(c,19),`<rect class="fg-eq" x="${r1(c[0]-19)}" y="${r1(c[1]-11)}" width="38" height="22" rx="11"/>`);
  const edge=(c,ang,l,B)=>{const v=[Math.cos(rad(ang)),Math.sin(rad(ang))],a=add(c,v,-l/2),b=add(c,v,l/2);B.pt(a,3);B.pt(b,3);return pl([a,b],"fg-edge")};
  const strap=(a,h,B)=>(B.pt(a),pl([a,h],"fg-strap"));
  const barLong=(c,B)=>pl([add(c,[-64,0]),add(c,[64,0])],"fg-eqs")+edge(add(c,[-56,0]),90,44,B)+edge(add(c,[56,0]),90,44,B);
  const landmine=(A,h,B)=>{const v=unit(sub(A,h));B.pt(add(A,[-9,0]));B.pt(add(A,[9,8]));return `<polygon class="fg-eq" points="${P(add(A,[-9,0]))} ${P(add(A,[9,0]))} ${P(add(A,[0,8]))}"/>`+pl([h,A],"fg-eqs")+plate(add(h,v,20),17,B)};
  function figure(f,B,ghost){
    const p=pose(f),J=solve(p),w=p.who||1,n=`fg-n${w}`,fr=J.fv?n:`fg-f${w}`,ln=[J.ln.R,J.ln.k,J.ln.a,J.ln.toe],lf=[J.lf.R,J.lf.k,J.lf.a,J.lf.toe],an=[J.an.R,J.an.e,J.an.h],af=[J.af.R,J.af.e,J.af.h];
    [...ln,...lf,...an,...af].forEach(q=>B.pt(q,4)); B.pt(J.Hd,L.hr);
    const h=p.hold, fade=x=>`<g opacity=".55">${x}</g>`, fa=unit(sub(J.an.h,J.an.e)), ff=unit(sub(J.af.h,J.af.e));
    let back=h==="bb"?plate(J.bar,21,B):"", glow="", mid="", front="";
    if(!ghost) (p.hi||[]).forEach(k=>glow+=pl({torso:[J.H,J.S],ln,lf,an,af}[k],"fg-hi"));
    if(h==="lm") mid=landmine(p.anchor,J.an.h,B);
    if(h==="sb") mid=sandbag(J.an.h,B);
    if(h==="vest") mid=pl([add(J.H,upv(J.t),22),add(J.H,upv(J.t),46)],"fg-vest");
    if(h==="fr") back=plate(J.fr,21,B);
    if(h==="bbh") front=plate(J.an.h,21,B);
    if(h==="kb") front=kb(J.an.h,fa,B);
    if(h==="kb2") front=fade(kb(J.af.h,ff,B))+kb(J.an.h,fa,B);
    if(h==="zsb") mid=sandbag(J.an.e,B);
    if(h==="bbl") front=barLong(J.an.h,B);
    if(h==="hammer"){const e=add(J.an.h,fa,62),w=perp(fa);B.pt(e,12);front=pl([add(J.an.h,fa,-6),e],"fg-eqs")+`<polygon class="fg-eq" points="${[add(add(e,w,12),fa,5),add(add(e,w,12),fa,-5),add(add(e,w,-12),fa,-5),add(add(e,w,-12),fa,5)].map(P).join(" ")}"/>`}
    if(h==="jr") mid=(()=>{const lo=Math.min(J.ln.a[1],J.lf.a[1]),q=[J.an.h,add(J.an.h,[14,-40]),[J.H[0]+22,lo-4],[J.H[0]-22,lo-4],add(J.af.h,[-14,-40]),J.af.h];q.forEach(x=>B.pt(x));
      let d=`M${P(q[0])}`;for(let i=1;i<q.length-1;i+=2)d+=` Q${P(q[i])} ${P(add(q[i],sub(q[i+1],q[i]),.5))}`;return `<path class="fg-strap" d="${d} L${P(q[q.length-1])}"/>`})();
    if(h==="zbb") back=plate(J.an.e,21,B);
    if(h==="eq") back=strap(J.bar,add(J.bar,[0,-14]),B)+kb(add(J.bar,[0,-14]),[0,-1],B);
    if(h==="kbr") front=kb(J.an.h,unit([.35,-1]),B);
    if(h==="kbr2") front=fade(kb(J.af.h,unit([.35,-1]),B))+kb(J.an.h,unit([.35,-1]),B);
    if(h==="goblet") front=kb(J.an.h,[0,-1],B);
    if(h==="db1") front=db(J.an.h,J.fv?[0,1]:[1,0],B);
    if(h==="db2") front=fade(db(J.af.h,[1,0],B))+db(J.an.h,[1,0],B);
    if(h==="med") front=(B.pt(J.an.h,12),circ(J.an.h,12,"fg-eq"));
    if(h==="pl") front=edge(J.an.h,90,42,B);
    if(h==="band") mid=strap(add(J.ln.a,sub(J.ln.toe,J.ln.a),.5),J.an.h,B)+(J.fv?strap(add(J.lf.a,sub(J.lf.toe,J.lf.a),.5),J.af.h,B):"");
    if(h==="trx"||h==="rope") mid=fade(strap(p.anchor,J.af.h,B))+strap(p.anchor,J.an.h,B)+(h==="trx"?pl([add(J.an.h,[0,-5]),add(J.an.h,[0,5])],"fg-eqs"):"");
    const trunk=J.fv?pl([add(J.S,[-17,0]),add(J.S,[17,0])],`fg-limb ${n}`)+pl([add(J.H,[-9,0]),add(J.H,[9,0])],`fg-limb ${n}`):"";
    const s=back+glow+pl(af,`fg-limb ${fr}`)+pl(lf,`fg-limb ${fr}`)+pl([J.H,J.S],`fg-torso ${n}`)+trunk+pl([J.S,J.Hd],`fg-limb ${n}`)+circ(J.Hd,L.hr,`fg-head ${n}`)+mid+pl(ln,`fg-limb ${n}`)+pl(an,`fg-limb ${n}`)+front;
    return ghost?`<g class="fg-ghost">${s}</g>`:s;
  }
  // A smooth curve through the points (Catmull-Rom), with a head at the end.
  function arrow(pts,B,cls){
    pts.forEach(q=>B.pt(q,5)); const e=[pts[0],...pts,pts[pts.length-1]]; let d=`M${P(pts[0])}`,c2=pts[0];
    for(let i=1;i<e.length-2;i++){const c1=add(e[i],sub(e[i+1],e[i-1]),1/6);c2=add(e[i+1],sub(e[i+2],e[i]),-1/6);d+=` C${P(c1)} ${P(c2)} ${P(e[i+1])}`}
    const end=pts[pts.length-1],v=unit(sub(end,len(sub(end,c2))>.5?c2:pts[pts.length-2])),w=perp(v);
    return `<g class="${cls}"><path class="fg-arr" d="${d}"/><polygon class="fg-arrh" points="${[add(end,v,3),add(add(end,v,-7),w,5),add(add(end,v,-7),w,-5)].map(P).join(" ")}"/></g>`;
  }
  const swap=(c,B)=>{const arc=(a0,a1)=>[0,1,2,3].map(i=>add(c,[Math.cos(rad(a0+(a1-a0)*i/3)),Math.sin(rad(a0+(a1-a0)*i/3))],11));return arrow(arc(200,340),B,"")+arrow(arc(20,160),B,"")};
  function scene(sc,B){
    let s="";
    for(const it of sc.items){
      const k=it.fig?figure(it.fig,B,it.ghost):it.kb?kb(it.kb,[0,-1],B):it.plate?plate(it.plate,it.r||21,B)
        :it.arrow?arrow(it.arrow,B,[it.dash&&"fg-dash",it.faint&&"fg-faint"].filter(Boolean).join(" "))
        :it.swap?swap(it.swap,B):it.guide?(it.guide.forEach(q=>B.pt(q)),pl(it.guide,"fg-guide")):"";
      if(k){s+=it.ghost&&!it.fig?`<g class="fg-ghost">${k}</g>`:k;continue}
      if(it.box){const [x,w,h]=it.box;B.pt([x,0]);B.pt([x+w,h]);s+=`<rect class="fg-eq" x="${x}" y="0" width="${w}" height="${h}" rx="2"/>`}
      else if(it.rack){const {x,top,hook,pin}=it.rack;B.pt([x-22,0]);B.pt([x+22,top]);
        s+=pl([[x,0],[x,top]],"fg-eqs")+pl([[x-20,0],[x+20,0]],"fg-eqs")+pl([[x,hook-3],[x-11,hook-3],[x-11,hook+5]],"fg-eqs")+pl([[x-26,pin],[x+12,pin]],"fg-eqs")}
      else if(it.bar){const b=it.bar;B.pt(add(b,[-10,20]));B.pt(add(b,[10,-5]));s+=pl([b,add(b,[0,18])],"fg-eqs")+pl([add(b,[-10,18]),add(b,[10,18])],"fg-eqs")+circ(b,4.5,"fg-eqf")}
      else if(it.label){const [x,y,t]=it.label;B.pt([x,y]);B.txt.push({x,y,t})}
      else if(it.wall){const [x,side=-1]=it.wall;B.pt([x+side*8,0]);B.pt([x,200]);s+=pl([[x,0],[x,200]],"fg-eqs")+[20,60,100,140,180].map(y=>pl([[x,y],[x+side*7,y-7]],"fg-eqs fg-thin")).join("")}
      else if(it.bench){const [x,w,h]=it.bench;B.pt([x,0]);B.pt([x+w,h]);s+=`<rect class="fg-eq" x="${x}" y="${h-7}" width="${w}" height="7" rx="2"/>`+pl([[x+6,0],[x+6,h-7]],"fg-eqs")+pl([[x+w-6,0],[x+w-6,h-7]],"fg-eqs")}
      else if(it.bosu){const [x,flat]=it.bosu;B.pt([x-31,0]);B.pt([x+31,21]);
        s+=flat?`<path class="fg-eq" d="M${x-30},17 A30,17 0 0 1 ${x+30},17 Z"/><rect class="fg-eq" x="${x-31}" y="17" width="62" height="4" rx="1.5"/>`:`<path class="fg-eq" d="M${x-30},0 A30,20 0 0 0 ${x+30},0 Z"/>`}
      else if(it.ball){const [x,y,r]=it.ball;s+=plate([x,y],r,B).replace(/<circle class="fg-eqf"[^>]*>/,"")}
      else if(it.sled){const [x,hh=34]=it.sled;B.pt([x-26,0]);B.pt([x+26,hh]);s+=`<polygon class="fg-eq" points="${x-26},0 ${x+26},0 ${x+20},16 ${x-20},16"/>`+pl([[x,16],[x,hh]],"fg-eqs")+(hh>40?pl([[x-10,hh],[x,hh]],"fg-eqs"):"")+plate([x,25],9,B)}
      else if(it.sb) s+=sandbag(it.sb,B);
      else if(it.db) s+=db(it.db,[1,0],B);
      else if(it.bike){const [x,a=-15,tilt=0]=it.bike,hp=[x+22,70],ht=add(hp,[Math.sin(rad(a)),Math.cos(rad(a))],60);B.pt([x-72,0]);B.pt([x+88,tilt?150:130]);
        const g=pl([[x-70,0],[x+80,0]],"fg-eqs")+pl([[x-44,4],[x-30,94]],"fg-eqs")+pl([[x-44,4],[x+30,56]],"fg-eqs")+`<rect class="fg-eq" x="${x-46}" y="93" width="32" height="8" rx="3"/>`
          +circ([x+52,52],34,"fg-eq")+circ([x+52,52],6,"fg-eqf")+circ([x,38],16,"fg-eq")+pl([[x+36,60],[x+48,60]],"fg-eqs")+pl([hp,ht],"fg-eqs");
        s+=tilt?`<g transform="rotate(${-tilt} ${x+80} 0)">${g}</g>`:g}
      else if(it.rower){const [x,sx,d=1]=it.rower,f=x+d*200;B.pt([x-4,0]);B.pt([f+d*40,96]);
        s+=pl([[x,0],[x,16],[f,16]],"fg-eqs")+`<rect class="fg-eq" x="${Math.min(f,f+d*36)}" y="0" width="36" height="46" rx="10"/>`+circ([f+d*18,26],13,"fg-eqf")+pl([[f,40],[f-d*14,92]],"fg-eqs")+`<rect class="fg-eq" x="${sx-16}" y="18" width="32" height="10" rx="4"/>`}
      else if(it.medb){B.pt(it.medb,12);s+=circ(it.medb,12,"fg-eq")}
      else if(it.tire){const [px,a=0,w=110,h=26]=it.tire,ro=v=>[px+v[0]*Math.cos(rad(a))+v[1]*Math.sin(rad(a)),-v[0]*Math.sin(rad(a))+v[1]*Math.cos(rad(a))],c=[[-w,0],[0,0],[0,h],[-w,h]].map(ro);
        c.forEach(q=>B.pt(q));s+=`<polygon class="fg-eq fg-tire" points="${c.map(P).join(" ")}"/>`+pl([ro([-w+8,h/2]),ro([-8,h/2])],"fg-eqs fg-thin")}
      else if(it.ghd){const [x,rx=92]=it.ghd;B.pt([x-rx-8,0]);B.pt([x+20,114]);
        s+=pl([[x,0],[x,82]],"fg-eqs")+pl([[x-rx,0],[x-rx,86]],"fg-eqs")+pl([[x-rx,40],[x,40]],"fg-eqs")+pl([[x-30,0],[x+20,0]],"fg-eqs")+`<rect class="fg-eq" x="${x-14}" y="82" width="30" height="16" rx="8"/>`+circ([x-rx,92],6,"fg-eq")+circ([x-rx,108],6,"fg-eq")}
      else if(it.bbl) s+=barLong(it.bbl,B);
      else if(it.line){it.line.forEach(q=>B.pt(q));s+=pl(it.line,"fg-strap")}
      else if(it.slab){const [x,y,l,a=0]=it.slab;s+=edge([x,y],a,l,B)}
      else if(it.anchor){const a=it.anchor;B.pt(add(a,[-8,-4]));B.pt(add(a,[8,8]));s+=pl([add(a,[-8,8]),add(a,[8,8])],"fg-eqs")+pl([a,add(a,[0,8])],"fg-eqs")}
      // top view: parallettes [x,y,angle], square boxes [x,y,size], and "me" (a person seen from above)
      else if(it.pb){const [x,y,a]=it.pb,v=[Math.cos(rad(a)),Math.sin(rad(a))],e1=add([x,y],v,-17),e2=add([x,y],v,17);B.pt(e1,5);B.pt(e2,5);
        s+=pl([e1,e2],"fg-eqs")+[e1,e2].map(e=>pl([add(e,perp(v),5),add(e,perp(v),-5)],"fg-eqs")).join("")}
      else if(it.sq){const [x,y,w]=it.sq;B.pt([x-w/2,y-w/2]);B.pt([x+w/2,y+w/2]);s+=`<rect class="fg-eq" x="${x-w/2}" y="${y-w/2}" width="${w}" height="${w}" rx="3"/>`}
      else if(it.me){const [x,y]=it.me;B.pt([x,y],9);s+=`<ellipse class="fg-me" cx="${x}" cy="${y}" rx="5" ry="9"/>`+circ([x+1,y],4.5,"fg-head fg-n1")}
    }
    return s;
  }
  // SVGs for an exercise's drawings: [{steps:[first,last], top, svg}]. Side and top views each share one viewBox.
  // px: roughly how wide a side-view drawing will be shown, so labels come out about 12px (top views twice that).
  function of(id,px=240){
    const figs=FIGS[id]||[], out=figs.map(f=>{const B=new Box();return {steps:f.steps,top:!!f.scene.top,body:scene(f.scene,B),B}});
    for(const top of [false,true]){
      const g=out.filter(o=>o.top===top); if(!g.length) continue;
      const lo=[Math.min(...g.map(o=>o.B.lo[0])),Math.min(...g.map(o=>o.B.lo[1]))], hi=[Math.max(...g.map(o=>o.B.hi[0])),Math.max(...g.map(o=>o.B.hi[1]))];
      const fs=(hi[0]-lo[0]+24)*12/(top?px*2:px);
      g.forEach(o=>o.B.txt.forEach(l=>{lo[0]=Math.min(lo[0],l.x-l.t.length*fs*.27);hi[0]=Math.max(hi[0],l.x+l.t.length*fs*.27);hi[1]=Math.max(hi[1],l.y+fs)}));
      const x0=lo[0]-12,x1=hi[0]+12,y0=top?lo[1]-12:Math.min(lo[1],0)-9,y1=hi[1]+12,vb=`${r1(x0)} ${r1(-y1)} ${r1(x1-x0)} ${r1(y1-y0)}`;
      const floor=top?"":`<rect class="fg-floorband" x="${r1(x0)}" y="-9" width="${r1(x1-x0)}" height="9"/>`+pl([[x0,0],[x1,0]],"fg-floor");
      g.forEach(o=>o.svg=`<svg class="fg${top?" fg-top":""}" viewBox="${vb}" aria-hidden="true"><g transform="scale(1,-1)">${floor}${o.body}</g>${o.B.txt.map(l=>`<text class="fg-lab" style="font-size:${r1(fs)}px" x="${r1(l.x)}" y="${r1(-l.y)}" text-anchor="middle">${l.t}</text>`).join("")}</svg>`);
    }
    return out.map(({steps,top,svg})=>({steps,top,svg}));
  }
  return {has:id=>!!(FIGS[id]||[]).length,of};
})();
/* ---------- end Figures ---------- */

/* ---------- Render plan ---------- */
const plan=document.getElementById("plan");
const COURSE_NOTE="Set up the course before you start. Rest 60 to 90 seconds between runs while you walk back. Quality beats speed: if a landing gets loud or wobbly, rest longer.";
const COOL_NOTE="A couple of short stretches, then longer yin holds: settle into each pose at about 70% of your range, stay still and let gravity do the work. Finish by breathing slowly.";
const FOOT="On plyo moves, land softly and end the set when landings get loud or sloppy. Skip or swap jumps if you have joint pain, are recovering from injury, or have a condition that makes impact risky.";
function blockNote(b,w){
  if(b.course) return COURSE_NOTE;
  const R=RESTS[w.settings.level-1];
  return `${b.rounds} rounds. Rest ${R.ex}s between moves and ${R.round}s after each round.${b.items.some(i=>isJump(i.id))?" Plyo moves come first while you're fresh.":""}${w.settings.partner==="on"?" Partner moves: switch roles after each set, so one works while the other holds or rests.":""}`;
}
const tagsHTML=ex=>`${ex.pt?'<span class="tag cb">Partner</span>':""}${ex.t>=120&&ex.p==="cool"?'<span class="tag">Yin</span>':""}${ex.ct?'<span class="tag cb">Slow + fast</span>':ex.cb?'<span class="tag cb">Combo</span>':""}${ex.sp?'<span class="tag">Sprint</span>':isJump(ex.id)?'<span class="tag">Plyo</span>':""}`;
// The exercise's drawings, each captioned with the steps it shows.
const figsHTML=(id,px)=>FIG.has(id)?`<div class="figs">${FIG.of(id,px).map(f=>`<figure${f.top?' class="wide"':""}>${f.svg}<figcaption>${f.steps[0]===f.steps[1]?`Step ${f.steps[0]}`:`Steps ${f.steps[0]}–${f.steps[1]}`}</figcaption></figure>`).join("")}</div>`:"";
function howHTML(ex){
  return `<div class="how">${figsHTML(ex.id,150)}<ol>${ex.s.map(t=>`<li>${t}</li>`).join("")}</ol>
  <p><b>Cue:</b> ${ex.c}</p>${ex.x?`<p><b>Avoid:</b> ${ex.x}</p>`:""}</div>`;
}
function row(id,meta,swappable,where){
  const ex=BY[id], j=isJump(id);
  return `<details class="${j?"jumpbar":""}"><summary>
    <span class="nm">${ex.n}<small>${meta}</small></span>
    ${tagsHTML(ex)}
    ${swappable?`<button class="swap" data-where="${where}" aria-label="Swap ${ex.n} for a similar move">Swap</button>`:""}
    <span class="chev" aria-hidden="true"></span></summary>${howHTML(ex)}</details>`;
}
function render(){
  if(!W){plan.hidden=true;return}
  const lv=W.settings.level, seq=sequence(W);
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
  <div class="actions"><button class="go" id="start">Start workout</button><button id="again">New workout</button><button id="print">Print</button></div>
  ${saveHTML()}
  <section class="sec"><h2>What you'll need</h2><p class="note">Tick items off as you set up.${W.settings.partner==="on"?" Plus your partner.":""}</p>
  ${(()=>{const g=equipList(W);return g.length?`<ul class="gear">${g.map(([lab,uses])=>`<li><label><input type="checkbox"><span><b>${lab}</b><small>${[...uses].join(", ")}</small></span></label></li>`).join("")}</ul>`:`<p class="note">Nothing but some floor space.</p>`})()}
  </section>
  ${evalsHTML()}
  <section class="sec"><h2>Warm-up</h2><p class="note">One after another, no rest.</p>
  <div class="list">${W.warm.map(id=>row(id,holdLabel(id,WARM_SECS),false)).join("")}</div></section>`;
  W.blocks.forEach((b,bi)=>{
    h+=`<section class="sec"><h2>${b.name}</h2><p class="note">${blockNote(b,W)}</p>
    <div class="list">${b.items.map((it,ii)=>row(it.id,reps(it.id,lv),true,`${bi}-${ii}`)).join("")}</div></section>`;
  });
  h+=`<section class="sec"><h2>Cool-down</h2><p class="note">${COOL_NOTE}</p>
  <div class="list">${W.cool.map(id=>row(id,holdLabel(id,COOL_SECS),false)).join("")}</div></section>
  <p class="foot">${FOOT}</p>`;
  plan.innerHTML=h; plan.hidden=false;
  document.getElementById("start").onclick=startFollow;
  document.getElementById("again").onclick=build;
  document.getElementById("print").onclick=()=>printWorkout(W);
  const sf=document.getElementById("saveForm"); if(sf) sf.onsubmit=saveCurrent;
  const eb=document.getElementById("evalBtn"); if(eb) eb.onclick=()=>openEval(W.savedId,W.name,estimateSecs(W));
}
/* ---------- Print ---------- */
// A separate sheet, shown only when printing: every move with its instructions spelled out,
// and a box per round to tick off. Prints the workout on screen, or a saved one without opening it.
const printEl=document.getElementById("printSheet");
function printHTML(w){
  const lv=w.settings.level, seq=sequence(w), total=estimate(seq), wm=estimate(seq,s=>s.sec==="Warm-up"), cm=estimate(seq,s=>s.sec.startsWith("Cool-down"));
  const boxes=n=>`<span class="ticks" aria-hidden="true">${"<i></i>".repeat(n)}</span>`;
  const move=(id,meta,n)=>{const ex=BY[id];return `<li><div class="ph"><b>${ex.n}</b><span class="meta">${meta}</span>${tagsHTML(ex)}${n?boxes(n):""}</div>
    ${figsHTML(id,110)}<ol>${ex.s.map(t=>`<li>${t}</li>`).join("")}</ol><p><b>Cue:</b> ${ex.c}${ex.x?` <b>Avoid:</b> ${ex.x}`:""}</p></li>`};
  // The heading, its note and the first move share an unbreakable box, so a heading never ends a page.
  const sec=(title,note,items)=>`<section><div class="keep"><h2>${title}</h2>${note?`<p class="note">${note}</p>`:""}<ul class="moves">${items[0]||""}</ul></div><ul class="moves">${items.slice(1).join("")}</ul></section>`;
  const gear=equipList(w);
  return `<header><h1>${w.name?esc(w.name):"Full-body workout"}</h1>
    <p>${LEVEL_NAMES[lv-1]} · about ${total-wm-cm} min of hard work, ${total} min in total · printed ${dateLabel(new Date().toISOString())}</p></header>
    <section><h2>What you'll need</h2>${gear.length?`<ul class="pgear">${gear.map(([lab,uses])=>`<li><b>${lab}</b>: ${[...uses].join(", ")}</li>`).join("")}</ul>`:`<p class="note">Nothing but some floor space.</p>`}${w.settings.partner==="on"?`<p class="note">Plus your partner.</p>`:""}</section>
    ${sec("Warm-up","One after another, no rest.",w.warm.map(id=>move(id,holdLabel(id,WARM_SECS))))}
    ${w.blocks.map(b=>sec(b.name,blockNote(b,w),b.items.map(it=>move(it.id,reps(it.id,lv),b.rounds)))).join("")}
    ${sec("Cool-down",COOL_NOTE,w.cool.map(id=>move(id,holdLabel(id,COOL_SECS))))}
    <p class="note">${FOOT}</p>`;
}
let printW=null; // set while printing something other than the workout on screen
function printWorkout(w){printW=w; window.print()}
addEventListener("beforeprint",()=>{const w=printW||W; printEl.innerHTML=w?printHTML(w):""; document.body.classList.toggle("printing",!!w)});
addEventListener("afterprint",()=>{printW=null; printEl.innerHTML=""; document.body.classList.remove("printing")});

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
      <div class="rowbtns"><button data-open="${w.id}">Open</button><button data-print="${w.id}">Print</button><button data-eval="${w.id}" data-name="${esc(w.name)}" data-est="${w.estimated_seconds}">Evaluate</button><button data-del="${w.id}" data-name="${esc(w.name)}" class="del">Delete</button></div></li>`).join("")}</ul>`
      :`<p class="note">Build a workout and save it with a name; it will show up here.</p>`}</details>`;
  document.getElementById("savedBox").addEventListener("toggle",e=>savedOpen=e.target.open);
}
savedEl.addEventListener("click",async e=>{
  const b=e.target.closest("button"); if(!b) return;
  try{
    if(b.dataset.open) await openSaved(+b.dataset.open);
    else if(b.dataset.print) printWorkout(fromDB(await call("GET",`workouts/${b.dataset.print}`)));
    else if(b.dataset.eval) openEval(+b.dataset.eval,b.dataset.name,+b.dataset.est);
    else if(b.dataset.del&&confirm(`Delete “${b.dataset.name}” and its evaluations?`)){
      await call("DELETE",`workouts/${b.dataset.del}`);
      if(W&&W.savedId===+b.dataset.del){delete W.savedId; delete W.name; delete W.sessions; save("fbw-workout",W); render()}
      loadSaved();
    }
  }catch(x){alert(x.message)}
});
const fromDB=w=>({settings:w.settings,warm:w.warm,cool:w.cool,blocks:w.blocks,savedId:w.id,name:w.name,sessions:w.sessions});
async function openSaved(id){
  W=fromDB(await call("GET",`workouts/${id}`));
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
