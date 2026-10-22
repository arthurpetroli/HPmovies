# Português no player e nos mangás

Verificação externa em **21/10/2026**, no ambiente local. Esta etapa amplia as fontes já instaladas; não houve push nem deploy. O [relatório anterior](REAL-CONTENT-VALIDATION.md) preserva os testes iniciais do Toko, Webtoons e Syosetu.

## Como acessar

Execute `npm run dev` e abra:

- [Catálogo de mangás PT-BR](http://127.0.0.1:5173/manga?language=pt-br).
- [Fontes de conteúdo](http://127.0.0.1:5173/sources), com atalhos de mangás em português e consulta direta de animes.
- [One Piece, episódio 1](http://127.0.0.1:5173/sources?kind=anime&id=21&title=One+Piece&source=tatakai&episode=1&open=1), usando a instalação local descrita em [LOCAL-SOURCE-HOST.md](LOCAL-SOURCE-HOST.md).

O catálogo, a busca e as seleções de mangás começam em PT-BR. O idioma escolhido fica na URL e nas preferências locais. `pt-br` seleciona a edição brasileira; `pt` reúne as edições `pt-br` e `pt` informadas pelo MangaDex; `pt-pt` consulta o código `pt` do serviço. “Todos os idiomas” exige seleção explícita. Quando não há capítulos no idioma escolhido, a tela informa isso e permite consultar outras edições, sem trocar o idioma silenciosamente. Em fontes Toko, a opção português inclui os códigos `pt` e suas variantes declaradas pela fonte.

## MangaDex: catálogo e páginas reais

O MangaDex voltou a responder **HTTP 200**, depois do HTTP 503 registrado na etapa anterior. A busca PT-BR, com as classificações de conteúdo já permitidas pela plataforma, informou **12.114 títulos com português brasileiro nos metadados**. A amostra de 24 itens devolvida pela API local continha esse idioma em todos os itens.

Esse total é a indicação de idioma do catálogo, não uma contagem de obras integralmente disponíveis para leitura. Metadados podem estar desatualizados, e uma edição pode conter somente alguns capítulos. Cada detalhe consulta o feed real antes de oferecer a leitura.

Nas oito obras abaixo, foram verificados o feed PT-BR, a resposta do MangaDex@Home de um capítulo com páginas e o download de uma imagem real com HTTP 200. Os números são entradas do feed naquele momento, incluindo links para sites externos e possíveis traduções alternativas. Não são contagens de capítulos hospedados com imagens nem significam coleção completa. A amostra baixou a primeira imagem de um capítulo de cada obra, sem percorrer todos os capítulos.

| Obra | Entradas PT-BR no feed | Identificador MangaDex |
| --- | ---: | --- |
| [One Piece](http://127.0.0.1:5173/manga/a1c7c817-4e59-43b7-9365-09675a149a6f?language=pt-br) | 73 | `a1c7c817-4e59-43b7-9365-09675a149a6f` |
| [Solo Leveling](http://127.0.0.1:5173/manga/32d76d19-8a05-4db0-9fc2-e0b0648fe9d0?language=pt-br) | 11 | `32d76d19-8a05-4db0-9fc2-e0b0648fe9d0` |
| [Jujutsu Kaisen 0](http://127.0.0.1:5173/manga/8b58f452-4d8a-4aad-a050-349e83fecccb?language=pt-br) | 4 | `8b58f452-4d8a-4aad-a050-349e83fecccb` |
| [Jujutsu Kaisen Modulo](http://127.0.0.1:5173/manga/f3f59f12-351a-4de7-bd51-696d0764d64e?language=pt-br) | 11 | `f3f59f12-351a-4de7-bd51-696d0764d64e` |
| [Berserk: The Prototype](http://127.0.0.1:5173/manga/4a5d677d-e3ac-4c23-a6bf-bb92c984fee4?language=pt-br) | 1 | `4a5d677d-e3ac-4c23-a6bf-bb92c984fee4` |
| [That Time I Got Reincarnated as a Slime](http://127.0.0.1:5173/manga/e78a489b-6632-4d61-b00b-5206f5b8b22b?language=pt-br) | 5 | `e78a489b-6632-4d61-b00b-5206f5b8b22b` |
| [The Eminence in Shadow](http://127.0.0.1:5173/manga/77bee52c-d2d6-44ad-a33a-1734c1fe696a?language=pt-br) | 71 | `77bee52c-d2d6-44ad-a33a-1734c1fe696a` |
| [SPY×FAMILY](http://127.0.0.1:5173/manga/6b958848-c885-4735-9201-12ee77abcb3c?language=pt-br) | 23 | `6b958848-c885-4735-9201-12ee77abcb3c` |

Foi corrigida a consulta do feed: os parâmetros `includeExternalUrl=1` e `includeEmptyPages=1` selecionavam somente edições externas/vazias, em vez de incluir também capítulos legíveis. Sem esses filtros, Jujutsu Kaisen 0 passou de zero para quatro entradas com páginas. Solo Leveling passou de seis links externos para onze entradas, sendo cinco com imagens e seis links. Edições externas continuam identificadas para abrir o site de origem.

A navegação real também foi validada em desktop de 1440 px e celular de 393 px. A home mostrou 48 cards e a busca 24 itens, todos com a indicação PT-BR e idioma mantido nos links. Jujutsu Kaisen 0 exibiu quatro capítulos na lista; “Começar a ler” levou ao capítulo 1, “A Criança Amaldiçoada”, com crédito Gekkou Scans e 55 páginas. As duas primeiras imagens responderam HTTP 200 JPEG e carregaram em 900×563 e 822×1200. Avançar e recarregar restaurou a página 2 em PT-BR; créditos e fonte permaneceram visíveis, sem overflow, erros de página ou falhas de requisição na amostra.

As páginas continuam passando pelo gateway de imagens existente, com tickets temporários e hosts oficiais. Créditos dos grupos e links de origem são preservados. Não foi adicionado um espelho de arquivos ao repositório. O uso mantém as [políticas do MangaDex](https://gitlab.com/mangadex-pub/mangadex-api-docs/-/blob/main/index.md) e o [contrato de capítulos e imagens](https://gitlab.com/mangadex-pub/mangadex-api-docs/-/blob/main/04-chapter/retrieving-chapter.md).

## Legendas externas em português

O backend consulta o endpoint público `rest.opensubtitles.org` e anexa as legendas ao resultado de uma reprodução real. Nesta verificação, a pesquisa anônima e o download gzip responderam HTTP 200, sem chave ou conta. Os arquivos foram descompactados e reconhecidos como SRT PT-BR para o episódio 1 dos seguintes animes:

| Anime | AniList | IMDb da série |
| --- | ---: | --- |
| One Piece | 21 | `tt0388629` |
| Cowboy Bebop | 1 | `tt0213338` |
| Naruto | 20 | `tt0409591` |
| Frieren: Beyond Journey’s End | 154587 | `tt22248376` |
| Demon Slayer | 101922 | `tt9335498` |
| Death Note | 1535 | `tt0877057` |
| Attack on Titan | 16498 | `tt2560140` |

Essa amostra comprova legendas para os episódios consultados, sem garantir todos os episódios ou o mesmo sincronismo para cada edição do vídeo. A busca de Jujutsu Kaisen, episódio 1, não devolveu uma faixa SRT nessa consulta; não foi inventada uma alternativa.

No caminho real de One Piece, a API local retornou as sete fontes de vídeo já existentes, três faixas externas PT-BR (duas SRT e uma ASS) e a faixa WebVTT em inglês da fonte original. O gateway entregou uma das SRT em UTF-8, com 359 entradas temporizadas. No navegador, essa faixa foi selecionada automaticamente e exibiu uma legenda ativa durante a reprodução em 1440×1080, com duração informada de 1477,974 s. A amostra avançou 12 s, continuou após seek para 60 s e chegou a 62 s; também foi aplicado ajuste de sincronização de 0,5 s. Houve somente um download de legenda, para a faixa selecionada, e 18 pedidos de mídia, todos HTTP 200. Desktop e celular de 393 px ficaram sem overflow ou erros de página. A interface identifica a origem OpenSubtitles e explica o ajuste de sincronização.

O player prioriza `pt-BR`, depois português genérico e português de Portugal, mantendo a opção manual de outro idioma ou de desativar legendas. A conversão de SRT/ASS baixa somente a faixa selecionada. VTT é aceito diretamente; ASS oferece diálogo textual simples, com as limitações já documentadas para karaoke, fontes e efeitos. Escolha outra faixa ou ajuste a sincronização quando a edição do vídeo tiver tempos diferentes.

### Identificação e transporte

O provedor próprio está em `src/aniwatch-apis/src/providers/portuguese-subtitles.ts`. Ele usa o [mapeamento AniList/IMDb de Fribb](https://github.com/Fribb/anime-lists/blob/master/anime-list-full.json) como dados externos e verifica a identidade dos episódios com metadados do [Cinemeta](https://v3-cinemeta.strem.io/manifest.json). Mapeamentos conflitantes ou ambíguos são descartados. A resposta da legenda precisa confirmar série, temporada, episódio e código de idioma; títulos semelhantes ou a palavra “legendado” não bastam. O serviço é pesquisado nos códigos `pob` (PT-BR) e `por` (português), com até 24 faixas por código e deduplicação por arquivo.

Os arquivos são expostos em `/api/subtitles/file/:token`. A rota recebe um ticket opaco, sem parâmetro de URL, e baixa exclusivamente do domínio HTTPS de download validado do OpenSubtitles. O transporte fixa um endereço DNS público na conexão, recusa redirecionamentos e não envia cookies ou credenciais. Há timeout, limites de concorrência/cache e de tamanho: até 2 MB recebidos e 4 MB após descompactar. Formato e codificação são validados antes da entrega como UTF-8. Não há cópia de legendas no Git nem cache em disco.

Uma falha nessa fonte é informada no diagnóstico e mantém o vídeo disponível. A integração vem habilitada por padrão e pode ser desativada no `.env`:

```dotenv
EXTERNAL_SUBTITLES_ENABLED=false
```

O funcionamento anônimo foi observado nesta sessão; o serviço externo pode alterar acesso, limites ou disponibilidade. Não foram configurados WARP, contas de terceiros ou mecanismos de contorno.

## O que o GoAnime acrescentou à pesquisa

Foi examinada a revisão [`85258f7b483064e428b0797955e320c152c8a7ea`](https://github.com/alvarorichard/GoAnime/tree/85258f7b483064e428b0797955e320c152c8a7ea), sob [licença MIT](https://github.com/alvarorichard/GoAnime/blob/85258f7b483064e428b0797955e320c152c8a7ea/LICENSE). O [registro de fontes](https://github.com/alvarorichard/GoAnime/blob/85258f7b483064e428b0797955e320c152c8a7ea/internal/api/source/kind.go) indica AnimeFire, Goyabu, SuperFlix e AniDB. O projeto oferece caminhos de anime; não fornece provedores de mangás ou novels.

| Caminho pesquisado | Informação útil no código | Resultado HTTP normal nesta sessão |
| --- | --- | --- |
| [AnimeFire](https://github.com/alvarorichard/GoAnime/blob/85258f7b483064e428b0797955e320c152c8a7ea/internal/scraper/providers/animefire/client.go) | Catálogo PT-BR e extração de vídeo | 403, erro 1010 |
| [Goyabu](https://github.com/alvarorichard/GoAnime/blob/85258f7b483064e428b0797955e320c152c8a7ea/internal/scraper/providers/goyabu/client.go) | Catálogo PT-BR e extração de vídeo | 403, desafio Cloudflare |
| [SuperFlix](https://github.com/alvarorichard/GoAnime/blob/85258f7b483064e428b0797955e320c152c8a7ea/internal/scraper/providers/superflix/types.go) | Faixas de áudio e legendas separadas | 403, erro 1010 |
| AniDB | Fonte em inglês do registro atual | Falha de DNS para `api.anidb.app` |

O [tratamento de áudio do SuperFlix](https://github.com/alvarorichard/GoAnime/blob/85258f7b483064e428b0797955e320c152c8a7ea/internal/api/superflix_audio.go) ajuda a distinguir áudio português de uma faixa de legenda. AnimeFire e Goyabu retornam caminhos de vídeo no código examinado; o idioma do catálogo, sozinho, não comprova uma legenda selecionável.

Esses resultados não demonstraram uma nova fonte HTTP reproduzível no HPmovies. Não foi copiado código do GoAnime nem instalado seu runtime. Rotinas de navegador, clearance, cookies e resolução de desafios não foram transportadas. A alternativa funcional desta etapa foi anexar legendas PT-BR independentes ao vídeo já validado, mantendo a pesquisa das fontes do GoAnime registrada para uma futura verificação de disponibilidade.

## Verificação desta etapa

As consultas externas e os downloads descritos acima foram executados separadamente das fixtures dos testes. A cobertura automatizada inclui códigos de idioma, preferência de leitura, busca/feed PT-BR, identidade das legendas, limites de download e falha independente da reprodução.

| Verificação final | Resultado |
| --- | --- |
| Testes automatizados | 233 aprovados em 26 arquivos |
| Lint, TypeScript, build e `git diff --check` | Aprovados |
| Suíte de navegador desktop e celular | 20 testes aprovados |
| Regressão de legendas no navegador | 2/2 execuções desktop/celular após ampliar o cenário existente: faixa inativa não é baixada; seleção de ASS inválida informa erro; voltar à SRT recupera a legenda e preserva sincronização |
| Player real com faixa PT-BR selecionada | Aprovado na amostra One Piece descrita acima, em desktop e celular |
| Leitor real MangaDex PT-BR | Aprovado na amostra Jujutsu Kaisen 0 descrita acima, em desktop e celular |

Os totais de testes desta etapa substituem somente a medição atual, mantendo os relatórios históricos. Continua o aviso de build do chunk HLS carregado sob demanda. Os artefatos técnicos e capturas ficam em `/tmp/hpmovies-pt-*`, fora do Git; o repositório não inclui os episódios, páginas ou legendas baixados na verificação.
