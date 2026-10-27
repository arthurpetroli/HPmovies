# Backend de conteúdo — Tatakai local, Toko e Stremio

Esta etapa liga a resolução de mídia e leitura à API HPmovies. AniList e MangaDex permanecem com suas integrações de catálogo; a indisponibilidade deles não exige alterar as fontes de conteúdo.

## Executar localmente

```bash
npm run dev
```

Esse comando inicia frontend 5173, API 4000 e host Tatakai 8099. Se já existe uma instância antiga do projeto nas portas, encerre-a pelo terminal onde foi iniciada e reinicie o comando. Para iniciar somente o host:

```bash
npm run dev:source-host
curl http://127.0.0.1:8099/health
```

O host é código real do [Tatakai](https://github.com/Snozxyx/Tatakai), sob MPL-2.0. Licença, revisão exata e alterações estão em `src/aniwatch-apis/src/providers/tatakai-runtime/vendor`. O código atual do repositório não inclui extensões de conteúdo; sem configuração, a resposta saudável contém `namespaces: []` e o HPmovies informa ausência da fonte. Não há catálogo fictício para simular reprodução.

## Configurar uma extensão local

Consulte [LOCAL-SOURCE-HOST.md](LOCAL-SOURCE-HOST.md) para o arquivo com manifesto, bundle CJS, confiança explícita e SHA-256. Esse arquivo fica fora do Git, por exemplo `.local/sources/sources.json`. Recursos Electron não são suportados; bundles com navegador opcional podem usar `browserMode: "disabled"` para executar os provedores HTTP originais.

```dotenv
HPMOVIES_EXTENSIONS_FILE=.local/sources/sources.json
HPMOVIES_SOURCE_HOST_PORT=8099
TATAKAI_ENABLED=true
TATAKAI_API_URL=http://127.0.0.1:8099
TATAKAI_NAMESPACE=namespace-declarado-no-manifesto
TATAKAI_CONTENT_AUTHORIZED=true
TATAKAI_ALLOWED_PROVIDERS=identificador-real-do-provedor
TATAKAI_ALLOWED_MEDIA_HOSTS=host-real-da-midia.example.com
```

Substitua os valores pelos dados da fonte escolhida, com permissão de uso. Os nomes não são uma lista de provedores já instalados. Novels com texto não exigem host de mídia; páginas de mangá e fontes de vídeo exigem hosts HTTPS exatos. O backend rejeita autenticação e destinos não configurados. Referer/Origin permitidos usam tickets opacos de imagens e vídeo; não há reenvio de cookies ou desafios de navegador. Ele não reintroduz o proxy aberto antigo.

O cliente Toko independente continua disponível em paralelo. Use `TOKO_API_URL` para um servidor Toko separado e outra porta caso o host Tatakai ocupe 8099. A configuração de permissão por provedor/domínio permanece independente.

## Endpoints HPmovies

Todas as respostas de sucesso usam `{ "data": ... }`. `source` seleciona o adaptador `tatakai` ou `toko`; `provider` seleciona uma fonte de leitura permitida dentro do adaptador. IDs de obra no novo contrato usam `anilist:123`, evitando confusão com UUIDs MangaDex. Os endpoints MangaDex existentes continuam separados.

| Operação | Rota |
| --- | --- |
| Diagnósticos | `GET /api/providers` |
| Imagem emitida por capítulo | `GET /api/content/image/:token` |
| Mídia emitida por fonte/manifesto HLS | `GET /api/streaming/media/:token` |
| Índice real de episódios | `GET /api/streaming/anime/:anilistId/episodes` |
| Resolver episódio explícito | `GET /api/content/anime/:anilistId/episodes/:numero` |
| Reabrir reprodução normalizada | `GET /api/streaming/episodes/:episodeId` |
| Capítulos de mangá | `GET /api/content/manga/:workId/chapters` |
| Páginas de mangá | `GET /api/content/manga/:workId/chapters/:chapterId/pages` |
| Capítulos de novel | `GET /api/content/novel/:workId/chapters` |
| Texto de novel | `GET /api/content/novel/:workId/chapters/:chapterId/content` |
| Capítulos no leitor existente | `GET /api/novels/:id/chapters` |
| Texto no leitor existente | `GET /api/novels/:id/chapters/:chapterId/content` |
| Série via addon HTTP | `GET /api/content/stremio/:imdbId/:temporada/:episodio` |

As rotas de leitura aceitam `source`, `provider`, `language`, `title` e até cinco `titles[]`. Informe títulos conhecidos para permitir busca na extensão durante indisponibilidade do AniList. Eles são contexto da requisição, sem registrar um mapeamento global. Preserve o mesmo título ao abrir um capítulo durante essa indisponibilidade.

```bash
curl 'http://127.0.0.1:4000/api/content/anime/1/episodes/1?source=tatakai&title=Cowboy%20Bebop'
curl 'http://127.0.0.1:4000/api/content/manga/anilist:30001/chapters?source=tatakai&language=pt-BR&title=Titulo%20da%20obra'
curl 'http://127.0.0.1:4000/api/content/novel/anilist:30001/chapters?source=tatakai&title=Titulo%20da%20obra'
```

Depois de listar capítulos, use o `id` retornado para pedir páginas ou texto. Esse ID é um hash estável; não contém a URL upstream. A API reconstrói a associação pela fonte após um reinício, verifica obra/tipo/provedor e transmite `providerChapterId` somente a partir da listagem validada. Idiomas e créditos são preservados. A lista prioriza PT-BR explícito, registra resultados parciais e isola falhas por fonte. Um capítulo com páginas que exigem cabeçalhos ou hosts sem configuração recebe erro integral. Os cabeçalhos autorizados são aplicados no transporte de imagens, com limite de bytes, DNS público fixado na conexão TLS e sem redirecionamentos.

O host local agora expõe `/api/v3/:namespace/index/episodes` por um resolver validado. Para Nebula, consulta o índice público paginado pelo ID AniList, valida a identidade e limita páginas, bytes, concorrência e tempo; outros provedores usam o método de índice da extensão quando existente. Não inventa episódios a partir da quantidade do catálogo. A página do anime preserva o índice mesmo quando uma sondagem de vídeo falha, permitindo resolver cada episódio individualmente. O player reconhece IDs `tatakai:<AniListId>:<episodio>` e `toko:<AniListId>:<episodio>`.

## Addon Stremio por HTTP

`STREMIO_ADDONS_JSON` é configuração privada do backend, sem instalação de executáveis:

```dotenv
STREMIO_ADDONS_JSON=[{"id":"minha-fonte","name":"Minha fonte HTTP","manifestUrl":"https://addon-real.example.com/manifest.json","authorized":true,"allowedMediaHosts":["media-real.example.com"]}]
```

O manifesto precisa declarar `stream`, o tipo `series` e um prefixo compatível com IMDb. Catálogos como Cinemeta não oferecem vídeo só por responderem a metadados. A resolução usa IMDb/temporada/episódio explícitos e aceita apenas HLS/MP4 diretos permitidos, sem torrents, embeds ou redirecionamentos. Nenhum addon de conteúdo é incluído automaticamente.

## Validação inicial do contrato

- Host Node real, manifesto/hash/registro explícito e resposta de saúde.
- Bundle original de teste executado no host, atravessando a API HPmovies para streaming, mangá e novel.
- Reabertura de capítulos após recriar o backend, contexto de título, idioma, créditos, `providerChapterId` e isolamento por obra/tipo.
- Retorno de texto no leitor normal mesmo com falha de metadados.
- Contratos Stremio, permissões, cache, falha isolada e descarte de fontes incompatíveis.
- Build, TypeScript, lint e suíte de navegador.

Os testes de runtime usam conteúdo original de teste. Isso valida a execução e os contratos, sem afirmar que existe uma extensão externa instalada. A validação externa posterior usou o pacote oficial Toko4.5.5 instalado fora do Git; veja [REAL-CONTENT-VALIDATION.md](REAL-CONTENT-VALIDATION.md).

Resultado desta etapa em 21/10/2026: **182 testes automatizados em 21 arquivos**, **10 testes de navegador desktop/mobile**, TypeScript, lint, build e `git diff --check` aprovados. O host local real respondeu HTTP 200; como nenhuma extensão externa foi configurada, retornou a lista vazia de namespaces. Os testes integrados usaram somente um bundle original de teste e não afirmam reprodução de animes de terceiros.

Arquivos principais: `providers/tatakai-runtime/*` e `scripts/start-source-host.cjs` (motor reaproveitado/licença); `providers/tatakai.ts`, `toko-http.ts`, `toko-reading.ts`, `content-registry.ts`, `novel-content.ts`, `stremio.ts` (resolução/adaptação); `app.ts`, `shared/content.ts`, configuração de integrações e exemplos `.env` (rotas/contratos); serviços de streaming e páginas de detalhe/player (títulos por requisição). Nenhum deploy ou push foi realizado.

## Conteúdo real e interface

A tela `/sources` consulta diretamente as rotas acima e reutiliza o player e os leitores existentes, preservando título/fonte/idioma nas URLs. Ela permite acesso enquanto os catálogos estão em manutenção. [REAL-CONTENT-VALIDATION.md](REAL-CONTENT-VALIDATION.md) contém a instalação local e os resultados externos atuais, separados dos testes automatizados.

A etapa de fontes reais encerrou com **214 testes automatizados em 24 arquivos e 18 testes de navegador**, além de lint, TypeScript, build e verificação de whitespace aprovados. O [relatório atual](REAL-CONTENT-VALIDATION.md) substitui as pendências de instalação externa do relatório inicial acima.
