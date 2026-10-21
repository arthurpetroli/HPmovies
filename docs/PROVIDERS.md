# Provedores HTTP: implementação e verificação local

Verificado em 21/10/2026. O catálogo AniList e o MangaDex funcionam independentemente de Toko/TatakaiAPI. A existência de metadados ou de um índice de episódios não implica mídia reproduzível.

## Toko

A integração é um cliente HTTP escrito no HPmovies; nenhum bundle, scraper, extensão executável ou código do Toko foi incorporado. O [metadado público do repositório](https://api.github.com/repos/Snozxyx/Toko) informava `license: null`; sua raiz não continha `LICENSE`. Os avisos de dependências não equivalem a uma licença para o projeto inteiro. A instalação/execução de uma distribuição separada depende das permissões aplicáveis e não foi realizada automaticamente.

O contrato foi conferido diretamente em [api/src/server.js](https://github.com/Snozxyx/Toko/blob/main/api/src/server.js), [tipos de fontes](https://github.com/Snozxyx/Toko/blob/main/src/types/source.types.ts), [README](https://github.com/Snozxyx/Toko/blob/main/README.md), [package.json](https://github.com/Snozxyx/Toko/blob/main/package.json) e [api/package.json](https://github.com/Snozxyx/Toko/blob/main/api/package.json). O cliente utiliza:

| Operação | Caminho real | Parâmetros |
| --- | --- | --- |
| Saúde | `/api/v3/health` | Nenhum; exige `ok: true`, `service: "toko-api"` e `toko: true` |
| Idiomas | `/api/v3/toko/languages` | `anilistId`, `stream=0` |
| Índice de episódios | `/api/v3/toko/index/episodes` | `anilistId`, `stream=0` |
| Reprodução direta | `/api/v3/toko/stream` | `anilistId`, `episode`, `stream=0`, limites de concorrência/retry/timeout |
| Capítulos de mangá/novel | `/api/v3/toko/{manga,novel}/chapters` | `anilistId`, `stream=0` |
| Páginas de mangá | `/api/v3/toko/manga/pages` | `chapterKey`, `provider`, `stream=0` |
| Conteúdo de novel | `/api/v3/toko/novel/content` | `chapterKey`, `provider`, `stream=0` |

`stream=0` é necessário: o endpoint de fontes responde SSE por padrão. O estado `ok` da saúde refere-se ao HTTP; `toko: false` significa bundle ausente. O índice possui `episodes: [{ number, title? }]`, não identificadores nativos do HPmovies. A integração cria identificadores `toko:<AniListId>:<numero>`, verifica uma fonte do primeiro episódio antes de declarar disponibilidade e verifica cada episódio novamente ao abrir o player.

Configuração privada do backend, com integração desligada por padrão:

```dotenv
TOKO_API_URL=http://127.0.0.1:8099
TOKO_ENABLED=false
TOKO_TIMEOUT_MS=8000
TOKO_RETRIES=1
TOKO_CONTENT_AUTHORIZED=false
TOKO_ALLOWED_PROVIDERS=
TOKO_ALLOWED_MEDIA_HOSTS=
TATAKAI_ENABLED=true
TATAKAI_API_URL=http://127.0.0.1:8099
TATAKAI_NAMESPACE=toko
```

Uma instalação externa autorizada pode seguir as instruções do repositório para construir o serviço (`npm run build:api`) e iniciá-lo com `TOKO_API_HOST=127.0.0.1 TOKO_API_PORT=8099 npm start`. O HPmovies não executa esses comandos nem instala extensões. O endereço deve apontar para a raiz do serviço; também aceita o sufixo `/api/v3`. Não exponha o serviço Toko diretamente: seu servidor inclui rotas administrativas, que o HPmovies não encaminha.

`TOKO_ENABLED=true` habilita apenas a comunicação e os diagnósticos. Para liberar conteúdo, o operador deve ter permissão para as fontes correspondentes, definir `TOKO_CONTENT_AUTHORIZED=true`, nomes de provedores em `TOKO_ALLOWED_PROVIDERS` e hosts DNS exatos em `TOKO_ALLOWED_MEDIA_HOSTS`, separados por vírgula. Não use curingas. Essas opções registram a configuração do operador; não fazem uma verificação jurídica automática dos direitos.

O servidor Toko analisado agrega provedores e não oferece filtro por provedor no endpoint de streaming. Não foi inventado um parâmetro para isso. O adaptador só consulta streams quando há permissão explícita configurada, e só libera resultados que correspondam ao provedor e ao host permitidos. Fontes com cabeçalhos especiais, embeds, torrents, URLs HTTP, credenciais na URL e hosts fora da lista são rejeitados. Legendas passam pelo mesmo filtro. `sub`, `dub`, rótulos livres e idioma ausente são `und`; `pt` permanece `pt`, e somente uma declaração explícita `pt-BR` é priorizada como português brasileiro. A qualidade declarada pelo provedor é um rótulo; os níveis HLS reais continuam sendo descobertos pelo player.

Os métodos de mangá e novel agora estão ligados às rotas normalizadas `/api/content/manga/...` e `/api/content/novel/...`, detalhadas em [CONTENT-BACKEND.md](CONTENT-BACKEND.md). A listagem exige um provedor permitido e filtra seus resultados. O conteúdo só aceita chaves anteriormente recebidas nessa listagem, com validade de dez minutos; uma chave arbitrária contendo uma URL não pode iniciar uma consulta. Fontes MangaDex ativas seguem seu adaptador próprio. Novels usam essas fontes quando configuradas; ausência de fonte continua sendo informada explicitamente.

Todas as consultas recusam redirecionamentos, limitam respostas JSON a 2 MB, têm timeout de 250–30000 ms e no máximo dois retries configuráveis; o padrão é um retry apenas para erros transitórios. Existem no máximo quatro consultas distintas simultâneas por cliente. Consultas idênticas compartilham uma Promise. O cache considera origem, rota, parâmetros ordenados e, em listagens filtradas, o provedor permitido. Saúde dura 15 s; streams, 30 s; metadados, 120 s. Falhas não são armazenadas como sucesso.

## Tatakai local e API pública

O [repositório Tatakai](https://github.com/Snozxyx/Tatakai) declara [MPL-2.0](https://github.com/Snozxyx/Tatakai/blob/main/LICENSE). Nesta etapa, seu host HTTP Node foi incorporado na revisão `80bfc190603868effd81a138b6ee07af0b94ec0d`, com licença e avisos preservados. `TatakaiStreamingProvider` agora consome esse contrato local real, em vez do antigo adaptador inativo. Inicie com `npm run dev:source-host`; `npm run dev` já inicia as três partes.

O serviço local responde em `/health` com `service: extension-api-host` e namespaces/capacidades das extensões registradas. A API adapta o namespace selecionado com contrato `streaming-sources-v3` para reprodução e leitura. O índice de episódios da API Toko independente não existe automaticamente nesse host; para extensões sem índice, resolva um número explícito pela rota de episódios em [CONTENT-BACKEND.md](CONTENT-BACKEND.md). Não são inventadas listas de episódios com base em metadados.

A configuração de bundle é explícita, local e fixada por hash. Veja [LOCAL-SOURCE-HOST.md](LOCAL-SOURCE-HOST.md). Nenhum pacote de fontes Toko ou de marketplaces foi baixado ou instalado automaticamente. O repositório Tatakai vem com a lista de extensões incluídas vazia. Sem pacote configurado, o host está saudável e a disponibilidade de conteúdo permanece vazia.

A API pública `api.tatakai.me` permanece distinta. O repositório `Snozxyx/TatakaiAPI` retornou 404; o domínio público e a loja retornaram 403 nas verificações desta etapa. Nenhum contorno foi tentado. Esses domínios não são usados pelo backend para resolver conteúdo.

## Stremio HTTP

O caminho HTTP/JSON usado pelo Tatakai também foi implementado de forma independente, sem instalar ou executar código de addon. `STREMIO_ADDONS_JSON` registra origens de manifestos escolhidas pelo operador, autorização e hosts de mídia. O addon deve declarar `stream` para `series` e aceitar o identificador IMDb pedido. Manifestos apenas de catálogo não são apresentados como fonte reproduzível.

A resolução recebe IMDb, temporada e episódio explicitamente. Torrents, embeds, URLs de autenticação, fontes que exigem cabeçalhos adicionais e hosts não permitidos são rejeitados; somente HLS/MP4 diretos entram no player. Não existe conversão presumida entre AniList e IMDb.

## Validação da etapa de conteúdo

- Host local real: `http://127.0.0.1:8099/health` respondeu 200 e `namespaces: []` sem configuração de bundles.
- Testes iniciam um host real com um bundle original de teste, fixado por hash, e atravessam a API HPmovies para reprodução, capítulos, páginas e texto. Isso valida o runtime e os adaptadores; não afirma mídia externa de um provedor ausente.
- O teste integrado comprovou que o host usa `count`, chaves opacas e `providerChapterId`, enquanto o servidor Toko independente usa `chapterCount`. O cliente trata os dois contratos separadamente.
- IDs de capítulo são estáveis e reconstituídos após reinício pela listagem da fonte; chaves brutas de upstream não viram parâmetros fornecidos pelo navegador.
- Títulos entram no contexto de cada requisição, inclusive na chave de cache, sem estado global que possa trocar a obra de outra consulta.
- Fontes reais de anime, mangá e novel continuam dependendo de um pacote ou endpoint permitido configurado. Saúde do host não comprova disponibilidade de conteúdo.
