(() => {
"use strict";
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const DB="gaara-rpg-pages-v2", VER=1; let db,current=null,busy=false;
const CFG={model:"openai/gpt-oss-120b",temperature:.82,topP:.92,maxTokens:900,contextCount:10,apiKey:"",autoIntel:true};
const DAILY_MESSAGE_LIMIT=80;
function quotaKey(){const d=new Date();return `gaara-msg-${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`}
function quotaUsed(){return Number(localStorage.getItem(quotaKey())||0)}
function quotaRemaining(){return Math.max(0,DAILY_MESSAGE_LIMIT-quotaUsed())}
function consumeMessage(){localStorage.setItem(quotaKey(),String(quotaUsed()+1));renderQuota()}
function localResetAt(){const d=new Date();d.setHours(24,0,0,0);return d}
function fmtTime(d){return d.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}
function parseResetDuration(s){
 if(!s)return null; let ms=0,m;
 if((m=s.match(/([\d.]+)h/)))ms+=+m[1]*3600000;
 if((m=s.match(/([\d.]+)m/)))ms+=+m[1]*60000;
 if((m=s.match(/([\d.]+)s/)))ms+=+m[1]*1000;
 return ms?new Date(Date.now()+ms):null;
}
function groqStatus(){try{return JSON.parse(localStorage.getItem("groq-rate-status")||"{}")}catch{return{}}}
function saveGroqStatus(r){
 try{
  const h=n=>r.headers.get(n);
  const reset=parseResetDuration(h("x-ratelimit-reset-requests"));
  const s={limitRequests:h("x-ratelimit-limit-requests"),remainingRequests:h("x-ratelimit-remaining-requests"),remainingTokens:h("x-ratelimit-remaining-tokens"),limitTokens:h("x-ratelimit-limit-tokens"),resetAt:reset?.toISOString()||null,updated:Date.now()};
  if(s.limitRequests||s.remainingRequests||s.remainingTokens){localStorage.setItem("groq-rate-status",JSON.stringify(s));renderQuota()}
 }catch{}
}
function renderQuota(){
 const el=document.querySelector("#quotaText");if(!el)return;
 const g=groqStatus(), reset=g.resetAt?new Date(g.resetAt):localResetAt();
 el.textContent=`${quotaRemaining()}/${DAILY_MESSAGE_LIMIT} mensagens hoje · reinicia ${fmtTime(reset)}`;
 el.title=g.remainingRequests?`Groq: ${g.remainingRequests}/${g.limitRequests||"?"} requisições diárias restantes. Tokens/min restantes: ${g.remainingTokens||"?"}.`:"Limite local do RPG; o limite real da Groq também depende de requisições e tokens.";
}

const MAX_MSG_CHARS=1800, MAX_MEMORY_CHARS=240, MEMORY_LIMIT=5, FINAL_TEXT_CHARS=3800;
const compactText=(s,n=MAX_MSG_CHARS)=>String(s??"").replace(/\s+/g," ").trim().slice(0,n);
const terms=s=>new Set((String(s??"").toLowerCase().match(/[a-zà-ÿ0-9愛]{4,}/g)||[]).filter(x=>!["para","como","mais","essa","esse","isso","ainda","muito","pela","pelo","uma","com","sem","saruto","gaara"].includes(x)));
function relevantMemories(){
 if(!current?.memories?.length)return[];
 ensureMemorySchema();
 const q=terms(current.messages.slice(-4).map(x=>x.content).join(" "));
 return current.memories.map((m,i)=>{const mt=terms(m.text);const overlap=[...mt].reduce((n,t)=>n+(q.has(t)?3:0),0);const importance=(m.importance||3)*1.4;const recency=i/current.memories.length;return {m,score:overlap+importance+recency}})
 .sort((a,b)=>b.score-a.score).slice(0,MEMORY_LIMIT).map(x=>compactText(x.m.text,MAX_MEMORY_CHARS));
}
function compactState(){const w=current.world,r=current.relationship,e=current.emotion;const active=(w.events||[]).filter(x=>!x.done).slice(-3).map(x=>compactText(x.text,140)).join("; ")||"nenhum";const agenda=(w.agenda||[]).filter(x=>!x.done).slice(0,2).map(x=>`${x.owner}: ${compactText(x.text,120)} (${x.when})`).join("; ")||"nenhuma";const milestones=(current.milestones||[]).slice(-5).map(x=>compactText(x,100)).join("; ")||"nenhum";return `ESTADO: ${w.date}; ${w.time}; ${w.location}; ${w.situation}. Gaara: ${e.state}, intensidade ${e.intensity}/100. Relação: ${r.state}; fam ${r.familiarity}, conf ${r.trust}, abertura ${r.openness}, atração ${r.attraction}, intimidade ${r.intimacy}. Marcos: ${milestones}. Pendências: ${active}. Agenda: ${agenda}.`;}

const LABELS={familiarity:"Familiaridade",trust:"Confiança",openness:"Abertura emocional",attraction:"Atração",intimacy:"Intimidade"};
const WHO={gaara:"Gaara",temari:"Temari",kankuro:"Kankurō",matatabi:"Matatabi",saruto:"Saruto"};
function normalizeMemory(m){
 if(typeof m==="string")return {id:crypto.randomUUID(),text:m,type:"geral",importance:3,tags:[],characters:["gaara"],created:Date.now()};
 return {id:m.id||crypto.randomUUID(),text:m.text||m.memory||"",type:m.type||"geral",importance:Math.max(1,Math.min(5,Number(m.importance)||3)),tags:Array.isArray(m.tags)?m.tags:[],characters:Array.isArray(m.characters)?m.characters:["gaara"],created:m.created||Date.now()};
}
function ensureMemorySchema(){if(!current)return;current.memories=(current.memories||[]).map(normalizeMemory)}
function memoryText(m){return normalizeMemory(m).text}
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

function render(){renderQuota();
 $("#scene").textContent=current?`${current.world.date} · ${current.world.time} · ${current.world.location}`:"Sem história aberta";
 let c=$("#chat");c.innerHTML="";
 if(!current){c.innerHTML='<div class="card">Crie uma história no menu ☰.</div>';return}
 current.messages.forEach((m,i)=>{let a=document.createElement("article");a.className="msg "+m.role;a.innerHTML=`<div class="meta">${m.role==="user"?"Saruto":"Gaara"}</div>${esc(m.content)}<div class="actions"><button data-edit="${i}">Editar</button>${m.role==="assistant"?`<button data-regen="${i}">Regenerar</button>`:""}<button data-cut="${i}">Voltar daqui</button></div>`;c.appendChild(a)});c.scrollTop=c.scrollHeight;
}
async function create(){let t=prompt("Nome da história:","Gaara × Saruto")||"Gaara × Saruto";current=initial(t);await persist();localStorage.setItem("last",current.id);render();$("#menu").close()}
async function choose(){let a=(await all()).sort((x,y)=>y.updated-x.updated);if(!a.length)return alert("Nenhuma história.");let n=+prompt(a.map((x,i)=>`${i+1}. ${x.title}`).join("\n"));if(n>0&&n<=a.length){current=a[n-1];localStorage.setItem("last",current.id);render()}}
async function call(messages,stream=true){
 let s=cfg();if(!s.apiKey)throw Error("Configure a Groq API Key.");
 let r=await fetch("https://api.groq.com/openai/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+s.apiKey},body:JSON.stringify({model:s.model,messages,temperature:+s.temperature,top_p:+(s.topP??.92),reasoning_effort:"low",max_completion_tokens:+s.maxTokens,stream})});
 saveGroqStatus(r);
 if(!r.ok){
   if(r.status===429){const retry=r.headers.get("retry-after");throw Error(`Limite da Groq atingido.${retry?` Tente novamente em ${retry} segundos.`:" Aguarde o reset indicado no painel."}`)}
   throw Error(`Groq ${r.status}: ${await r.text()}`);
 }
 return r;
}
function knowledgeContext(){const recent=current.messages.slice(-8).map(x=>x.content.toLowerCase()).join(" ");const rows=(current.knowledge||[]).filter(x=>[...terms(x.fact)].some(t=>recent.includes(t))||x.knows.includes("gaara")).slice(0,6);return rows.length?rows.map(x=>`${compactText(x.fact,140)} [sabem: ${x.knows.join(",")}]`).join("\n"):"";}
function context(extra=""){const s=cfg(),recent=current.messages.slice(-Math.min(10,Number(s.contextCount)||10)).map(x=>({role:x.role,content:compactText(x.content)}));const mem=relevantMemories(),chapter=current.chapters?.at(-1)?.summary?compactText(current.chapters.at(-1).summary,650):"";const pieces=[SYSTEM,compactState()];if(chapter)pieces.push("RESUMO ANTERIOR: "+chapter);if(mem.length)pieces.push("MEMÓRIAS RELEVANTES:\n- "+mem.join("\n- "));const know=knowledgeContext();if(know)pieces.push("CONHECIMENTO RELEVANTE:\n"+know);if(extra)pieces.push(extra);return [{role:"system",content:pieces.join("\n\n")},...recent];}
async function send(){if(busy||!current)return;
 if(quotaRemaining()<=0){alert(`Você usou as ${DAILY_MESSAGE_LIMIT} mensagens de hoje. O limite local reinicia à meia-noite. Se a Groq tiver atingido um limite antes disso, vale o reset informado por ela.`);return}
 let t=compactText($("#input").value.trim(),MAX_MSG_CHARS);if(!t)return;$("#input").value="";consumeMessage();current.messages.push({id:crypto.randomUUID(),role:"user",content:t,time:Date.now()});current.turnsSinceIntel++;current.turnsSinceChapter++;await persist();render();await generate()}
async function generate(replace=null,cont=false){
 busy=true;$("#typing").hidden=false;
 try{let m=context(cont?"\nContinue a cena organicamente sem criar ação/fala/pensamento de Saruto.":"");if(cont)m.push({role:"user",content:"Continue a cena sem avançar o turno de Saruto."});let r=await call(m,true),rd=r.body.getReader(),dec=new TextDecoder(),buf="",out="",idx;
 if(replace!==null){idx=replace;current.messages[idx].content=""}else{current.messages.push({id:crypto.randomUUID(),role:"assistant",content:"",time:Date.now()});idx=current.messages.length-1}render();
 while(1){let z=await rd.read();if(z.done)break;buf+=dec.decode(z.value,{stream:true});let ls=buf.split("\n");buf=ls.pop();for(let line of ls){if(!line.startsWith("data: "))continue;let d=line.slice(6);if(d==="[DONE]")continue;try{let j=JSON.parse(d),t=j.choices?.[0]?.delta?.content||"";out+=t;if(out.length>FINAL_TEXT_CHARS)out=out.slice(0,FINAL_TEXT_CHARS);current.messages[idx].content=out;render()}catch{}}}
 await persist();await intelligence();
 }catch(e){alert(e.message)}finally{busy=false;$("#typing").hidden=true}
}
async function jsonAnalysis(prompt){
 let r=await call([{role:"system",content:"Retorne SOMENTE JSON válido, sem markdown."},{role:"user",content:prompt}],false),j=await r.json(),x=j.choices?.[0]?.message?.content||"{}";x=x.replace(/^```json\s*|```$/g,"").trim();return JSON.parse(x)
}
async function intelligence(){
 if(!cfg().autoIntel||current.turnsSinceIntel<4)return;
 let tr=current.messages.slice(-10).map(x=>(x.role==="user"?"SARUTO":"GAARA")+": "+compactText(x.content,900)).join("\n");
 let p=`Analise o RPG abaixo de modo CONSERVADOR. Não invente fatos. JSON:
{"memory":null|{"text":string,"type":"vínculo|revelação|promessa|conflito|preferência|evento|geral","importance":1..5,"tags":[string],"characters":["gaara"|"temari"|"kankuro"|"matatabi"]},"relationship":{"familiarity":-2..2,"trust":-2..2,"openness":-2..2,"attraction":-2..2,"intimacy":-2..2},"state":string|null,"emotion":{"state":string,"intensity":0..100,"cause":string},"world":{"time":string|null,"location":string|null,"weather":string|null,"situation":string|null,"advance_day":false},"new_event":null|string,"resolved_events":[],"milestone":null|string,"learned":[],"npc":{"temari":{"familiarity":-1..1,"trust":-1..1,"memory":null|string},"kankuro":{"familiarity":-1..1,"trust":-1..1,"memory":null|string},"matatabi":{"memory":null|string}}}
"learned" é lista de {"fact":texto EXATO de um fato já existente,"character":"gaara|temari|kankuro"} somente se a pessoa realmente aprendeu isso na cena. Não marque atração/marcos por simples olhar ou coincidência. Não faça o tempo avançar demais.
TRECHO:\n${tr}`;
 try{let a=await jsonAnalysis(p);if(a.memory){
 const nm=normalizeMemory(a.memory);
 if(nm.text&&!current.memories.some(x=>memoryText(x).toLowerCase()===nm.text.toLowerCase()))current.memories.push(nm);
}
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
 let tr=current.messages.slice(-16).map(x=>(x.role==="user"?"Saruto":"Gaara")+": "+compactText(x.content,700)).join("\n");try{let a=await jsonAnalysis(`Crie um registro conciso do capítulo sem inventar fatos. JSON {"title":"...","summary":"..."}.\n${tr}`);current.chapters.push({id:crypto.randomUUID(),title:a.title,summary:a.summary,date:current.world.date});current.turnsSinceChapter=0;await persist()}catch(e){console.warn(e)}
}
function panel(t,h){$("#panelTitle").textContent=t;$("#panelBody").innerHTML=h;$("#panel").showModal()}
function memories(){
 if(!current)return panel("Memórias","Abra uma história.");
 ensureMemorySchema();
 const cards=current.memories.slice().reverse().map((m,ri)=>{const i=current.memories.length-1-ri;return `<div class="memoryCard"><div class="memoryTop"><span class="memoryType">${esc(m.type)}</span><span class="stars">${"★".repeat(m.importance)}${"☆".repeat(5-m.importance)}</span></div><p>${esc(m.text)}</p>${m.tags.length?`<div class="chips">${m.tags.map(t=>`<span>${esc(t)}</span>`).join("")}</div>`:""}<div class="memoryFoot"><small>${m.characters.map(x=>WHO[x]||x).join(" · ")}</small><div><button data-em="${i}">Editar</button><button data-dm="${i}">Excluir</button></div></div></div>`}).join("");
 const npc=["gaara","temari","kankuro","matatabi"].map(w=>`<details><summary>${WHO[w]} <span>${(current.npcMemories[w]||[]).length}</span></summary>${(current.npcMemories[w]||[]).map(x=>`<div class="miniMemory">${esc(typeof x==="string"?x:(x.text||""))}</div>`).join("")||'<p class="empty">Nenhuma memória individual.</p>'}</details>`).join("");
 panel("Memórias",`<div class="sectionIntro"><div><b>Memória narrativa</b><small>Fatos duradouros selecionados por relevância e importância.</small></div><button id="addMem">＋ Adicionar</button></div>${cards||'<div class="emptyState">Ainda não há memórias permanentes.</div>'}<h3>Memórias por personagem</h3><div class="detailsList">${npc}</div>`);
}
function world(){
 if(!current)return panel("Mundo","Abra uma história.");
 const w=current.world;
 panel("Mundo",`<div class="heroCard"><small>AGORA</small><b>${esc(w.date)}</b><span>${esc(w.time)} · ${esc(w.location)}</span><p>${esc(w.situation)}</p><em>${esc(w.weather)}</em></div>
 <h3>Locais conhecidos</h3><div class="chips">${w.locations.map(x=>`<span>${esc(x)}</span>`).join("")}</div>
 <h3>Agenda</h3>${w.agenda.filter(x=>!x.done).map(x=>`<div class="infoRow"><div><b>${esc(x.owner)}</b><small>${esc(x.when)}</small></div><span>${esc(x.text)}</span></div>`).join("")||'<div class="emptyState">Nenhum compromisso pendente.</div>'}
 <h3>Fios narrativos</h3>${w.events.filter(x=>!x.done).map(x=>`<div class="threadCard"><i></i><span>${esc(x.text)}</span></div>`).join("")||'<div class="emptyState">Nenhum fio narrativo ativo.</div>'}`);
}
function journal(){
 panel("Diário",current?(current.chapters.slice().reverse().map((x,i)=>`<article class="chapter"><div class="chapterNo">${String(current.chapters.length-i).padStart(2,"0")}</div><div><small>${esc(x.date)}</small><b>${esc(x.title)}</b><p>${esc(x.summary)}</p></div></article>`).join("")||'<div class="emptyState">O diário será preenchido automaticamente conforme a história avança.</div>'):"Abra uma história.");
}
function intel(){
 if(!current)return panel("Inteligência","Abra uma história.");
 const r=current.relationship;
 const bars=["familiarity","trust","openness","attraction","intimacy"].map(k=>`<div class="metric"><div><span>${LABELS[k]}</span><b>${r[k]}</b></div><div class="bar"><i style="width:${r[k]}%"></i></div></div>`).join("");
 const facts=current.knowledge.map(x=>`<div class="knowledge"><p>${esc(x.fact)}</p><small>Sabem: ${x.knows.map(k=>WHO[k]||k).join(", ")}</small></div>`).join("");
 panel("Inteligência",`<div class="sectionIntro"><div><b>Vínculo Gaara → Saruto</b><small>${esc(r.state)}</small></div></div>${bars}
 <h3>Estado emocional de Gaara</h3><div class="heroCard emotion"><b>${esc(current.emotion.state)}</b><span>Intensidade ${current.emotion.intensity}/100</span><p>${esc(current.emotion.cause)}</p></div>
 <h3>Marcos do relacionamento</h3>${current.milestones.map(x=>`<div class="milestone">◆ <span>${esc(x)}</span></div>`).join("")||'<div class="emptyState">Nenhum marco importante ainda.</div>'}
 <h3>Conhecimento e segredos</h3>${facts}
 <h3>Relações com Saruto</h3><div class="npcGrid"><div class="npcCard"><b>Temari</b><span>Familiaridade ${current.npcRelations.temari.familiarity}</span><span>Confiança ${current.npcRelations.temari.trust}</span></div><div class="npcCard"><b>Kankurō</b><span>Familiaridade ${current.npcRelations.kankuro.familiarity}</span><span>Confiança ${current.npcRelations.kankuro.trust}</span></div></div>`);
}
async function recap(){if(!current)return;let last=current.chapters.at(-1);panel("Recap",`<div class="card"><b>Anteriormente</b><p>${esc(last?.summary||current.memories.slice(-4).map(memoryText).join(" "))||"A história está apenas começando."}</p></div><div class="card"><b>Agora</b><p>${esc(current.world.date)} · ${esc(current.world.time)} · ${esc(current.world.location)}</p><p>${esc(current.world.situation)}</p></div><h3>Pendências</h3>${current.world.events.filter(x=>!x.done).map(x=>`<div class="card">${esc(x.text)}</div>`).join("")||"<p>Nenhuma.</p>"}`)}
async function search(){let q=prompt("Buscar:");if(!q||!current)return;let a=current.messages.filter(x=>x.content.toLowerCase().includes(q.toLowerCase()));panel("Busca",a.map(x=>`<div class="card"><b>${x.role==="user"?"Saruto":"Gaara"}</b><p>${esc(x.content)}</p></div>`).join("")||"Nada encontrado.")}
function setup(){let s=cfg();$("#apiKey").value=s.apiKey;$("#model").value=s.model;$("#temperature").value=s.temperature;$("#maxTokens").value=s.maxTokens;$("#contextCount").value=s.contextCount;$("#setup").showModal()}
function exportSave(){if(!current)return;let b=new Blob([JSON.stringify(current,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=`gaara-${current.id}.json`;a.click()}
async function init(){
 await openDB();renderQuota();let id=localStorage.getItem("last");if(id)current=await get(id);render();
 $("#menuBtn").onclick=()=>$("#menu").showModal();$("#closeMenu").onclick=()=>$("#menu").close();$("#closePanel").onclick=()=>$("#panel").close();$("#closeSetup").onclick=()=>$("#setup").close();
 $("#newSave").onclick=create;$("#switchSave").onclick=async()=>{await choose();$("#menu").close()};$("#settings").onclick=()=>{$("#menu").close();setup()};$("#searchBtn").onclick=()=>{$("#menu").close();search()};$("#recapBtn").onclick=()=>{$("#menu").close();recap()};$("#exportBtn").onclick=exportSave;
 $("#clearBtn").onclick=async()=>{if(current&&confirm("Apagar esta história?")){await remove(current.id);current=null;localStorage.removeItem("last");render();$("#menu").close()}};
 $("#importFile").onchange=async e=>{try{let x=JSON.parse(await e.target.files[0].text());x.id=crypto.randomUUID();x.updated=Date.now();await put(x);current=x;localStorage.setItem("last",x.id);render();$("#menu").close()}catch(e){alert("Save inválido: "+e.message)}};
 $("#send").onclick=send;$("#continueBtn").onclick=()=>current&&generate(null,true);$("#intelBtn").onclick=intel;$("#input").onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send()}};
 $$("nav button").forEach(b=>b.onclick=()=>({memory:memories,world,journal}[b.dataset.tab]?.()));
 $("#chat").onclick=async e=>{let b=e.target.closest("button");if(!b||!current)return;if(b.dataset.edit!==undefined){let i=+b.dataset.edit,n=prompt("Editar:",current.messages[i].content);if(n!==null){current.messages[i].content=n;await persist();render()}}else if(b.dataset.cut!==undefined&&confirm("Apagar tudo depois desta mensagem?")){current.messages=current.messages.slice(0,+b.dataset.cut+1);await persist();render()}else if(b.dataset.regen!==undefined){let i=+b.dataset.regen;current.messages=current.messages.slice(0,i+1);await generate(i)}};
 $("#panelBody").onclick=async e=>{
 if(e.target.id==="addMem"){let text=prompt("O que deve ser lembrado?");if(text){let imp=Number(prompt("Importância de 1 a 5:","3"))||3;current.memories.push(normalizeMemory({text,importance:imp,type:"manual",characters:["gaara"]}));await persist();memories()}}
 else if(e.target.dataset.em!==undefined){let i=+e.target.dataset.em,m=normalizeMemory(current.memories[i]),text=prompt("Editar memória:",m.text);if(text!==null){m.text=text;let imp=Number(prompt("Importância de 1 a 5:",String(m.importance)))||m.importance;m.importance=Math.max(1,Math.min(5,imp));current.memories[i]=m;await persist();memories()}}
 else if(e.target.dataset.dm!==undefined&&confirm("Excluir esta memória?")){current.memories.splice(+e.target.dataset.dm,1);await persist();memories()}
};
 $("#saveSettings").onclick=()=>{setCfg({...cfg(),apiKey:$("#apiKey").value.trim(),model:$("#model").value.trim(),temperature:+$("#temperature").value,maxTokens:+$("#maxTokens").value,contextCount:+$("#contextCount").value});$("#setup").close()};
 $("#testGroq").onclick=async()=>{setCfg({...cfg(),apiKey:$("#apiKey").value.trim(),model:$("#model").value.trim()});$("#testResult").textContent="Testando…";try{let r=await call([{role:"user",content:"Responda somente OK"}],false),j=await r.json();$("#testResult").textContent="Conectado: "+j.choices[0].message.content}catch(e){$("#testResult").textContent=e.message}};
 if("serviceWorker"in navigator)navigator.serviceWorker.register("./sw.js").catch(console.warn);
}
document.addEventListener("DOMContentLoaded",init);
})();