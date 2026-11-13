# BingeBang, Stremio e catálogo de filmes e séries

Integração local de 07/11/2026. Mantém React, TypeScript, Vite, Tailwind,
React Router, Hono e HLS.js. Não envolve push ou deploy.

## Uso no HPmovies

- `/cinema`: catálogo paginado de filmes e séries, busca por título e filtros de
  streaming e região. A seleção fixa de oito títulos foi removida.
- `/cinema/movie/:imdb` e `/cinema/series/:imdb`: detalhes; séries mostram os
  episódios realmente fornecidos pelo Cinemeta, incluindo temporadas e especiais.
- `/sources?kind=stremio`: consulta manual de um filme, série ou anime por IMDb.
- Nos detalhes dos animes existentes, a busca de outras fontes abre o catálogo
  IMDb com título e tipo preenchidos. O usuário escolhe a edição correspondente.
- O player dos animes também agrega automaticamente as novas fontes quando há
  correspondência segura de AniList, IMDb, temporada e episódio.
- O player mantém a origem e volta aos detalhes ou ao formulário após recarregar.
  As fontes retornadas aparecem no seletor de vídeo existente.

O catálogo usa páginas de 50 entradas do Cinemeta, com consulta direta à origem
oficial `cinemeta-catalogs.strem.io/top/catalog/`. Busca e filtros combinados usam
o GraphQL público do JustWatch, sem chave privada. A disponibilidade regional dos
provedores vem do mesmo serviço; o filtro de assinatura usa `FLATRATE`, sem
confundir aluguel ou compra com assinatura. Há Brasil e Estados Unidos; Hulu
apareceu somente nos Estados Unidos. Metadados de detalhes e episódios continuam
no Cinemeta. A presença de um título no catálogo não comprova reprodução.

IDs AniList e IMDb não são intercambiáveis. Os animes usam o mapeamento explícito
já existente nas legendas, com validação de temporada, episódio, offsets e filmes.
Sem correspondência segura, as fontes antigas permanecem disponíveis e a nova
consulta não inventa um identificador. O merge preserva o episódio AniList,
deduplica URLs e mantém as legendas nativas vinculadas ao respectivo vídeo.
Falhas do addon não descartam fontes antigas; o addon também pode resgatar um
episódio quando a fonte anterior falha. Índices de episódios continuam reais.
No endpoint `resolve`, o filtro de fonte explicitamente escolhido é respeitado.

## OpenSubtitles e tradução por IA

Em **Configurações do player**, use **Buscar no OpenSubtitles**, escolha o idioma
e selecione a versão. São oferecidos 48 idiomas. O painel mostra release, formato
textual e quantidade de downloads quando a fonte realmente fornece essa contagem.
Versões sem contagem não recebem um valor fictício. SRT, ASS/SSA e VTT são
normalizados no backend. O arquivo é baixado quando selecionado, por ticket local;
o navegador não fornece uma URL arbitrária ao servidor.

A escolha preserva o elemento de vídeo, posição e intenção de reprodução. Ela
acompanha as trocas de fonte do mesmo episódio, sem vazar para o episódio seguinte.
Desativar legendas manualmente também permanece respeitado. O diálogo oferece
estados de carregamento, vazio, erro e nova tentativa, foco modal, Escape e uso
em tela cheia. Preferências existentes de tamanho, fundo e sincronização continuam.

Na seção **Sua experiência**, a tradução por IA também aceita a versão externa
escolhida, mesmo quando já existe português ou uma tradução anterior. Inglês
prefere o Argos EN→PT instalado. Quando habilitado, o Ollama local usa um modelo
multilíngue já instalado para outros idiomas ou origem não identificada:

```dotenv
AUTOMATIC_SUBTITLES_OLLAMA_ENABLED=true
AUTOMATIC_SUBTITLES_OLLAMA_URL=http://127.0.0.1:11434
AUTOMATIC_SUBTITLES_OLLAMA_MODEL=qwen3.5:9b
```

Não foi baixado um modelo novo nesta etapa. A tradução recebe apenas falas e IDs;
ordem e timestamps originais são preservados fora da IA. IDs ausentes, repetidos,
estranhos ou resposta truncada provocam falha integral. Há um job multilíngue por
vez, lotes de até 16 falas/1.800 caracteres, 120 segundos por lote e 30 minutos
totais. A primeira carga do modelo pode demorar. **Parar acompanhamento** para
a espera no navegador e informa que o trabalho local pode continuar.

A saída é marcada como tradução automática e pode conter erros. O modelo não
garante qualidade equivalente em todos os idiomas. Se o modelo local não estiver
disponível, a interface informa a limitação; a reprodução e a legenda original
continuam disponíveis. O fluxo preserva a tradução Argos já existente.

## O que foi identificado no BingeBang

A referência foi [BingeBang TV](https://bingebang.st/tv). Os nomes informados pelo
usuário foram Aldebaran, Markab, Yildun, Vega, Sirius, Wezen, Fomalhaut, Nashira
e Botein. São identificadores do player da fonte; não são nove APIs públicas
independentes que possam ser reutilizadas como URLs fixas.

O [código do adaptador FMHY](https://github.com/RisPNG/fmhywebstremio/tree/e50be0f870af2d4ba964a04e4009bf979b18668d)
segue o contrato nativo:

- `GET /api/search/movie?query=...&page=1` e
  `GET /api/search/tv?query=...&page=1`: descoberta no catálogo da fonte.
- A resposta informa uma página de reprodução. Séries acrescentam temporada e
  episódio ao endereço dessa página.
- `GET /api/player/sources` e `GET /api/player/resolve?src=...`: dependem do ticket
  emitido pela página e de `X-BB-Player`; retornam envelopes do protocolo nativo.
- O addon resolve a mídia e fornece um relay assinado, que preserva o contexto
  exigido pelo upstream. As URLs são temporárias e não devem ser copiadas para
  código, documentação ou Git.

Não foram contornados desafios Cloudflare. Nesta máquina, `/tv` respondeu 403,
enquanto a consulta nativa feita pelo addon funcionou. Portanto, esse 403 isolado
não comprova que toda a fonte está indisponível. O README upstream ainda dizia
que BingeBang estava excluído; o registro e o commit inspecionados já marcavam
a fonte como saudável. Esse estado embarcado também não substitui teste atual.

## Addon local e licença

Foi preparado um checkout separado em `.local/fmhywebstremio`, ignorado pelo Git,
na revisão `e50be0f870af2d4ba964a04e4009bf979b18668d`, versão `1.24.1`.
O [projeto upstream usa MIT](https://github.com/RisPNG/fmhywebstremio/blob/e50be0f870af2d4ba964a04e4009bf979b18668d/LICENSE.txt).
A licença e o código permanecem no checkout. O bundle privado e as licenças das
fontes antigas do HPmovies não foram alterados.

O patch versionado [`../scripts/fmhy-hpmovies.patch`](../scripts/fmhy-hpmovies.patch)
amplia de quatro para nove as tentativas de servidor BingeBang, sem remover o
prazo existente. Também preserva o nome nativo do servidor até a resposta Stremio.
Nomes são lidos do retorno real; não foram criados servidores estáticos ou fontes
de demonstração. O aviso MIT foi preservado no checkout e em
[`../licenses/fmhywebstremio-MIT.txt`](../licenses/fmhywebstremio-MIT.txt).

Para reproduzir a preparação em outro clone local, execute a partir da raiz:

```bash
git clone https://github.com/RisPNG/fmhywebstremio.git .local/fmhywebstremio
git -C .local/fmhywebstremio checkout e50be0f870af2d4ba964a04e4009bf979b18668d
git -C .local/fmhywebstremio apply ../../scripts/fmhy-hpmovies.patch
npm --prefix .local/fmhywebstremio ci --ignore-scripts
npm --prefix .local/fmhywebstremio run build
```

O addon tem dependências próprias. A instalação usou `npm ci --ignore-scripts`,
sem adicionar dependências ao HPmovies. O relatório de instalação upstream
indicou 36 vulnerabilidades, sendo duas críticas. Não foi aplicado `audit fix`.
O serviço permanece em loopback e não foi preparado para hospedagem pública.

O launcher `scripts/start-stremio-addon.cjs` inicia somente esse checkout e
aguarda `/ready`. Um preload limita o listener HTTP à porta escolhida em
`127.0.0.1`. A versão upstream não oferece `HOST` nem exporta seu servidor.
O launcher encerra seu próprio filho ao receber sinal, recusa porta ocupada e
omite logs upstream que poderiam conter URLs de mídia.

O modo local carrega o registro embarcado de fontes e valida os candidatos
durante cada consulta. `/live` e `/ready` não comprovam reprodução. O prazo de
descoberta e validação continua limitado pelo próprio addon.

## Configuração

Com a configuração local abaixo, o addon passa a iniciar junto com o aplicativo:

```bash
npm run dev
```

`npm start` também inclui o addon opcional no ciclo de vida local, depois de
`npm run build`; isso não publica o site. A inicialização automática exige
`STREMIO_ALLOW_LOOPBACK=true` e uma entrada autorizada cujo manifesto seja
exatamente `http://127.0.0.1:<HPMOVIES_STREMIO_PORT>/manifest.json`. Addons públicos
e configurações desativadas não iniciam executáveis locais.

O aplicativo inicia e encerra apenas seu próprio processo FMHY. Se o serviço já
estiver ativo, confere `/ready` e a identidade/capacidades do manifesto antes de
reutilizá-lo; não o encerra ao sair. Uma porta ocupada por serviço diferente é
recusada. Quedas inesperadas do filho recebem até três tentativas de reinício
com intervalo crescente; depois disso, o log pede para reiniciar o aplicativo.

`npm run dev:stremio` continua disponível para diagnóstico ou execução separada.
Nesse caso, inicie-o antes do aplicativo; o aplicativo reconhecerá o serviço já
ativo. Esse comando separado continua recusando uma porta já ocupada.

Exemplo de configuração privada, também explicado em `.env.example`:

```dotenv
HPMOVIES_FMHY_DIR=.local/fmhywebstremio
HPMOVIES_STREMIO_PORT=7010
STREMIO_ALLOW_LOOPBACK=true
STREMIO_TIMEOUT_MS=35000
STREMIO_ADDONS_JSON=[{"id":"fmhy","name":"FMHY Web Stream","manifestUrl":"http://127.0.0.1:7010/manifest.json","authorized":true,"allowedMediaHosts":[]}]
```

`STREMIO_ALLOW_LOOPBACK` autoriza manifesto local e mídia da mesma origem exata,
incluindo protocolo, hostname e porta. Não autoriza outros serviços locais, LAN
ou portas diferentes. Addons públicos continuam exigindo HTTPS e hosts de mídia
explicitamente configurados. O timeout aceita de 250 a 45.000 ms.

Nesta configuração, o browser e o addon estão na mesma máquina. O relay
`127.0.0.1` não serve como integração para outros aparelhos ou um site publicado.
Uma futura hospedagem precisa de arquitetura própria de entrega de mídia;
não basta publicar estas variáveis locais.

## Contratos do backend

| Recurso | Rota |
| --- | --- |
| Catálogo IMDb | `GET /api/cinema/catalog?type=movie\|series&search=...&page=1&provider=nfx&region=BR` |
| Streamings e regiões | `GET /api/cinema/filters` |
| Metadados e episódios | `GET /api/cinema/:type/:imdb` |
| Filme Stremio | `GET /api/content/stremio/movie/:imdb` |
| Série Stremio | `GET /api/content/stremio/:imdb/:season/:episode` |
| Reconsulta no player | `GET /api/streaming/episodes/:id` |
| Versões de legenda | `GET /api/subtitles/search/:episodeId?language=pt-BR` |

As duas consultas Stremio aceitam somente `provider` opcional. Sem seleção, IDs
`stremio:all:movie:tt...` e `stremio:all:tt...:temporada:episodio` conservam todos
os addons no reload. IDs antigos de provedores específicos continuam aceitos.
`all` é reservado, não pode ser o ID de um addon configurado.

O adaptador lê apenas JSON; não executa código recebido de addons. Aceita HLS
e MP4 por HTTP. Recusa torrents, links externos, credenciais, redirects e
cabeçalhos arbitrários declarados por fontes. O relay MP4 `media.bin` da mesma
origem só é aceito após leitura limitada, MIME `video/mp4` e assinatura `ftyp`.
O relay mantém CORS e byte ranges do addon para reprodução e seek.

Áudio ausente continua `und`; não é deduzido de legendas ou do nome do servidor.
Qualidade no nome é uma declaração da fonte, não prova da resolução decodificada.
Um stream ou episódio indexado não comprova identidade audiovisual ou idioma.

## Verificação e limites

Fixtures de testes unitários e E2E ficam separadas das verificações reais.
O resumo de rede e protocolo está em
[`validation/2026-11-07-fmhy-protocol.json`](validation/2026-11-07-fmhy-protocol.json).
Resultados finais do player e das verificações do projeto são registrados no
[`DEVELOPMENT-STATE.md`](DEVELOPMENT-STATE.md).

O checker opt-in `npm run test:stremio:real` testa Breaking Bad S01E01,
Attack on Titan S01E01 e Inception através dos links do catálogo. Exige vídeo
e áudio decodificados, duração na faixa da amostra, avanço após seek e layout
sem overflow a 320 px. Grava somente métricas e capturas temporárias, sem URLs
assinadas. Identidade audiovisual integral e idioma falado exigem conferência
separada; nem essas métricas nem a duração provam correspondência sozinhas.
`npm run test:stremio:real -- --mp4 tt0903747` seleciona Wezen para verificar
também o caminho MP4/Range no browser.
