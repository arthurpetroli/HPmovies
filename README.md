# HPmovies V2 — execução local

Plataforma de descoberta de animes, mangás e light novels, com biblioteca pessoal, histórico, player HLS e leitores. React, TypeScript, Vite, Tailwind, React Router, Hono e HLS.js foram preservados. Esta entrega prioriza o computador local; não exige Redis, conta ou deploy.

## Iniciar

Requer **Node.js 22.12+** e npm.

```bash
npm ci
npm run dev
```

Abra **http://127.0.0.1:5173**. O comando inicia o frontend, a API em **http://127.0.0.1:4000** e o host de fontes em **http://127.0.0.1:8099**; `Ctrl+C` encerra os três processos. As portas são fixas para evitar abrir outra instância silenciosamente. Encerre processos anteriores se estiverem ocupadas.

O `.env` é opcional. Para personalizar, copie `.env.example` para `.env`. `BACKEND_PORT` define a porta da API; o proxy Vite acompanha esse valor. `PORT` continua aceito para compatibilidade. `VITE_API_BASE_URL` vazio usa `/api` com encaminhamento local; preenchido, aceita a origem da API ou uma base terminando em `/api`. `DEV_API_PROXY_URL` permite escolher o destino do proxy sem expor configurações privadas no frontend.

**Disponibilidade externa verificada em 21/10/2026:** AniList recusou consultas GraphQL reais com HTTP 403 e mensagem de indisponibilidade temporária; MangaDex respondeu HTTP 503. A interface mostra os erros e permite tentar novamente. Isso limita os catálogos; o acesso direto às fontes instaladas foi validado separadamente. Não existem dados de demonstração disfarçados de catálogo.

Neste ambiente, o pacote original Toko 4.5.5 foi instalado localmente a pedido do usuário, fora do Git. A tela [Fontes de conteúdo](http://127.0.0.1:5173/sources) abre vídeos e leituras diretamente, com os mesmos provedores do pacote. O [relatório de conteúdo real](docs/REAL-CONTENT-VALIDATION.md) registra os títulos, idiomas e testes efetivamente validados.

Você também pode testar, independentemente dessas APIs:

- [Player HLS autorizado](http://127.0.0.1:5173/watch/demo).
- [Leitor textual com história original PT-BR](http://127.0.0.1:5173/novel/demo/read/1).
- [Minha Lista e histórico](http://127.0.0.1:5173/library).
- [Diagnóstico das fontes](http://127.0.0.1:5173/providers).

O vídeo precisa de conexão com o servidor de demonstração. Os textos originais são servidos pela API local.

## Funcionalidades implementadas

- **Animes:** início com destaque cinematográfico e carrosséis; pesquisa e sugestões; gênero, ano, temporada, formato, status, ordem e paginação; detalhes com personagens, relações, recomendações e links oficiais. Dados via AniList; disponibilidade de reprodução consultada separadamente.
- **Player:** HLS adaptativo com níveis reais do manifesto, seleção manual, MP4 alternativo, velocidade, volume, mute, tela cheia, atalhos, buffering, erros e retomada; navegação anterior/próximo quando fornecida pelo índice. Aberturas só podem ser puladas com intervalos válidos do provedor.
- **Legendas:** WebVTT, conversão SRT e diálogo simples ASS, seleção/desativação, prioridade por código explícito `pt-BR`, tamanho, fundo, contorno e sincronização persistentes. ASS não renderiza karaoke, desenhos, fontes anexadas nem efeitos de composição.
- **Mangás:** contrato MangaDex v5, seleções populares/em publicação/notas/atualizações, busca, filtros, detalhes, capítulos por idioma e créditos dos grupos. Leitor vertical, página única ou dupla adaptativa, zoom, largura/altura, temas, tela cheia, teclado/gestos, carregamento progressivo, retry por imagem e retomada. O leitor também recebe capítulos/páginas das extensões em `/sources`, com idioma, créditos e progresso. A integração Webtoons foi validada com páginas reais; fixtures de teste ficam somente nos testes.
- **Novels:** catálogo AniList `MANGA`/`NOVEL`, filtros e detalhes; leitor textual com fonte, tamanho, espaçamento, temas, capítulos e progresso. Três capítulos de uma história original permitem testar o leitor. Fontes de texto também usam o host Toko/Tatakai; a leitura do original japonês de Bookworm foi validada através do Syosetu.
- **Biblioteca:** animes, mangás e novels; listas, favoritos, conclusão manual e históricos de reprodução/leitura. Persistência local com dados limitados, validação e avisos se o navegador bloquear o armazenamento. Serviços separados permitem futura sincronização por conta.
- **Provedores:** contratos independentes, cliente HTTP Toko com configuração, timeout/retry/cache e permissões por provedor/domínio; host local Tatakai, resolução de leitura e addons Stremio por HTTP; tela de diagnóstico. Imagens, HLS, segmentos, MP4 e legendas que exigem Referer/Origin configurados usam tickets opacos; a saúde técnica não comprova conteúdo disponível.

AniList fornece metadados e não vídeos. O player de demonstração usa **Big Buck Bunny, CC BY 3.0**, com atribuição na interface. Sua faixa PT-BR é um guia original do player. Não é uma tradução de diálogos do filme. Títulos do catálogo sem fonte validada não recebem botão de reprodução.

## Configuração dos provedores

Todas as variáveis ficam documentadas em `.env.example`. Variáveis de Toko, Tatakai, AniList, MangaDex e Redis pertencem somente ao backend.

**Toko:** o artefato original 4.5.5 solicitado pelo usuário está instalado somente em `.local/sources/toko-4.5.5/`, fora do Git e sem alterar seu bundle. A distribuição não declara licença geral para incorporar/redistribuir seu código. O HPmovies usa o host Tatakai MPL-2.0 e um cliente HTTP independente. O adaptador `TOKO_*` continua disponível para um servidor HTTP separado; o pacote local usa `TATAKAI_*`. `TOKO_ENABLED=true` ativa a comunicação; reprodução exige também `TOKO_CONTENT_AUTHORIZED=true`, provedores em `TOKO_ALLOWED_PROVIDERS` e hosts exatos em `TOKO_ALLOWED_MEDIA_HOSTS`. Essas opções só devem representar permissões que o operador realmente possui. Sem serviço configurado, o catálogo e a biblioteca continuam independentes.

**Tatakai local:** o host Node do repositório foi incorporado sob MPL-2.0, com licença e revisão preservadas. `npm run dev` o inicia junto da API. `TATAKAI_ENABLED=true` consulta esse host local; a API pública `api.tatakai.me` continua separada e não é usada como fonte de conteúdo. O repositório atual não inclui extensões de conteúdo. Neste ambiente, `HPMOVIES_EXTENSIONS_FILE` já aponta ao pacote local com manifesto e SHA-256. As fontes selecionadas são Nebula, Webtoons e Syosetu. Em uma instalação nova, configure o bundle, namespace, provedores e domínios permitidos; extensões não são baixadas durante `npm ci` ou `npm run dev`. Veja [o host local](docs/LOCAL-SOURCE-HOST.md) e [as rotas de conteúdo](docs/CONTENT-BACKEND.md).

**MangaDex:** a documentação exige proxy para websites. A API local faz as consultas e fornece imagens por tickets opacos em `/api/manga/image/:token`, emitidos para hosts oficiais previamente validados. A rota não recebe uma URL. Tem timeout, limite de bytes, MIME de imagens, limite de concorrência e bloqueio de redirecionamentos. Créditos são preservados, não há anúncios nem cobrança. `MANGADEX_BLOCKED_GROUP_IDS` permite respeitar pedidos de remoção de grupos, informados por UUID. O comportamento deve continuar atendendo à [política oficial](https://gitlab.com/mangadex-pub/mangadex-api-docs/-/blob/main/index.md) e às [limitações de uso](https://gitlab.com/mangadex-pub/mangadex-api-docs/-/blob/main/2-limitations.md).

**Aniwatch:** arquivos históricos preservados; não é importado nem consultado pelo fluxo ativo. `ENABLE_LEGACY_HIANIME=false` é o padrão. A rota antiga de proxy arbitrário permanece bloqueada com HTTP 410 mesmo com legado habilitado. [ANIWATCH_STATUS.md](ANIWATCH_STATUS.md) contém o diagnóstico histórico; `npm run diagnose:aniwatch` é opcional e não é necessário para a plataforma.

## Verificações

```bash
npm test
npm run lint
npm run build
```

Testes de navegador, após instalar o navegador de testes:

```bash
npx playwright install chromium
npm run test:e2e
```

O Playwright inicia a aplicação ou reutiliza uma instância local. Para usar um Chromium compatível já instalado, informe `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/caminho/do/chrome`. Em Linux, as bibliotecas nativas necessárias ao navegador também precisam estar disponíveis.

Os testes antigos de scraping em `src/aniwatch-apis/__tests__` são históricos e não fazem parte da suíte local ativa.

A suíte de navegador distingue cenários com fixtures isoladas (catálogos e páginas de mangá) de chamadas reais (backend local, texto original, HLS remoto). Fixtures não integram o código da aplicação. O HLS depende da disponibilidade do servidor de teste e de codecs compatíveis.

```bash
curl http://127.0.0.1:4000/health
curl http://127.0.0.1:4000/api/providers
curl 'http://127.0.0.1:4000/api/catalog/search?search=Frieren&season=FALL'
curl 'http://127.0.0.1:4000/api/manga/search?search=Yotsuba'
curl http://127.0.0.1:4000/api/novels/demo/chapters/1/content
```

Para verificar a versão compilada, use `npm run start:backend` e, em outro terminal, `npm run preview`. O frontend de preview também usa a API local. Para desenvolver no dia a dia, `npm run dev` já basta.

## Segurança, limites e próximos passos

A API escuta somente em loopback por padrão, limita origens e quantidade de requisições usando o endereço real da conexão, recusa proxy arbitrário e não encaminha APIs administrativas de terceiros. Cache e consultas simultâneas são limitados; chaves incluem provedor, rota e parâmetros. Redis é opcional. Credenciais não são expostas no frontend e extensões executáveis não são instaladas automaticamente.

Após remoção de dependências sem uso e atualizações compatíveis, `npm audit --omit=dev` não apresentou alertas nesta validação. A árvore completa ainda tem sete alertas de ferramentas de desenvolvimento ligados ao Tailwind 3 (`braces` e `postcss-selector-parser`). A correção sugerida exige uma migração para Tailwind 4 e está registrada para uma etapa própria. O chunk de reprodução inclui HLS.js e é carregado apenas ao abrir o player.

O relatório por entrega, arquivos, reaproveitamento, resultados e pendências está em [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md). [AUDIT.md](AUDIT.md) preserva também a auditoria histórica anterior. Próximos passos: repetir a validação dos catálogos quando as APIs responderem, ampliar a validação das demais fontes e idiomas do Toko e depois preparar o deploy em uma etapa futura. Não foi feito push nem publicação.

A quota de mídia (`MEDIA_RATE_LIMIT`, padrão 600/minuto por cliente) é independente da quota de catálogo. O transporte fixa DNS público na conexão TLS, valida hosts/origens, limita bytes/concorrência/cache e recusa cookies, autenticação, redirecionamentos e playlists criptografadas. Recursos de navegador e contorno de desafios não são ativados.
