# Ampliação das legendas em português — 27/10/2026

A busca de legendas agora combina OpenSubtitles REST, o addon oficial OpenSubtitles
v3 e um catálogo pequeno de arquivos públicos revisados. Todas as faixas chegam ao
player como WebVTT UTF-8 por tickets opacos. `EXTERNAL_SUBTITLES_ENABLED` controla
o conjunto; nesta validação não foram necessárias credenciais.

## Casos solicitados

| Obra | Identidade | Nova opção | Validação real |
| --- | --- | --- | --- |
| Steins;Gate The Movie – Load Region of Déjà Vu | AniList 11577; IMDb tt2967286; filme de 2013 | [Legendei PT-BR](https://legendei.net/pt-br-steinsgate-filme-load-region-of-deja-vu/) | 1.435 entradas; vídeo de 5.407,51 segundos; texto português visível |
| Overgeared, episódio 2 | AniList 212888; IMDb tt43691353; S01E02 | [SubDL, tradução automática](https://subdl.com/s/info/v5sUEYTk84/overgeared) | 512 entradas úteis; vídeo de 1.420,04 segundos; texto e aviso de tradução automática visíveis |

No filme, as fontes de vídeo não tinham legendas nativas e as duas consultas REST
de português retornavam listas vazias. O arquivo público do Legendei foi revisado
contra o filme e sua duração. O catálogo mantém apenas a referência; não inclui
uma cópia da legenda no repositório.

A ficha do SubDL identifica a tradução de Overgeared como automática. Sua inclusão
foi autorizada explicitamente pelo usuário. O SRT original continha 32 entradas
com comandos vetoriais ASS achatados como texto. A sanitização limitada às faixas
automáticas curadas remove essas linhas e controles bidi; o conversor descarta os
intervalos que ficaram vazios, preservando 512 entradas.

**Overgeared E01 permanece sem uma faixa portuguesa pública e baixável validada.**
As páginas encontradas no SubtitleCat ofereciam tradução sob demanda, sem arquivo
PT pronto; não foram apresentadas como legendas existentes. Os demais episódios
não herdam a faixa do E02.

## Fonte geral adicional

O addon OpenSubtitles v3 consta no [catálogo oficial do Stremio](https://github.com/Stremio/stremio-official-addons/blob/master/index.json)
e segue o [contrato de legendas do SDK](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/subtitles.md).
A consulta usa o IMDb exato; séries incluem temporada e episódio. O parser valida
essas informações, aceita somente `pob` e `por` e limita a quantidade de faixas.

O identificador da resposta v3 difere do identificador do arquivo. A deduplicação
com REST usa o número do caminho de download, evitando duas opções para o mesmo
arquivo. O endpoint observado em `subs5.strem.io` normaliza o texto para UTF-8;
metadados antigos como `CP1252` não são reaplicados ao arquivo já convertido.

Verificação pela classe real `PortugueseSubtitleProvider`, sem fixtures, com
download de uma faixa v3 por obra:

| Obra, episódio 1 | Faixas v3 | Faixas REST restantes | Entradas da faixa v3 baixada |
| --- | ---: | ---: | ---: |
| Naruto | 2 | 3 | 348 |
| One Piece | 2 | 1 | 357 |
| Steins;Gate, série | 2 | 1 | 360 |
| Your Name, filme | 1 | 5 | 1.068 |

Esses totais já eliminam duplicatas entre as duas fontes. A origem humana das
faixas v3 não foi presumida: elas não traziam uma indicação de tradução automática.
Bleach retornou zero faixas externas porque seu mapeamento de temporada no Fribb
estava incompleto para as regras de correspondência existentes; essas regras não
foram afrouxadas para preencher a lista.

## Player e transporte

`machineTranslated` marca as faixas automáticas. Elas têm identificação na lista
e o aviso persistente “Tradução automática: pode conter erros.”. Faixas portuguesas
sem essa marca vêm antes das automáticas, que vêm antes dos demais idiomas. A
escolha explícita de inglês ou de legendas desativadas continua sendo respeitada.

Os downloads usam destinos específicos: rota UTF-8 observada do addon ou URLs
exatas do catálogo curado. O transporte continua fixando DNS público na conexão
TLS, sem cookies, autenticação ou redirecionamentos. O ZIP é processado em memória,
com limite de 2 MB de entrada, 4 MB descompactados e 32 entradas. Caminhos inseguros,
ZIP64, criptografia, CRC inválido e múltiplas legendas ambíguas são recusados.

Falhas de uma fonte são isoladas. Os lançamentos curados continuam disponíveis
quando os catálogos remotos falham; sua identidade é explícita. A indisponibilidade
das legendas continua independente da reprodução do vídeo.

## Verificação e limites

- 373 testes unitários em 36 arquivos; lint, TypeScript e build aprovados.
- Oito cenários Playwright de legendas em desktop e celular aprovados, incluindo
  prioridade, seleção manual, aviso automático e desativação.
- Os dois casos solicitados passaram pelo player real sem interceptação de rotas:
  avanço, áudio decodificado, seek, legenda PT-BR visível e captura móvel sem overflow.
- Todas as respostas de mídia e legenda observadas nesses dois casos foram HTTP
  200; não houve erro de página, requisição falha ou alerta.

Os trechos foram verificados; a sincronização de cada fala do filme inteiro não
foi auditada. A tradução automática pode conter erros. Novos arquivos curados
exigem revisão de identidade e disponibilidade, não apenas semelhança do título.

Resumos numéricos, sem tokens ou texto das legendas:

- [Player real dos dois casos](validation/2026-10-27-more-subtitles-playback.json).
- [Downloads reais pelo addon v3](validation/2026-10-27-opensubtitles-v3.json).

Para repetir a reprodução, com aplicação, navegador e bibliotecas disponíveis:

```bash
npm run test:streaming:real -- 11577 212888:2
```

Os argumentos aceitam `ID` para o episódio 1 ou `ID:episódio`. Sem argumentos,
permanece a amostra original de cinco animes. Capturas ficam em `/tmp` e não são
versionadas. Não houve push ou deploy.
