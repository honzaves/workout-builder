/* End-to-end check of template drafts against the real server (tests/test_frontend.py serves the built app
   from a temporary folder with a copy of the database). Writes [name, value] pairs into a pre element (id e2e). */
(async()=>{
  const F=window.FBW, out={}, wait=async c=>{for(let i=0;i<100&&!c();i++) await new Promise(r=>setTimeout(r,50))};
  window.confirm=()=>true;
  try{
    await wait(()=>!document.getElementById("saved").hidden);
    out.apiOn=!document.getElementById("saved").hidden;
    Object.assign(F.S,{mode:"template",level:2,equip:["db","box"],course:"off",grip:"off",blocks:1,partner:"off"});
    F.W=F.genTemplate(F.S); F.render();
    document.querySelector('#plan [data-act="auto"][data-where="0-0"]').click();
    document.getElementById("wname").value="E2E draft";
    document.getElementById("saveDraft").click();
    await wait(()=>F.W.draftId);
    out.draftId=F.W.draftId;
    const first=F.W.blocks[0].items[0].id, empty=F.emptyCount(F.W);
    F.W=null; localStorage.removeItem("fbw-workout"); F.render();
    await wait(()=>document.querySelector("[data-opendraft]"));
    out.listed=document.querySelector("#savedBox .savedlist").textContent.includes("E2E draft");
    document.querySelector("[data-opendraft]").click();
    await wait(()=>F.W&&F.W.draftId);
    out.reopened=F.W.blocks[0].items[0].id===first&&F.emptyCount(F.W)===empty;
    document.querySelector('#plan [data-act="fill"]').click();
    out.dirty=F.W.dirty;
    document.getElementById("saveForm").requestSubmit();
    await wait(()=>F.W.savedId);
    out.savedId=F.W.savedId;
    out.draftsLeft=(await (await fetch("api/drafts")).json()).length;
    out.savedMode=(await (await fetch(`api/workouts/${F.W.savedId}`)).json()).mode;
  }catch(e){out.error=String(e)}
  const pre=document.createElement("pre"); pre.id="e2e"; pre.textContent=JSON.stringify(out); document.body.appendChild(pre);
})();
