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

O HPmovies não baixa ou instala código executável de catálogos automaticamente. Bundles CJS autocontidos, selecionados pelo operador e com licença/permissão aplicável, podem ser registrados por arquivo local. Extensões executam dentro do processo Node com as permissões do usuário. O host não implementa Electron. Um manifesto com `browserDomains` pode ser registrado explicitamente com `browserMode: "disabled"` para usar seus provedores HTTP; os recursos que exigem navegador continuam indisponíveis. O launcher força `CF_BYPASS_ENABLED=false` e `CF_BYPASS_AUTO_INSTALL=false`.

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

Reinicie o host após alterar a lista. Ele valida todos os manifestos e hashes antes de admitir qualquer extensão e executa uma cópia privada dos bytes verificados. Para atualizar um bundle, revise os novos bytes e atualize o hash. O campo opcional `providers` limita os registros exportados antes de qualquer chamada agregada, inclusive mangá; nomes ausentes no bundle causam erro. `mangaTimeoutMs` permite um orçamento de 1.000 a 60.000 ms para o catálogo paginado, usando os mesmos métodos dos provedores originais.

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

Este host mantém os cabeçalhos fornecidos pelas fontes nas respostas; o backend HPmovies aplica sua validação de destinos e o acesso direto antes de expor os recursos ao player/leitor. Referer/Origin explicitamente permitidos usam tickets opacos emitidos para fontes já resolvidas. Hosts e origens precisam estar nas allowlists privadas; cookies, autenticação, redirecionamentos e destinos DNS privados são recusados. Não há parâmetro de URL arbitrária no transporte de mídia.

## Licença e verificação

O [aviso de origem](../src/aniwatch-apis/src/providers/tatakai-runtime/vendor/NOTICE.md) identifica o arquivo incorporado, a revisão e suas alterações locais. A licença MPL-2.0 completa está ao lado do arquivo. Testes do contrato e da configuração explícita estão em `tests/source-host.test.ts`.

## Pacote Toko usado neste ambiente

A pedido do usuário, o artefato oficial [toko.kai 4.5.5](https://github.com/Snozxyx/Toko/releases/tag/toko-v4.5.5) foi instalado **somente em `.local/sources/toko-4.5.5/`**, fora do Git. Nenhum arquivo de sua fonte ou bundle é redistribuído pelo HPmovies; a licença MPL do host não se estende ao Toko atual. O pacote publicado mantém seu README e avisos originais.

- SHA-256 do arquivo `.kai`: `04ad5be6438591fc0ad6e4c904c45343562b7d4468433ecabe00f5525145f8a2`.
- SHA-256 do `bundle.js` intacto: `2802a9497ccafa1b00998e78dc10275da328bd1bcb654937a5cf68984c0f808e`.
- Configuração privada: `.local/sources/sources.json`; namespace `toko`, `browserMode: "disabled"`, `providers: ["nebula", "webtoons", "syosetu"]`, `mangaTimeoutMs: 55000`.
- `.env` aponta ao registro e contém os hosts/origens exatos usados pelas respostas observadas. A configuração não é incluída no bundle frontend.

Essas são três fontes do **próprio pacote original**, selecionadas para esta validação; a instalação não afirma que todos os outros provedores do Toko funcionam. A extensão permanece inalterada no disco; o host limita seus registros em memória. Não existe download de extensões ao executar `npm ci` ou `npm run dev`.

Para reproduzir em outra máquina, obtenha essa release do autor, confira o SHA-256, extraia `manifest.json` e `bundle.js` localmente e registre os caminhos/hashes conforme o exemplo acima. Preserve os avisos da distribuição. Consulte [a validação real de conteúdo](REAL-CONTENT-VALIDATION.md) para os títulos e as limitações observadas.
