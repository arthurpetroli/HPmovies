# Revisão de vídeo e português — 27/10/2026

Os três links recebidos usam identificadores **AniList**. A revisão corrigiu
falhas distintas de consulta, transporte, idioma e mapeamento de legendas.
A validação real percorreu `/anime/:id`, abriu o episódio e usou o player sem
interceptação de rotas, fixtures ou substituição por demonstração.

## Referências e instalação local

- [Toko](https://github.com/Snozxyx/Toko), revisão `b0642ca83d5f`, versão 4.5.7.
- [TatakaiServer](https://github.com/snozxyx/tatakaiserver), revisão `56f7d6da4113`.
- [HiAnime consultado](https://hianimes.se/home).
- Arquivo privado fornecido: `src/toko.kai`, versão 4.5.7.

O runtime local ainda carregava Toko 4.5.5. O pacote 4.5.7 foi instalado em
`.local/sources/toko-4.5.7`, com README, notices e licença preservados. A
configuração privada passou a selecionar esse pacote; a instalação anterior e
o arquivo fornecido permanecem intactos. Os provedores selecionados continuam
Nebula, AniZone, Webtoons e Syosetu. O pacote e a configuração ficam fora do Git.

A inspeção do bundle encontrou 79 provedores de streaming nas duas versões;
o total anunciado no README diverge desse inventário. Existem alternativas
como animepahe, animeya, animeheaven e watchanimeworld, além de fontes voltadas
a outros idiomas. A presença no bundle não comprova reprodução nem português.
Nesta etapa, os consertos nas fontes existentes atenderam aos casos recebidos;
não foram habilitados provedores sem verificação de conteúdo.

O HTML de `hianimes.se/home` apresentou interface EN/JP. Isso não comprova faixas
portuguesas, endpoints compatíveis com Aniwatch ou a identidade de seus vídeos.
A compatibilidade legada HiAnime do projeto permanece separada do catálogo
AniList e não foi usada para aprovar os resultados desta etapa.

## Causas corrigidas

### The Laid-Off Cheat-Granting Mage — AniList 207329

O título original tem 233 caracteres e ultrapassava o contrato de 200 caracteres
dos aliases de busca. A página enviava esse alias junto ao título inglês e a API
rejeitava a consulta inteira. Os serviços frontend agora removem aliases opcionais
incompatíveis, preservam os demais e continuam usando o ID AniList. Não truncam
nomes, pois isso poderia alterar a identidade da busca.

Variantes de vídeo e legendas também passaram a usar famílias de CDN ausentes da
configuração local. Após conferir manifestos, segmentos e faixas reais, a lista
privada foi atualizada. As três variantes HLS japonesas e as três inglesas foram
sondadas; essa sondagem verifica transporte, não reprodução integral de cada uma.

O rótulo explícito `Portuguese (CR Portuguese(Brazil))` agora normaliza para
`pt-BR`. Também foram tratados os rótulos ingleses CR, CC e Forced; faixas somente
forçadas não são oferecidas como base de tradução de um episódio inteiro.

### Detective Conan — AniList 235

O mapeamento Fribb compartilha o IMDb da série com um especial explicitamente
associado à temporada zero. Esse especial fazia o parser considerar ambígua a
série inteira e impedia a consulta de S01E01, apesar de existir um arquivo PT-BR.

Somente especiais com temporada zero concordante nas duas origens deixam de
contar como uma segunda série regular. Mapeamentos regulares ambíguos continuam
recusados. A faixa S01E01 baixada pelo OpenSubtitles tem 350 entradas após ASS→VTT.

Durante a revisão, Hunter x Hunter E01 trouxe um candidato externo chamado
`S01E101`, contradizendo os metadados E01. REST e addon agora rejeitam declarações
explícitas `SxxEyyy` incompatíveis com a identidade já resolvida. Números absolutos
isolados e offsets válidos não são tratados como contradição de temporada.

### Clevatess II — AniList 198946

O mapeamento correto é IMDb `tt32991344`, temporada 2. OpenSubtitles não forneceu
uma faixa PT validada para E01 nesta consulta. Foram revisados arquivos do
[SubDL para a segunda temporada](https://subdl.com/subtitle/sd12680202/clevatess/second-season)
e adicionadas referências exatas para E03, E04, E06, E07, E08, E09, E11 e E12.

Cada ZIP foi baixado pelo transporte real do provider, descompactado em memória
e convertido de ASS UTF-8. Os arquivos contêm diálogos portugueses e indicação do
episódio correspondente. Quantidades de entradas: 375, 323, 342, 326, 325, 329, 368
e 308, respectivamente. E01/E02/E05/E10/E13 não herdam os arquivos desses episódios.

Para E01, o novo fallback local traduziu a faixa inglesa de 400 entradas. O player
carregou o arquivo inteiro e exibiu texto português com aviso de tradução
automática. A identidade esperada é S02E01, “Solsein, the Divine Academy”.

## Fontes brasileiras e fallback

A página de [Clevatess no AnimesOnline](https://animesonline.io/60810/) utiliza
player externo; não foi validado um SRT/VTT separado nessa página. A
[orientação do Orion](https://animesorion.cc/como-assistir-animes-em-nosso-site/)
descreve anúncios e abas para acessar o player. Não foi encontrado ali um
catálogo de legendas baixáveis que pudesse ser integrado com correspondência
segura. Esses sites não foram cadastrados como arquivos de legenda disponíveis.

O botão **Gerar legenda em português** oferece tradução local de uma faixa
existente e elegível em inglês. O modelo Argos/OPUS-MT EN→PT-BR está instalado no
cache local e funciona em CPU, sem API paga. `npm run dev` inicia o tradutor quando
o modelo está instalado; uma instância saudável existente é reaproveitada.

A API emite ofertas opacas vinculadas ao episódio e à faixa. O navegador não
envia URLs arbitrárias nem texto para tradução. O trabalho ocorre em lotes, com
limites, polling, deduplicação e cache. Erros não interrompem o vídeo nem entregam
legenda parcial. O player seleciona o resultado sem reiniciar o vídeo e mantém o
aviso “Tradução automática: pode conter erros.”.

Instalação, atribuição e limites estão em
[AUTOMATIC-SUBTITLES.md](AUTOMATIC-SUBTITLES.md). Este fallback traduz texto; ele
não transcreve áudio de vídeos sem uma faixa de origem. Também não corrige tempos
já incorretos e não garante a qualidade de cada fala gerada.

## Reprodução real

| Obra e episódio | Duração observada | Resolução no trecho | Entradas portuguesas | Origem da faixa |
| --- | ---: | --- | ---: | --- |
| 207329 E01 | 1.420,04 s | 1920×1080 | 373 | Nativa, PT-BR |
| Conan 235 E01 | 1.496,51 s | 1920×1080 | 350 | OpenSubtitles, PT-BR |
| Clevatess II 198946 E01 | 1.419,96 s | 1920×1080 | 400 | Tradução automática local |
| Clevatess II 198946 E03 | 1.425,01 s | 1920×1080 | 375 | SubDL, PT-BR |
| Demon Slayer 101922 E01 | 1.419,96 s | 1920×1080 | 301 | OpenSubtitles, PT-BR |
| Hunter x Hunter 11061 E01 | 1.411,45 s | 640×360 | 293 | Nativa, PT-BR |

Os seis casos tiveram mais de dez segundos de avanço, quadros e áudio
decodificados, seek seguido de novo avanço e texto português visível. Nenhum teve
erro de página, requisição falha, alerta ou overflow móvel. A resolução é a do
trecho observado. As capturas permitem inspecionar vídeo, legenda e interface;
a auditoria não abrange todas as falas nem todos os episódios ou qualidades.

As cinco reproduções sem geração estão em
[validation/2026-10-27-source-review-playback.json](validation/2026-10-27-source-review-playback.json).
A geração e reprodução de Clevatess E01 estão em
[validation/2026-10-27-clevatess-automatic-playback.json](validation/2026-10-27-clevatess-automatic-playback.json).
Os resumos não incluem URLs privadas, tokens, chaves ou texto das legendas.

## Verificações e retomada

- 416 testes unitários em 39 arquivos, lint, TypeScript e build aprovados.
- 24 cenários Playwright de legendas, geração, episódios e recuperação de fontes
  aprovados em desktop e celular. São contratos com fixtures e vídeo público de
  teste, separados dos seis casos reais acima.
- O launcher do tradutor foi verificado reaproveitando a instância principal e
  iniciando/encerrando uma instância em porta isolada, sem interromper a principal.
- Permanece o aviso de chunk do player acima de 500 kB; o build foi concluído.

Com navegador e bibliotecas disponíveis, reproduza:

```bash
npm run dev
npm run test:streaming:real -- 207329 235 198946:3 101922 11061
npm run test:streaming:real -- 198946 --translate
```

Neste ambiente o navegador precisa de
`LD_LIBRARY_PATH=/tmp/hpmovies-browser-libs/extracted/usr/lib/x86_64-linux-gnu`.
As capturas ficaram em `/tmp/hpmovies-playback-1793131549131/` e
`/tmp/hpmovies-playback-1793131564185/`; podem desaparecer após reinício.

O catálogo inteiro não foi validado e a disponibilidade externa pode mudar.
Cobertura de 100% não foi estabelecida. Não houve commit, push ou deploy.
