# Host de fontes local

O HPmovies inclui o host HTTP do Tatakai, revisionado em [`80bfc190603868effd81a138b6ee07af0b94ec0d`](https://github.com/Snozxyx/Tatakai/tree/80bfc190603868effd81a138b6ee07af0b94ec0d), sob MPL-2.0. Ele funciona com Node e atende streaming, capítulos/páginas de mangá e capítulos/texto de novel conforme os métodos de cada extensão.

Inicie isoladamente com:

```bash
node scripts/start-source-host.cjs
curl http://127.0.0.1:8099/health
```

O host usa somente `127.0.0.1`. `HPMOVIES_SOURCE_HOST_PORT` altera a porta. Uma porta ocupada produz um erro explícito para que o backend não consulte outro serviço por engano.

## Disponibilidade de conteúdo

O [repositório Tatakai](https://github.com/Snozxyx/Tatakai/blob/80bfc190603868effd81a138b6ee07af0b94ec0d/src/core/extensions/defaultExtensions.ts) contém o mecanismo de execução, mas suas listas de extensões incluídas estão vazias. Por isso o host inicia com `namespaces: []`; sua saúde indica que o serviço está rodando, enquanto a disponibilidade de conteúdo depende de uma fonte configurada.

O HPmovies não baixa ou instala código executável de catálogos automaticamente. Bundles CJS autocontidos, selecionados pelo operador e com licença/permissão aplicável, podem ser registrados por arquivo local. Extensões executam dentro do processo Node com as permissões do usuário. Bundles que dependem de `browserDomains`/Electron recebem um erro explícito neste host.

## Configuração explícita de bundles locais

Crie um diretório local fora do código versionado, por exemplo `.local/sources/`, e coloque nele o manifesto e o bundle já preparados. Um arquivo `.kai` é um pacote; o campo `bundlePath` aponta para seu bundle CJS extraído, não para o ZIP.

Calcule o hash dos bytes do bundle que você verificou:

```bash
sha256sum .local/sources/bundle.cjs
```

Crie `.local/sources/sources.json` com os caminhos relativos a esse arquivo:

```json
{
  "version": 1,
  "extensions": [
    {
      "trusted": true,
      "manifestPath": "manifest.json",
      "bundlePath": "bundle.cjs",
      "sha256": "SUBSTITUA_PELO_SHA256_DO_BUNDLE_VERIFICADO"
    }
  ]
}
```

Exemplo dos campos de manifesto consumidos pelo host:

```json
{
  "id": "minha-fonte",
  "capabilities": ["streaming", "manga", "novel"],
  "apiServer": {
    "namespace": "minha-fonte",
    "contract": "streaming-sources-v3",
    "routes": ["sources", "stream"],
    "healthPath": "/health"
  }
}
```

Declare somente as capacidades que o bundle realmente implementa. Os métodos CJS aceitos são `sourcesAll`/`streamAll`/`torrentAll` ou `batch`/`single` para streaming, `getMangaChapters`/`getMangaPages` para mangá e `getNovelChapters`/`getNovelContent` para novel. O contrato `custom-source-v1` também é aceito para os métodos `custom*` do Tatakai.

No `.env`, configure:

```dotenv
HPMOVIES_EXTENSIONS_FILE=.local/sources/sources.json
HPMOVIES_SOURCE_HOST_PORT=8099
```

Reinicie o host após alterar a lista. Ele valida todos os manifestos e hashes antes de admitir qualquer extensão e executa uma cópia privada dos bytes verificados. Para atualizar um bundle, revise os novos bytes e atualize o hash.

## Contrato HTTP

`GET /health` responde:

```json
{
  "ok": true,
  "service": "extension-api-host",
  "namespaces": [
    {
      "namespace": "minha-fonte",
      "extensionId": "minha-fonte",
      "contract": "streaming-sources-v3",
      "routes": ["sources", "stream"],
      "providerRoutes": ["providers", "providers/:name"],
      "capabilities": ["streaming", "manga", "novel"],
      "customSources": [],
      "customRoutes": []
    }
  ]
}
```

As rotas abaixo usam o prefixo `/api/v3/minha-fonte`:

| Rota | Parâmetros principais | Resposta |
| --- | --- | --- |
| `/health` | — | `ok`, `namespace`, `extensionId` |
| `/providers` | — | `providers`, `count`, `byKind` |
| `/providers/:name` | `anilistId`, `titles[]`, `episode` | `sources`, diagnóstico do provedor |
| `/stream` ou `/sources` | `anilistId`, `titles[]`, `episode`, `stream=0` | `sources`, `providerStatus`, `count` |
| `/manga/chapters` | `anilistId`, `malId`, `title`, `titles[]` | `chapters` com provedor e `chapterKey` |
| `/manga/pages` | `chapterKey`, `provider`, `providerChapterId` | `pages` com URL e cabeçalhos necessários |
| `/novel/chapters` | mesmos IDs/títulos, `provider`, `seriesId` | `chapters` com provedor e `chapterKey` |
| `/novel/content` | `chapterKey`, `provider`, `providerChapterId` | `paragraphs` ordenados com `index`/`text` |

Streaming usa SSE por padrão. `stream=0` pede JSON. `refresh=1` ignora o cache. Rotas de leitura sem método correspondente retornam `501`, preservando a distinção entre fonte incompatível e capítulo ausente. A rota de sondagem de URLs arbitrárias do upstream fica desabilitada no wrapper do HPmovies.

Este host mantém os cabeçalhos fornecidos pelas fontes nas respostas; o backend HPmovies aplica sua validação de destinos e o acesso direto antes de expor os recursos ao player/leitor. Fontes que exigem cabeçalhos de reprodução adicionais recebem um erro explícito; nenhum proxy arbitrário foi reintroduzido.

## Licença e verificação

O [aviso de origem](../src/aniwatch-apis/src/providers/tatakai-runtime/vendor/NOTICE.md) identifica o arquivo incorporado, a revisão e suas alterações locais. A licença MPL-2.0 completa está ao lado do arquivo. Testes do contrato e da configuração explícita estão em `tests/source-host.test.ts`.
