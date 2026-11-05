# Revisão de legendas — 04/11/2026

## Causas reproduzidas

Em Chainsmoker Cat / Yani Neko (`207141`), o episódio 1 tinha faixas no upstream,
mas os hosts dos arquivos não estavam na configuração local permitida. No E2 e
na versão inglesa do E4, o idioma explícito `Portuguese (Brazilian)` era
normalizado como desconhecido. A versão japonesa do Nebula no E4 fornecia somente
inglês. As faixas de cada versão continuam vinculadas à respectiva fonte.

A AniZone retornou uma versão japonesa com PT-BR completo nos 12 episódios. Seu
host também precisava de validação local. A ordem retornada das faixas portuguesas
era Forced, completa e Dubtitle; selecionar a primeira opção portuguesa poderia
deixar o diálogo sem tradução.

## Correções

- Normalização de nomes explícitos de idiomas, incluindo Brazilian, variantes
  portuguesas, espanhol regional e códigos com sublinhado.
- Preferência por legendas completas antes de Forced, Signs/Songs e Dubtitle.
  O idioma continua dependendo do campo de idioma, nunca do nome do arquivo.
  Entre fontes com a mesma cobertura de português, o padrão prefere áudio
  japonês. Escolha manual de fonte, idioma inglês e legendas desativadas continuam
  disponíveis; a preferência explícita por desativar permanece preservada.
- ASS/SSA com cabeçalhos permitidos deixa de ser descartado. O gateway valida
  VTT/SRT/ASS com o conversor compartilhado e aceita SRT sem índice e com hora
  curta. Formato original, limites de tamanho, permissões de cabeçalhos e
  validações de destino/rede permanecem aplicados. ASS é convertido em texto;
  composição gráfica, fontes anexadas, desenhos e karaokê não são renderizados.
- Player informa carregamento após 400 ms, identifica VTT sem falas válidas e
  oferece nova tentativa ou outra faixa portuguesa. A recuperação não percorre
  alternativas em ciclo e não seleciona inglês silenciosamente. O alerta cabe
  em telas de 320 px e permite rolagem quando necessário.
- Reativar a mesma faixa inicia um novo carregamento, sem reaproveitar erro ou
  estado pronto anterior. Consultar as fontes para buscar legendas preserva a
  posição e a intenção de continuar reproduzindo.
- Ausência de português mostra orientação abaixo do vídeo, com ação para usar
  outra fonte portuguesa ou consultar as fontes novamente. Sem legenda de
  origem, a interface explica o limite da tradução automática. O resumo informa
  o áudio da fonte ativa, pois a troca de fonte também pode mudar esse idioma.

## Configuração privada local

Foram validados e acrescentados seis hosts exatos, sem liberar toda uma família
de domínios: `ow13u.mysubsplay.com`, `suzaku.xin-cdn.xyz`,
`hc6kp.mysubsplay.com`, `qra5z.mysubsplay.com`, `4gmkc.mysubsplay.com` e
`mjmff.mysubsplay.com`. A verificação incluiu DNS público e conteúdo real de
legendas; os hosts das versões de vídeo também passaram por manifesto e
primeiro segmento no gateway.

A configuração fica no ambiente privado local. Nenhum arquivo de ambiente,
URL assinada, chave, bundle de fontes ou licença foi adicionado ao Git. Em outro
ambiente, hosts e disponibilidade precisam de nova verificação antes de serem
habilitados. Não houve commit, push ou deploy.

## Validação

**269 testes unitários afetados em 12 arquivos**, lint, TypeScript e build
aprovados. Permanece o aviso conhecido do chunk player/HLS acima de 500 kB.
**34 cenários distintos de navegador** foram aprovados em desktop e celular,
cobrindo carregamento, faixas vazias, recuperação limitada, preferência off,
fontes, tradução automática, aparência e tela cheia. Uma asserção antiga de status
foi delimitada à seção da tradução após a adição do novo status de disponibilidade.
As rodadas com alterações em andamento tiveram interrupções por recarga do
desenvolvimento e foram reexecutadas com o código estabilizado.

Inventário real, separado das fixtures: os 12 episódios ofereceram PT-BR completo
baixável e convertível na AniZone. Entradas por episódio:
261, 344, 281, 314, 361, 300, 325, 358, 314, 304, 385 e 344.

Reprodução real pelo caminho anime → episódio, sem interceptação de rotas:

| Anime / episódio | Fonte selecionada | Duração | PT-BR |
| --- | --- | ---: | ---: |
| Chainsmoker Cat E01 | AniZone, ja, faixa completa | 1.434,02 s | 261 |
| Chainsmoker Cat E02 | Nebula, ja | 1.422,05 s | 344 |
| Chainsmoker Cat E03 | Nebula, ja | 1.422,00 s | 281 |
| Chainsmoker Cat E04 | AniZone, ja, faixa completa | 1.444,07 s | 314 |
| Demon Slayer E01 | AniZone, ja, legenda externa | 1.419,96 s | 301 |
| Hunter x Hunter 2011 E01 | AniZone, ja, legenda externa | 1.411,45 s | 293 |

Nas seis amostras houve decodificação de áudio/vídeo, mais de dez segundos de
avanço, seek seguido de novo avanço e texto português visível. As capturas de
Chainsmoker Cat foram inspecionadas; E1 e E4 selecionaram a faixa completa em
português com a fonte japonesa. Não houve alerta do player, erro de página ou
overflow móvel nesses casos. Isso não representa inspeção integral de todos os
episódios, revisão linguística completa ou prova automática da identidade do áudio.

O checker estrito preservou resultado de falha porque as miniaturas TMDB
apresentaram requisições de imagem malsucedidas nas seis amostras. Houve ainda
falha transitória no índice do E1 durante a recarga da API. Os vídeos e as legendas
cumpriram as verificações acima; não se afirma que toda a navegação ficou livre
de falhas de rede. Esses resultados não foram convertidos artificialmente em
sucesso no JSON.

Uma tentativa posterior do E1 parou antes do player por HTTP 500 no catálogo;
a consulta seguinte retornou 200. A nova reprodução do E1, depois de recarregar
todos os hosts privados, voltou a carregar 261 falas PT-BR, sem erro de API,
mantendo apenas a falha da miniatura externa.

Evidência agregada, sem URLs de mídia ou credenciais:
[2026-11-04-subtitle-review.json](validation/2026-11-04-subtitle-review.json).
Capturas temporárias em `/tmp/hpmovies-playback-1793843317549/`; rechecagem final
de E1/E4 em `/tmp/hpmovies-playback-1793843671984/`.
O verificador real agora aceita `207141:episódio`:

```bash
npm run dev
npm run test:streaming:real -- 207141:1 207141:2 207141:3 207141:4
```

As portas de desenvolvimento existentes foram preservadas. A API foi recarregada
para aplicar a configuração privada. Para conferir a correção no navegador já
aberto, recarregue a página do anime/episódio; a opção de legendas desativadas,
quando salva pelo usuário, continua exigindo ativação manual nas configurações.
