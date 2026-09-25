# Gaara RPG — V3

RPG local privado Saruto × Gaara usando Groq / `openai/gpt-oss-120b`.

## Instalação (Windows)

1. Instale Python 3.11+.
2. Abra PowerShell nesta pasta.
3. `python -m venv .venv`
4. `.venv\Scripts\Activate.ps1`
5. `pip install -r requirements.txt`
6. Copie `.env.example` para `.env` e coloque sua chave Groq.
7. `uvicorn app:app --reload --host 127.0.0.1 --port 8000`
8. Abra `http://127.0.0.1:8000`.

## V3

- Gaara aos 18 anos, Saruto e lore reduzido em PT-BR.
- Cada novo save começa com uma cena inicial em Sunagakure sem controlar Saruto.
- Streaming via Groq.
- Saves separados em SQLite.
- Editar mensagens e voltar a história.
- Regenerar a última resposta do Gaara.
- Continuar uma resposta/cena sem criar uma fala falsa de Saruto.
- Memória automática conservadora a cada 4 respostas do Gaara.
- Memórias podem ser adicionadas, editadas ou excluídas manualmente.
- Progressão interna lenta: familiaridade, confiança, abertura, atração e intimidade.
- Diário automático a cada 12 respostas, com edição/exclusão dos resumos.
- Configurações por save: estilo narrativo, temperature, top_p, tamanho de resposta e quantidade de mensagens recentes no contexto.
- Memória e capítulos automáticos podem ser desligados por save.
- Exclusão de saves.
- Layout responsivo para celular.

## Observações

A chave Groq fica apenas no backend em `.env`.

O banco fica em `data/rpg.db`. Para preservar suas histórias em futuras atualizações, faça backup desse arquivo antes de substituir a pasta do projeto.

O sistema não controla Saruto: os prompts e as funções de continuar/regenerar reforçam que falas, pensamentos, decisões e ações do OC pertencem ao usuário.

## V4 — mundo persistente
- Estado da cena (dia, período, local, clima e situação).
- Relações separadas de Temari e Kankurō com Saruto.
- Fios/eventos persistentes do mundo.
- Painel Mundo.
- Botão para gerar um acontecimento orgânico via Groq quando você quiser movimentar a história.
- Eventos entram no contexto até serem encerrados.

A V4 mantém a regra de que Saruto pertence exclusivamente ao usuário; eventos podem criar situações, nunca decidir a reação dele.

## V5 — mundo automático
- O sistema acompanha automaticamente período do dia, localização, clima e situação da cena.
- Passagens temporais explícitas avançam o calendário interno sem transformar cada mensagem em um novo dia.
- O calendário começa em 01/03 do Ano Narrativo 1 e registra 23/03 como aniversário de Saruto.
- Temari e Kankurō agora mantêm familiaridade, confiança, atitude e memórias próprias sobre Saruto.
- Fios do mundo podem ser encerrados automaticamente quando a cena realmente os resolve.
- Tudo pode ser desligado em Configurações com “Mundo, tempo e NPCs automáticos”.
- O sistema não presume que Gaara, Temari ou Kankurō conheçam o aniversário de Saruto; eles só podem reconhecê-lo se essa informação tiver surgido no RPG.

## V6 — rotina, agenda, locais e iniciativa de NPCs

- Locais persistentes de Sunagakure, com locais-base já cadastrados e possibilidade de adicionar outros.
- Agenda narrativa com compromissos futuros e responsáveis.
- Rotina inicial do Kazekage cadastrada na agenda.
- Compromissos entram no contexto da IA e podem gerar conflitos naturais com planos pessoais.
- Temari e Kankurō podem gerar fios narrativos por iniciativa própria, mas de forma conservadora e baseada nas memórias/relação já construídas.
- Obrigações do Kazekage e acontecimentos da vila também podem gerar ganchos sem depender de aleatoriedade pura.
- O motor evita criar emergência em toda cena, não força romance e continua proibido de controlar Saruto.
- Locais visitados podem ser reconhecidos e reaparecer no contexto.
- Agenda e locais podem ser gerenciados no painel Mundo.

## V7 — inteligência narrativa

A V7 adiciona estado emocional persistente de Gaara, marcos de relacionamento, Matatabi como personagem contextual, conhecimento individual/segredos, memórias por personagem, recap ao retornar, busca no histórico e exportação completa do save em JSON. O painel **Inteligência** mostra exatamente o que o motor está mantendo, para que a continuidade não vire uma caixa-preta.

## Interface para celular

Esta edição foi adaptada para telas pequenas: navegação inferior, diálogos em tela cheia, áreas de toque maiores, suporte a safe-area/notch, compositor que cresce automaticamente e layout para teclado virtual.

Para abrir no celular enquanto o servidor roda no PC, inicie o Uvicorn com `--host 0.0.0.0` e acesse pelo IP local do computador, por exemplo `http://192.168.0.10:8000`. O PC e o celular precisam estar na mesma rede. Não exponha a porta diretamente à internet.

O manifesto web também permite adicionar o site à tela inicial em navegadores compatíveis. Para uma instalação PWA completa/offline seria necessário servir por HTTPS (ou localhost) e adicionar service worker; o RPG em si continua precisando do backend e da conexão com a Groq.

No celular, toque no título da história no topo para trocar rapidamente entre saves. Configurações menos usadas continuam disponíveis abrindo a interface em tela maior; os controles essenciais ficam na barra inferior.

## GitHub / produção

Este pacote já está preparado para ser versionado. O `.gitignore` impede o envio de `.env`, ambientes virtuais, cache Python e bancos SQLite locais.

Antes do primeiro push, crie seu `.env` local a partir de `.env.example`. Nunca faça commit da sua `GROQ_API_KEY`.

### GitHub Desktop

1. Abra **GitHub Desktop**.
2. `File > Add local repository...` e escolha esta pasta.
3. Se a pasta ainda não for um repositório, escolha **create a repository**.
4. Faça o primeiro commit.
5. Clique em **Publish repository**. Se o RPG for apenas seu, marque o repositório como **Private**.

### Banco de dados no host

O banco agora aceita `DATABASE_PATH`. Localmente, o padrão é `data/rpg.db`. Em produção, configure `DATABASE_PATH` para um disco/volume persistente. Não use o filesystem efêmero do deploy para os saves.

### Variáveis de ambiente no host

Configure no painel do host, e não no GitHub:

- `GROQ_API_KEY` = sua chave privada
- `GROQ_MODEL` = `openai/gpt-oss-120b`
- `DATABASE_PATH` = caminho do volume persistente, se aplicável

O endpoint `/health` pode ser usado pelo host para health checks.

Há também `render.yaml` e `Procfile` como pontos de partida para hosts compatíveis. Confirme preços e disponibilidade de disco persistente no provedor antes de criar o serviço.
