# Correção do carregamento de legendas em português

Validação local em **22/10/2026**. O relato investigado foi: o inglês carregava, mas selecionar qualquer opção PT-BR não exibia legenda. Os relatórios de [fontes em português](PORTUGUESE-SOURCES.md) e [streaming](STREAMING-FIX-VALIDATION.md) preservam os resultados de 21/10; esta revisão verifica a troca manual de inglês para português e o arquivo efetivamente usado pelo navegador.

## O que mudou

As legendas externas do OpenSubtitles agora chegam ao navegador como **WebVTT nativo em UTF-8**, com `Content-Type: text/vtt; charset=utf-8`. O backend baixa o arquivo original, descompacta quando necessário, valida a codificação e converte SRT ou diálogo simples ASS antes da resposta. O ticket interno mantém o formato de origem; a faixa entregue ao player declara `format: vtt`. Esse caminho dispensa Blob e conversão no navegador. A conversão antiga continua disponível para outras fontes que ainda forneçam SRT/ASS.

O conversor puro passou para [src/shared/subtitles.ts](../src/shared/subtitles.ts), compartilhado pelo backend e pela conversão legada. Uma entrada com intervalo inválido é descartada sem perder as demais falas válidas; arquivos sem nenhuma fala válida produzem erro. O transporte mantém limite de 2 MB recebidos, até 4 MB após descompactação e limite de 2 MB na entrada e saída da conversão. Continuam valendo tickets opacos, destino HTTPS validado, DNS público fixado na conexão, timeouts, concorrência e cache limitados. Não foram adicionados cookies, credenciais ou contorno de acesso.

No [VideoPlayer](../src/frontend/components/player/VideoPlayer.tsx), somente a faixa selecionada e com URL pronta monta um elemento `<track>`. Uma conversão pendente deixa de criar um elemento sem `src`. Os eventos são vinculados ao `TextTrack` desse elemento, acessado por `HTMLTrackElement.track`, e identificados pela seleção e tentativa atuais. Eventos antigos deixam de afetar outra faixa; um carregamento bem-sucedido limpa o erro correspondente. A sincronização e a exibição usam as falas da faixa selecionada.

Uma falha de legenda aparece sobre o player mesmo com as configurações fechadas. “Tentar legenda novamente” recarrega a faixa escolhida, com até três tentativas manuais por seleção. O player mantém a escolha de idioma e informa a falha, sem trocar silenciosamente para inglês. Português continua prioritário quando não existe outra preferência; uma seleção manual de inglês ou “Desativadas” continua sendo respeitada. A preferência salva em inglês explica a seleção inicial em algumas sessões, mas não explicava a falha ao escolher PT-BR manualmente.

Também foi corrigido um limite indevido na leitura dos mapeamentos AniList: IDs acima de 100.000 eram descartados. O limite agora acompanha a API, aceitando inteiros positivos de até nove dígitos. Frieren (`154587`) e Demon Slayer (`101922`) passam a ser considerados. As verificações de série, temporada, episódio, duplicidade e ambiguidades continuam obrigatórias.

## Legenda real no Chromium e no Firefox

A execução usou o backend, os vídeos HLS e os arquivos reais, sem interceptar as respostas. Foi repetida no Chromium e no Firefox, começando com inglês salvo nas preferências e selecionando manualmente **cada opção portuguesa** disponível para o episódio 1 dos dois animes abaixo.

| Anime | Opções verificadas | Falas carregadas em cada faixa |
| --- | --- | --- |
| [One Piece, episódio 1](http://127.0.0.1:5173/sources?kind=anime&id=21&title=One+Piece&source=tatakai&episode=1&open=1) | 3 PT-BR | 359, 332 e 357 |
| [Naruto, episódio 1](http://127.0.0.1:5173/sources?kind=anime&id=20&title=Naruto&source=tatakai&episode=1&open=1) | 4 PT-BR e 1 português genérico | PT-BR: 350, 333, 304 e 319; português: 299 |

Todas as faixas selecionadas retornaram **HTTP 200 e `text/vtt; charset=utf-8`**, por URL local, sem Blob. Em cada seleção havia um único `<track>` no DOM. Além de contar entradas, a verificação procurou uma fala ativa e conferiu que o texto correspondente aparecia na camada de legendas. O modo nativo `hidden` é intencional: o player utiliza as entradas para desenhar essa camada personalizada.

Recarregar preservou o idioma português escolhido e fez somente um pedido de arquivo de legenda: PT-BR em One Piece e português genérico em Naruto, conforme a última seleção de cada execução. A inspeção com largura de 393 px não encontrou overflow; as quatro execuções terminaram sem erros de página. Essa largura verifica layout móvel no navegador de testes, sem representar um aparelho Android ou iOS físico.

Os resultados ficam em `/tmp/hpmovies-subtitles-chromium-manual.json` e `/tmp/hpmovies-subtitles-firefox-manual.json`, com capturas em `/tmp/hpmovies-subtitles-*`, fora do Git. Esses artefatos são temporários; o repositório não inclui episódios ou arquivos de legenda baixados.

## Descoberta e arquivo em IDs modernos

Uma execução independente consultou diretamente o provedor para os dois IDs antes excluídos e baixou a primeira faixa PT-BR. Foram usadas requisições HTTP anônimas normais, com no máximo duas consultas em paralelo.

| Anime, episódio 1 | Opções em português | Faixa PT-BR entregue |
| --- | --- | --- |
| Frieren — AniList 154587 | 2, sendo 1 PT-BR | WebVTT UTF-8, 46.064 bytes, 342 falas |
| Demon Slayer — AniList 101922 | 2, sendo 1 PT-BR | WebVTT UTF-8, 18.933 bytes, 303 falas |

Ambos retornaram `text/vtt; charset=utf-8`, cabeçalho WebVTT e decodificação UTF-8 válida. Esta amostra comprova a descoberta e o arquivo português desses episódios. Não comprova reprodução atual dos vídeos desses dois títulos: suas fontes podem usar outros hosts de CDN e exigir uma revisão independente das permissões de mídia.

## Regressão e limites

- **250 testes automatizados aprovados em 26 arquivos.**
- **Lint, TypeScript e build aprovados.**
- **32 testes de navegador aprovados**, em aproximadamente 1,2 minuto. A suíte Chromium usa cenários controlados e vídeo HLS público de demonstração; é separada das consultas reais de anime abaixo.
- Cobertura do provedor inclui IDs modernos e fora dos limites, conversão ASS, preservação de falas SRT válidas, WebVTT sem falas válidas, identidade do episódio e restrições de transporte.
- A amostra manual de Chromium acima verifica a troca de inglês para cada opção portuguesa, o texto visível, a preferência após recarga e o layout móvel.
- **Cinco verificações reais aprovadas** por `npm run test:streaming:real`: episódio 1 de Naruto, Death Note, Cowboy Bebop, Attack on Titan e One Piece. Cada execução confirmou avanço do vídeo, áudio decodificado, seek com retomada e legenda PT-BR visível. O resultado está em `/tmp/hpmovies-playback-1792667930103/results.json`, separado das fixtures.
- **Três regressões aprovadas no Firefox**: inglês → SRT portuguesa com preferência mantida após recarga; WebVTT portuguesa com HTTP 503 seguida de nova tentativa; e erro nativo da faixa seguido de carregamento bem-sucedido, limpando o aviso. Esses cenários usaram legendas controladas e um WebM VP8 original de 23.855 bytes gerado em `/tmp`. Confirmam o ciclo de carregamento nesse navegador; não comprovam reprodução HLS dos animes no Firefox.

Esses resultados cobrem os arquivos e cenários observados. Não garantem todos os episódios, navegadores ou sincronismo de cada edição. O acesso anônimo ao OpenSubtitles e os hosts de vídeo podem mudar. Se uma faixa carregar com tempos diferentes, use a sincronização em configurações; se o download falhar, o aviso e a tentativa manual continuam disponíveis sem trocar o idioma.

Não houve push nem deploy. A instalação local do Toko permanece fora do Git.
