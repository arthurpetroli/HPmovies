# Correção e validação da reprodução real

Verificação local em **21/10/2026**. Esta etapa investiga a falha de reprodução informada após as recomendações de Naruto, Death Note, Cowboy Bebop e Attack on Titan. Os [resultados anteriores em português](PORTUGUESE-SOURCES.md) preservam a amostra inicial de One Piece; disponibilidade de legenda e resposta do manifesto, isoladamente, não comprovam que outro episódio reproduz.

**Revisão de legendas em 22/10/2026:** a falha posterior ao selecionar PT-BR, as mudanças no ciclo de carregamento do player e a entrega de WebVTT nativo estão em [SUBTITLE-LOADING-FIX.md](SUBTITLE-LOADING-FIX.md). Este relatório preserva a validação de vídeo e os totais de testes da etapa de 21/10.

## Causa reproduzida

Nos quatro títulos, a fonte devolvia um manifesto HLS com HTTP 200. Esse manifesto apontava para outra playlist, cujos segmentos usavam novos domínios de CDN. Como esses domínios não estavam na lista exata de hosts permitidos, o gateway recusava os descendentes. A rota local da playlist retornava HTTP 503 com `CONTENT_IMAGE_NOT_PERMITTED`, embora a URL inicial existisse.

| Anime, episódio 1 | AniList | Domínio dos segmentos observado |
| --- | ---: | --- |
| Naruto | 20 | `fn5an.wintergrove.space` |
| Death Note | 1535 | `iaae2.eclipseharbor.space` |
| Cowboy Bebop | 1 | `55z9f.midnightvale.top` |
| Attack on Titan | 16498 | `wolfn.goldenanchor.space` |

Os primeiros segmentos dos quatro títulos responderam HTTP 200 em requisições normais do cliente local. Embora declarassem `image/jpeg`, eram MPEG-TS: a validação conferiu os pacotes de 188 bytes do arquivo inteiro. Não eram imagens nem páginas HTML. O gateway já reconhecia essa situação; a falta dos novos hosts impedia que chegasse ao segmento.

A configuração privada foi atualizada com oito hosts exatos observados nas fontes: os quatro da tabela, `by31m.goldenanchor.space`, `c6bk0.oakhorizon.space`, `mo6mo.stellarfrontier.space` e `fngju.twilightharbor.space`. Antes da inclusão, foram conferidos DNS público e os três primeiros segmentos das respectivas playlists: 30 segmentos, em dez fontes de áudio japonês/inglês de Naruto, Death Note, Cowboy Bebop, Attack on Titan e One Piece. Não foi liberado um domínio curinga nem um destino informado livremente pelo navegador. O `.env` permanece fora do Git; esses hosts não são acrescentados automaticamente a novas cópias. Uma instalação nova precisa configurar seus hosts conforme as fontes efetivamente usadas.

## Comportamento corrigido

O adaptador Toko/Tatakai agora encaminha todas as fontes HLS e MP4 aprovadas pelo gateway local, inclusive quando a fonte não declara cabeçalhos. O navegador recebe um ticket opaco. O transporte continua validando provedor, host, origem e DNS público, com limites de tempo, bytes, concorrência e cache; cookies, autenticação e redirecionamentos permanecem recusados. Cabeçalhos de User-Agent de navegador não são imitados.

Antes de oferecer uma fonte como disponível, o backend verifica mídia real. Em HLS, percorre a primeira variante do manifesto até uma playlist com duração de segmentos e baixa o primeiro segmento; valida MPEG-TS ou o par de inicialização/segmento fMP4. Em MP4, solicita até 64 KiB e confere a estrutura ISO-BMFF inicial. Essas sondagens recebem somente tickets já emitidos pelo gateway, sem uma rota de URL arbitrária. A resolução executa duas sondagens por vez, com orçamento total de oito segundos e cancelamento das requisições. O resultado da sondagem é lembrado por até 30 segundos; uma falha, por cinco segundos.

Fontes que não passam nessa verificação são descartadas. Na amostra, alternativas MP4 retornavam HTTP 302 para `vidcache.net:8161`; elas não foram anunciadas como reproduzíveis nem tiveram esse redirecionamento seguido automaticamente. A ausência de uma fonte aprovada informa erro de mídia, em vez de afirmar disponibilidade porque um provedor retornou uma URL.

O player mantém as tentativas de recuperação limitadas. Uma falha definitiva, a preparação sem metadados por 15 segundos ou a reprodução sem avançar por 15 segundos aciona a próxima URL distinta. Ao trocar, preserva a posição e a intenção de continuar reproduzindo. A escolha de idioma e os ajustes de legenda continuam nas preferências do player. Cada URL é tentada uma vez por ciclo; ao esgotar as opções, há aviso e tentativa manual. Falha de uma legenda não provoca troca do vídeo.

Ao clicar em “Tentar fontes novamente” após esgotar as opções, a página consulta novamente a API de reprodução com o mesmo episódio e os mesmos títulos de busca. Isso permite receber tickets novos após expiração ou reinício do backend, em vez de repetir somente links antigos. A posição é retomada pelo histórico; essa ação manual prepara o vídeo pausado, e o usuário pode clicar em reproduzir. Não há ciclo automático infinito de renovação. O cenário de regressão recebe HTTP 404 no ticket antigo, retorna outra fonte na segunda consulta, restaura 12 segundos pausado e, após o clique, avança além de 13 segundos.

Também foi corrigida uma SRT real de Naruto: um dos 351 blocos tinha duração zero e fazia a conversão rejeitar a faixa inteira. O conversor agora descarta blocos com tempos inválidos e preserva os válidos. Nessa faixa, resultaram 350 entradas utilizáveis. A cobertura inclui arquivos SRT e ASS com blocos válidos e inválidos no mesmo arquivo; faixas sem entradas válidas continuam produzindo erro explícito.

## Comparação com GoAnime e Tatakai

O [HlsAdapter do Tatakai](https://github.com/Snozxyx/Tatakai/blob/80bfc190603868effd81a138b6ee07af0b94ec0d/src/core/player/HlsAdapter.ts) organiza candidatos, limita recuperação de rede/mídia e tenta outro candidato quando necessário. Seu [resolvedor de streaming](https://github.com/Snozxyx/Tatakai/blob/80bfc190603868effd81a138b6ee07af0b94ec0d/src/core/player/stream-resolver.ts) também faz sondagens para ordenar caminhos. A mudança local aplica esses princípios de recuperação limitada e troca de fonte; acrescenta a verificação do primeiro trecho de mídia antes de declarar a fonte disponível. Uma resposta HTTP 200 de manifesto continua insuficiente para assegurar decodificação no navegador.

O [proxy documentado do Tatakai](https://github.com/Snozxyx/Tatakai/blob/80bfc190603868effd81a138b6ee07af0b94ec0d/cloudflare-worker/README.md) reescreve descendentes HLS, preserva Range/206 e usa `Accept-Encoding: identity`. Esses comportamentos já estavam no transporte local e foram mantidos, com permissões delimitadas por configuração e tickets.

O [GoAnime usa mpv como player](https://github.com/alvarorichard/GoAnime/blob/85258f7b483064e428b0797955e320c152c8a7ea/internal/player/player.go). Seu [preparo da reprodução](https://github.com/alvarorichard/GoAnime/blob/85258f7b483064e428b0797955e320c152c8a7ea/internal/player/playvideo.go) configura o demuxer FFmpeg para HLS, inclui cabeçalhos necessários e trata extensões de segmentos que não correspondem ao conteúdo. No HPmovies, o tipo HLS é preservado e os bytes são validados antes de corrigir o MIME. Reproduzir no mpv não comprova suporte aos mesmos codecs no Chrome; a validação final desta etapa ocorre no próprio player web. O mpv não foi adicionado como dependência da aplicação.

As fontes GoAnime que retornaram HTTP 403 ou falha de DNS na [pesquisa anterior](PORTUGUESE-SOURCES.md#o-que-o-goanime-acrescentou-à-pesquisa) não foram apresentadas como novas fontes funcionais. Não foram incorporados mecanismos de clearance, resolução de desafios ou contorno de acesso.

## Evidência no navegador

Após a correção dos hosts, a amostra inicial avançou pelo menos oito segundos nos quatro títulos, sem erro de mídia. A execução final de `npm run test:streaming:real` passou nos cinco títulos abaixo, com resultado registrado em `/tmp/hpmovies-playback-1792637023154/results.json`, às 23h44 de 21/10/2026, no horário de São Paulo.

| Anime, episódio 1 | Resolução decodificada | Entradas da faixa PT-BR |
| --- | --- | ---: |
| [Naruto](http://127.0.0.1:5173/sources?kind=anime&id=20&title=Naruto&source=tatakai&episode=1&open=1) | 1056×800 | 350 |
| [Death Note](http://127.0.0.1:5173/sources?kind=anime&id=1535&title=Death+Note&source=tatakai&episode=1&open=1) | 1920×1080 | 298 |
| [Cowboy Bebop](http://127.0.0.1:5173/sources?kind=anime&id=1&title=Cowboy+Bebop&source=tatakai&episode=1&open=1) | 1448×1080 | 215 |
| [Attack on Titan](http://127.0.0.1:5173/sources?kind=anime&id=16498&title=Shingeki+no+Kyojin&source=tatakai&episode=1&open=1) | 1920×1080 | 253 |
| [One Piece](http://127.0.0.1:5173/sources?kind=anime&id=21&title=One+Piece&source=tatakai&episode=1&open=1) | 1440×1080 | 359 |

Em cada título, o vídeo avançou até dez segundos, com 243 quadros decodificados, nenhum quadro descartado e bytes de áudio decodificados maiores que zero. Após avançar dez segundos com o controle do player, a reprodução continuou até aproximadamente 21 segundos, sem erro de mídia e com `readyState=4`. Todas as requisições de mídia e legenda observadas retornaram HTTP 200. Não houve erros de página, requisições falhas, alertas nem overflow na captura móvel de 393 px.

As cinco faixas selecionadas tinham idioma `pt-BR` e entradas carregadas. O modo nativo `hidden` é intencional: o player usa as entradas para desenhar a legenda personalizada. Além de medir carregamento e seleção, o script buscou um trecho com diálogo após 30 segundos e confirmou que o texto da faixa portuguesa estava visível na camada de legendas. `portugueseCaptionVisible=true` foi registrado nos cinco títulos, e as capturas desktop/móvel incluem esse texto.

Os testes automatizados desta etapa aprovaram **242 testes em 26 arquivos**; lint, TypeScript e build também passaram. A suíte final de navegador, incluindo troca de fonte e renovação manual de tickets expirados, aprovou **26 testes em aproximadamente 1,1 minuto**, cobrindo desktop e celular. Esses cenários de recuperação usam falhas locais controladas e vídeo HLS público de teste; são separados da execução real dos cinco animes descrita acima. `git diff --check` também passou.

## Repetir a verificação real

Com a aplicação e o host configurado rodando em `npm run dev`, execute em outro terminal:

```bash
npx playwright install chromium
npm run test:streaming:real
```

O script `scripts/check-real-playback.mjs` consulta as fontes reais de Naruto, Death Note, Cowboy Bebop, Attack on Titan e One Piece, sempre no episódio 1. Não intercepta rotas, não usa fixtures e não substitui uma falha por vídeo de demonstração. É possível limitar os títulos aos IDs aceitos:

```bash
npm run test:streaming:real -- 20 1535
```

Para cada título, o comando exige avanço de pelo menos dez segundos, quadros de vídeo decodificados, bytes de áudio decodificados e uma faixa PT-BR selecionada com entradas carregadas. Faz seek, exige novo avanço, procura um trecho de diálogo português e confere sua exibição na camada de legendas. Registra o estado do player, verifica requisições de mídia e erros da página e gera capturas em 1440 px e 393 px. A captura móvel verifica layout na mesma sessão; não representa um navegador físico Android ou iOS. Qualquer falha de título deixa o comando com código de saída diferente de zero.

Os resultados JSON e as capturas ficam em `/tmp/hpmovies-playback-<timestamp>/`, fora do repositório. O script aceita `PLAYWRIGHT_CHROMIUM_EXECUTABLE` para um navegador compatível já instalado e `STREAM_CHECK_ORIGIN` para outra origem local. As bibliotecas nativas do Chromium precisam estar disponíveis no Linux.

## Limites da conclusão

A sondagem comprova o acesso e a estrutura da mídia inicial; a execução no navegador comprova decodificação e avanço nos trechos observados. Nenhum desses testes percorre episódios inteiros ou todos os animes. Hosts, tokens e disponibilidade externos podem mudar. Uma rotação de CDN fora da configuração volta a ser recusada e deve ser revisada antes de ampliar permissões.

Não houve push ou deploy. O bundle Toko instalado permanece intacto e fora do Git, conforme [LOCAL-SOURCE-HOST.md](LOCAL-SOURCE-HOST.md).
