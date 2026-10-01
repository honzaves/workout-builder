/* Front-end test cases. tests/test_frontend.py appends this script to a copy of the built app,
   runs it in headless Chrome and reads the JSON this script writes into a pre element (id fbw-results).
   window.FBW (end of app.js) exposes the internals tested here. */
(()=>{
  const F=window.FBW, results=[], extra={};
  const test=(name,fn)=>{try{fn();results.push({name,ok:true})}catch(e){results.push({name,ok:false,error:String(e&&e.message||e)})}};
  const eq=(a,b,msg)=>{const x=JSON.stringify(a),y=JSON.stringify(b);if(x!==y) throw new Error(`${msg||"not equal"}: ${x} !== ${y}`)};
  const yes=(c,msg)=>{if(!c) throw new Error(msg||"expected true")};
  const ALL=Object.keys(F.DATA.equipment);
  const S=(o={})=>({blocks:3,level:2,plyo:"some",sprints:"some",combos:"some",grip:"on",partner:"off",course:"one",equip:[...ALL],...o});
  const mains=w=>w.blocks.filter(b=>b.kind==="main");
  const YIN={1:1,2:1,3:2,4:2,5:3,6:3};
  const sample=a=>a[Math.floor(Math.random()*a.length)];
  const randomSettings=()=>S({blocks:1+Math.floor(Math.random()*6),level:1+Math.floor(Math.random()*4),
    plyo:sample(["some","lots"]),sprints:sample(["none","some","lots"]),combos:sample(["none","some","lots","max"]),
    grip:sample(["on","off"]),partner:sample(["on","off"]),course:sample(["off","one","two"]),
    equip:ALL.filter(()=>Math.random()<.4)});

  test("genQuick returns a version 2 workout",()=>{
    const w=F.genQuick(S());
    eq([w.v,w.mode],[2,"quick"]);
    yes(w.blocks.every(b=>["main","course","grip"].includes(b.kind)),"block kinds");
    yes(w.blocks.every(b=>b.items.every(it=>it.id&&F.BY[it.id]&&it.pat)),"block items");
    w.warm.forEach(x=>yes(F.WARM_ROLES.includes(x.role)&&F.DATA.phases[x.role].includes(x.id),`warm ${x.id}/${x.role}`));
    w.cool.forEach(x=>yes(F.COOL_ROLES.includes(x.role)&&F.DATA.phases[x.role].includes(x.id),`cool ${x.id}/${x.role}`));
  });

  test("the number of main blocks follows the setting (1-6)",()=>{
    for(let n=1;n<=6;n++){
      const m=mains(F.genQuick(S({blocks:n})));
      eq(m.map(b=>b.name),[..."ABCDEF"].slice(0,n).map(c=>"Block "+c),`blocks=${n}`);
      yes(m.every(b=>b.items.length>=3),`blocks=${n}: at least 3 moves per block`);
    }
  });

  test("obstacle course first and grip finisher last, only when switched on",()=>{
    const w=F.genQuick(S({course:"two",grip:"on"}));
    eq(w.blocks[0].kind,"course"); eq(w.blocks[0].items.length,2,"two courses");
    eq(w.blocks[w.blocks.length-1].kind,"grip");
    const off=F.genQuick(S({course:"off",grip:"off"}));
    yes(off.blocks.every(b=>b.kind==="main"),"no course or grip block");
  });

  test("warm-up and cool-down composition",()=>{
    for(let n=1;n<=6;n++){
      const w=F.genQuick(S({blocks:n,equip:[]}));
      eq(w.warm.map(x=>x.role),["pulse","flow","mob","mob","pulse"],"warm-up roles");
      eq(w.cool.filter(x=>x.role==="yin").length,YIN[n],`yin holds for ${n} blocks`);
      eq([w.cool[0].role,w.cool[1].role,w.cool[w.cool.length-1].role],["stretch","stretch","calm"],"cool-down roles");
    }
  });

  test("filters: equipment, level, partner and sprints are respected",()=>{
    for(let k=0;k<60;k++){
      const s=randomSettings(), w=F.genQuick(s);
      F.idsOf(w).forEach(id=>yes(F.ok(F.BY[id],s),`${id} not allowed by ${JSON.stringify(s)}`));
    }
  });

  // With little equipment pick() reuses a move when nothing unused fits, so repeats are only checked with everything selected,
  // and only in the main blocks: the grip finisher can repeat a move when the kit is full (known issue, see docs/TODO.md).
  test("no repeated moves in the main blocks with all equipment",()=>{
    for(let k=0;k<30;k++){
      const s=S({blocks:1+k%6,level:1+k%4,sprints:k%2?"some":"none",partner:k%3?"off":"on"});
      const b=mains(F.genQuick(s)).flatMap(bl=>bl.items.map(x=>x.id));
      yes(new Set(b).size===b.length,`repeated move with ${JSON.stringify(s)}: ${b}`);
    }
  });

  test("upgrade converts a version 1 workout and leaves version 2 alone",()=>{
    const w=F.genQuick(S({course:"one",grip:"on"}));
    const v1={settings:w.settings,warm:w.warm.map(x=>x.id),cool:w.cool.map(x=>x.id),savedId:7,name:"Old",
      blocks:w.blocks.map(({kind,...b})=>kind==="course"?{...b,course:true}:b)};
    const up=F.upgrade(v1);
    eq([up.v,up.mode,up.savedId,up.name],[2,"quick",7,"Old"]);
    eq(up.blocks.map(b=>b.kind),w.blocks.map(b=>b.kind),"kinds");
    yes(up.blocks.every(b=>!("course" in b)),"course flag removed");
    eq(up.warm.map(x=>x.id),v1.warm); eq(up.cool.map(x=>x.id),v1.cool);
    yes(up.warm.every(x=>F.DATA.phases[x.role].includes(x.id)),"warm roles looked up");
    yes(F.upgrade(w)===w,"version 2 is returned unchanged");
    yes(F.upgrade(null)===null,"null stays null");
  });

  test("loadW upgrades, fixes old settings and drops workouts with unknown ids",()=>{
    const w=F.genQuick(S({blocks:2}));
    const v1={settings:{...w.settings,duration:20},warm:w.warm.map(x=>x.id),cool:w.cool.map(x=>x.id),blocks:w.blocks.map(({kind,...b})=>kind==="course"?{...b,course:true}:b)};
    delete v1.settings.blocks;
    localStorage.setItem("fbw-workout",JSON.stringify(v1));
    const got=F.loadW();
    eq([got.v,got.settings.blocks,"duration" in got.settings],[2,2,false]);
    localStorage.setItem("fbw-workout",JSON.stringify({...w,warm:[{id:"no-such-move",role:"pulse"}]}));
    eq(F.loadW(),null,"unknown id");
    localStorage.removeItem("fbw-workout");
    eq(F.loadW(),null,"nothing stored");
  });

  test("sequence: one set per item and round, rests between, none after the last set",()=>{
    const w=F.genQuick(S({course:"one",grip:"on"})), seq=F.sequence(w);
    const sets=w.blocks.reduce((a,b)=>a+b.rounds*b.items.length,0);
    eq(seq.filter(x=>x.k==="set").length,sets,"sets");
    eq(seq.filter(x=>x.k==="rest").length,sets-1,"rests");
    eq(seq.filter(x=>x.k==="timed").length,w.warm.length+w.cool.length,"timed");
    yes(seq[seq.length-1].sec.startsWith("Cool-down"),"ends with the cool-down");
  });

  test("block rest and item level override the workout level",()=>{
    const w=F.genQuick(S({course:"off",grip:"off",blocks:1,level:2}));
    w.blocks[0].rest={ex:7,round:77};
    const rests=F.sequence(w).filter(x=>x.k==="rest").map(x=>x.secs);
    yes(rests.includes(7)&&rests.includes(77)&&!rests.includes(F.RESTS[1].ex),`rests ${rests}`);
    const id=F.LIB.find(x=>!x.rt&&x.r&&x.r[1]&&x.r[3]&&x.r[1]!==x.r[3]).id;
    w.blocks[0].items=[{id,pat:F.BY[id].p,lv:4}];
    eq(F.sequence(w).find(x=>x.k==="set").reps,F.BY[id].r[3],"level 4 reps");
    delete w.blocks[0].items[0].lv;
    eq(F.sequence(w).find(x=>x.k==="set").reps,F.BY[id].r[1],"falls back to the workout level");
  });

  test("empty slots are skipped by sequence, ids, equipment list and toDB",()=>{
    const w=F.genQuick(S({course:"off",grip:"on",blocks:2}));
    w.warm[1].id=null; w.cool[0].id=null; w.blocks[0].items[1].id=null; w.blocks[2].items.forEach(it=>it.id=null);
    const seq=F.sequence(w);
    yes(seq.every(x=>x.k==="rest"||x.id),"no empty ids in the sequence");
    yes(F.idsOf(w).every(Boolean),"idsOf");
    F.equipList(w);
    const db=F.toDB(w,"x");
    eq(db.blocks.map(b=>b.kind),["warmup","main","main","cooldown"],"block with only empty slots dropped");
    yes(db.blocks.every(b=>b.items.every(it=>it.id)),"no empty items");
  });

  test("toDB shape",()=>{
    const w=F.genQuick(S({course:"one",grip:"on",blocks:2,level:3}));
    const db=F.toDB(w,"Front-end test");
    eq(db.blocks.map(b=>b.kind),["warmup","course","main","main","grip","cooldown"]);
    const main=db.blocks[2];
    eq([main.rest_ex,main.rest_round],[F.RESTS[2].ex,F.RESTS[2].round]);
    eq([db.blocks[1].rest_ex,db.blocks[1].rest_round],[0,90],"course rest");
    yes(db.blocks.every(b=>b.items.every(it=>it.id&&it.pat&&it.prescription&&it.est>0&&Array.isArray(it.equipment))),"items");
    yes(db.estimated_seconds>0);
    extra.toDB=db;
  });

  test("render shows every section with a Swap button per move",()=>{
    const w=F.genQuick(S({course:"one",grip:"on",blocks:3}));
    F.W=w; F.render();
    const plan=document.getElementById("plan");
    yes(!plan.hidden,"plan visible");
    const h2=[...plan.querySelectorAll("h2")].map(h=>h.textContent);
    ["Warm-up","Obstacle course","Block A","Block B","Block C","Grip finisher","Cool-down"].forEach(t=>yes(h2.includes(t),`missing ${t}`));
    eq(plan.querySelectorAll(".swap").length,F.idsOf(w).length,"swap buttons");
  });

  test("Swap replaces a block move and a warm-up move",()=>{
    const w=F.genQuick(S({course:"off",grip:"off",blocks:2}));
    F.W=w; F.render();
    const before=w.blocks[0].items[0].id, beforeWarm=w.warm[0].id;
    for(let k=0;k<5&&F.W.blocks[0].items[0].id===before;k++) document.querySelector('.swap[data-where="0-0"]').click();
    yes(F.W.blocks[0].items[0].id!==before,"block move swapped");
    for(let k=0;k<5&&F.W.warm[0].id===beforeWarm;k++) document.querySelector('.swap[data-where="w-0"]').click();
    yes(F.W.warm[0].id!==beforeWarm,"warm-up move swapped");
    eq(F.W.warm[0].role,"pulse","role kept");
  });

  test("Build workout stores a version 2 workout",()=>{
    document.getElementById("build").click();
    const stored=JSON.parse(localStorage.getItem("fbw-workout"));
    eq([stored.v,stored.mode],[2,"quick"]);
  });

  /* ---------- Exercise picker ---------- */
  const st=(o={})=>({section:"main",cat:null,tags:[],lv:null,q:"",settings:S(),...o});

  test("pickPool: each section lists only its own moves",()=>{
    const warm=F.pickPool(st({section:"warm",cat:"pulse"}));
    yes(warm.length&&warm.every(id=>F.DATA.phases.pulse.includes(id)),"warm-up pulse");
    const cool=F.pickPool(st({section:"cool"}));
    yes(cool.length&&cool.every(id=>F.COOL_ROLES.some(r=>F.DATA.phases[r].includes(id))),"cool-down, all roles");
    ["course","grip"].forEach(sec=>{const ids=F.pickPool(st({section:sec})); yes(ids.length&&ids.every(id=>F.BY[id].p===sec),sec)});
    const push=F.pickPool(st({cat:"push"}));
    yes(push.length&&push.every(id=>F.BY[id].p==="push"||F.BY[id].p2==="push"),"push");
    const main=F.pickPool(st());
    const MAIN=["plyoL","plyoU","squat","hinge","lunge","push","pull","core"];
    yes(main.every(id=>MAIN.includes(F.BY[id].p)||MAIN.includes(F.BY[id].p2)),"main lists moves with a block pattern (main or also_pattern)");
    yes(main.every(id=>!F.BY[id].rt),"no retired moves");
  });

  test("pickPool: equipment, partner, level and tag filters",()=>{
    const bw=F.pickPool(st({settings:S({equip:[]})}));
    yes(bw.length&&bw.every(id=>!(F.BY[id].e||[]).length),"bodyweight only");
    yes(F.pickPool(st()).every(id=>!F.BY[id].pt),"no partner moves when training alone");
    yes(F.pickPool(st({settings:S({partner:"on"}),tags:["pt"]})).length>0,"partner moves with a partner");
    const l1=F.pickPool(st({lv:1}));
    yes(l1.length&&l1.every(id=>(F.BY[id].l||1)===1),"level 1");
    yes(F.pickPool(st({lv:4})).length>l1.length,"level 4 includes lower levels");
    const sp=F.pickPool(st({tags:["sp","cb"]}));
    yes(sp.every(id=>F.BY[id].sp&&F.BY[id].cb),"tags combine");
    eq(F.pickPool(st({settings:S({sprints:"none"}),tags:["sp"]})),[],"sprints switched off");
  });

  test("pickPool: search finds names first, then steps, across all categories",()=>{
    const ids=F.pickPool(st({cat:"squat",q:"lizard"}));
    eq(ids[0],"lizard-crawl","name match first, outside the selected category");
    yes(ids.every(id=>F.BY[id].n.toLowerCase().includes("lizard")||F.BY[id].s.some(t=>t.toLowerCase().includes("lizard"))),"matches");
    const nm=ids.findIndex(id=>!F.BY[id].n.toLowerCase().includes("lizard"));
    yes(nm<0||ids.slice(nm).every(id=>!F.BY[id].n.toLowerCase().includes("lizard")),"name matches before step matches");
  });

  const dlg=document.getElementById("pickDlg");
  test("Choose on a block move: chips, detail, level and Use this",()=>{
    const w=F.genQuick(S({course:"off",grip:"off",blocks:1,level:2}));
    F.W=w; F.render();
    const it=w.blocks[0].items[1];
    document.querySelector('.choose[data-choose="0-1"]').click();
    yes(dlg.open,"picker open");
    yes(dlg.querySelector(`[data-cat="${it.pat}"]`).getAttribute("aria-pressed")==="true","slot pattern preselected");
    yes(dlg.querySelector('[data-lv="2"]').getAttribute("aria-pressed")==="true","workout level preselected");
    const rows=dlg.querySelectorAll(".prow");
    yes(rows.length>0&&rows.length<=40,`first page only (${rows.length})`);
    // choose a level-2 move that also has level-4 reps, at level 4
    const target=F.pickPool(st({cat:it.pat,lv:2})).find(id=>id!==it.id&&F.BY[id].r[3]&&F.BY[id].r[1]!==F.BY[id].r[3]);
    yes(target,"a move with level-4 reps");
    dlg.querySelector("#pQ").value=F.BY[target].n; dlg.querySelector("#pQ").dispatchEvent(new Event("input"));
    dlg.querySelector(`.prow[data-id="${target}"]`).click();
    yes(dlg.querySelector(".pdetail"),"detail view");
    yes(dlg.querySelector('[data-plv="2"]').getAttribute("aria-pressed")==="true","level defaults to the workout level");
    dlg.querySelector('[data-plv="4"]').click();
    dlg.querySelector("#pUse").click();
    yes(!dlg.open,"picker closed");
    eq([F.W.blocks[0].items[1].id,F.W.blocks[0].items[1].lv],[target,4],"slot updated with the level");
    eq(F.sequence(F.W).find(x=>x.id===target).reps,F.BY[target].r[3],"level-4 reps in the sequence");
    yes(document.querySelector('.choose[data-choose="0-1"]'),"row redrawn");
  });

  test("Choose on a warm-up move keeps the slot's role",()=>{
    const w=F.genQuick(S({course:"off",grip:"off",blocks:1}));
    F.W=w; F.render();
    document.querySelector('.choose[data-choose="w-1"]').click();
    yes(dlg.querySelector('[data-cat="flow"]').getAttribute("aria-pressed")==="true","flow preselected");
    yes(!dlg.querySelector("[data-lv]"),"no level chips for warm-up moves");
    const other=[...dlg.querySelectorAll(".prow")].map(b=>b.dataset.id).find(id=>id!==w.warm[1].id);
    dlg.querySelector(`.prow[data-id="${other}"]`).click();
    yes(!dlg.querySelector("[data-plv]"),"no level buttons in the detail");
    dlg.querySelector("#pUse").click();
    eq(F.W.warm[1],{id:other,role:"flow"});
  });

  test("picker: Show more, chips toggle off, close without changes",()=>{
    const w=F.genQuick(S({course:"off",grip:"off",blocks:1}));
    F.W=w; F.render();
    const before=JSON.stringify(F.W);
    document.querySelector('.choose[data-choose="0-0"]').click();
    dlg.querySelector('[data-lv="2"]').click(); // level chip off: all levels
    const cat=dlg.querySelector('#pChips [data-cat][aria-pressed="true"]'); if(cat) cat.click(); // category off: all patterns
    const total=F.pickPool(st());
    yes(dlg.querySelector(".pcount").textContent.startsWith(String(total.length)),"count shows the whole main section");
    dlg.querySelector("#pMore").click();
    eq(dlg.querySelectorAll(".prow").length,80,"second page appended");
    dlg.querySelector("#pClose").click();
    yes(!dlg.open,"closed");
    eq(JSON.stringify(F.W),before,"workout unchanged");
  });

  /* ---------- Template mode ---------- */
  const setS=o=>Object.assign(F.S,S(),o);
  const act=(a,attrs="")=>{const b=document.querySelector(`#plan button[data-act="${a}"]${attrs}`); yes(b,`button ${a}${attrs}`); b.click()};
  window.confirm=()=>true;

  test("genTemplate: an empty workout with the starting structure",()=>{
    const w=F.genTemplate(S({blocks:2,course:"two",grip:"on",level:3}));
    eq([w.v,w.mode,F.emptyCount(w),F.idsOf(w).length],[2,"template",w.warm.length+w.cool.length+w.blocks.reduce((a,b)=>a+b.items.length,0),0]);
    eq(w.blocks.map(b=>[b.kind,b.name,b.items.length]),[["course","Obstacle course",2],["main","Block A",3],["main","Block B",3],["grip","Grip finisher",2]]);
    eq(w.warm.map(x=>x.role),["pulse","flow","mob","mob","pulse"]);
    eq(w.cool.map(x=>x.role),["stretch","stretch","yin","calm"]);
    eq(w.blocks[1].rest,{ex:F.RESTS[1].ex,round:F.RESTS[1].round},"rest like Intermediate");
    eq(w.blocks[1].rounds,3);
    eq(F.sequence(w),[],"nothing to do yet");
  });

  test("Auto and Fill the rest fill only empty slots, at the auto-fill level, within the filters",()=>{
    setS({mode:"template",level:3,equip:["db","kb","box","band"],partner:"off"});
    const w=F.genTemplate(F.S); F.W=w; F.render();
    act("auto",'[data-where="1-0"]');
    const first=F.W.blocks[1].items[0];
    yes(first.id&&first.lv===3,"slot filled at level 3");
    act("fill");
    eq(F.emptyCount(F.W),0,"all filled");
    eq(F.W.blocks[1].items[0].id,first.id,"the first fill was kept");
    const s={...F.W.settings,combos:"some",sprints:"some"};
    F.idsOf(F.W).forEach(id=>yes(F.ok(F.BY[id],s),`${id} allowed`));
    F.W.blocks.filter(b=>b.kind!=="course").forEach(b=>b.items.forEach(x=>yes(x.lv===3,`${x.id} level ${x.lv}`)));
    yes(new Set(F.idsOf(F.W)).size===F.idsOf(F.W).length,"no repeated moves");
  });

  test("editing: add, move and remove slots and blocks; blocks are renamed",()=>{
    setS({mode:"template",blocks:2,course:"off",grip:"off"});
    F.W=F.genTemplate(F.S); F.render();
    act("additem",'[data-b="0"]');
    eq(F.W.blocks[0].items.length,4,"slot added");
    eq(F.W.blocks[0].items[3].pat,"core","extra slot hint (plyoL, squat, push already there)");
    act("auto",'[data-where="0-0"]'); const moved=F.W.blocks[0].items[0].id;
    act("down",'[data-where="0-0"]');
    eq(F.W.blocks[0].items[1].id,moved,"moved down");
    act("del",'[data-where="0-1"]');
    yes(!F.idsOf(F.W).includes(moved),"slot removed");
    act("addblock",'[data-kind="course"][data-at="1"]');
    eq(F.W.blocks.map(b=>b.kind),["main","course","main"]);
    act("addblock",'[data-kind="main"][data-at="0"]');
    eq(F.W.blocks.map(b=>b.name),["Block A","Block B","Obstacle course","Block C"],"renamed in order");
    act("bdown",'[data-b="0"]');
    eq(F.W.blocks.map(b=>b.name),["Block A","Block B","Obstacle course","Block C"],"names follow the order");
    act("bdel",'[data-b="2"]');
    eq(F.W.blocks.map(b=>b.kind),["main","main","main"]);
    act("rounds",'[data-b="0"][data-d="1"]'); act("rounds",'[data-b="0"][data-d="1"]');
    eq(F.W.blocks[0].rounds,5);
    const sel=document.querySelector('#plan select[data-b="1"]'); sel.value="3"; sel.dispatchEvent(new Event("change",{bubbles:true}));
    eq(F.W.blocks[1].rest,{ex:F.RESTS[3].ex,round:F.RESTS[3].round},"Beast rest");
  });

  test("editing: warm-up and cool-down counts keep the role order",()=>{
    F.W=F.genTemplate(S({blocks:1,course:"off",grip:"off"})); F.render();
    act("warmcount",'[data-d="1"]');
    eq(F.W.warm.map(x=>x.role),["pulse","flow","mob","mob","pulse","mob"]);
    act("coolcount",'[data-d="1"]');
    eq(F.W.cool.map(x=>x.role),["stretch","stretch","yin","yin","calm"],"extra yin before the calm finish");
    act("coolcount",'[data-d="-1"]'); act("coolcount",'[data-d="-1"]');
    eq(F.W.cool.map(x=>x.role),["stretch","stretch","calm"],"yin holds go first");
    act("warmcount",'[data-d="-1"]');
    eq(F.W.warm.length,5);
  });

  test("Choose in a template keeps the chosen level even when it equals the auto-fill level",()=>{
    setS({mode:"template",level:2,course:"off",grip:"off",blocks:1});
    F.W=F.genTemplate(F.S); F.render();
    document.querySelector('.choose[data-choose="0-1"]').click();
    dlg.querySelector(".prow").click(); dlg.querySelector("#pUse").click();
    const it=F.W.blocks[0].items[1];
    yes(it.id&&it.lv,"filled with an explicit level");
  });

  test("a template with empty slots asks before Start; toDB skips them and records mode and levels",()=>{
    setS({mode:"template",level:2,course:"one",grip:"off",blocks:2,equip:["box","db"]});
    F.W=F.genTemplate(F.S); F.render();
    act("auto",'[data-where="1-0"]'); act("auto",'[data-where="w-0"]'); act("auto",'[data-where="0-0"]');
    window.confirm=()=>false;
    document.getElementById("start").click();
    yes(!document.getElementById("follow").classList.contains("on"),"follow-along not started");
    window.confirm=()=>true;
    const db=F.toDB(F.W,"Template test");
    eq(db.mode,"template");
    eq(db.blocks.map(b=>b.kind),["warmup","course","main","cooldown"],"empty blocks and sections skipped");
    eq(db.blocks[2].items[0].level,2);
    eq(db.settings.blocks,2);
    act("fill");
    extra.toDBTemplate=F.toDB(F.W,"Template test");
  });

  test("mode switch: template hides the generator settings and builds a template",()=>{
    setS({mode:"quick"});
    document.querySelector('[data-key="mode"] [data-v="template"]').click();
    yes(document.querySelector('[data-not="template"]').hidden,"plyo/sprints/combos hidden");
    eq(document.getElementById("build").textContent,"Create template");
    F.W=null;
    document.getElementById("build").click();
    eq(F.W.mode,"template");
    act("auto",'[data-where="w-0"]');
    let asked=false; window.confirm=()=>(asked=true,false);
    document.querySelector('[data-key="mode"] [data-v="quick"]').click();
    document.getElementById("build").click();
    yes(asked&&F.W.mode==="template","asked before replacing unsaved template work, kept it on No");
    window.confirm=()=>true;
    document.getElementById("build").click();
    eq(F.W.mode,"quick");
    yes(!document.querySelector('[data-not="template"]').hidden,"settings back");
    eq(document.getElementById("build").textContent,"Build workout");
  });

  /* ---------- Mix levels ---------- */
  test("genMix: four moves per block, levels 1 to 4 in order, mixed patterns",()=>{
    for(let k=0;k<20;k++){
      const s=S({blocks:1+k%6,level:1+k%4,course:k%2?"one":"off",grip:k%3?"on":"off"}), w=F.genMix(s);
      eq(w.mode,"mix");
      eq(w.blocks.filter(b=>b.kind==="main").length,s.blocks,"block count");
      w.blocks.filter(b=>b.kind==="main").forEach(b=>{
        eq(b.items.map(x=>x.lv),[1,2,3,4],`${b.name} levels with all equipment`);
        b.items.forEach(x=>{eq(F.BY[x.id].l||1,x.lv,`${x.id} is really level ${x.lv}`); yes(F.ok(F.BY[x.id],{...s,level:4}),`${x.id} allowed`)});
        eq(new Set(b.items.map(x=>x.pat)).size,4,`${b.name}: four different patterns ${b.items.map(x=>x.pat)}`);
      });
      eq(w.warm.length,5,"warm-up as in Quick");
    }
  });

  test("genMix: bodyweight only falls back to neighbouring levels and keeps the order",()=>{
    for(let k=0;k<20;k++){
      const s=S({blocks:3,equip:[],partner:"off"}), w=F.genMix(s);
      w.blocks.filter(b=>b.kind==="main").forEach(b=>{
        eq(b.items.length,4,"four moves");
        const lv=b.items.map(x=>x.lv);
        yes(lv.every((l,i)=>!i||l>=lv[i-1]),`ascending ${lv}`);
        b.items.forEach(x=>{eq(F.BY[x.id].l||1,x.lv,`${x.id} level`); yes(!(F.BY[x.id].e||[]).length,`${x.id} bodyweight`)});
      });
    }
  });

  test("mixLevels gives level 4 to the pattern with the most level-4 options",()=>{
    const s=S(), pats=["lunge","push","plyoU","hinge"], n=p=>F.LIB.filter(x=>(x.p===p||x.p2===p)&&x.l===4&&F.ok(x,{...s,level:4})).length;
    const best=pats.reduce((a,b)=>n(b)>n(a)?b:a);
    const lv=F.mixLevels(pats,s,new Set());
    eq([...lv].sort(),[1,2,3,4],"each level once");
    eq(pats[lv.indexOf(4)],best,"level 4");
  });

  test("Mix: reps and level per move, Swap keeps the level, saved with mode and levels",()=>{
    const w=F.genMix(S({course:"off",grip:"off",blocks:1,level:2}));
    F.W=w; F.render();
    const b=w.blocks[0];
    b.items.forEach(x=>eq(F.sequence(w).find(q=>q.id===x.id).reps,F.BY[x.id].r[x.lv-1]||[...F.BY[x.id].r].reverse().find(Boolean),`${x.id} reps at level ${x.lv}`));
    yes(document.querySelector('.swap[data-where="0-0"]').closest("summary").querySelector("small").textContent.includes(" · Beginner"),"level shown");
    yes(document.querySelector("#plan").textContent.includes("from level 1 to level 4"),"block note");
    const before=b.items[2].id;
    for(let k=0;k<5&&F.W.blocks[0].items[2].id===before;k++) document.querySelector('.swap[data-where="0-2"]').click();
    const it=F.W.blocks[0].items[2];
    yes(it.id!==before,"swapped"); eq([it.lv,F.BY[it.id].l],[3,3],"still level 3");
    const db=F.toDB(F.W,"Mix test");
    eq(db.mode,"mix"); eq(db.blocks[1].items.map(x=>x.level),[1,2,3,4]);
    extra.toDBMix=db;
  });

  test("mode switch: Mix levels builds a mix workout and keeps the generator settings",()=>{
    setS({mode:"quick"}); F.W=null;
    document.querySelector('[data-key="mode"] [data-v="mix"]').click();
    yes(!document.querySelector('[data-not="template"]').hidden,"plyo/sprints/combos stay");
    yes(document.getElementById("l-level").textContent.includes("level 1 to level 4"),"level label");
    document.getElementById("build").click();
    eq(F.W.mode,"mix");
    document.getElementById("again").click();
    eq(F.W.mode,"mix","New workout repeats the mode");
    document.querySelector('[data-key="mode"] [data-v="quick"]').click();
  });

  const pre=document.createElement("pre"); pre.id="fbw-results";
  pre.textContent=JSON.stringify({results,extra});
  document.body.appendChild(pre);
})();
