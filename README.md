# HPmovies V2 — execução local

Plataforma de descoberta de animes, mangás e light novels, com biblioteca pessoal, histórico, player HLS e leitores. React, TypeScript, Vite, Tailwind, React Router, Hono e HLS.js foram preservados. Esta entrega prioriza o computador local; não exige Redis, conta ou deploy.

**Retomada em 27/10/2026:** as três [skills locais](docs/PROJECT-SKILLS.md) estão instaladas. O [estado de desenvolvimento](docs/DEVELOPMENT-STATE.md) registra as mudanças de episódios, streaming e legendas, os testes atuais e as pendências; os relatórios anteriores preservam suas datas de validação.

## Iniciar

Requer **Node.js 22.12+** e npm.

```bash
npm ci
npm run dev
```

Abra **http://127.0.0.1:5173**. O comando inicia o frontend, a API em **http://127.0.0.1:4000** e o host de fontes em **http://127.0.0.1:8099**; `Ctrl+C` encerra os três processos. As portas são fixas para evitar abrir outra instância silenciosamente. Encerre processos anteriores se estiverem ocupadas.

O `.env` é opcional. Para personalizar, copie `.env.example` para `.env`. `BACKEND_PORT` define a porta da API; o proxy Vite acompanha esse valor. `PORT` continua aceito para compatibilidade. `VITE_API_BASE_URL` vazio usa `/api` com encaminhamento local; preenchido, aceita a origem da API ou uma base terminando em `/api`. `DEV_API_PROXY_URL` permite escolher o destino do proxy sem expor configurações privadas no frontend.

**Disponibilidade externa verificada em 21/10/2026:** AniList recusou consultas GraphQL reais com HTTP 403 e mensagem de indisponibilidade temporária. O MangaDex recuperou o acesso após o HTTP 503 inicial: catálogo PT-BR, feeds de oito obras e imagens reais responderam HTTP 200. Falhas externas continuam visíveis, com opção de tentar novamente. Não existem dados de demonstração disfarçados de catálogo.

Neste ambiente, o pacote original Toko 4.5.5 foi instalado localmente a pedido do usuário, fora do Git. A tela [Fontes de conteúdo](http://127.0.0.1:5173/sources) abre vídeos e leituras diretamente, com os mesmos provedores do pacote. O [relatório de conteúdo real](docs/REAL-CONTENT-VALIDATION.md) registra os títulos, idiomas e testes efetivamente validados.

O foco atual é português: abra o [catálogo de mangás PT-BR](http://127.0.0.1:5173/manga?language=pt-br). A busca informou 12.114 títulos marcados com esse idioma; os capítulos disponíveis variam por obra. O player também consulta legendas externas PT-BR/PT do OpenSubtitles, com prioridade para PT-BR e sincronização ajustável. Foram baixadas legendas reais para sete animes, incluindo One Piece e Naruto. Veja [a validação em português e a pesquisa do GoAnime](docs/PORTUGUESE-SOURCES.md).

A falha de vídeo nas recomendações seguintes foi reproduzida: os segmentos HLS passaram a usar hosts de CDN ausentes da configuração local. O backend agora verifica o manifesto e o primeiro trecho antes de oferecer a fonte; o player tenta outra URL quando a atual falha ou para de avançar. A [validação da correção de streaming](docs/STREAMING-FIX-VALIDATION.md) registra a causa, as amostras reais e a comparação com Tatakai/GoAnime.

**Legendas revisadas em 22/10/2026:** o OpenSubtitles agora entrega WebVTT nativo convertido no servidor. O player monta somente a faixa selecionada, limpa erros após carregamento e permite tentar novamente sem trocar para inglês. A troca manual de inglês para todas as opções portuguesas de One Piece e Naruto, episódio 1, foi validada com texto visível no Chromium. Veja [a correção do carregamento de legendas](docs/SUBTITLE-LOADING-FIX.md), incluindo a correção dos IDs modernos de Frieren e Demon Slayer e os limites da amostra.

**Mais legendas em 27/10/2026:** a busca agora combina OpenSubtitles REST e o addon oficial v3, com identidade exata e deduplicação por arquivo. Também foram integrados dois lançamentos revisados: PT-BR do filme de Steins;Gate pelo Legendei e tradução automática PT-BR de Overgeared, episódio 2, pelo SubDL. A faixa automática é identificada na seleção e mantém um aviso visível no player; faixas portuguesas sem essa indicação têm prioridade. Veja [fontes, testes e limites](docs/MORE-PORTUGUESE-SUBTITLES.md). Não foi encontrado arquivo português acessível para Overgeared E01 nesta pesquisa.

Você também pode testar, independentemente dessas APIs:

- [Player HLS autorizado](http://127.0.0.1:5173/watch/demo).
- [Leitor textual com história original PT-BR](http://127.0.0.1:5173/novel/demo/read/1).
- [Minha Lista e histórico](http://127.0.0.1:5173/library).
- [Diagnóstico das fontes](http://127.0.0.1:5173/providers).

O vídeo precisa de conexão com o servidor de demonstração. Os textos originais são servidos pela API local.

## Funcionalidades implementadas

- **Animes:** início com destaque cinematográfico e carrosséis; pesquisa e sugestões; gênero, ano, temporada, formato, status, ordem e paginação; detalhes com personagens, relações, recomendações e links oficiais. Episódios diretamente nos detalhes, com índice real da fonte, busca, intervalos de 50 e páginas de 24. Dados via AniList; cada vídeo é verificado ao abrir o episódio.
- **Player:** HLS adaptativo com níveis reais do manifesto, seleção manual, MP4 alternativo, velocidade, volume, mute, tela cheia, atalhos, buffering, erros e retomada; navegação anterior/próximo quando fornecida pelo índice. Fontes Toko/Tatakai passam por verificação do primeiro trecho; falhas definitivas ou 15 segundos sem avanço acionam a próxima URL disponível, preservando posição e intenção de reprodução. Aberturas só podem ser puladas com intervalos válidos do provedor.
- **Legendas:** WebVTT nativo para OpenSubtitles, com conversão SRT/ASS no servidor; conversão no navegador mantida para fontes legadas. Seleção/desativação, prioridade por código explícito `pt-BR`, tamanho, fundo, contorno e sincronização persistentes. Busca externa PT-BR/PT por identidade de série, temporada e episódio; download somente da faixa selecionada, aviso de erro e até três novas tentativas manuais, com falha independente do vídeo e sem trocar silenciosamente o idioma. ASS não renderiza karaoke, desenhos, fontes anexadas nem efeitos de composição.
- **Mangás:** contrato MangaDex v5, seleções populares/em publicação/notas/atualizações, busca, filtros, detalhes, capítulos por idioma e créditos dos grupos. PT-BR é o padrão do catálogo e da leitura; português agregado e outros idiomas são escolhas explícitas, preservadas na URL e nas preferências. Leitor vertical, página única ou dupla adaptativa, zoom, largura/altura, temas, tela cheia, teclado/gestos, carregamento progressivo, retry por imagem e retomada. O leitor também recebe capítulos/páginas das extensões em `/sources`, com idioma, créditos e progresso. MangaDex PT-BR e Webtoons foram validados com imagens reais; fixtures de teste ficam somente nos testes.
- **Novels:** catálogo AniList `MANGA`/`NOVEL`, filtros e detalhes; leitor textual com fonte, tamanho, espaçamento, temas, capítulos e progresso. Três capítulos de uma história original permitem testar o leitor. Fontes de texto também usam o host Toko/Tatakai; a leitura do original japonês de Bookworm foi validada através do Syosetu.
- **Biblioteca:** animes, mangás e novels; listas, favoritos, conclusão manual e históricos de reprodução/leitura. Persistência local com dados limitados, validação e avisos se o navegador bloquear o armazenamento. Serviços separados permitem futura sincronização por conta.
- **Provedores:** contratos independentes, cliente HTTP Toko com configuração, timeout/retry/cache e permissões por provedor/domínio; host local Tatakai, resolução de leitura e addons Stremio por HTTP; tela de diagnóstico. HLS e MP4 Toko/Tatakai usam tickets opacos no transporte local, com verificação inicial de mídia. Imagens e legendas que exigem Referer/Origin configurados também usam tickets; a saúde técnica não comprova conteúdo disponível.

AniList fornece metadados e não vídeos. O player de demonstração usa **Big Buck Bunny, CC BY 3.0**, com atribuição na interface. Sua faixa PT-BR é um guia original do player. Não é uma tradução de diálogos do filme. O índice permite selecionar episódios reais; essa listagem não comprova que todos os vídeos estão disponíveis.

## Configuração dos provedores

Todas as variáveis ficam documentadas em `.env.example`. Variáveis de Toko, Tatakai, AniList, MangaDex e Redis pertencem somente ao backend.

**Toko:** o artefato original 4.5.5 solicitado pelo usuário está instalado somente em `.local/sources/toko-4.5.5/`, fora do Git e sem alterar seu bundle. A distribuição não declara licença geral para incorporar/redistribuir seu código. O HPmovies usa o host Tatakai MPL-2.0 e um cliente HTTP independente. O adaptador `TOKO_*` continua disponível para um servidor HTTP separado; o pacote local usa `TATAKAI_*`. `TOKO_ENABLED=true` ativa a comunicação; reprodução exige também `TOKO_CONTENT_AUTHORIZED=true`, provedores em `TOKO_ALLOWED_PROVIDERS` e hosts exatos em `TOKO_ALLOWED_MEDIA_HOSTS`. Essas opções só devem representar permissões que o operador realmente possui. Sem serviço configurado, o catálogo e a biblioteca continuam independentes.

**Tatakai local:** o host Node do repositório foi incorporado sob MPL-2.0, com licença e revisão preservadas. `npm run dev` o inicia junto da API. `TATAKAI_ENABLED=true` consulta esse host local; a API pública `api.tatakai.me` continua separada e não é usada como fonte de conteúdo. O repositório atual não inclui extensões de conteúdo. Neste ambiente, `HPMOVIES_EXTENSIONS_FILE` já aponta ao pacote local com manifesto e SHA-256. As fontes selecionadas são Nebula, AniZone, Webtoons e Syosetu. Em uma instalação nova, configure o bundle, namespace, provedores e domínios permitidos; extensões não são baixadas durante `npm ci` ou `npm run dev`. Veja [o host local](docs/LOCAL-SOURCE-HOST.md) e [as rotas de conteúdo](docs/CONTENT-BACKEND.md).

**MangaDex:** a documentação exige proxy para websites. A API local faz as consultas e fornece imagens por tickets opacos em `/api/manga/image/:token`, emitidos para hosts oficiais previamente validados. A rota não recebe uma URL. Tem timeout, limite de bytes, MIME de imagens, limite de concorrência e bloqueio de redirecionamentos. Créditos são preservados, não há anúncios nem cobrança. `MANGADEX_BLOCKED_GROUP_IDS` permite respeitar pedidos de remoção de grupos, informados por UUID. O comportamento deve continuar atendendo à [política oficial](https://gitlab.com/mangadex-pub/mangadex-api-docs/-/blob/main/index.md) e às [limitações de uso](https://gitlab.com/mangadex-pub/mangadex-api-docs/-/blob/main/2-limitations.md).

**Legendas em português:** `EXTERNAL_SUBTITLES_ENABLED=true` habilita OpenSubtitles REST, addon oficial v3 e lançamentos curados; é o padrão e não exigiu chave nesta validação. A API confere a identidade do episódio, emite tickets opacos em `/api/subtitles/file/:token` e limita download/descompactação. Os lançamentos curados usam arquivos públicos revisados e URLs exatas; não há busca aproximada por título. Uma falha da busca mantém o vídeo disponível. Use `false` para desativar. O acesso anônimo observado pode mudar conforme o serviço externo; detalhes atuais em [MORE-PORTUGUESE-SUBTITLES.md](docs/MORE-PORTUGUESE-SUBTITLES.md) e pesquisa anterior em [PORTUGUESE-SOURCES.md](docs/PORTUGUESE-SOURCES.md).

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

Com `npm run dev` e as fontes reais já configuradas, verifique separadamente vídeo, áudio, legenda PT-BR e seek nos cinco títulos da amostra:

```bash
npm run test:streaming:real
```

Esse comando não usa fixtures, depende dos serviços externos e salva JSON/capturas em `/tmp/hpmovies-playback-<timestamp>/`. IDs opcionais limitam a amostra, por exemplo `npm run test:streaming:real -- 20 1535`. Critérios e limites estão em [STREAMING-FIX-VALIDATION.md](docs/STREAMING-FIX-VALIDATION.md).

Os testes antigos de scraping em `src/aniwatch-apis/__tests__` são históricos e não fazem parte da suíte local ativa.

A suíte de navegador distingue cenários com fixtures isoladas (catálogos e páginas de mangá) de chamadas reais (backend local, texto original, HLS remoto). Fixtures não integram o código da aplicação. O HLS depende da disponibilidade do servidor de teste e de codecs compatíveis.

```bash
curl http://127.0.0.1:4000/health
curl http://127.0.0.1:4000/api/providers
curl 'http://127.0.0.1:4000/api/catalog/search?search=Frieren&season=FALL'
curl 'http://127.0.0.1:4000/api/manga/search?language=pt-br&sort=popular'
curl http://127.0.0.1:4000/api/novels/demo/chapters/1/content
```

Para verificar a versão compilada, use `npm run start:backend` e, em outro terminal, `npm run preview`. O frontend de preview também usa a API local. Para desenvolver no dia a dia, `npm run dev` já basta.

## Segurança, limites e próximos passos

A API escuta somente em loopback por padrão, limita origens e quantidade de requisições usando o endereço real da conexão, recusa proxy arbitrário e não encaminha APIs administrativas de terceiros. Cache e consultas simultâneas são limitados; chaves incluem provedor, rota e parâmetros. Redis é opcional. Credenciais não são expostas no frontend e extensões executáveis não são instaladas automaticamente.

Após remoção de dependências sem uso e atualizações compatíveis, `npm audit --omit=dev` não apresentou alertas nesta validação. A árvore completa ainda tem sete alertas de ferramentas de desenvolvimento ligados ao Tailwind 3 (`braces` e `postcss-selector-parser`). A correção sugerida exige uma migração para Tailwind 4 e está registrada para uma etapa própria. O chunk de reprodução inclui HLS.js e é carregado apenas ao abrir o player.

O relatório por entrega, arquivos, reaproveitamento, resultados e pendências está em [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md). [AUDIT.md](AUDIT.md) preserva também a auditoria histórica anterior. Próximos passos: repetir a validação do AniList quando responder, ampliar as amostras de capítulos e legendas em português e a validação das demais fontes do Toko; depois, preparar o deploy em uma etapa futura. Não foi feito push nem publicação.

A quota de mídia (`MEDIA_RATE_LIMIT`, padrão 600/minuto por cliente) é independente da quota de catálogo. O transporte fixa DNS público na conexão TLS, valida hosts/origens e limita bytes/concorrência/cache. `TOKO_ALLOWED_STREAM_DOMAINS` e `TATAKAI_ALLOWED_STREAM_DOMAINS` permitem famílias específicas de CDN e seus subdomínios, somente para vídeo e legendas; imagens continuam exigindo hosts exatos. HLS AES-128 comum com chave pública de 16 bytes é suportado e o segmento decifrado é validado antes de oferecer a fonte. Cookies, autenticação, redirecionamentos, DRM e formatos de criptografia não suportados continuam recusados. Recursos de navegador e contorno de desafios não são ativados.
