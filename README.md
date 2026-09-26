# Gaara RPG — Pages V6 Limits

Mantém V5 + controle de uso:
- 80 mensagens do usuário por dia no RPG;
- contador visível no cabeçalho;
- limite local reinicia à meia-noite do aparelho;
- captura, quando expostos ao navegador, os headers oficiais da Groq de requisições restantes e reset;
- erros 429 mostram aviso específico;
- chamadas internas de memória/capítulos não gastam o contador de mensagens do usuário, mas continuam contando nos limites reais da API Groq.

O limite oficial da Groq continua sendo soberano e varia por plano/modelo.
