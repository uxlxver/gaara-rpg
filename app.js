(() => {
"use strict";
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const DB="gaara-rpg-pages-v2", VER=1; let db,current=null,busy=false;
const CFG={model:"openai/gpt-oss-120b",temperature:.85,maxTokens:1400,contextCount:36,apiKey:"",autoIntel:true};
const clamp=n=>Math.max(0,Math.min(100,Number(n)||0)), esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const SYSTEM=`Você é o motor narrativo de um RPG persistente no universo de Naruto. Escreva em português brasileiro, terceira pessoa, diálogos com travessão.
GAARA: 18 anos, Quinto Kazekage. Reservado, observador, conciso, responsável, empático, emocionalmente contido sem ser robótico. Temari e Kankurō são seus irmãos. Gaara não é mais jinchūriki de Shukaku.
SARUTO: 18 anos, aniversário 23/03. Viajante sem aldeia, moreno, olhos felinos heterocrômicos verde/amarelo, cabelo azul-escuro com mechas azuis claras. Calmo, compreensivo, elegante, sensual e reservado. Jinchūriki de Matatabi; chamas azuis. Foi isolado e abandonado por ser visto como monstro e fugiu de sua aldeia distante. Possui 愛 azul perto da nuca.
AGÊNCIA: NUNCA escreva fala, pensamento, sentimento, decisão, movimento ou ação de Saruto. O usuário controla Saruto integralmente.
ROMANCE: Gaara e Saruto começam desconhecidos. O 愛 desperta curiosidade e identificação, nunca paixão automática. Romance slow burn, sustentado por convivência, confiança, vulnerabilidade e escolhas.
MUNDO: Sunagakure continua existindo fora do romance. Gaara tem obrigações de Kazekage. Temari, Kankurō, Matatabi e outros NPCs têm agência e conhecimento individual; ninguém sabe fatos que não aprendeu.
CANON: Rasa, Karura, Yashamaru e Chiyo são falecidos. Naruto teve papel importante na transformação de Gaara.
ESTILO: evite melodrama constante, repetição, terapia artificial, declarações precoces e fazer todo assunto voltar ao trauma. NPCs podem iniciar ações plausíveis. Faça cenas avançarem.`;

const OPENING=`O fim da tarde tingia as muralhas de Sunagakure de cobre quando os guardas anunciaram um viajante sem identificação de aldeia. Gaara estava próximo aos portões depois de uma inspeção, a cabaça às costas e relatórios sob um dos braços.

Seu olhar passou pelo recém-chegado sem pressa — e então parou por um instante a mais quando um movimento deixou visível, perto da nuca, um traço azul familiar demais.

愛.

Gaara não comentou. Ergueu os olhos novamente, a expressão contida apesar da curiosidade súbita.

— Você veio de longe.`;

function initial(title){
 return {id:crypto.randomUUID(),title,created:Date.now(),updated:Date.now(),
 messages:[{id:crypto.randomUUID(),role:"assistant",content:OPENING,time:Date.now()}],
 memories:[],chapters:[],npcMemories:{gaara:[],temari:[],kankuro:[],matatabi:[]},
 knowledge:[
  {fact:"Saruto é jinchūriki de Matatabi.",knows:["saruto","matatabi"],secret:true},
  {fact:"Saruto foi rejeitado e fugiu de sua antiga aldeia.",knows:["saruto","matatabi"],secret:true},
  {fact:"Saruto faz aniversário em 23/03.",knows:["saruto","matatabi"],secret:true},
  {fact:"O significado pessoal do 愛 de Saruto.",knows:["saruto","matatabi"],secret:true}
 ],
 milestones:[],
 relationship:{familiarity:0,trust:0,openness:0,attraction:0,intimacy:0,state:"Curiosidade"},
 npcRelations:{temari:{familiarity:0,trust:0},kankuro:{familiarity:0,trust:0}},
 emotion:{state:"calmo e curioso",intensity:18,cause:"o viajante e o kanji 愛"},
 world:{day:1,month:3,year:1,date:"01/03 — Ano 1",time:"fim da tarde",location:"Portões de Sunagakure",weather:"seco, vento leve",situation:"Primeiro encontro",
 locations:["Portões de Sunagakure","Torre do Kazekage","Residência de Gaara","Ruas centrais","Campo de treinamento","Deserto"],
 events:[],agenda:[
  {owner:"Gaara",when:"amanhã de manhã",text:"revisar relatórios e assuntos administrativos",done:false}
 ]},
 turnsSinceIntel:0, turnsSinceChapter:0};
}
function openDB(){return new Promise((res,rej)=>{let q=indexedDB.open(DB,VER);q.onupgradeneeded=e=>{let d=e.target.result;if(!d.objectStoreNames.contains("saves"))d.createObjectStore("saves",{keyPath:"id"})};q.onsuccess=e=>{db=e.target.result;res()};q.onerror=()=>rej(q.error)})}
const st=(m="readonly")=>db.transaction("saves",m).objectStore("saves");
const get=(k)=>new Promise((r,j)=>{let q=st().get(k);q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error)});
const all=()=>new Promise((r,j)=>{let q=st().getAll();q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error)});
const put=v=>new Promise((r,j)=>{let q=st("readwrite").put(v);q.onsuccess=()=>r(v);q.onerror=()=>j(q.error)});
const remove=k=>new Promise((r,j)=>{let q=st("readwrite").delete(k);q.onsuccess=()=>r();q.onerror=()=>j(q.error)});
const cfg=()=>({...CFG,...JSON.parse(localStorage.getItem("gaara-cfg")||"{}")});
const setCfg=x=>localStorage.setItem("gaara-cfg",JSON.stringify(x));
async function persist(){if(current){current.updated=Date.now();await put(current)}}

function render(){
 $("#scene").textContent=current?`${current.world.date} · ${current.world.time} · ${current.world.location}`:"Sem história aberta";
 let c=$("#chat");c.innerHTML="";
 if(!current){c.innerHTML='<div class="card">Crie uma história no menu ☰.</div>';return}
 current.messages.forEach((m,i)=>{let a=document.createElement("article");a.className="msg "+m.role;a.innerHTML=`<div class="meta">${m.role==="user"?"Saruto":"Gaara"}</div>${esc(m.content)}<div class="actions"><button data-edit="${i}">Editar</button>${m.role==="assistant"?`<button data-regen="${i}">Regenerar</button>`:""}<button data-cut="${i}">Voltar daqui</button></div>`;c.appendChild(a)});c.scrollTop=c.scrollHeight;
}
async function create(){let t=prompt("Nome da história:","Gaara × Saruto")||"Gaara × Saruto";current=initial(t);await persist();localStorage.setItem("last",current.id);render();$("#menu").close()}
async function choose(){let a=(await all()).sort((x,y)=>y.updated-x.updated);if(!a.length)return alert("Nenhuma história.");let n=+prompt(a.map((x,i)=>`${i+1}. ${x.title}`).join("\n"));if(n>0&&n<=a.length){current=a[n-1];localStorage.setItem("last",current.id);render()}}
async function call(messages,stream=true){
 let s=cfg();if(!s.apiKey)throw Error("Configure a Groq API Key.");
 let r=await fetch("https://api.groq.com/openai/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+s.apiKey},body:JSON.stringify({model:s.model,messages,temperature:+s.temperature,max_completion_tokens:+s.maxTokens,stream})});
 if(!r.ok)throw Error(`Groq ${r.status}: ${await r.text()}`);return r;
}
function worldContext(){
 let w=current.world,r=current.relationship,n=current.npcRelations;
 let facts=current.knowledge.map(x=>`${x.fact} [sabem: ${x.knows.join(", ")}]`).join("\n");
 let agenda=w.agenda.filter(x=>!x.done).map(x=>`- ${x.owner}: ${x.when} — ${x.text}`).join("\n");
 let events=w.events.filter(x=>!x.done).map(x=>"- "+x.text).join("\n");
 return `\nESTADO PERSISTENTE
Data: ${w.date}; período: ${w.time}; local: ${w.location}; clima: ${w.weather}; situação: ${w.situation}.
Gaara: emoção ${current.emotion.state} (${current.emotion.intensity}/100), causa: ${current.emotion.cause}.
Relação Gaara→Saruto: ${r.state}; familiaridade ${r.familiarity}; confiança ${r.trust}; abertura ${r.openness}; atração ${r.attraction}; intimidade ${r.intimacy}.
Temari→Saruto: familiaridade ${n.temari.familiarity}, confiança ${n.temari.trust}. Kankurō→Saruto: familiaridade ${n.kankuro.familiarity}, confiança ${n.kankuro.trust}.
Marcos: ${current.milestones.join("; ")||"nenhum"}.
Agenda:\n${agenda||"- nenhuma pendência"}\nFios ativos:\n${events||"- nenhum"}\nCONHECIMENTO INDIVIDUAL (respeite rigorosamente):\n${facts}
MEMÓRIAS GERAIS:\n${current.memories.slice(-18).map(x=>"- "+x).join("\n")||"- nenhuma"}`;
}
function context(extra=""){let s=cfg(),m=current.messages.slice(-s.contextCount).map(x=>({role:x.role,content:x.content}));return [{role:"system",content:SYSTEM+worldContext()+extra},...m]}
async function send(){if(busy||!current)return;let t=$("#input").value.trim();if(!t)return;$("#input").value="";current.messages.push({id:crypto.randomUUID(),role:"user",content:t,time:Date.now()});current.turnsSinceIntel++;current.turnsSinceChapter++;await persist();render();await generate()}
async function generate(replace=null,cont=false){
 busy=true;$("#typing").hidden=false;
 try{let m=context(cont?"\nContinue a cena organicamente sem criar ação/fala/pensamento de Saruto.":"");if(cont)m.push({role:"user",content:"Continue a cena sem avançar o turno de Saruto."});let r=await call(m,true),rd=r.body.getReader(),dec=new TextDecoder(),buf="",out="",idx;
 if(replace!==null){idx=replace;current.messages[idx].content=""}else{current.messages.push({id:crypto.randomUUID(),role:"assistant",content:"",time:Date.now()});idx=current.messages.length-1}render();
 while(1){let z=await rd.read();if(z.done)break;buf+=dec.decode(z.value,{stream:true});let ls=buf.split("\n");buf=ls.pop();for(let line of ls){if(!line.startsWith("data: "))continue;let d=line.slice(6);if(d==="[DONE]")continue;try{let j=JSON.parse(d),t=j.choices?.[0]?.delta?.content||"";out+=t;current.messages[idx].content=out;render()}catch{}}}
 await persist();await intelligence();
 }catch(e){alert(e.message)}finally{busy=false;$("#typing").hidden=true}
}
async function jsonAnalysis(prompt){
 let r=await call([{role:"system",content:"Retorne SOMENTE JSON válido, sem markdown."},{role:"user",content:prompt}],false),j=await r.json(),x=j.choices?.[0]?.message?.content||"{}";x=x.replace(/^```json\s*|```$/g,"").trim();return JSON.parse(x)
}
async function intelligence(){
 if(!cfg().autoIntel||current.turnsSinceIntel<4)return;
 let tr=current.messages.slice(-12).map(x=>(x.role==="user"?"SARUTO":"GAARA")+": "+x.content).join("\n");
 let p=`Analise o RPG abaixo de modo CONSERVADOR. Não invente fatos. JSON:
{"memory":null|string,"relationship":{"familiarity":-2..2,"trust":-2..2,"openness":-2..2,"attraction":-2..2,"intimacy":-2..2},"state":string|null,"emotion":{"state":string,"intensity":0..100,"cause":string},"world":{"time":string|null,"location":string|null,"weather":string|null,"situation":string|null,"advance_day":false},"new_event":null|string,"resolved_events":[],"milestone":null|string,"learned":[],"npc":{"temari":{"familiarity":-1..1,"trust":-1..1,"memory":null|string},"kankuro":{"familiarity":-1..1,"trust":-1..1,"memory":null|string},"matatabi":{"memory":null|string}}}
"learned" é lista de {"fact":texto EXATO de um fato já existente,"character":"gaara|temari|kankuro"} somente se a pessoa realmente aprendeu isso na cena. Não marque atração/marcos por simples olhar ou coincidência. Não faça o tempo avançar demais.
TRECHO:\n${tr}`;
 try{let a=await jsonAnalysis(p);if(a.memory&&!current.memories.includes(a.memory))current.memories.push(a.memory);
 for(let k of ["familiarity","trust","openness","attraction","intimacy"])current.relationship[k]=clamp(current.relationship[k]+Number(a.relationship?.[k]||0));
 if(a.state)current.relationship.state=a.state;if(a.emotion){current.emotion={...current.emotion,...a.emotion}}
 let w=a.world||{};if(w.time)current.world.time=w.time;if(w.location){current.world.location=w.location;if(!current.world.locations.includes(w.location))current.world.locations.push(w.location)}if(w.weather)current.world.weather=w.weather;if(w.situation)current.world.situation=w.situation;if(w.advance_day)advanceDay();
 if(a.new_event)current.world.events.push({id:crypto.randomUUID(),text:a.new_event,done:false});for(let text of a.resolved_events||[]){let e=current.world.events.find(x=>x.text===text);if(e)e.done=true}
 if(a.milestone&&!current.milestones.includes(a.milestone))current.milestones.push(a.milestone);
 for(let l of a.learned||[]){let f=current.knowledge.find(x=>x.fact===l.fact);if(f&&!f.knows.includes(l.character))f.knows.push(l.character)}
 for(let who of ["temari","kankuro"]){let q=a.npc?.[who];if(q){current.npcRelations[who].familiarity=clamp(current.npcRelations[who].familiarity+(q.familiarity||0));current.npcRelations[who].trust=clamp(current.npcRelations[who].trust+(q.trust||0));if(q.memory)current.npcMemories[who].push(q.memory)}}
 if(a.npc?.matatabi?.memory)current.npcMemories.matatabi.push(a.npc.matatabi.memory);current.turnsSinceIntel=0;await persist();if(current.turnsSinceChapter>=12)await makeChapter();
 }catch(e){console.warn("intelligence",e)}
}
function advanceDay(){let w=current.world;let d=new Date(2001,w.month-1,w.day+1);w.day=d.getDate();w.month=d.getMonth()+1;w.date=String(w.day).padStart(2,"0")+"/"+String(w.month).padStart(2,"0")+" — Ano "+w.year;if(w.day===23&&w.month===3)w.events.push({id:crypto.randomUUID(),text:"Hoje é aniversário de Saruto. Somente personagens que sabem a data podem reconhecê-lo.",done:false})}
async function makeChapter(){
 let tr=current.messages.slice(-28).map(x=>(x.role==="user"?"Saruto":"Gaara")+": "+x.content).join("\n");try{let a=await jsonAnalysis(`Crie um registro conciso do capítulo sem inventar fatos. JSON {"title":"...","summary":"..."}.\n${tr}`);current.chapters.push({id:crypto.randomUUID(),title:a.title,summary:a.summary,date:current.world.date});current.turnsSinceChapter=0;await persist()}catch(e){console.warn(e)}
}
function panel(t,h){$("#panelTitle").textContent=t;$("#panelBody").innerHTML=h;$("#panel").showModal()}
function memories(){if(!current)return panel("Memória","Abra uma história.");panel("Memória",`<button id="addMem">Adicionar</button>${current.memories.map((m,i)=>`<div class="card row">${esc(m)}<button data-dm="${i}">✕</button></div>`).join("")||'<p class="muted">Nenhuma.</p>'}<h3>Matatabi</h3>${current.npcMemories.matatabi.map(x=>`<div class="card">${esc(x)}</div>`).join("")||'<p class="muted">Nenhuma memória própria ainda.</p>'}`)}
function world(){if(!current)return panel("Mundo","Abra uma história.");let w=current.world;panel("Mundo",`<div class="card"><b>${w.date}</b><p>${esc(w.time)} · ${esc(w.location)}</p><p>${esc(w.weather)}</p><p>${esc(w.situation)}</p></div><h3>Locais</h3>${w.locations.map(x=>`<span class="tag">${esc(x)}</span>`).join("")}<h3>Agenda</h3>${w.agenda.map(x=>`<div class="card">${esc(x.owner)} · ${esc(x.when)}<br>${esc(x.text)}</div>`).join("")}<h3>Fios ativos</h3>${w.events.filter(x=>!x.done).map(x=>`<div class="card event">${esc(x.text)}</div>`).join("")||'<p class="muted">Nenhum.</p>'}`)}
function journal(){panel("Diário",current?(current.chapters.map(x=>`<div class="card"><b>${esc(x.title)}</b><small>${esc(x.date)}</small><p>${esc(x.summary)}</p></div>`).join("")||'<p class="muted">Ainda sem capítulos automáticos.</p>'):"Abra uma história.")}
function intel(){if(!current)return panel("Inteligência","Abra uma história.");let r=current.relationship;panel("Inteligência",`<h3>Gaara → Saruto</h3>${Object.entries(r).filter(x=>x[0]!=="state").map(([k,v])=>`${k}: ${v}<div class="bar"><i style="width:${v}%"></i></div>`).join("")}<p>Estado: <b>${esc(r.state)}</b></p><h3>Emoção</h3><div class="card">${esc(current.emotion.state)} (${current.emotion.intensity}/100)<br><span class="muted">${esc(current.emotion.cause)}</span></div><h3>Marcos</h3>${current.milestones.map(x=>`<div class="card">${esc(x)}</div>`).join("")||'<p class="muted">Nenhum.</p>'}<h3>Conhecimento / segredos</h3>${current.knowledge.map(x=>`<div class="card">${esc(x.fact)}<br><span class="muted">Sabem: ${esc(x.knows.join(", "))}</span></div>`).join("")}<h3>Temari</h3><div class="card">Familiaridade ${current.npcRelations.temari.familiarity} · confiança ${current.npcRelations.temari.trust}</div><h3>Kankurō</h3><div class="card">Familiaridade ${current.npcRelations.kankuro.familiarity} · confiança ${current.npcRelations.kankuro.trust}</div>`)}
async function recap(){if(!current)return;let last=current.chapters.at(-1);panel("Recap",`<div class="card"><b>Anteriormente</b><p>${esc(last?.summary||current.memories.slice(-4).join(" "))||"A história está apenas começando."}</p></div><div class="card"><b>Agora</b><p>${esc(current.world.date)} · ${esc(current.world.time)} · ${esc(current.world.location)}</p><p>${esc(current.world.situation)}</p></div><h3>Pendências</h3>${current.world.events.filter(x=>!x.done).map(x=>`<div class="card">${esc(x.text)}</div>`).join("")||"<p>Nenhuma.</p>"}`)}
async function search(){let q=prompt("Buscar:");if(!q||!current)return;let a=current.messages.filter(x=>x.content.toLowerCase().includes(q.toLowerCase()));panel("Busca",a.map(x=>`<div class="card"><b>${x.role==="user"?"Saruto":"Gaara"}</b><p>${esc(x.content)}</p></div>`).join("")||"Nada encontrado.")}
function setup(){let s=cfg();$("#apiKey").value=s.apiKey;$("#model").value=s.model;$("#temperature").value=s.temperature;$("#maxTokens").value=s.maxTokens;$("#contextCount").value=s.contextCount;$("#setup").showModal()}
function exportSave(){if(!current)return;let b=new Blob([JSON.stringify(current,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=`gaara-${current.id}.json`;a.click()}
async function init(){
 await openDB();let id=localStorage.getItem("last");if(id)current=await get(id);render();
 $("#menuBtn").onclick=()=>$("#menu").showModal();$("#closeMenu").onclick=()=>$("#menu").close();$("#closePanel").onclick=()=>$("#panel").close();$("#closeSetup").onclick=()=>$("#setup").close();
 $("#newSave").onclick=create;$("#switchSave").onclick=async()=>{await choose();$("#menu").close()};$("#settings").onclick=()=>{$("#menu").close();setup()};$("#searchBtn").onclick=()=>{$("#menu").close();search()};$("#recapBtn").onclick=()=>{$("#menu").close();recap()};$("#exportBtn").onclick=exportSave;
 $("#clearBtn").onclick=async()=>{if(current&&confirm("Apagar esta história?")){await remove(current.id);current=null;localStorage.removeItem("last");render();$("#menu").close()}};
 $("#importFile").onchange=async e=>{try{let x=JSON.parse(await e.target.files[0].text());x.id=crypto.randomUUID();x.updated=Date.now();await put(x);current=x;localStorage.setItem("last",x.id);render();$("#menu").close()}catch(e){alert("Save inválido: "+e.message)}};
 $("#send").onclick=send;$("#continueBtn").onclick=()=>current&&generate(null,true);$("#intelBtn").onclick=intel;$("#input").onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send()}};
 $$("nav button").forEach(b=>b.onclick=()=>({memory:memories,world,journal}[b.dataset.tab]?.()));
 $("#chat").onclick=async e=>{let b=e.target.closest("button");if(!b||!current)return;if(b.dataset.edit!==undefined){let i=+b.dataset.edit,n=prompt("Editar:",current.messages[i].content);if(n!==null){current.messages[i].content=n;await persist();render()}}else if(b.dataset.cut!==undefined&&confirm("Apagar tudo depois desta mensagem?")){current.messages=current.messages.slice(0,+b.dataset.cut+1);await persist();render()}else if(b.dataset.regen!==undefined){let i=+b.dataset.regen;current.messages=current.messages.slice(0,i+1);await generate(i)}};
 $("#panelBody").onclick=async e=>{if(e.target.id==="addMem"){let m=prompt("Nova memória:");if(m){current.memories.push(m);await persist();memories()}}else if(e.target.dataset.dm!==undefined){current.memories.splice(+e.target.dataset.dm,1);await persist();memories()}};
 $("#saveSettings").onclick=()=>{setCfg({...cfg(),apiKey:$("#apiKey").value.trim(),model:$("#model").value.trim(),temperature:+$("#temperature").value,maxTokens:+$("#maxTokens").value,contextCount:+$("#contextCount").value});$("#setup").close()};
 $("#testGroq").onclick=async()=>{setCfg({...cfg(),apiKey:$("#apiKey").value.trim(),model:$("#model").value.trim()});$("#testResult").textContent="Testando…";try{let r=await call([{role:"user",content:"Responda somente OK"}],false),j=await r.json();$("#testResult").textContent="Conectado: "+j.choices[0].message.content}catch(e){$("#testResult").textContent=e.message}};
 if("serviceWorker"in navigator)navigator.serviceWorker.register("./sw.js").catch(console.warn);
}
document.addEventListener("DOMContentLoaded",init);
})();