import os, sqlite3, json, asyncio
from pathlib import Path
from datetime import datetime
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

ROOT=Path(__file__).parent
load_dotenv(ROOT/'.env')
DB=Path(os.getenv('DATABASE_PATH', str(ROOT/'data'/'rpg.db'))); DB.parent.mkdir(parents=True, exist_ok=True)
app=FastAPI(title='Gaara RPG')
app.mount('/static', StaticFiles(directory=ROOT/'static'), name='static')

@app.get('/health')
def health():
    return {'status': 'ok'}

def db():
    c=sqlite3.connect(DB); c.row_factory=sqlite3.Row; return c

def init():
    c=db(); c.executescript('''
    CREATE TABLE IF NOT EXISTS saves(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT,save_id INTEGER NOT NULL,role TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(save_id) REFERENCES saves(id));
    CREATE TABLE IF NOT EXISTS memories(id INTEGER PRIMARY KEY AUTOINCREMENT,save_id INTEGER NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(save_id) REFERENCES saves(id));
    CREATE TABLE IF NOT EXISTS relationship(save_id INTEGER PRIMARY KEY,familiarity INTEGER DEFAULT 0,trust INTEGER DEFAULT 0,openness INTEGER DEFAULT 0,attraction INTEGER DEFAULT 0,intimacy INTEGER DEFAULT 0,state TEXT DEFAULT 'Curiosidade');
    CREATE TABLE IF NOT EXISTS chapters(id INTEGER PRIMARY KEY AUTOINCREMENT,save_id INTEGER NOT NULL,number INTEGER NOT NULL,title TEXT NOT NULL,summary TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(save_id,number));
    CREATE TABLE IF NOT EXISTS meta(save_id INTEGER PRIMARY KEY,last_analysis_message_id INTEGER DEFAULT 0,last_chapter_message_id INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS settings(save_id INTEGER PRIMARY KEY,temperature REAL DEFAULT 0.9,top_p REAL DEFAULT 0.95,max_tokens INTEGER DEFAULT 1000,context_messages INTEGER DEFAULT 32,style TEXT DEFAULT 'equilibrado',auto_memory INTEGER DEFAULT 1,auto_chapters INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS scene_state(save_id INTEGER PRIMARY KEY,day INTEGER DEFAULT 1,time_of_day TEXT DEFAULT 'fim da tarde',location TEXT DEFAULT 'Sunagakure',weather TEXT DEFAULT 'seco, vento leve',situation TEXT DEFAULT 'Primeiro encontro',updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS npc_relations(save_id INTEGER NOT NULL,npc TEXT NOT NULL,familiarity INTEGER DEFAULT 0,trust INTEGER DEFAULT 0,attitude TEXT DEFAULT 'Desconhecido',notes TEXT DEFAULT '',PRIMARY KEY(save_id,npc));
    CREATE TABLE IF NOT EXISTS world_events(id INTEGER PRIMARY KEY AUTOINCREMENT,save_id INTEGER NOT NULL,title TEXT NOT NULL,content TEXT NOT NULL,status TEXT DEFAULT 'ativo',created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS npc_memories(id INTEGER PRIMARY KEY AUTOINCREMENT,save_id INTEGER NOT NULL,npc TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS calendar_events(id INTEGER PRIMARY KEY AUTOINCREMENT,save_id INTEGER NOT NULL,month INTEGER NOT NULL,day INTEGER NOT NULL,title TEXT NOT NULL,description TEXT DEFAULT '',annual INTEGER DEFAULT 1,UNIQUE(save_id,month,day,title));
    CREATE TABLE IF NOT EXISTS world_meta(save_id INTEGER PRIMARY KEY,last_world_message_id INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS locations(id INTEGER PRIMARY KEY AUTOINCREMENT,save_id INTEGER NOT NULL,name TEXT NOT NULL,description TEXT DEFAULT '',category TEXT DEFAULT 'Suna',visited INTEGER DEFAULT 0,UNIQUE(save_id,name));
    CREATE TABLE IF NOT EXISTS agenda(id INTEGER PRIMARY KEY AUTOINCREMENT,save_id INTEGER NOT NULL,day INTEGER NOT NULL,month INTEGER NOT NULL,year INTEGER NOT NULL,time_of_day TEXT DEFAULT 'manhã',title TEXT NOT NULL,description TEXT DEFAULT '',owner TEXT DEFAULT 'Gaara',status TEXT DEFAULT 'pendente');
    CREATE TABLE IF NOT EXISTS npc_initiative_meta(save_id INTEGER PRIMARY KEY,last_message_id INTEGER DEFAULT 0,last_calendar_day INTEGER DEFAULT 0);
    '''); c.commit(); c.close()
init()
def migrate():
    c=db()
    cols={r['name'] for r in c.execute('PRAGMA table_info(scene_state)')}
    for name,decl in [('calendar_day','INTEGER DEFAULT 1'),('calendar_month','INTEGER DEFAULT 3'),('calendar_year','INTEGER DEFAULT 1')]:
        if name not in cols: c.execute(f'ALTER TABLE scene_state ADD COLUMN {name} {decl}')
    cols={r['name'] for r in c.execute('PRAGMA table_info(settings)')}
    if 'auto_world' not in cols: c.execute('ALTER TABLE settings ADD COLUMN auto_world INTEGER DEFAULT 1')
    c.commit(); c.close()
migrate()

def prompt(name): return (ROOT/'prompts'/name).read_text(encoding='utf-8')
BASE='\n\n'.join(prompt(x) for x in ['system.md','gaara.md','saruto.md','world.md'])
DEFAULT_LOCATIONS=[('Torre do Kazekage','Centro administrativo de Suna e principal local de trabalho de Gaara.','Suna'),('Residência de Gaara','Espaço privado e tranquilo de Gaara em Sunagakure.','Suna'),('Ruas centrais de Sunagakure','Área movimentada com moradores, shinobi e comércio local.','Suna'),('Portões de Sunagakure','Entrada fortificada da vila, usada por viajantes, caravanas e shinobi.','Suna'),('Campo de treinamento','Área destinada a treinamento e prática shinobi.','Suna'),('Deserto ao redor de Suna','Extensão árida que circunda a vila, com calor intenso durante o dia e frio à noite.','Arredores')]

def get_save(sid):
    c=db(); s=c.execute('SELECT * FROM saves WHERE id=?',(sid,)).fetchone(); c.close(); return s

def get_settings(sid):
    c=db(); r=c.execute('SELECT * FROM settings WHERE save_id=?',(sid,)).fetchone()
    if not r:
        c.execute('INSERT OR IGNORE INTO settings(save_id) VALUES(?)',(sid,)); c.commit(); r=c.execute('SELECT * FROM settings WHERE save_id=?',(sid,)).fetchone()
    out=dict(r); c.close(); return out

def style_instruction(style):
    return {
      'conciso':'ESTILO ATUAL: respostas mais concisas, com foco em diálogo e ações relevantes; evite alongar cenas comuns.',
      'literario':'ESTILO ATUAL: prosa mais atmosférica e detalhada, sem perder naturalidade, sem controlar Saruto e sem cair em melodrama.',
      'dialogo':'ESTILO ATUAL: priorize diálogo natural e interação; narração apenas o suficiente para situar ações, expressões e ambiente.',
      'equilibrado':'ESTILO ATUAL: equilibre diálogo, ação e ambientação; varie o tamanho conforme a importância da cena.'
    }.get(style,'ESTILO ATUAL: equilibre diálogo, ação e ambientação.')

def get_world_state(sid):
    c=db(); st=c.execute('SELECT * FROM scene_state WHERE save_id=?',(sid,)).fetchone(); npcs=[dict(x) for x in c.execute('SELECT * FROM npc_relations WHERE save_id=? ORDER BY npc',(sid,))]; events=[dict(x) for x in c.execute("SELECT * FROM world_events WHERE save_id=? AND status='ativo' ORDER BY id DESC LIMIT 6",(sid,))][::-1]; c.close(); return (dict(st) if st else None),npcs,events

def context(sid):
    cfg=get_settings(sid); c=db()
    mem=[r['content'] for r in c.execute('SELECT content FROM memories WHERE save_id=? ORDER BY id DESC LIMIT 30',(sid,)).fetchall()][::-1]
    rel=c.execute('SELECT * FROM relationship WHERE save_id=?',(sid,)).fetchone()
    msgs=c.execute('SELECT role,content FROM messages WHERE save_id=? ORDER BY id DESC LIMIT ?',(sid,int(cfg['context_messages']))).fetchall()[::-1]
    c.close()
    extra='\n\nMEMÓRIAS IMPORTANTES:\n'+('\n'.join('- '+x for x in mem) if mem else 'Nenhuma ainda.')
    if rel: extra+=f"\n\nESTADO INTERNO DO VÍNCULO (não mostre números ao usuário): familiaridade {rel['familiarity']}, confiança {rel['trust']}, abertura {rel['openness']}, atração {rel['attraction']}, intimidade {rel['intimacy']}; estado: {rel['state']}. Não trate estes valores como mecânica explícita."
    st,npcs,events=get_world_state(sid)
    if st: extra+=f"\n\nESTADO DA CENA: dia narrativo {st['day']}; calendário {st.get('calendar_day',1):02d}/{st.get('calendar_month',3):02d}, ano {st.get('calendar_year',1)}; {st['time_of_day']}; local {st['location']}; clima {st['weather']}. {st['situation']}"
    if npcs:
        extra+='\nNPCs e Saruto: '+'; '.join(f"{n['npc']}: {n['attitude']}" for n in npcs)
        cc=db(); nm=[dict(x) for x in cc.execute('SELECT npc,content FROM npc_memories WHERE save_id=? ORDER BY id DESC LIMIT 12',(sid,))]; cc.close()
        if nm: extra+='\nMEMÓRIAS DOS NPCs: '+' | '.join(f"{x['npc']}: {x['content']}" for x in reversed(nm))
    if events: extra+='\nFIOS ATIVOS: '+' | '.join(f"{e['title']}: {e['content']}" for e in events)
    cc=db(); agenda=[dict(x) for x in cc.execute("SELECT * FROM agenda WHERE save_id=? AND status='pendente' ORDER BY year,month,day,id LIMIT 8",(sid,))]; locs=[dict(x) for x in cc.execute('SELECT name,description,visited FROM locations WHERE save_id=? ORDER BY visited DESC,id LIMIT 10',(sid,))]; cc.close()
    if agenda: extra+='\nAGENDA E COMPROMISSOS FUTUROS: '+' | '.join(f"{a['day']:02d}/{a['month']:02d} {a['time_of_day']} — {a['owner']}: {a['title']} ({a['description']})" for a in agenda)
    if locs: extra+='\nLOCAIS CONHECIDOS/PERSISTENTES: '+' | '.join(f"{l['name']}: {l['description']}" for l in locs)
    extra+='\nO mundo tem vida própria: NPCs, deveres do Kazekage e acontecimentos podem surgir naturalmente, sem controlar Saruto e sem forçar evento em toda resposta.'
    extra+='\n\n'+style_instruction(cfg['style'])
    return BASE+extra,[{'role':r['role'],'content':r['content']} for r in msgs],cfg

async def groq_json(messages, max_tokens=700):
    key=os.getenv('GROQ_API_KEY'); model=os.getenv('GROQ_MODEL','openai/gpt-oss-120b')
    if not key: return None
    payload={'model':model,'messages':messages,'temperature':0.2,'top_p':0.9,'max_tokens':max_tokens,'stream':False,'response_format':{'type':'json_object'}}
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            r=await client.post('https://api.groq.com/openai/v1/chat/completions',headers={'Authorization':f'Bearer {key}','Content-Type':'application/json'},json=payload)
            if r.status_code>=400: return None
            return json.loads(r.json()['choices'][0]['message']['content'])
    except Exception: return None

def clamp(v): return max(0,min(100,int(v)))
def rel_state(r):
    f,t,o,a,i=[r[k] for k in ('familiarity','trust','openness','attraction','intimacy')]
    if i>=70 and t>=70: return 'Vínculo íntimo'
    if a>=65 and t>=55: return 'Atração reconhecida'
    if a>=40 and f>=45: return 'Interesse crescente'
    if t>=35 or f>=35: return 'Familiaridade'
    if f>=15: return 'Curiosidade persistente'
    return 'Curiosidade'

async def analyze_story(sid:int):
    if not get_settings(sid)['auto_memory']: return
    c=db(); meta=c.execute('SELECT * FROM meta WHERE save_id=?',(sid,)).fetchone()
    if not meta:
        c.execute('INSERT OR IGNORE INTO meta(save_id) VALUES(?)',(sid,)); c.commit(); meta=c.execute('SELECT * FROM meta WHERE save_id=?',(sid,)).fetchone()
    rows=c.execute('SELECT id,role,content FROM messages WHERE save_id=? AND id>? ORDER BY id',(sid,meta['last_analysis_message_id'])).fetchall()
    if sum(1 for r in rows if r['role']=='assistant')<4: c.close(); return
    relrow=c.execute('SELECT * FROM relationship WHERE save_id=?',(sid,)).fetchone(); rel=dict(relrow) if relrow else {'familiarity':0,'trust':0,'openness':0,'attraction':0,'intimacy':0}
    existing=[x['content'] for x in c.execute('SELECT content FROM memories WHERE save_id=? ORDER BY id DESC LIMIT 20',(sid,)).fetchall()]
    last_id=rows[-1]['id']; excerpt='\n'.join(f"{r['role'].upper()}: {r['content'][:1800]}" for r in rows[-10:]); c.close()
    instruction='Você é um extrator de continuidade para um RPG Gaara/Saruto. Analise SOMENTE os eventos fornecidos. Retorne JSON com: memories (array de 0 a 3 fatos realmente duráveis, cada um em PT-BR e <=180 caracteres); deltas (objeto com familiarity, trust, openness, attraction, intimacy, cada inteiro de -3 a +3). Seja conservador. Conversa comum, refeição, olhar, flerte leve e pequenos gestos NÃO viram memória permanente. Não invente sentimentos de Saruto. Atração/confiança só mudam se houver evidência concreta na cena. Nunca acelere romance por destino, kanji ou semelhança de passado.'
    data=await groq_json([{'role':'system','content':instruction},{'role':'user','content':f"Memórias já existentes: {json.dumps(existing,ensure_ascii=False)}\nEstado atual: {json.dumps(rel,ensure_ascii=False)}\nNOVOS EVENTOS:\n{excerpt}"}],600)
    if not data: return
    c=db(); now=datetime.now().isoformat()
    for m in (data.get('memories') or [])[:3]:
        if isinstance(m,str) and 8<len(m)<=220 and m not in existing: c.execute('INSERT INTO memories(save_id,content,created_at) VALUES(?,?,?)',(sid,m.strip(),now))
    d=data.get('deltas') or {}; nr={}
    for k in ('familiarity','trust','openness','attraction','intimacy'):
        try: delta=max(-3,min(3,int(d.get(k,0) or 0)))
        except Exception: delta=0
        nr[k]=clamp(rel[k]+delta)
    nr['state']=rel_state(nr)
    c.execute('UPDATE relationship SET familiarity=?,trust=?,openness=?,attraction=?,intimacy=?,state=? WHERE save_id=?',(nr['familiarity'],nr['trust'],nr['openness'],nr['attraction'],nr['intimacy'],nr['state'],sid))
    c.execute('UPDATE meta SET last_analysis_message_id=? WHERE save_id=?',(last_id,sid)); c.commit(); c.close()

async def maybe_make_chapter(sid:int):
    if not get_settings(sid)['auto_chapters']: return
    c=db(); meta=c.execute('SELECT * FROM meta WHERE save_id=?',(sid,)).fetchone()
    if not meta: c.close(); return
    rows=c.execute('SELECT id,role,content FROM messages WHERE save_id=? AND id>? ORDER BY id',(sid,meta['last_chapter_message_id'])).fetchall()
    if sum(1 for r in rows if r['role']=='assistant')<12: c.close(); return
    num=c.execute('SELECT COALESCE(MAX(number),0)+1 n FROM chapters WHERE save_id=?',(sid,)).fetchone()['n']; last_id=rows[-1]['id']; c.close()
    excerpt='\n'.join(f"{r['role'].upper()}: {r['content'][:1400]}" for r in rows[-26:])
    data=await groq_json([{'role':'system','content':'Resuma um capítulo de RPG em PT-BR. Retorne JSON: {"title":"título curto sem número","summary":"resumo factual de 100 a 220 palavras"}. Não invente fatos nem pensamentos de Saruto.'},{'role':'user','content':excerpt}],550)
    if not data or not data.get('summary'): return
    c=db(); c.execute('INSERT OR IGNORE INTO chapters(save_id,number,title,summary,created_at) VALUES(?,?,?,?,?)',(sid,num,str(data.get('title') or 'Continuação')[:80],str(data['summary'])[:2200],datetime.now().isoformat())); c.execute('UPDATE meta SET last_chapter_message_id=? WHERE save_id=?',(last_id,sid)); c.commit(); c.close()

class SaveIn(BaseModel): title:str='Nova história'
class MsgIn(BaseModel): content:str
class EditIn(BaseModel): content:str
class MemoryIn(BaseModel): content:str
class ChapterIn(BaseModel): title:str; summary:str
class SettingsIn(BaseModel):
    temperature:float=0.9; top_p:float=0.95; max_tokens:int=1000; context_messages:int=32; style:str='equilibrado'; auto_memory:bool=True; auto_chapters:bool=True; auto_world:bool=True

@app.get('/',response_class=HTMLResponse)
def home(): return (ROOT/'templates'/'index.html').read_text(encoding='utf-8')
@app.get('/api/saves')
def saves():
    c=db(); rows=[dict(x) for x in c.execute('SELECT * FROM saves ORDER BY updated_at DESC')]; c.close(); return rows
@app.post('/api/saves')
def create_save(x:SaveIn):
    now=datetime.now().isoformat(); c=db(); cur=c.execute('INSERT INTO saves(title,created_at,updated_at) VALUES(?,?,?)',(x.title,now,now)); sid=cur.lastrowid
    c.execute('INSERT INTO relationship(save_id) VALUES(?)',(sid,)); c.execute('INSERT INTO meta(save_id) VALUES(?)',(sid,)); c.execute('INSERT INTO settings(save_id) VALUES(?)',(sid,)); c.execute('INSERT INTO scene_state(save_id,updated_at,calendar_day,calendar_month,calendar_year) VALUES(?,?,?,?,?)',(sid,now,1,3,1)); c.execute('INSERT INTO world_meta(save_id) VALUES(?)',(sid,)); c.execute('INSERT INTO npc_initiative_meta(save_id) VALUES(?)',(sid,)); [c.execute('INSERT OR IGNORE INTO locations(save_id,name,description,category) VALUES(?,?,?,?)',(sid,*loc)) for loc in DEFAULT_LOCATIONS]; c.execute('INSERT INTO agenda(save_id,day,month,year,time_of_day,title,description,owner) VALUES(?,?,?,?,?,?,?,?)',(sid,2,3,1,'manhã','Rotina administrativa do Kazekage','Revisão de relatórios, missões e assuntos internos de Sunagakure.','Gaara')); c.execute('INSERT OR IGNORE INTO calendar_events(save_id,month,day,title,description,annual) VALUES(?,?,?,?,?,1)',(sid,3,23,'Aniversário de Saruto','Aniversário de Saruto. Só personagens que aprenderam a data devem reconhecê-la.')); c.execute('INSERT INTO npc_relations(save_id,npc) VALUES(?,?),(?,?)',(sid,'Temari',sid,'Kankurō'))
    opening='''O fim da tarde cobria Sunagakure com uma luz dourada quando Gaara deixou a Torre do Kazekage. O trabalho havia se estendido além do previsto, e o movimento nas ruas começava a mudar com a queda gradual da temperatura do deserto.\n\nEle seguia sem escolta próxima, embora alguns shinobi mantivessem a atenção habitual à distância. Foi então que uma presença desconhecida chamou sua atenção entre os viajantes que atravessavam aquela parte da vila.\n\nGaara diminuiu o passo por um instante. Não reconhecia aquele chakra. Tampouco reconhecia o jovem.\n\nSeus olhos verdes permaneceram sobre o estranho apenas o suficiente para registrar sua presença antes de Gaara continuar, aparentemente indiferente.\n\nPor enquanto, era apenas um viajante que ele nunca tinha visto antes.'''
    c.execute('INSERT INTO messages(save_id,role,content,created_at) VALUES(?,?,?,?)',(sid,'assistant',opening,now)); c.commit(); c.close(); return {'id':sid}
@app.delete('/api/saves/{sid}')
def delete_save(sid:int):
    c=db()
    for table in ('messages','memories','chapters','relationship','meta','settings','scene_state','npc_relations','world_events','npc_memories','calendar_events','world_meta','locations','agenda','npc_initiative_meta'): c.execute(f'DELETE FROM {table} WHERE save_id=?',(sid,))
    c.execute('DELETE FROM saves WHERE id=?',(sid,)); c.commit(); c.close(); return {'ok':True}
@app.get('/api/saves/{sid}/messages')
def messages(sid:int):
    c=db(); rows=[dict(x) for x in c.execute('SELECT * FROM messages WHERE save_id=? ORDER BY id',(sid,))]; c.close(); return rows
@app.get('/api/saves/{sid}/memories')
def memories(sid:int):
    c=db(); rows=[dict(x) for x in c.execute('SELECT * FROM memories WHERE save_id=? ORDER BY id DESC',(sid,))]; rel=c.execute('SELECT * FROM relationship WHERE save_id=?',(sid,)).fetchone(); c.close(); return {'memories':rows,'relationship':dict(rel) if rel else None}
@app.get('/api/saves/{sid}/chapters')
def chapters(sid:int):
    c=db(); rows=[dict(x) for x in c.execute('SELECT * FROM chapters WHERE save_id=? ORDER BY number DESC',(sid,))]; c.close(); return rows
@app.get('/api/saves/{sid}/settings')
def settings(sid:int): return get_settings(sid)
@app.put('/api/saves/{sid}/settings')
def update_settings(sid:int,x:SettingsIn):
    if x.style not in {'equilibrado','conciso','literario','dialogo'}: raise HTTPException(400,'Estilo inválido')
    vals=(max(0,min(2,x.temperature)),max(0.05,min(1,x.top_p)),max(200,min(2500,x.max_tokens)),max(8,min(80,x.context_messages)),x.style,int(x.auto_memory),int(x.auto_chapters),int(x.auto_world),sid)
    c=db(); c.execute('UPDATE settings SET temperature=?,top_p=?,max_tokens=?,context_messages=?,style=?,auto_memory=?,auto_chapters=?,auto_world=? WHERE save_id=?',vals); c.commit(); c.close(); return {'ok':True}
@app.post('/api/saves/{sid}/memories')
def add_memory(sid:int,x:MemoryIn):
    c=db(); c.execute('INSERT INTO memories(save_id,content,created_at) VALUES(?,?,?)',(sid,x.content.strip(),datetime.now().isoformat())); c.commit(); c.close(); return {'ok':True}
@app.put('/api/memories/{mid}')
def edit_memory(mid:int,x:MemoryIn):
    c=db(); c.execute('UPDATE memories SET content=? WHERE id=?',(x.content.strip(),mid)); c.commit(); c.close(); return {'ok':True}
@app.delete('/api/memories/{mid}')
def delete_memory(mid:int):
    c=db(); c.execute('DELETE FROM memories WHERE id=?',(mid,)); c.commit(); c.close(); return {'ok':True}
@app.put('/api/chapters/{cid}')
def edit_chapter(cid:int,x:ChapterIn):
    c=db(); c.execute('UPDATE chapters SET title=?,summary=? WHERE id=?',(x.title.strip()[:80],x.summary.strip()[:2200],cid)); c.commit(); c.close(); return {'ok':True}
@app.delete('/api/chapters/{cid}')
def delete_chapter(cid:int):
    c=db(); c.execute('DELETE FROM chapters WHERE id=?',(cid,)); c.commit(); c.close(); return {'ok':True}
def advance_calendar(day,month,year,delta):
    mdays=[31,28,31,30,31,30,31,31,30,31,30,31]
    for _ in range(max(0,min(7,int(delta)))):
        day+=1
        if day>mdays[month-1]: day=1; month+=1
        if month>12: month=1; year+=1
    return day,month,year

async def analyze_world(sid:int):
    cfg=get_settings(sid)
    if not cfg.get('auto_world',1): return
    c=db(); wm=c.execute('SELECT * FROM world_meta WHERE save_id=?',(sid,)).fetchone()
    if not wm:
        c.execute('INSERT OR IGNORE INTO world_meta(save_id) VALUES(?)',(sid,)); c.commit(); wm=c.execute('SELECT * FROM world_meta WHERE save_id=?',(sid,)).fetchone()
    rows=c.execute('SELECT id,role,content FROM messages WHERE save_id=? AND id>? ORDER BY id',(sid,wm['last_world_message_id'])).fetchall()
    if sum(1 for r in rows if r['role']=='assistant')<2: c.close(); return
    st=dict(c.execute('SELECT * FROM scene_state WHERE save_id=?',(sid,)).fetchone()); npcs=[dict(x) for x in c.execute('SELECT * FROM npc_relations WHERE save_id=?',(sid,))]; active=[dict(x) for x in c.execute("SELECT * FROM world_events WHERE save_id=? AND status='ativo' ORDER BY id DESC LIMIT 8",(sid,))]
    excerpt='\n'.join(f"{r['role'].upper()}: {r['content'][:1600]}" for r in rows[-8:]); last_id=rows[-1]['id']; c.close()
    inst='Você mantém o estado de um RPG narrativo de Naruto. Extraia SOMENTE mudanças sustentadas pela cena. Nunca invente ações, pensamentos ou sentimentos de Saruto. JSON: {"time_of_day":string|null,"location":string|null,"weather":string|null,"situation":string|null,"advance_days":0..2,"npc_updates":[{"npc":"Temari|Kankurō","familiarity_delta":-2..2,"trust_delta":-2..2,"attitude":string|null,"memory":string|null}],"resolved_event_ids":[inteiros]}. Seja conservador. Só avance dia com passagem temporal clara. Mudança de NPC exige evidência. memory <=160 caracteres e apenas fato que o NPC deveria lembrar.'
    data=await groq_json([{'role':'system','content':inst},{'role':'user','content':f"Estado: {json.dumps(st,ensure_ascii=False)}\nNPCs: {json.dumps(npcs,ensure_ascii=False)}\nFios: {json.dumps(active,ensure_ascii=False)}\nCena:\n{excerpt}"}],650)
    if not data: return
    c=db(); now=datetime.now().isoformat()
    try: adv=max(0,min(2,int(data.get('advance_days',0) or 0)))
    except: adv=0
    cd,cm,cy=advance_calendar(st.get('calendar_day',1),st.get('calendar_month',3),st.get('calendar_year',1),adv)
    c.execute('UPDATE scene_state SET day=?,time_of_day=?,location=?,weather=?,situation=?,calendar_day=?,calendar_month=?,calendar_year=?,updated_at=? WHERE save_id=?',(st['day']+adv,str(data.get('time_of_day') or st['time_of_day'])[:60],str(data.get('location') or st['location'])[:100],str(data.get('weather') or st['weather'])[:100],str(data.get('situation') or st['situation'])[:300],cd,cm,cy,now,sid))
    for u in (data.get('npc_updates') or [])[:4]:
        npc=u.get('npc')
        if npc not in {'Temari','Kankurō'}: continue
        cur=c.execute('SELECT * FROM npc_relations WHERE save_id=? AND npc=?',(sid,npc)).fetchone()
        try: fd=max(-2,min(2,int(u.get('familiarity_delta',0) or 0))); td=max(-2,min(2,int(u.get('trust_delta',0) or 0)))
        except: fd=td=0
        c.execute('UPDATE npc_relations SET familiarity=?,trust=?,attitude=? WHERE save_id=? AND npc=?',(clamp(cur['familiarity']+fd),clamp(cur['trust']+td),str(u.get('attitude') or cur['attitude'])[:100],sid,npc))
        mem=u.get('memory')
        if isinstance(mem,str) and 8<len(mem)<=180 and not c.execute('SELECT 1 FROM npc_memories WHERE save_id=? AND npc=? AND content=?',(sid,npc,mem.strip())).fetchone(): c.execute('INSERT INTO npc_memories(save_id,npc,content,created_at) VALUES(?,?,?,?)',(sid,npc,mem.strip(),now))
    valid={x['id'] for x in active}
    for eid in data.get('resolved_event_ids') or []:
        if eid in valid: c.execute("UPDATE world_events SET status='encerrado' WHERE id=? AND save_id=?",(eid,sid))
    if cm==3 and cd==23 and not c.execute("SELECT 1 FROM world_events WHERE save_id=? AND title='23 de março' AND status='ativo'",(sid,)).fetchone(): c.execute('INSERT INTO world_events(save_id,title,content,status,created_at) VALUES(?,?,?,?,?)',(sid,'23 de março','Hoje é aniversário de Saruto. Apenas personagens que tenham aprendido a data podem reconhecê-la espontaneamente.','ativo',now))
    c.execute('UPDATE locations SET visited=visited+1 WHERE save_id=? AND lower(name)=lower(?)',(sid,str(data.get('location') or st['location'])[:100]))
    c.execute("UPDATE agenda SET status='concluído' WHERE save_id=? AND status='pendente' AND (year<? OR (year=? AND month<?) OR (year=? AND month=? AND day<?))",(sid,cy,cy,cm,cy,cm,cd))
    c.execute('UPDATE world_meta SET last_world_message_id=? WHERE save_id=?',(last_id,sid)); c.commit(); c.close()

@app.get('/api/saves/{sid}/world')
def world(sid:int):
    st,npcs,events=get_world_state(sid); c=db(); nm=[dict(x) for x in c.execute('SELECT * FROM npc_memories WHERE save_id=? ORDER BY id DESC LIMIT 20',(sid,))]; cal=[dict(x) for x in c.execute('SELECT * FROM calendar_events WHERE save_id=? ORDER BY month,day',(sid,))]; agenda=[dict(x) for x in c.execute("SELECT * FROM agenda WHERE save_id=? ORDER BY status,year,month,day,id",(sid,))]; locs=[dict(x) for x in c.execute('SELECT * FROM locations WHERE save_id=? ORDER BY visited DESC,id',(sid,))]; c.close(); return {'scene':st,'npcs':npcs,'events':events,'npc_memories':nm,'calendar':cal,'agenda':agenda,'locations':locs}

@app.post('/api/saves/{sid}/world-event')
async def world_event(sid:int):
    st,npcs,events=get_world_state(sid)
    c=db(); rows=c.execute('SELECT role,content FROM messages WHERE save_id=? ORDER BY id DESC LIMIT 8',(sid,)).fetchall()[::-1]; c.close()
    excerpt='\n'.join(f"{r['role'].upper()}: {r['content'][:1000]}" for r in rows)
    inst='Crie UM acontecimento orgânico curto para RPG em Sunagakure: dever do Kazekage, Temari/Kankurō, morador, clima, missão, segurança ou cotidiano. Não controle Saruto, não force romance, não crie catástrofe gratuita. JSON: {"title":"curto","content":"1-3 frases PT-BR"}.'
    data=await groq_json([{'role':'system','content':inst},{'role':'user','content':f"Estado: {json.dumps(st,ensure_ascii=False)}\nAtivos: {json.dumps(events,ensure_ascii=False)}\nRecente:\n{excerpt}"}],350)
    if not data or not data.get('content'): raise HTTPException(500,'Falha ao gerar acontecimento')
    c=db(); c.execute('INSERT INTO world_events(save_id,title,content,status,created_at) VALUES(?,?,?,?,?)',(sid,str(data.get('title') or 'Acontecimento')[:80],str(data['content'])[:500],'ativo',datetime.now().isoformat())); c.commit(); c.close(); return data

@app.delete('/api/world-events/{eid}')
def close_event(eid:int):
    c=db(); c.execute("UPDATE world_events SET status='encerrado' WHERE id=?",(eid,)); c.commit(); c.close(); return {'ok':True}

@app.delete('/api/messages/{mid}')
def delete_message(mid:int):
    c=db(); row=c.execute('SELECT save_id FROM messages WHERE id=?',(mid,)).fetchone()
    if not row: c.close(); raise HTTPException(404)
    c.execute('DELETE FROM messages WHERE id>=? AND save_id=?',(mid,row['save_id'])); c.execute('UPDATE meta SET last_analysis_message_id=MIN(last_analysis_message_id,?),last_chapter_message_id=MIN(last_chapter_message_id,?) WHERE save_id=?',(mid-1,mid-1,row['save_id'])); c.commit(); c.close(); return {'ok':True}
@app.put('/api/messages/{mid}')
def edit_message(mid:int,x:EditIn):
    c=db(); row=c.execute('SELECT save_id FROM messages WHERE id=?',(mid,)).fetchone()
    if not row: c.close(); raise HTTPException(404)
    c.execute('UPDATE messages SET content=? WHERE id=?',(x.content,mid)); c.execute('DELETE FROM messages WHERE save_id=? AND id>?',(row['save_id'],mid)); c.execute('UPDATE meta SET last_analysis_message_id=MIN(last_analysis_message_id,?),last_chapter_message_id=MIN(last_chapter_message_id,?) WHERE save_id=?',(mid,mid,row['save_id'])); c.commit(); c.close(); return {'ok':True}

async def stream_generation(sid:int, extra_instruction=None):
    key=os.getenv('GROQ_API_KEY'); model=os.getenv('GROQ_MODEL','openai/gpt-oss-120b')
    if not key: raise HTTPException(500,'Configure GROQ_API_KEY no arquivo .env')
    sys,msgs,cfg=context(sid)
    if extra_instruction: sys+='\n\nINSTRUÇÃO TEMPORÁRIA PARA ESTA GERAÇÃO:\n'+extra_instruction
    payload={'model':model,'messages':[{'role':'system','content':sys}]+msgs,'temperature':cfg['temperature'],'top_p':cfg['top_p'],'max_tokens':cfg['max_tokens'],'stream':True}
    async def gen():
        full=''
        try:
            async with httpx.AsyncClient(timeout=120) as client:
                async with client.stream('POST','https://api.groq.com/openai/v1/chat/completions',headers={'Authorization':f'Bearer {key}','Content-Type':'application/json'},json=payload) as r:
                    if r.status_code>=400: yield 'Erro Groq: '+(await r.aread()).decode(errors='ignore'); return
                    async for line in r.aiter_lines():
                        if not line.startswith('data: '): continue
                        data=line[6:]
                        if data=='[DONE]': break
                        try:
                            d=json.loads(data); t=d['choices'][0]['delta'].get('content') or ''
                            if t: full+=t; yield t
                        except Exception: pass
            if full.strip():
                c=db(); c.execute('INSERT INTO messages(save_id,role,content,created_at) VALUES(?,?,?,?)',(sid,'assistant',full,datetime.now().isoformat())); c.execute('UPDATE saves SET updated_at=? WHERE id=?',(datetime.now().isoformat(),sid)); c.commit(); c.close(); asyncio.create_task(analyze_story(sid)); asyncio.create_task(maybe_make_chapter(sid)); asyncio.create_task(analyze_world(sid)); asyncio.create_task(maybe_npc_initiative(sid))
                asyncio.create_task(analyze_v7(sid))
        except Exception as e: yield f'\n[Erro: {e}]'
    return StreamingResponse(gen(),media_type='text/plain; charset=utf-8')


class AgendaIn(BaseModel):
    day:int; month:int; year:int=1; time_of_day:str='manhã'; title:str; description:str=''; owner:str='Gaara'
class LocationIn(BaseModel): name:str; description:str=''; category:str='Suna'

@app.get('/api/saves/{sid}/agenda')
def get_agenda(sid:int):
    c=db(); rows=[dict(x) for x in c.execute("SELECT * FROM agenda WHERE save_id=? ORDER BY status,year,month,day,id",(sid,))]; c.close(); return rows
@app.post('/api/saves/{sid}/agenda')
def add_agenda(sid:int,x:AgendaIn):
    c=db(); c.execute('INSERT INTO agenda(save_id,day,month,year,time_of_day,title,description,owner,status) VALUES(?,?,?,?,?,?,?,?,?)',(sid,max(1,min(31,x.day)),max(1,min(12,x.month)),max(1,x.year),x.time_of_day[:40],x.title[:100],x.description[:400],x.owner[:50],'pendente')); c.commit(); c.close(); return {'ok':True}
@app.delete('/api/agenda/{aid}')
def finish_agenda(aid:int):
    c=db(); c.execute("UPDATE agenda SET status='concluído' WHERE id=?",(aid,)); c.commit(); c.close(); return {'ok':True}
@app.get('/api/saves/{sid}/locations')
def get_locations(sid:int):
    c=db(); rows=[dict(x) for x in c.execute('SELECT * FROM locations WHERE save_id=? ORDER BY visited DESC,id',(sid,))]; c.close(); return rows
@app.post('/api/saves/{sid}/locations')
def add_location(sid:int,x:LocationIn):
    c=db(); c.execute('INSERT OR REPLACE INTO locations(save_id,name,description,category,visited) VALUES(?,?,?,?,COALESCE((SELECT visited FROM locations WHERE save_id=? AND name=?),0))',(sid,x.name[:100],x.description[:500],x.category[:60],sid,x.name[:100])); c.commit(); c.close(); return {'ok':True}

async def maybe_npc_initiative(sid:int):
    cfg=get_settings(sid)
    if not cfg.get('auto_world',1): return
    c=db(); meta=c.execute('SELECT * FROM npc_initiative_meta WHERE save_id=?',(sid,)).fetchone()
    if not meta:
        c.execute('INSERT OR IGNORE INTO npc_initiative_meta(save_id) VALUES(?)',(sid,)); c.commit(); meta=c.execute('SELECT * FROM npc_initiative_meta WHERE save_id=?',(sid,)).fetchone()
    last=c.execute('SELECT COALESCE(MAX(id),0) id FROM messages WHERE save_id=?',(sid,)).fetchone()['id']; st=dict(c.execute('SELECT * FROM scene_state WHERE save_id=?',(sid,)).fetchone()); recent=c.execute('SELECT role,content FROM messages WHERE save_id=? ORDER BY id DESC LIMIT 10',(sid,)).fetchall()[::-1]
    npcs=[dict(x) for x in c.execute('SELECT * FROM npc_relations WHERE save_id=?',(sid,))]; ag=[dict(x) for x in c.execute("SELECT * FROM agenda WHERE save_id=? AND status='pendente' ORDER BY year,month,day LIMIT 6",(sid,))]; c.close()
    if last-int(meta['last_message_id'] or 0)<8: return
    excerpt='\n'.join(f"{r['role']}: {r['content'][:1000]}" for r in recent)
    inst='Decida se Temari, Kankurō ou uma obrigação realista do Kazekage deve gerar iniciativa narrativa AGORA. Seja conservador: na maioria das análises, não gere nada. Não controle Saruto, não force romance, não crie emergência aleatória. Retorne JSON {"create":bool,"title":string,"content":string,"source":"Temari|Kankurō|Kazekage|Vila","agenda":null ou {"days_from_now":0..7,"time_of_day":string,"title":string,"description":string,"owner":string}}. content <=350 caracteres e deve ser um gancho plausível baseado em memórias, agenda ou rotina.'
    data=await groq_json([{'role':'system','content':inst},{'role':'user','content':f"Cena: {json.dumps(st,ensure_ascii=False)}\nNPCs: {json.dumps(npcs,ensure_ascii=False)}\nAgenda: {json.dumps(ag,ensure_ascii=False)}\nRecente:\n{excerpt}"}],450)
    c=db(); c.execute('UPDATE npc_initiative_meta SET last_message_id=?,last_calendar_day=? WHERE save_id=?',(last,st.get('calendar_day',1),sid))
    if data and data.get('create') and data.get('content'):
        title=str(data.get('title') or 'Iniciativa')[:80]; content=str(data['content'])[:500]
        if not c.execute("SELECT 1 FROM world_events WHERE save_id=? AND status='ativo' AND title=?",(sid,title)).fetchone(): c.execute('INSERT INTO world_events(save_id,title,content,status,created_at) VALUES(?,?,?,?,?)',(sid,title,content,'ativo',datetime.now().isoformat()))
        a=data.get('agenda')
        if isinstance(a,dict) and a.get('title'):
            try: dd=max(0,min(7,int(a.get('days_from_now',0) or 0)))
            except: dd=0
            d,m,y=advance_calendar(st.get('calendar_day',1),st.get('calendar_month',3),st.get('calendar_year',1),dd)
            c.execute('INSERT INTO agenda(save_id,day,month,year,time_of_day,title,description,owner,status) VALUES(?,?,?,?,?,?,?,?,?)',(sid,d,m,y,str(a.get('time_of_day') or 'manhã')[:40],str(a['title'])[:100],str(a.get('description') or '')[:400],str(a.get('owner') or data.get('source') or 'Gaara')[:50],'pendente'))
    c.commit(); c.close()

@app.post('/api/saves/{sid}/chat')
async def chat(sid:int,x:MsgIn):
    if not get_save(sid): raise HTTPException(404)
    now=datetime.now().isoformat(); c=db(); c.execute('INSERT INTO messages(save_id,role,content,created_at) VALUES(?,?,?,?)',(sid,'user',x.content,now)); c.execute('UPDATE saves SET updated_at=? WHERE id=?',(now,sid)); c.commit(); c.close()
    return await stream_generation(sid)
@app.post('/api/saves/{sid}/continue')
async def continue_response(sid:int):
    return await stream_generation(sid,'Continue naturalmente a cena a partir do ponto atual. Não repita a resposta anterior. Preserve o turno de Saruto: não escreva falas, pensamentos, decisões ou ações dele.')
@app.post('/api/saves/{sid}/regenerate')
async def regenerate(sid:int):
    c=db(); last=c.execute("SELECT id FROM messages WHERE save_id=? AND role='assistant' ORDER BY id DESC LIMIT 1",(sid,)).fetchone()
    if not last: c.close(); raise HTTPException(400,'Não há resposta para regenerar')
    c.execute('DELETE FROM messages WHERE id=?',(last['id'],)); c.commit(); c.close()
    return await stream_generation(sid,'Gere uma alternativa para a resposta anterior de Gaara/NPCs. Não mencione regeneração e não controle Saruto.')

# ===== V7: inteligência narrativa, segredos, Matatabi, recap, busca e backup =====
def init_v7():
    c=db(); c.executescript('''
    CREATE TABLE IF NOT EXISTS emotional_state(save_id INTEGER PRIMARY KEY,mood TEXT DEFAULT 'calmo',intensity INTEGER DEFAULT 20,cause TEXT DEFAULT '',updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS milestones(id INTEGER PRIMARY KEY AUTOINCREMENT,save_id INTEGER NOT NULL,key TEXT NOT NULL,label TEXT NOT NULL,reached INTEGER DEFAULT 0,detail TEXT DEFAULT '',reached_at TEXT,UNIQUE(save_id,key));
    CREATE TABLE IF NOT EXISTS known_facts(id INTEGER PRIMARY KEY AUTOINCREMENT,save_id INTEGER NOT NULL,fact TEXT NOT NULL,knowers TEXT NOT NULL DEFAULT 'Saruto',secret INTEGER DEFAULT 1,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS character_memories(id INTEGER PRIMARY KEY AUTOINCREMENT,save_id INTEGER NOT NULL,character TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL);
    '''); c.commit(); c.close()
init_v7()
MILESTONES=[('matatabi_known','Gaara descobriu que Saruto é jinchūriki de Matatabi'),('past_shared','Saruto compartilhou parte importante do próprio passado'),('kanji_meaning','Gaara descobriu o significado do 愛 de Saruto'),('trust_vulnerability','Houve vulnerabilidade ou confiança significativa'),('attraction_recognized','A atração foi reconhecida explicitamente'),('relationship_started','Gaara e Saruto iniciaram um relacionamento')]

def ensure_v7(sid):
    c=db(); now=datetime.now().isoformat(); c.execute('INSERT OR IGNORE INTO emotional_state(save_id,updated_at) VALUES(?,?)',(sid,now))
    for k,l in MILESTONES: c.execute('INSERT OR IGNORE INTO milestones(save_id,key,label) VALUES(?,?,?)',(sid,k,l))
    c.execute("INSERT OR IGNORE INTO known_facts(save_id,fact,knowers,secret,created_at) SELECT ?,?,?,1,? WHERE NOT EXISTS(SELECT 1 FROM known_facts WHERE save_id=? AND fact LIKE 'Saruto é jinchūriki%')",(sid,'Saruto é jinchūriki de Matatabi, a Duas-Caudas.','Saruto,Matatabi',now,sid))
    c.execute("INSERT OR IGNORE INTO known_facts(save_id,fact,knowers,secret,created_at) SELECT ?,?,?,1,? WHERE NOT EXISTS(SELECT 1 FROM known_facts WHERE save_id=? AND fact LIKE 'O significado pessoal%')",(sid,'O significado pessoal do 愛 azul de Saruto ainda não foi revelado.','Saruto,Matatabi',now,sid)); c.commit(); c.close()

def v7_context(sid):
    ensure_v7(sid); c=db(); emo=c.execute('SELECT * FROM emotional_state WHERE save_id=?',(sid,)).fetchone(); miles=[dict(x) for x in c.execute('SELECT * FROM milestones WHERE save_id=? ORDER BY id',(sid,))]; facts=[dict(x) for x in c.execute('SELECT * FROM known_facts WHERE save_id=? ORDER BY id',(sid,))]; cm=[dict(x) for x in c.execute('SELECT * FROM character_memories WHERE save_id=? ORDER BY id DESC LIMIT 12',(sid,))]; c.close()
    out=f"\n\nESTADO EMOCIONAL DE GAARA: {emo['mood']} (intensidade {emo['intensity']}/100). Causa atual: {emo['cause'] or 'nenhuma dominante'}. Preserve continuidade emocional sem tornar isso mecânico."
    out+='\nMARCOS DO VÍNCULO: '+'; '.join(('✓ ' if m['reached'] else '✗ ')+m['label'] for m in miles)
    # Knowledge firewall: facts are labelled; model must not leak to characters not in knowers.
    out+='\nCONHECIMENTO PRIVADO (respeite estritamente quem sabe): '+' | '.join(f"[{f['knowers']}] {f['fact']}" for f in facts)
    if cm: out+='\nMEMÓRIAS INDIVIDUAIS: '+' | '.join(f"{m['character']}: {m['content']}" for m in reversed(cm))
    out+='\nMATATABI: é uma personagem senciente ligada a Saruto. Pode falar internamente com Saruto quando apropriado, com presença felina, perceptiva e digna; não controla Saruto nem narra decisões dele. Não deve interromper toda cena.'
    return out

_old_context=context
def context(sid):
    base,msgs,cfg=_old_context(sid)
    return base+v7_context(sid),msgs,cfg

async def analyze_v7(sid:int):
    ensure_v7(sid); c=db(); rows=c.execute('SELECT role,content FROM messages WHERE save_id=? ORDER BY id DESC LIMIT 10',(sid,)).fetchall()[::-1]; emo=dict(c.execute('SELECT * FROM emotional_state WHERE save_id=?',(sid,)).fetchone()); miles=[dict(x) for x in c.execute('SELECT key,label,reached FROM milestones WHERE save_id=?',(sid,))]; facts=[dict(x) for x in c.execute('SELECT id,fact,knowers FROM known_facts WHERE save_id=?',(sid,))]; c.close()
    if len(rows)<3:return
    excerpt='\n'.join(f"{r['role']}: {r['content'][:1400]}" for r in rows)
    inst='''Analise continuidade de RPG. JSON: {"emotion":{"mood":string,"intensity":0..100,"cause":string},"reached_milestones":[keys],"knowledge_updates":[{"fact_contains":string,"add_knower":"Gaara|Temari|Kankurō"}],"character_memories":[{"character":"Gaara|Temari|Kankurō|Matatabi","content":string}]}. Seja MUITO conservador. Só marque marco quando aconteceu explicitamente. Só dê conhecimento a personagem que presenciou ou recebeu a informação. Nunca invente pensamentos/ações de Saruto. Memórias <=160 chars, só fatos duráveis.'''
    data=await groq_json([{'role':'system','content':inst},{'role':'user','content':f"Emoção: {json.dumps(emo,ensure_ascii=False)}\nMarcos:{json.dumps(miles,ensure_ascii=False)}\nFatos:{json.dumps(facts,ensure_ascii=False)}\nCena:\n{excerpt}"}],650)
    if not data:return
    c=db(); now=datetime.now().isoformat(); e=data.get('emotion') or {}
    if e.get('mood'): c.execute('UPDATE emotional_state SET mood=?,intensity=?,cause=?,updated_at=? WHERE save_id=?',(str(e['mood'])[:60],max(0,min(100,int(e.get('intensity',20) or 20))),str(e.get('cause') or '')[:220],now,sid))
    valid={m['key'] for m in miles}
    for k in data.get('reached_milestones') or []:
        if k in valid:c.execute('UPDATE milestones SET reached=1,reached_at=? WHERE save_id=? AND key=?',(now,sid,k))
    for u in data.get('knowledge_updates') or []:
        q=str(u.get('fact_contains') or '').strip(); who=u.get('add_knower')
        if not q or who not in {'Gaara','Temari','Kankurō'}:continue
        row=c.execute('SELECT * FROM known_facts WHERE save_id=? AND fact LIKE ? LIMIT 1',(sid,'%'+q[:80]+'%')).fetchone()
        if row:
            ks=[x.strip() for x in row['knowers'].split(',') if x.strip()]
            if who not in ks: ks.append(who); c.execute('UPDATE known_facts SET knowers=? WHERE id=?',(','.join(ks),row['id']))
    for m in (data.get('character_memories') or [])[:4]:
        ch=m.get('character'); txt=str(m.get('content') or '').strip()
        if ch in {'Gaara','Temari','Kankurō','Matatabi'} and 8<len(txt)<=180 and not c.execute('SELECT 1 FROM character_memories WHERE save_id=? AND character=? AND content=?',(sid,ch,txt)).fetchone(): c.execute('INSERT INTO character_memories(save_id,character,content,created_at) VALUES(?,?,?,?)',(sid,ch,txt,now))
    c.commit(); c.close()

@app.get('/api/saves/{sid}/intelligence')
def intelligence(sid:int):
    ensure_v7(sid); c=db(); out={'emotion':dict(c.execute('SELECT * FROM emotional_state WHERE save_id=?',(sid,)).fetchone()),'milestones':[dict(x) for x in c.execute('SELECT * FROM milestones WHERE save_id=? ORDER BY id',(sid,))],'facts':[dict(x) for x in c.execute('SELECT * FROM known_facts WHERE save_id=? ORDER BY id',(sid,))],'character_memories':[dict(x) for x in c.execute('SELECT * FROM character_memories WHERE save_id=? ORDER BY id DESC LIMIT 40',(sid,))]}; c.close(); return out

@app.get('/api/saves/{sid}/recap')
def recap(sid:int):
    ensure_v7(sid); c=db(); st=c.execute('SELECT * FROM scene_state WHERE save_id=?',(sid,)).fetchone(); ch=c.execute('SELECT * FROM chapters WHERE save_id=? ORDER BY number DESC LIMIT 1',(sid,)).fetchone(); ev=[dict(x) for x in c.execute("SELECT title,content FROM world_events WHERE save_id=? AND status='ativo' ORDER BY id DESC LIMIT 4",(sid,))]; em=c.execute('SELECT * FROM emotional_state WHERE save_id=?',(sid,)).fetchone(); ms=[x['label'] for x in c.execute('SELECT label FROM milestones WHERE save_id=? AND reached=1 ORDER BY id',(sid,))]; c.close(); return {'scene':dict(st) if st else None,'last_chapter':dict(ch) if ch else None,'active_threads':ev,'emotion':dict(em) if em else None,'milestones':ms}

@app.get('/api/saves/{sid}/search')
def search_rpg(sid:int,q:str=''):
    q=q.strip();
    if not q:return []
    c=db(); like='%'+q+'%'; rows=[dict(x) for x in c.execute("SELECT id,role,content,created_at FROM messages WHERE save_id=? AND content LIKE ? ORDER BY id DESC LIMIT 80",(sid,like))]; c.close(); return rows

@app.get('/api/saves/{sid}/export')
def export_save(sid:int):
    ensure_v7(sid); c=db(); tables=['saves','messages','memories','relationship','chapters','settings','scene_state','npc_relations','world_events','npc_memories','calendar_events','locations','agenda','emotional_state','milestones','known_facts','character_memories']; data={'format':'gaara-rpg-v7','exported_at':datetime.now().isoformat(),'save_id':sid}
    for t in tables:
        if t=='saves': data[t]=[dict(x) for x in c.execute('SELECT * FROM saves WHERE id=?',(sid,))]
        else:data[t]=[dict(x) for x in c.execute(f'SELECT * FROM {t} WHERE save_id=?',(sid,))]
    c.close(); return data

class FactIn(BaseModel): fact:str; knowers:str='Saruto,Matatabi'; secret:bool=True
@app.post('/api/saves/{sid}/facts')
def add_fact(sid:int,x:FactIn):
    c=db(); c.execute('INSERT INTO known_facts(save_id,fact,knowers,secret,created_at) VALUES(?,?,?,?,?)',(sid,x.fact.strip(),x.knowers.strip(),int(x.secret),datetime.now().isoformat())); c.commit(); c.close(); return {'ok':True}
