# Entrega local HPmovies V2 — 21/10/2026

## Escopo e estado final

Trabalho realizado em `feat/hpmovies-v2`, priorizando execução local. As alterações que já estavam no workspace foram preservadas e ampliadas. Não houve push, publicação, instalação automática de extensões ou migração da stack.

A implementação local e seus testes foram concluídos nesta rodada. A validação externa integral permanece pendente: o AniList recusou consultas reais, o MangaDex respondeu 503, não existe serviço Toko local instalado e a TatakaiAPI não tem contrato público validado. Portanto, **esta entrega não afirma que todos os critérios de conclusão do produto foram atingidos**. Catálogos e leitores não usam dados fictícios em produção para esconder essas dependências.

## Entrega 1 — Auditoria, estabilidade e provedores

**Implementado:** execução conjunta frontend/API; proxy local e configuração unificada; cache com TTL, deduplicação, limite de memória/concorrência e chaves por provedor/rota/parâmetros; configuração privada de serviços; rate limiting pelo endereço da conexão e CORS configurável; headers de segurança. O proxy antigo que recebia URLs arbitrárias retorna 410. O Aniwatch só é importado após uma requisição legada explicitamente habilitada; a plataforma ativa inicia sem ele.

Contratos independentes: `AnimeCatalogProvider`, `AnimeStreamingProvider`, `MangaCatalogProvider`, `MangaChapterProvider` e `NovelProvider`. O registro de reprodução mantém a demonstração separada, isola falhas e expõe estados de disponibilidade. Toko possui cliente HTTP tipado baseado nos caminhos e parâmetros reais, health check que distingue servidor de bundle, timeout/retry limitado, cache, validação e filtros por permissão/provedor/domínio. `sub` não vira PT-BR. Tatakai tem adaptador que informa indisponibilidade e não inventa endpoints. A tela `/providers` separa conexão técnica de autorização.

**Arquivos principais:** `src/shared/{providers,manga,novel}.ts`; `src/aniwatch-apis/src/app.ts`, `server.ts`, `config/{runtime,integrations,cache,apiError}.ts`, `middleware/apiLimit.ts`, `providers/{anilist,streaming,registry,toko,toko-http,tatakai}.ts`, `routes/legacy.ts`; `.env.example`, exemplo do backend, `vite.config.ts`, configurações TypeScript e `package*.json`.

**Reaproveitamento:** Hono, servidor Node, cache Redis opcional e arquivos de compatibilidade existentes. O cache e o proxy que já tinham correções locais foram preservados e verificados. Não foi copiado código Toko/Tatakai; o primeiro não declara licença e o segundo foi consultado como referência arquitetural sob sua licença declarada.

**Validação:** cache, isolamento, filtros, erros, rate limiting, ausência simulada de Aniwatch, proxy 410 e contratos Toko foram testados. Toko/Tatakai tiveram contratos ou disponibilidade investigados em fontes primárias, registrados em [PROVIDERS.md](PROVIDERS.md). `127.0.0.1:8099` não tinha serviço; o domínio Tatakai respondeu 404 às verificações, sem demonstrar um contrato utilizável.

**Pendências:** serviço Toko permitido e fontes autorizadas reais; documentação e condições TatakaiAPI; repetir consultas ao AniList após recuperação da API. Nenhuma configuração, por si só, comprova direitos sobre conteúdo.

## Entrega 2 — Animes, interface e player

**Implementado:** identidade própria, header, navegação desktop/mobile, pesquisa com sugestões, destaque cinematográfico, carrosséis e estados de erro/carregamento/vazio. Catálogo AniList com busca, gênero, ano, temporada, formato, status, ordenação e paginação. Detalhes com sinopse, personagens, relações/temporadas, recomendações, links, favoritos e disponibilidade separada. A home mantém navegação, retomada e acesso às demonstrações durante uma falha do catálogo.

Player: HLS e MP4, resoluções reais, seleção automática/manual, velocidade, volume/mute, tela cheia, atalhos, avanço/retorno, episódios adjacentes quando comprovados, buffering, recuperação limitada, troca de fonte e progresso persistido. Aberturas exigem intervalo válido. WebVTT e conversão SRT/ASS textual; idioma declarado, seleção/desativação, tamanho, fundo/contorno e sincronização persistente. ASS não pretende renderizar efeitos, karaoke ou desenhos. Conversões têm limite de 2 MB e timeout. Uma faixa falha não oculta outra faixa válida. Preferência de idioma é alterada por ação manual, preservando-a quando uma fonte não possui aquele idioma.

**Arquivos principais:** `src/App.tsx`, `src/index.css`, páginas `Anime*`, `ExplorePage.tsx`, `WatchPage.tsx`, `ProvidersPage.tsx`; componentes `anime`, `navigation`, `filters`, `search`, `player`; serviços `catalog.ts`, `streaming.ts`, `http.ts`, `library.ts`; `public/hpmovies.svg` e `demo-pt-BR.vtt`.

**Reaproveitamento:** limites e funções dos cards, hero, carrossel, busca, navegação, player e HLS.js existentes. `Home` e `Navbar` continuam delegando às implementações canônicas. Os novos leitores e o player são carregados sob demanda.

**Validação:** desktop e mobile, filtros, pesquisa vazia, detalhes, favoritos após recarregamento e ausência de reprodução inventada foram verificados no navegador com contratos simulados exclusivamente na suíte de testes. Reprodução HLS remota real avançou, 720p foi selecionado, atalhos/progresso/retomada e preferências persistiram. O teste de SRT carregou uma legenda de teste via Blob/WebVTT, manteve-a visível enquanto outra faixa falhava e restaurou a sincronização. Foi corrigido o bloqueio do botão central de reprodução pela camada de controles no mobile.

**Pendências:** catálogo externo ao vivo, episódios reais e legendas de animes permitidos. A faixa PT-BR da demonstração é um guia original e isso aparece na tela.

## Entrega 3 — Mangás

**Implementado:** provedor MangaDex v5, catálogo com seleções, busca, filtros, ordenação/paginação, detalhes, capítulos por idioma e créditos de grupos. PT-BR é a seleção inicial; a interface informa ausência da tradução e permite outras edições. Falhas de feed não apagam os detalhes e falhas de navegação não ocultam páginas disponíveis.

Leitor vertical, página única/dupla adaptativa, ajuste de largura/altura/tamanho original, zoom, temas, tela cheia, teclado, gestos, carregamento progressivo, duas próximas páginas em pré-carregamento, retry individual, capítulos anterior/próximo, progresso e retomada. Páginas que não carregam não são marcadas como lidas. Preferências e histórico são locais, com aviso sobre armazenamento indisponível.

A documentação oficial do MangaDex exige proxy de API e imagens para websites. Consultas passam pelo backend; capas/páginas usam tickets opacos e temporários, restritos a hosts oficiais HTTPS. Não existe parâmetro de URL no gateway. Há limite de 20 MB, timeout total, MIME permitido, redirecionamentos bloqueados, 12 carregamentos simultâneos, deduplicação e até 2048 tickets. Imagens podem ser embutidas por uma origem frontend separada; as outras rotas mantêm isolamento. A política de remoção por grupo entra também nas chaves de cache. URLs expiradas de capas salvas podem ser renovadas; falhas mostram um placeholder.

**Arquivos principais:** `shared/manga.ts`, `providers/mangadex.ts`; `services/manga.ts`, `mangaLibrary.ts`; `MangaHomePage.tsx`, `MangaDetailsPage.tsx`, `MangaReaderPage.tsx`; `components/manga/*`, `frontend/manga.css` e rotas em `app.ts`/`App.tsx`.

**Reaproveitamento:** cliente HTTP comum, hook de requisições, componentes de estado, estilo visual e biblioteca local. Implementação própria, consultando os contratos oficiais e a arquitetura Tatakai.

**Validação:** normalização, filtros, PT-BR, créditos, paginação, cache, isolamento de falhas, navegação, gateway e persistência cobertos por testes. Navegador desktop/mobile verificou capítulo PT-BR, mudança para leitura paginada, avanço, retomada após reload, próximo capítulo e presença na biblioteca. As imagens e metadados desse fluxo são fixtures rotuladas da suíte, sem uso na aplicação.

**Pendência externa:** `api.mangadex.org` retornou 503 nesta sessão, impedindo comprovar catálogo e páginas reais. Não houve contorno dessa falha. Referências: [política](https://gitlab.com/mangadex-pub/mangadex-api-docs/-/blob/main/index.md), [limitações](https://gitlab.com/mangadex-pub/mangadex-api-docs/-/blob/main/2-limitations.md) e [capítulos/imagens](https://gitlab.com/mangadex-pub/mangadex-api-docs/-/blob/main/04-chapter/retrieving-chapter.md).

## Entrega 4 — Novels, biblioteca e verificações finais

**Implementado:** catálogo real AniList com `type:MANGA`/`format:NOVEL`, busca/filtros/paginação, detalhes/autores/links e interface de capítulos. Leitor textual com fonte/tamanho/espaçamento/temas, progresso por parágrafo, retomada e navegação. Três capítulos de uma história original PT-BR permitem testar o leitor sem uma fonte externa. Obras de catálogo sem fonte autorizada retornam capítulos indisponíveis e nenhum texto externo é inventado.

Biblioteca unificada para todos os formatos: listas, favoritos, conclusão manual e históricos de reprodução e leitura, com filtros por formato. Dados locais são validados e limitados. Persistência bloqueada ou cheia gera aviso; alterações seguem disponíveis na sessão. Serviços por domínio permitem futura sincronização por conta sem introduzir autenticação agora.

**Arquivos principais:** `shared/novel.ts`, `providers/novels.ts`, serviços `novels.ts`/`novelLibrary.ts`, páginas `Novel*` e `novel.css`, `LibraryPage.tsx` e serviços de biblioteca. Testes em `tests/`, configuração Vitest e `playwright.config.ts`; documentação neste diretório e na raiz.

**Reaproveitamento:** AniList, cliente HTTP, componentes de estado/cards e persistência de anime existentes. Removidos pacotes sem uso (Express e complementos, `redis` duplicado, `ts-node` e `nodemon`), mantendo Hono, `ioredis` e `tsx`. Vitest foi atualizado e dependências receberam correções compatíveis.

**Pendências:** textos externos permitidos, validação dos catálogos online e futura sincronização por conta/deploy. LocalStorage foi mantido com compactação, limites e avisos; não foi criado banco ou sistema de autenticação sem necessidade.

## Resultado final dos testes

| Verificação | Resultado |
| --- | --- |
| `npm test` | 148 testes aprovados, 17 arquivos |
| `npm run lint` | Aprovado, sem erros nem avisos |
| `npm run build` | TypeScript frontend/configuração/backend e builds aprovados |
| `npm run test:e2e` | 10 testes aprovados, desktop 1440 px e mobile Pixel 7 |
| Capturas adicionais reais | Início, diagnóstico, mangás e demos; sem overflow e sem erros JavaScript |
| HLS e MP4 de demonstração | Manifesto HTTP 200, MP4 parcial HTTP 206; reprodução HLS real comprovada |
| Versão compilada | API e frontend preview iniciados; saúde/demonstrações/proxy e leitor/HLS verificados |
| `git diff --check` | Aprovado |
| `npm audit --omit=dev` | 0 alertas |
| `npm audit` completo | 7 alertas: 2 moderados, 5 altos, 0 críticos; ferramentas de desenvolvimento Tailwind 3 |

A instalação original apresentava 49 alertas, incluindo quatro críticos. Os sete restantes envolvem `braces`/`postcss-selector-parser` e dependentes do Tailwind 3. A correção indicada pelo npm exige migração para Tailwind 4; não foi aplicada uma migração automática com `--force`. Isso precisa ser tratado antes de declarar a árvore inteira livre de alertas. O build também informa que o chunk do player ultrapassa 500 kB, devido ao HLS.js; ele é separado e só é transferido ao abrir a reprodução.

Os testes de contrato usam fixtures e falhas simuladas. Os testes de navegador dos catálogos/mangás também usam fixtures próprias; os testes de backend local, texto original, HLS e SRT são executados no navegador com as fontes indicadas. Essas categorias não equivalem a uma validação ao vivo dos serviços indisponíveis.

## Próximos passos concretos

1. Repetir consultas de home, busca, filtros, detalhes e personagens ao AniList quando sua API responder.
2. Repetir catálogo, capítulos PT-BR, gateway e leitor com uma edição realmente acessível do MangaDex.
3. Configurar um serviço Toko permitido, comprovar bundle/health, provedores autorizados, mídia, idiomas e episódios reais.
4. Manter TatakaiAPI desativada até obter documentação e condições verificáveis; conectar textos de novels apenas com permissão.
5. Tratar a migração de ferramentas Tailwind para remover os alertas restantes e, depois, preparar o deploy em uma etapa autorizada separada.
