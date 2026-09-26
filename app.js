(() => {
"use strict";
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const DB_NAME="gaara-rpg-pages", DB_VER=1; let db, current=null, busy=false;
const defaults={model:"openai/gpt-oss-120b",temperature:.85,maxTokens:1200,contextCount:32,apiKey:""};
const SYSTEM=`Você conduz um RPG narrativo de longa duração no universo de Naruto. Escreva SEMPRE em português brasileiro natural, em terceira pessoa, usando travessões em diálogos.
Interprete Gaara aos 18 anos, Quinto Kazekage: reservado, observador, conciso, maduro, empático e responsável. Ele não é frio nem robótico; demonstra afeto sobretudo por atenção, confiança e ações. Romance é slow burn.
NUNCA escreva falas, pensamentos, sentimentos, decisões ou ações de Saruto. Saruto pertence exclusivamente ao usuário.
Saruto tem 18 anos, nasceu em 23/03, é viajante sem aldeia, moreno, olhos felinos heterocrômicos (verde e amarelo), cabelo azul-escuro com mechas azuis claras, calmo, compreensivo, elegante, sensual e reservado. É jinchūriki de Matatabi e usa chamas azuis. Foi rejeitado como monstro e fugiu de sua antiga aldeia distante. Possui 愛 azul perto da nuca; o significado exato pertence ao usuário.
Gaara e Saruto começam desconhecidos. Gaara nota o 愛 e sente curiosidade/identificação, não paixão instantânea. A descoberta de Matatabi e paralelos de solidão podem aprofundar o vínculo gradualmente.
NPCs como Temari e Kankurō têm agência própria e não possuem conhecimento telepático. Sunagakure é um mundo vivo. Gaara tem deveres de Kazekage.
Gaara não é mais jinchūriki de Shukaku. Rasa, Karura, Yashamaru e Chiyo são falecidos. Naruto é importante para a transformação de Gaara.
Evite melodrama, repetição, declarações românticas precoces e trauma em toda cena. Faça a história avançar.`;
const OPENING=`O fim da tarde tingia as muralhas de Sunagakure de cobre quando os guardas anunciaram a chegada de um viajante sem identificação de aldeia. Gaara estava próximo aos portões após uma inspeção breve, a cabaça às costas e a atenção voltada aos relatórios que Kankurō acabara de entregar.

Seu olhar passou pelo recém-chegado sem pressa — e então parou por um instante a mais quando um movimento deixou visível, próximo à nuca, um traço azul familiar demais.

愛.

Gaara não comentou. Apenas ergueu os olhos novamente para o rosto do viajante, a expressão contida apesar da curiosidade súbita.

— Você veio de longe.`;
function req(r){return new Promise((res,rej)=>{const q=indexedDB.open(DB_NAME,DB_VER);q.onupgradeneeded=e=>{const d=e.target.result;if(!d.objectStoreNames.contains("saves"))d.createObjectStore("saves",{keyPath:"id"});if(!d.objectStoreNames.contains("settings"))d.createObjectStore("settings",{keyPath:"id"});};q.onsuccess=e=>{db=e.target.result;res(db)};q.onerror=()=>rej(q.error)})}
function store(n,m="readonly"){return db.transaction(n,m).objectStore(n)}
function getAll(n){return new Promise((r,j)=>{let q=store(n).getAll();q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error)})}
function get(n,k){return new Promise((r,j)=>{let q=store(n).get(k);q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error)})}
function put(n,v){return new Promise((r,j)=>{let q=store(n,"readwrite").put(v);q.onsuccess=()=>r(v);q.onerror=()=>j(q.error)})}
function del(n,k){return new Promise((r,j)=>{let q=store(n,"readwrite").delete(k);q.onsuccess=()=>r();q.onerror=()=>j(q.error)})}
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function settings(){return {...defaults,...JSON.parse(localStorage.getItem("gaara-settings")||"{}")}}
function saveSettingsObj(x){localStorage.setItem("gaara-settings",JSON.stringify(x))}
function newState(title="Gaara × Saruto"){return {id:crypto.randomUUID(),title,created:Date.now(),updated:Date.now(),messages:[{id:crypto.randomUUID(),role:"assistant",content:OPENING,time:Date.now()}],memories:[],chapters:[],world:{date:"01/03 — Ano 1",time:"fim da tarde",location:"Portões de Sunagakure",weather:"seco, vento leve",situation:"Primeiro encontro",events:[]},relationship:{familiarity:0,trust:0,openness:0,attraction:0,intimacy:0,state:"Curiosidade"},emotion:{state:"calmo e curioso",cause:"o encontro com o viajante e o kanji 愛"},milestones:[],knowledge:[]}}
async function persist(){if(current){current.updated=Date.now();await put("saves",current)}}
function render(){
 $("#scene").textContent=current?`${current.world.location} · ${current.world.time}`:"Sem história aberta"; const c=$("#chat"); c.innerHTML="";
 if(!current){c.innerHTML='<div class="card">Crie uma história pelo menu ☰.</div>';return}
 current.messages.forEach((m,i)=>{let d=document.createElement("article");d.className="msg "+m.role;d.innerHTML=`<div class="meta">${m.role==="user"?"Saruto":"Gaara"}</div>${esc(m.content)}<div class="actions"><button data-edit="${i}">Editar</button>${m.role==="assistant"?`<button data-regen="${i}">Regenerar</button>`:""}<button data-cut="${i}">Voltar daqui</button></div>`;c.appendChild(d)});
 c.scrollTop=c.scrollHeight;
}
async function chooseSave(){
 let all=(await getAll("saves")).sort((a,b)=>b.updated-a.updated); if(!all.length){alert("Nenhuma história salva.");return}
 let txt=all.map((s,i)=>`${i+1}. ${s.title}`).join("\n"), n=Number(prompt("Escolha:\n"+txt)); if(n>=1&&n<=all.length){current=all[n-1];localStorage.setItem("lastSave",current.id);render()}
}
async function createSave(){let title=prompt("Nome da história:","Gaara × Saruto")||"Gaara × Saruto";current=newState(title);await persist();localStorage.setItem("lastSave",current.id);render();$("#menu").close()}
async function groq(messages, stream=true){
 const s=settings(); if(!s.apiKey) throw new Error("Configure sua Groq API Key no menu.");
 const r=await fetch("https://api.groq.com/openai/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+s.apiKey},body:JSON.stringify({model:s.model,messages,temperature:Number(s.temperature),max_completion_tokens:Number(s.maxTokens),stream})});
 if(!r.ok) throw new Error(`Groq ${r.status}: ${await r.text()}`); return r;
}
function context(){
 const s=settings(), recent=current.messages.slice(-Number(s.contextCount));
 const memory=current.memories.length?`\nMEMÓRIAS IMPORTANTES:\n${current.memories.slice(-20).map(x=>"- "+x).join("\n")}`:"";
 const world=`\nESTADO ATUAL: ${current.world.date}; ${current.world.time}; ${current.world.location}; ${current.world.weather}. Situação: ${current.world.situation}. Relação: ${current.relationship.state}. Emoção de Gaara: ${current.emotion.state}.`;
 return [{role:"system",content:SYSTEM+memory+world},...recent.map(x=>({role:x.role,content:x.content}))];
}
async function send(){
 if(busy||!current)return;if(!$("#input").value.trim())return; let text=$("#input").value.trim();$("#input").value="";
 current.messages.push({id:crypto.randomUUID(),role:"user",content:text,time:Date.now()});await persist();render();await generate();
}
async function generate(replaceIndex=null, continuation=false){
 busy=true;$("#typing").hidden=false; try{
  let msgs=context(); if(continuation)msgs.push({role:"user",content:"Continue a cena a partir da última resposta, sem controlar Saruto e sem repetir o que já foi escrito."});
  let r=await groq(msgs,true), reader=r.body.getReader(), dec=new TextDecoder(), out="", buf="";
  let idx;if(replaceIndex!==null){idx=replaceIndex;current.messages[idx].content=""}else{current.messages.push({id:crypto.randomUUID(),role:"assistant",content:"",time:Date.now()});idx=current.messages.length-1} render();
  while(true){let {done,value}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});let lines=buf.split("\n");buf=lines.pop();for(const line of lines){if(!line.startsWith("data: "))continue;let d=line.slice(6);if(d==="[DONE]")continue;try{let j=JSON.parse(d),t=j.choices?.[0]?.delta?.content||"";out+=t;current.messages[idx].content=out;render()}catch{}}}
  await persist(); maybeAnalyze();
 }catch(e){alert(e.message)}finally{busy=false;$("#typing").hidden=true}
}
async function maybeAnalyze(){
 if(current.messages.filter(x=>x.role==="assistant").length%4!==0)return;
 try{
 const transcript=current.messages.slice(-10).map(x=>(x.role==="user"?"SARUTO":"GAARA")+": "+x.content).join("\n");
 const prompt=`Analise silenciosamente o trecho abaixo. Retorne SOMENTE JSON válido com: {"memory":null ou string curta de fato realmente importante e duradouro,"relationship":{"familiarity":-2..2,"trust":-2..2,"openness":-2..2,"attraction":-2..2,"intimacy":-2..2},"state":"rótulo curto da relação","emotion":"estado emocional curto de Gaara","situation":"situação atual curta"}. Seja conservador; interações comuns não viram memória nem grandes aumentos. Não invente ações de Saruto.\n${transcript}`;
 const r=await groq([{role:"system",content:prompt}],false),j=await r.json(),raw=j.choices?.[0]?.message?.content||"{}";raw=raw.replace(/^```json\s*|```$/g,"").trim();let a=JSON.parse(raw);
 if(a.memory&&!current.memories.includes(a.memory))current.memories.push(a.memory);
 for(const k of ["familiarity","trust","openness","attraction","intimacy"])current.relationship[k]=Math.max(0,Math.min(100,current.relationship[k]+Number(a.relationship?.[k]||0)));
 if(a.state)current.relationship.state=a.state;if(a.emotion)current.emotion.state=a.emotion;if(a.situation)current.world.situation=a.situation;await persist();
 }catch(e){console.warn("Análise automática ignorada:",e)}
}
function panel(title,html){$("#panelTitle").textContent=title;$("#panelBody").innerHTML=html;$("#panel").showModal()}
function memoryPanel(){panel("Memória",current?`<button id="addMem">Adicionar memória</button>${current.memories.map((m,i)=>`<div class="card row"><span>${esc(m)}</span><button data-delmem="${i}">✕</button></div>`).join("")||'<p class="muted">Nenhuma memória permanente ainda.</p>'}`:"<p>Abra uma história.</p>")}
function worldPanel(){if(!current)return panel("Mundo","Abra uma história.");let w=current.world,r=current.relationship;panel("Mundo",`<div class="card"><b>${esc(w.date)}</b><p>${esc(w.time)} · ${esc(w.location)}</p><p>${esc(w.weather)}</p><p>${esc(w.situation)}</p></div><h3>Gaara → Saruto</h3>${Object.entries(r).filter(([k])=>k!=="state").map(([k,v])=>`<div>${k}: ${v}<div class="bar"><i style="width:${v}%"></i></div></div>`).join("")}<p>Estado: <b>${esc(r.state)}</b></p><h3>Gaara</h3><div class="card">${esc(current.emotion.state)}<br><span class="muted">${esc(current.emotion.cause||"")}</span></div>`)}
function journalPanel(){panel("Diário",current?(current.chapters.map(x=>`<div class="card"><b>${esc(x.title)}</b><p>${esc(x.summary)}</p></div>`).join("")||'<p class="muted">Os capítulos podem ser adicionados manualmente por enquanto.</p>'):"Abra uma história.")}
async function doSearch(){if(!current)return;let q=prompt("Buscar na história:");if(!q)return;let a=current.messages.filter(x=>x.content.toLowerCase().includes(q.toLowerCase()));panel("Busca",a.map(x=>`<div class="card"><b>${x.role==="user"?"Saruto":"Gaara"}</b><p>${esc(x.content)}</p></div>`).join("")||"<p>Nada encontrado.</p>")}
function openSettings(){let s=settings();$("#apiKey").value=s.apiKey;$("#model").value=s.model;$("#temperature").value=s.temperature;$("#maxTokens").value=s.maxTokens;$("#contextCount").value=s.contextCount;$("#setup").showModal()}
function exportSave(){if(!current)return;let b=new Blob([JSON.stringify(current,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=`gaara-rpg-${current.id}.json`;a.click();URL.revokeObjectURL(a.href)}
async function init(){
 await req(); let id=localStorage.getItem("lastSave");if(id)current=await get("saves",id);render();
 $("#menuBtn").onclick=()=>$("#menu").showModal();$("#closeMenu").onclick=()=>$("#menu").close();$("#closePanel").onclick=()=>$("#panel").close();$("#closeSetup").onclick=()=>$("#setup").close();
 $("#newSave").onclick=createSave;$("#switchSave").onclick=async()=>{await chooseSave();$("#menu").close()};$("#settings").onclick=()=>{$("#menu").close();openSettings()};$("#searchBtn").onclick=()=>{$("#menu").close();doSearch()};$("#exportBtn").onclick=exportSave;
 $("#clearBtn").onclick=async()=>{if(current&&confirm("Apagar esta história?")){await del("saves",current.id);current=null;localStorage.removeItem("lastSave");render();$("#menu").close()}};
 $("#importFile").onchange=async e=>{try{let x=JSON.parse(await e.target.files[0].text());x.id=crypto.randomUUID();x.updated=Date.now();await put("saves",x);current=x;localStorage.setItem("lastSave",x.id);render();$("#menu").close()}catch{alert("Save inválido.")}};
 $("#send").onclick=send;$("#input").onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send()}};$("#input").oninput=e=>{e.target.style.height="auto";e.target.style.height=Math.min(150,e.target.scrollHeight)+"px"};
 $$("nav button").forEach(b=>b.onclick=()=>{if(b.dataset.tab==="chat")return;({memory:memoryPanel,world:worldPanel,journal:journalPanel}[b.dataset.tab]||(()=>{}))()});
 $("#chat").onclick=async e=>{let b=e.target.closest("button");if(!b||!current)return;if(b.dataset.edit!==undefined){let i=+b.dataset.edit,n=prompt("Editar:",current.messages[i].content);if(n!==null){current.messages[i].content=n;await persist();render()}}if(b.dataset.cut!==undefined&&confirm("Apagar tudo depois desta mensagem?")){current.messages=current.messages.slice(0,+b.dataset.cut+1);await persist();render()}if(b.dataset.regen!==undefined){let i=+b.dataset.regen;current.messages=current.messages.slice(0,i+1);await generate(i)}};
 $("#panelBody").onclick=async e=>{if(e.target.id==="addMem"){let m=prompt("Nova memória:");if(m){current.memories.push(m);await persist();memoryPanel()}}if(e.target.dataset.delmem!==undefined){current.memories.splice(+e.target.dataset.delmem,1);await persist();memoryPanel()}};
 $("#saveSettings").onclick=()=>{saveSettingsObj({apiKey:$("#apiKey").value.trim(),model:$("#model").value.trim(),temperature:+$("#temperature").value,maxTokens:+$("#maxTokens").value,contextCount:+$("#contextCount").value});$("#setup").close()};
 $("#testGroq").onclick=async()=>{let old=settings();saveSettingsObj({...old,apiKey:$("#apiKey").value.trim(),model:$("#model").value.trim()});$("#testResult").textContent="Testando…";try{let r=await groq([{role:"user",content:"Responda apenas: OK"}],false),j=await r.json();$("#testResult").textContent="Conectado: "+(j.choices?.[0]?.message?.content||"OK")}catch(e){$("#testResult").textContent=e.message}};
 if("serviceWorker"in navigator)navigator.serviceWorker.register("./sw.js").catch(console.warn);
}
document.addEventListener("DOMContentLoaded",init);
})();