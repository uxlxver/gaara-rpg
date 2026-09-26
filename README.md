# Gaara RPG — GitHub Pages

Rewrite estático/mobile-first. Não usa Python, FastAPI, SQLite, Uvicorn nem servidor próprio.

## Publicar
1. Envie **o conteúdo desta pasta** para a raiz do repositório.
2. GitHub → Settings → Pages.
3. Source: **Deploy from a branch**.
4. Branch: `main`, pasta `/ (root)`.
5. Salve. O endereço será `https://SEU-USUARIO.github.io/gaara-rpg/`.

## Groq
Abra ☰ → Configurações e informe uma chave Groq exclusiva para este RPG.

IMPORTANTE: GitHub Pages é client-side. A Groq recomenda não expor chaves no frontend. Esta versão guarda a chave apenas no armazenamento local do navegador e nunca no repositório, mas qualquer código executado no navegador pode acessar uma chave usada por ele. Para segurança forte, use um proxy backend. Para uso pessoal, crie uma chave dedicada e revogue/rotacione quando necessário.

## Dados
Histórias ficam no IndexedDB do navegador. Use **Exportar save** regularmente. Limpar os dados do site no navegador apaga os saves locais.

## Recursos
- Gaara 18 / Saruto / Matatabi e slow burn
- múltiplos saves
- streaming Groq
- editar, regenerar e voltar
- memória automática conservadora
- estado do mundo e relacionamento
- busca
- exportação/importação JSON
- PWA/mobile
- interface funciona offline; IA requer internet
