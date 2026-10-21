# Fontes de conteúdo e runtime Tatakai

Verificação: 21/10/2026. Esta consulta usou arquivos públicos dos repositórios e requisições HTTP de leitura. Nenhuma extensão foi instalada ou executada.

## O que existe no repositório Tatakai

O [Tatakai](https://github.com/Snozxyx/Tatakai) declara [MPL-2.0](https://github.com/Snozxyx/Tatakai/blob/main/LICENSE). O código de host e de adaptação pode ser avaliado para reaproveitamento com a licença e os avisos correspondentes preservados.

O arquivo [defaultExtensions.ts](https://github.com/Snozxyx/Tatakai/blob/main/src/core/extensions/defaultExtensions.ts) mantém vazias as listas de extensões oficiais e de URLs de instalação. A árvore pública consultada não contém diretório `extension/toko`, distribuição `.kai` ou provedores Toko incorporados. Algumas páginas de documentação ainda mencionam exemplos nesse diretório; a árvore atual deve prevalecer ao planejar a implementação.

O [cliente de streaming](https://github.com/Snozxyx/Tatakai/blob/main/src/lib/api/api-client.ts) mantém um adaptador de compatibilidade que retorna listas vazias: a resolução de fontes foi transferida para extensões locais. Clonar apenas o frontend ou configurar `api.tatakai.me` não fornece um catálogo de mídia reproduzível.

Existem módulos de host em `desktop/runtime/extension-api-host/` e `desktop/runtime/extension/`. São contratos úteis para um runtime local, mas exigem uma extensão separadamente instalada. O [host HTTP](https://github.com/Snozxyx/Tatakai/blob/main/desktop/runtime/extension-api-host/host-server.cjs) carrega o bundle no processo Node; o host de workers é uma implementação distinta. Recursos de navegador e de proxy dependem de capacidades do aplicativo desktop. Um worker ou manifesto não constitui isolamento suficiente para executar qualquer código remoto.

## De onde Tatakai descobre extensões

O [importador de catálogos](https://github.com/Snozxyx/Tatakai/blob/main/scripts/import-extension-catalogs.mjs) referencia mercados Seanime e Stremio, incluindo um catálogo português. São referências externas, com licenças e requisitos próprios. A consulta ao metadado de `Jhoorodre/seanime-provider` e `5rahim/seanime-extensions` retornou `license: null`; a licença do Tatakai não deve ser aplicada automaticamente aos respectivos payloads.

O [adaptador Stremio](https://github.com/Snozxyx/Tatakai/blob/main/src/core/extensions/remote/stremio.ts) trabalha com HTTP/JSON, sem executar o código do addon. Manifestações anunciam recursos, tipos e prefixos de IDs. Um catálogo que só oferece `catalog` e `meta` não oferece streaming. O [cliente de instalação](https://github.com/Snozxyx/Tatakai/blob/main/src/core/extensions/remote/installed.ts) exige manifesto configurado quando o addon declara essa necessidade.

## Contrato Toko verificado

O [Toko](https://github.com/Snozxyx/Toko) está na versão [4.5.5](https://github.com/Snozxyx/Toko/releases/tag/toko-v4.5.5). O repositório continua sem licença geral explícita; avisos MIT de dependências não licenciam todo o projeto. A release oferece `toko.kai`; não oferece servidor HTTP independente como binário pronto.

O [servidor HTTP](https://github.com/Snozxyx/Toko/blob/main/api/src/server.js) publica os seguintes contratos:

| Operação | Endpoint | Dados relevantes |
| --- | --- | --- |
| Saúde | `/api/v3/health` | `ok`, `service: toko-api`, `toko`; o último indica bundle carregado |
| Episódios | `/api/v3/toko/index/episodes` | `provider`, `episodeCount`, `episodes` |
| Streaming | `/api/v3/toko/stream` | `sources`, `providerStatus`; `stream=0` seleciona JSON |
| Capítulos de mangá | `/api/v3/toko/manga/chapters` | Uma linha por fonte: `chapterKey`, `provider`, `providerChapterId`, número, idioma, volume, scanlator e data |
| Páginas | `/api/v3/toko/manga/pages` | `pages`: `pageNumber`, `imageUrl`, `headers`, dimensões opcionais |
| Capítulos de novel | `/api/v3/toko/novel/chapters` | Capítulos, tradutor, `providerStatus`, `partial` |
| Texto | `/api/v3/toko/novel/content` | `paragraphs`: `index` e `text`; título, número e provedor |
| Busca de novel | `/api/v3/toko/novel/search` | `results`: `id`, `title`, `url`, `provider`; diagnóstico por provedor |

As listagens de capítulos aceitam `anilistId`, `malId`, `title` e `titles[]`. Fornecer títulos já conhecidos permite consultas por título durante uma indisponibilidade do AniList. Novels também aceitam `provider`, `seriesId` e `fullScan=1`. Respostas parciais precisam preservar seu estado para permitir atualização posterior. Os identificadores de capítulo devem permanecer opacos, sem decodificar URLs no HPmovies. Atsu usa `atsu` para mangá e `atsu-novel` para texto.

O endpoint de páginas devolve URLs e cabeçalhos; não entrega os bytes de imagem. Algumas fontes precisam de cabeçalhos adicionais. O cliente direto deve comunicar essa incompatibilidade, ou um transporte próprio deve validar destinos e permissões antes de buscar bytes.

## Resultado das consultas externas

- `http://127.0.0.1:8099/api/v3/health`: conexão recusada; não existe serviço Toko local escutando nesse endereço.
- `https://api.github.com/repos/Snozxyx/TatakaiAPI`: 404.
- `https://api.tatakai.me/` e `/api/v3/health`: 403, erro 1010. Nenhum contorno foi tentado.
- `https://extension.tatakai.me/api/extension?limit=3`: 403, erro 1010. O serviço recusou a consulta de catálogo.
- `https://v3-cinemeta.strem.io/manifest.json`: 200, com recursos de metadados e catálogo, sem recurso `stream`. Essa resposta comprova acesso ao catálogo, sem validar reprodução.

Um teste completo ainda precisa de uma extensão ou serviço de conteúdo permitido e de mídia real retornada por ele. Um teste de saúde isolado não valida reprodução, páginas ou texto.
