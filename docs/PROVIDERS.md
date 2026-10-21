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
TATAKAI_ENABLED=false
TATAKAI_API_URL=
```

Uma instalação externa autorizada pode seguir as instruções do repositório para construir o serviço (`npm run build:api`) e iniciá-lo com `TOKO_API_HOST=127.0.0.1 TOKO_API_PORT=8099 npm start`. O HPmovies não executa esses comandos nem instala extensões. O endereço deve apontar para a raiz do serviço; também aceita o sufixo `/api/v3`. Não exponha o serviço Toko diretamente: seu servidor inclui rotas administrativas, que o HPmovies não encaminha.

`TOKO_ENABLED=true` habilita apenas a comunicação e os diagnósticos. Para liberar conteúdo, o operador deve ter permissão para as fontes correspondentes, definir `TOKO_CONTENT_AUTHORIZED=true`, nomes de provedores em `TOKO_ALLOWED_PROVIDERS` e hosts DNS exatos em `TOKO_ALLOWED_MEDIA_HOSTS`, separados por vírgula. Não use curingas. Essas opções registram a configuração do operador; não fazem uma verificação jurídica automática dos direitos.

O servidor Toko analisado agrega provedores e não oferece filtro por provedor no endpoint de streaming. Não foi inventado um parâmetro para isso. O adaptador só consulta streams quando há permissão explícita configurada, e só libera resultados que correspondam ao provedor e ao host permitidos. Fontes com cabeçalhos especiais, embeds, torrents, URLs HTTP, credenciais na URL e hosts fora da lista são rejeitados. Legendas passam pelo mesmo filtro. `sub`, `dub`, rótulos livres e idioma ausente são `und`; `pt` permanece `pt`, e somente uma declaração explícita `pt-BR` é priorizada como português brasileiro. A qualidade declarada pelo provedor é um rótulo; os níveis HLS reais continuam sendo descobertos pelo player.

Os métodos de mangá e novel constituem contratos internos preparados, sem expor rotas públicas automaticamente. A listagem exige um provedor permitido e filtra seus resultados. O conteúdo só aceita chaves anteriormente recebidas nessa listagem, com validade de dez minutos; uma chave arbitrária contendo uma URL não pode iniciar uma consulta. Fontes MangaDex ativas seguem seu adaptador próprio. Novels permanecem sem conteúdo externo até existir uma fonte validada e permitida.

Todas as consultas recusam redirecionamentos, limitam respostas JSON a 2 MB, têm timeout de 250–30000 ms e no máximo dois retries configuráveis; o padrão é um retry apenas para erros transitórios. Existem no máximo quatro consultas distintas simultâneas por cliente. Consultas idênticas compartilham uma Promise. O cache considera origem, rota, parâmetros ordenados e, em listagens filtradas, o provedor permitido. Saúde dura 15 s; streams, 30 s; metadados, 120 s. Falhas não são armazenadas como sucesso.

## TatakaiAPI

O [repositório Tatakai](https://github.com/Snozxyx/Tatakai) declara [MPL-2.0](https://github.com/Snozxyx/Tatakai/blob/main/LICENSE). Foi usado para consulta arquitetural, sem copiar arquivos. Seu [cliente atual](https://github.com/Snozxyx/Tatakai/blob/main/src/lib/api/api-client.ts) indica que a resolução central de streaming foi removida em favor de extensões locais, e [backendOrigin.ts](https://github.com/Snozxyx/Tatakai/blob/main/src/lib/api/backendOrigin.ts) referencia `api.tatakai.me` para outras funções.

`https://api.github.com/repos/Snozxyx/TatakaiAPI` retornou 404. O domínio `https://api.tatakai.me` respondeu, mas a raiz e a tentativa de `/api/v3/health` retornaram 404 JSON (`Not Found`). Esse teste comprova a resposta do domínio, sem estabelecer um endpoint de saúde, contrato de streaming ou permissão de uso externo. Não há URLs ou contratos inventados no adaptador.

`TatakaiStreamingProvider` implementa a interface e informa indisponibilidade. Mesmo com `TATAKAI_ENABLED=true`, permanece inativo e informa `unauthorized` até que documentação e permissão sejam verificadas. Ele não realiza requisições, evitando confundir a configuração de uma URL com uma integração validada.

## Validação realizada

- `http://127.0.0.1:8099/api/v3/health`: conexão recusada, pois não há runtime Toko instalado neste ambiente. A integração HTTP foi implementada e testada com respostas de contrato controladas; reprodução real por Toko não foi validada.
- TatakaiAPI: resultados reais descritos acima; adaptação de streaming permanece desativada.
- `tests/toko-providers.test.ts`: configuração, saúde HTTP versus bundle, autorização, contratos JSON, estado dos episódios, idiomas, destinos, erros, retry, limite de resposta, concorrência, cache por conteúdo/provedor e bloqueio de chaves arbitrárias.

Para conferir o serviço Toko quando existir uma instalação permitida, execute `curl --fail --max-time 10 http://127.0.0.1:8099/api/v3/health` e consulte o diagnóstico do HPmovies. Somente um teste de reprodução com mídia permitida pode validar a integração de conteúdo ao vivo; o health check sozinho não basta.
