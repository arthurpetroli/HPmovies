# Estado de desenvolvimento — 28/10/2026

Retomada atual: produção compilada em `http://127.0.0.1:4000`, com site/API,
fontes em `:8099` e tradutor opcional em `:5000`, iniciados por `npm start`.
O desenvolvimento com `npm run dev` continua em `:5173`; não execute ambos nas
mesmas portas auxiliares. Branch integrada: `main`.

## Skills instaladas

UI/UX Pro Max, Frontend Design e Caveman estão em `.agents/skills`, com revisões
fixadas, licenças e hashes em `.agents/skills.lock.json`. Uso e comandos em
[PROJECT-SKILLS.md](PROJECT-SKILLS.md); orientações de aplicação em `AGENTS.md`.
A busca local de UX foi executada com sucesso. Não foram adicionadas dependências
ao aplicativo. Caveman orienta a concisão da conversa, sem reduzir a precisão do
código, documentação ou verificações.

## Mudanças retomadas e concluídas

- A página do anime mostra episódios diretamente, com busca, intervalos de 50,
  páginas de 24 e retorno do player para o anime. O painel antigo de consulta
  manual foi removido.
- A rota de índice que faltava no host foi implementada. O resolver consulta o
  índice real paginado do Nebula pelo ID AniList, valida a identidade e impõe
  limites de páginas, bytes, concorrência e tempo. O bundle original permanece
  intacto. Uma falha inicial de vídeo preserva os episódios para nova resolução.
- O transporte aceita famílias específicas de CDN configuradas para streaming,
  incluindo seus subdomínios. Imagens mantêm hosts exatos. Uma configuração só
  com raízes de streaming agora também funciona no cliente HTTP.
- HLS AES-128 comum funciona com chaves públicas de 16 bytes e segmentos TS
  validados após decifrar. IV explícito curto é expandido para 16 bytes; o caso
  de sequência implícita acima de 32 bits é recusado por incompatibilidade com
  o HLS.js. DRM e formatos incompatíveis continuam recusados.
- Os metadados explícitos de português das fontes foram normalizados. As
  correções anteriores de WebVTT, prioridade PT-BR e recuperação de legenda
  permanecem, com erros independentes dos vídeos.
- Erros de streaming têm mensagens próprias e não afirmam que o catálogo caiu.

## Correção de Demon Slayer nesta retomada

O problema foi reproduzido novamente: para AniList `101922`, episódio 1, a fonte
Nebula em inglês retornava uma compilação de **6.307 segundos**. AniZone retornava
o episódio correto com aproximadamente **1.420 segundos**.

`source-mismatches.ts` exclui somente essa combinação conhecida de anime,
episódio, provedor, idioma e formato HLS antes de emitir tickets ou sondar mídia.
É uma correção pontual de mapeamento externo, não um validador geral de identidade.
A regra deverá ser revisada quando o upstream corrigir o conteúdo. Não foi usado
um limite global que pudesse descartar filmes ou episódios longos legítimos.

O script real também exige de 18 a 35 minutos nesse caso de regressão, evitando
aprovar novamente o filme só porque ele reproduz.

## Validação de 27/10/2026

- **300 testes em 32 arquivos**, lint, TypeScript e build aprovados.
- **38 testes de navegador** aprovados em desktop e celular. A suíte inclui
  contratos isolados com fixtures e vídeo público de teste; a execução dos dois
  animes reais abaixo é independente.
- Execução real sem interceptação de rotas, fixtures ou substituição por demo:

| Anime, episódio 1 | Fonte | Duração | Vídeo decodificado | Entradas PT-BR |
| --- | --- | ---: | --- | ---: |
| Demon Slayer (`101922`) | AniZone | 1.419,96 s | 1920×1080 | 303 |
| Hunter x Hunter 2011 (`11061`) | AniZone | 1.411,45 s | 640×360 | 293 |

Nos dois casos houve mais de dez segundos de avanço, áudio decodificado, seek
seguido de novo avanço e texto PT-BR visível. Não houve erro de página, requisição
falha, alerta ou overflow na captura móvel; as respostas de mídia observadas
foram HTTP 200. A resolução registrada é a observada no trecho, não uma garantia
da resolução máxima da fonte.

O resumo numérico está em [validation/2026-10-27-playback.json](validation/2026-10-27-playback.json).
As capturas desta execução ficaram em `/tmp/hpmovies-playback-1793111949380/` e
podem desaparecer após reinício. Relatórios datados de 21 e 22/10 preservam suas
amostras históricas; não representam novos testes de todos aqueles títulos hoje.

Para repetir, com navegador e suas bibliotecas disponíveis:

```bash
npm run dev
npm run test:streaming:real -- 101922 11061
```

## Pendências para a próxima etapa

1. Ampliar a amostra real de títulos, temporadas e filmes, conferindo identidade
   do episódio e todas as qualidades HLS, pois variantes podem usar outras CDNs.
2. Revisar as faixas portuguesas que falham por disponibilidade da própria fonte,
   incluindo o caso histórico de Bleach; ele não foi revalidado nesta retomada.
3. Revalidar novos domínios antes de ampliar a configuração privada. Os registros
   temporários de algumas sondagens anteriores não sobreviveram ao reinício.
4. Aplicar as skills de design nas próximas mudanças de interface, preservando o
   briefing e a identidade do HPmovies. O foco seguinte continua sendo a cobertura
   funcional e o português.

O catálogo completo e todos os episódios externos não foram testados. Índice,
URL e HTTP 200 isolados não comprovam correspondência ou reprodução integral.
O deploy continua reservado para uma etapa posterior.

## Atualização posterior: mais legendas em português

Integração e validação de 27/10/2026: OpenSubtitles v3 passou a complementar o REST,
com deduplicação por arquivo e downloads UTF-8. O filme de Steins;Gate recebeu a
faixa PT-BR revisada do Legendei. Overgeared E02 recebeu tradução automática do
SubDL, autorizada pelo usuário, com identificação, aviso persistente e prioridade
para opções portuguesas sem a marca automática.

Os dois casos passaram no player real: 1.435 entradas no filme e 512 no episódio.
Também foram baixadas faixas v3 de Naruto, One Piece, Steins;Gate série e Your Name.
Validação desta etapa: 373 testes, oito cenários Playwright de legendas, lint,
TypeScript e build aprovados. Overgeared E01 segue sem arquivo português público
e baixável validado; Bleach requer revisão da correspondência de temporada.

Fontes, evidências e limites em [MORE-PORTUGUESE-SUBTITLES.md](MORE-PORTUGUESE-SUBTITLES.md).

## Integração à main — 27/10/2026

Por solicitação do usuário, os 22 commits de `feat/hpmovies-v2`, até `fcb2cf7`,
foram integrados à `main` local com histórico preservado e sem conflitos.
A `main` local estava alinhada com `origin/main` após o fetch. A integração
mantém o código aprovado; este registro atualiza somente a documentação.
As verificações da etapa de legendas acima continuam sendo a validação do código
integrado. Não houve push ou deploy nesta operação.

## Redesign da descoberta e cards — 27/10/2026

Interface local redesenhada com as skills frontend-design, UI/UX e caveman.
A direção segue a composição de descoberta solicitada do Crunchyroll e mantém
o verde do HPmovies: navegação mais simples, destaque com arte ampla, títulos
legíveis, fileiras de pôsteres maiores, gêneros ilustrados e seção editorial.
As decisões e a limitação de acesso à referência estão em
[FRONTEND-DESIGN.md](FRONTEND-DESIGN.md).

Os cards mostram sinopse, nota AniList, formato, ano, episódios, status e gêneros
quando disponíveis. Mouse e teclado abrem a prévia; no celular existe controle
explícito de toque. Escape fecha. Conforme o ajuste solicitado na retomada,
o card inteiro é um único link nativo: capa, título, sinopse e áreas vazias abrem
o anime. Salvar e fechar são botões independentes, sem navegação acidental e sem
botões dentro de links. O carrossel salvo foi movido para depois das demais
fileiras, evitando deslocar o card na primeira adição.

Pôsteres continuam usando `extraLarge` do AniList. O destaque limita a ampliação
do banner conforme suas dimensões naturais, reduz o tamanho de títulos longos
sem cortá-los e usa a capa se o banner falhar. Não houve alteração de fontes,
player, legendas, backend ou dependências. O idioma da sinopse segue o catálogo.

Verificações desta etapa:

- 373 testes unitários em 36 arquivos aprovados.
- Lint, TypeScript e build aprovados. Continua o aviso de bundle do player
  acima de 500 kB; ele não impediu a compilação.
- Suítes `platform.spec.ts` e `discover-design.spec.ts`: 20 cenários aprovados
  em desktop e celular; dois casos não se aplicam ao dispositivo e são pulados.
  As fixtures do catálogo são sintéticas e separadas da aplicação. Os testes
  de player dessa suíte usam demonstração; não revalidam episódios reais.
- Inspeção separada com catálogo real: 92 cards, sem erros de página ou overflow
  nas larguras 412, 768, 1024 e 1440px. Também foi conferida a prévia real a 360px,
  com sinopse e botões visíveis. Destaques reais ficaram entre 662 e 706px no
  desktop da amostra. Capturas temporárias estão em `/tmp/hpmovies-hero-refined-*`
  e `/tmp/hpmovies-card-real-*`; podem desaparecer após reinício.

Retomada: iniciar com `npm run dev` e acessar `http://127.0.0.1:5173`.
Neste ambiente, Playwright precisou das bibliotecas extraídas localmente em
`/tmp/hpmovies-browser-libs/extracted/usr/lib/x86_64-linux-gnu`, fornecidas via
`LD_LIBRARY_PATH`, sem instalação de sistema. As pendências de conteúdo real e
legendas das etapas anteriores permanecem. Não houve commit, push ou deploy.

## Salvamento no Git autorizado — 27/10/2026

Após aprovar o redesign e o clique no card inteiro, o usuário solicitou salvar
o trabalho no Git remoto. Esta etapa reúne interface, estilos, testes de navegador
e documentação na `main`, com envio para `origin`. As verificações acima cobrem
o código que está sendo salvo; não houve novas alterações funcionais nesta etapa.

O bundle privado `src/toko.kai` permanece somente local e foi incluído no
`.gitignore` para evitar seu envio acidental. Arquivos de ambiente e artefatos
de navegador continuam fora do versionamento. Não foi solicitado deploy.

## Revisão das fontes e fallback português — 27/10/2026

Os casos `/anime/207329`, `/anime/235` e `/anime/198946` foram revisados com
Toko/TatakaiServer e o arquivo privado fornecido. O runtime local passou de
Toko 4.5.5 para 4.5.7, preservando a instalação anterior, o bundle original e
as licenças. A configuração local de CDNs foi ampliada somente após conferir
manifestos, segmentos e legendas reais; pacotes e configuração continuam privados.

Correções: aliases opcionais acima do limite não bloqueiam mais o ID AniList;
rótulos portugueses CR normalizam para PT-BR; Conan deixa de ser bloqueado por
um especial de temporada zero no Fribb. OpenSubtitles agora recusa filenames
com `SxxEyyy` explicitamente incompatível com o episódio solicitado. Clevatess II
recebeu oito referências PT-BR exatas para E03/E04/E06/E07/E08/E09/E11/E12.

O player oferece **Gerar legenda em português** para faixas inglesas elegíveis.
A tradução roda em CPU com Argos/OPUS-MT local, conserva os tempos e identifica
o resultado como automático. O modelo e o ambiente Python ficam no cache do
usuário. Já estão instalados neste ambiente; `npm run dev` inicia ou reaproveita
o serviço `:5000`. Em outro ambiente, execute `npm run setup:translator` uma vez.
Sem faixa de origem, não há transcrição automática de áudio nesta implementação.

Validação final: **416 testes unitários em 39 arquivos**, lint, TypeScript e
build aprovados; **24 cenários Playwright** afetados aprovados em desktop/celular.
Seis casos reais, navegando pela página do anime, reproduziram vídeo/áudio com
seek e texto português visível: 207329 E01, Conan E01, Clevatess II E01 e E03,
Demon Slayer E01 e Hunter x Hunter E01. Clevatess E01 usou a nova geração local
com 400 entradas; os demais usaram faixas nativas ou externas já disponíveis.
Não houve erro observado ou overflow móvel nesses casos. Continua o aviso de
bundle do player acima de 500 kB, sem falha no build.

Fontes, causas, limites, comandos e JSONs de evidência estão em
[SOURCE-REVIEW-2026-10-27.md](SOURCE-REVIEW-2026-10-27.md). O fallback e sua licença
estão em [AUTOMATIC-SUBTITLES.md](AUTOMATIC-SUBTITLES.md). Não foi estabelecida
cobertura integral do catálogo. Não houve commit, push ou deploy nesta etapa.

## Apresentação das legendas — 27/10/2026

A legenda agora segue a imagem fornecida pelo usuário: texto branco sem serifa,
peso 700, contorno preto definido, sombra curta e fundo transparente por padrão.
A opção **Fundo preto da legenda** continua nas configurações e persiste quando
ativada. A fonte usada é Arial com fallbacks locais; não foi instalada uma fonte
proprietária ou alterado o bundle privado das fontes de conteúdo.

A escala foi deslocada conforme solicitado: pequena usa os antigos tamanhos da
média (16px móvel/24px desktop), média usa os antigos da grande (20px/30px) e
grande passa a 24px/36px. Em tela cheia, os tamanhos acompanham a largura do player,
com limites. A composição mantém texto centralizado junto à base e eleva a
legenda enquanto os controles estão visíveis. Em superfícies estreitas, o texto
pode compartilhar esse espaço para não ser cortado acima do vídeo; permanece
acima dos controles centrais sem bloquear cliques.

As preferências passam a `hpmovies.captions.v2`. A migração mantém idioma, tamanho
e sincronização da v1 e inicia sem a antiga caixa padrão uma vez. Escolhas de
fundo feitas na v2 prevalecem nas próximas visitas. Armazenamento bloqueado ou
corrompido continua usando valores seguros.

A tentativa de conferir o vídeo público da Crunchyroll retornou HTTP 403 com
verificação Cloudflare, sem disponibilizar o player. O ajuste visual usa a
referência enviada, sem afirmar identidade de fonte ou medição do player oficial.
O [suporte oficial sobre aparência de Closed Captions](https://crunchyroll.zendesk.com/hc/en-us/articles/38779221011092-How-to-set-custom-Closed-Captions-on-Crunchyroll)
documenta personalização, mas não estabelece a fonte ou os pixels das legendas
de anime exibidas na referência.

Verificação desta etapa: 24 testes unitários afetados aprovados; 18 cenários
Playwright de carregamento, aparência e recuperação de fontes aprovados em
desktop/celular. Os seis cenários afetados por ajustes finais de layout e migração
foram reexecutados com sucesso. Foram conferidos multiline, três tamanhos, fundo
preto após reload, tela cheia e larguras de 320/360px com controles visíveis.
Lint, TypeScript e build aprovados; permanece o aviso conhecido do chunk do player.

Também houve inspeção separada de 207329 E01 real, sem fixtures ou interceptação:
médio/grande no desktop, grande no celular e fundo preto opcional, sem texto fora
do player ou overflow da página. Essa inspeção é de apresentação e não revalida
todo o conteúdo externo. Capturas finais em `/tmp/hpmovies-caption-style-final/`;
medidas sem URLs privadas em
[validation/2026-10-27-caption-appearance.json](validation/2026-10-27-caption-appearance.json).
Não houve commit, push ou deploy nesta etapa.

## Aviso automático fora do vídeo e execução local — 27/10/2026

O aviso “Tradução automática: pode conter erros.” foi movido do overlay do
player para **Sua experiência**. O painel acompanha a faixa efetivamente
selecionada: exibe o aviso para tradução automática e o remove ao escolher
uma faixa humana, desativar legendas ou mudar para uma fonte sem essa seleção.
O vídeo e a tela cheia não recebem mais essa mensagem sobre a imagem.

Nos testes móveis foi identificado que o gradiente dos controles interceptava
o clique no botão central de reprodução. Os controles centrais agora ficam
acima do gradiente e abaixo da legenda, preservando texto legível e cliques.

O projeto foi iniciado novamente com `npm run dev`: frontend `:5173`, API
`:4000`, host das fontes `:8099` e tradutor local `:5000`, com respostas HTTP 200.
As verificações de disponibilidade não equivalem a novos testes de conteúdo.
Verificação do ajuste: 24 testes unitários afetados e quatro cenários de navegador
em desktop/celular aprovados; lint, TypeScript e build aprovados. O aviso fica
no painel, acompanha as escolhas humana/automática/desativada e está ausente do
player. As bibliotecas do navegador nesta execução estão no cache persistente:
`LD_LIBRARY_PATH=/home/arthu/.cache/hpmovies-qa/libs/usr/lib/x86_64-linux-gnu`.
Nenhum commit, push ou deploy foi realizado.

## Pular abertura — 27/10/2026

O botão **Pular abertura** agora usa marcações reais por episódio. O player já
aceitava `Playback.intro`, mas as fontes atuais não preenchiam esse campo. O novo
fallback consulta AniSkip somente depois de conhecer a duração real do vídeo,
pela rota `GET /api/streaming/episodes/:id/intro?duration=...`, separada da
resolução e da reprodução. O botão aparece apenas durante o intervalo e salta
para seu fim; conserva o estado de reprodução ou pausa.

A identidade AniList é convertida para MAL pelo campo exato `idMal` do AniList,
sem busca por título ou inferência de temporada. Para a abertura, o provider solicita `op`
ao [AniSkip](https://api.aniskip.com/api-docs). A API upstream aceita diferenças
de duração de até 20 segundos; o filtro local permite no máximo **dois segundos**,
recusa intervalos contraditórios ou fora do vídeo e não escala os tempos.
Faixas de abertura fornecidas diretamente por uma fonte continuam restritas à
fonte primária. Mudanças de fonte cancelam consultas pendentes e invalidam os
tempos anteriores.

A consulta tem timeout, limite de bytes, concorrência e cache. Ausência de dados,
incompatibilidade de edição ou falha externa deixam o vídeo funcionar sem o
botão. Não foi usada uma duração fixa estimada. Episódios fracionários, episódio
zero e IDs fora de Toko/Tatakai não usam esse fallback.

O botão tem posição estável no canto superior direito, alvo mínimo de 44px,
foco visível e suporte a teclado, celular e tela cheia. Não muda de lugar quando
os controles comuns reaparecem e fica oculto durante configurações ou mensagens
de erro. A reprodução começa sem esperar a consulta de abertura.

Verificações: **24 testes unitários afetados** em quatro arquivos, lint,
TypeScript e build aprovados; **oito cenários Playwright** em desktop e celular
aprovados. As fixtures de abertura usam vídeo público de teste e não comprovam
marcações de animes reais. Cobrem início/fim, clique e teclado, seek retroativo,
pausa, tela cheia, ausência e intervalos inválidos.

Em uma execução real separada, Conan 235 E01 teve duração de 1.496,506 segundos
e abertura cadastrada entre **0,625 e 104,875 segundos**. O botão foi usado em
desktop e celular, avançou para depois da abertura, desapareceu e manteve o
vídeo reproduzindo, sem erros, alertas ou overflow. Os trechos antes/depois
também foram inspecionados visualmente para confirmar a transição.

Amostras incompatíveis foram recusadas: Kimetsu E01 tinha diferença de 15,23s e
Hunter E01 de 5,71s em relação às durações cadastradas. O 207329 E01 não tinha
registro de abertura nesta consulta. O recurso depende da cobertura e qualidade
das marcações; não representa detecção automática da música ou de cenas.

As duas reproduções reais aprovadas estão em
[validation/2026-10-27-intro-playback.json](validation/2026-10-27-intro-playback.json).
O arquivo separa uma tentativa adicional de Kimetsu E02: a fonte de vídeo falhou
na verificação inicial e não chegou a consultar a abertura. Essa tentativa não
foi classificada como falha do botão nem como reprodução aprovada.

Capturas temporárias em `/tmp/hpmovies-intro-real-final/`. O projeto continua
local em `http://127.0.0.1:5173`. Não houve commit, push ou deploy nesta etapa.

## Próximo episódio durante o ending — 27/10/2026

O player agora mostra **Próximo episódio** durante um encerramento marcado e
também após o fim completo do vídeo. O botão usa a mesma posição e aparência de
**Pular abertura**. Ao clicar, a navegação abre o ID do próximo episódio emitido
pela fonte, mantém o anime e os aliases de busca, carrega a nova mídia e solicita
reprodução desde o início. A tela de preparação permanece visível enquanto o
episódio seguinte é resolvido. Se o navegador bloquear autoplay, continua valendo
a recuperação existente pelo botão de reprodução.

As marcações `ed` usam a mesma identidade AniList→MAL e tolerância de dois segundos
da abertura, pela rota `/api/streaming/episodes/:id/ending?duration=...`. Cache e
consultas em andamento distinguem `op` de `ed`, mantendo a identidade compartilhada.
Marcações nativas de `Playback.ending` ficam restritas à fonte primária, e mudanças
de fonte cancelam consultas anteriores. No último episódio disponível não há
botão ou consulta de encerramento desnecessária.

A transição exige clique. Sair do intervalo de ending não avança o episódio;
cenas posteriores continuam disponíveis. Sem marcação compatível, o botão ainda
pode aparecer quando o evento nativo `ended` confirma o fim do vídeo.

A intenção de iniciar o próximo do zero é consumida uma vez. Recarregar a página,
voltar pelo histórico ou tentar novamente uma fonte preserva a retomada salva,
sem repetir esse reinício. Há proteção contra cliques duplicados durante a troca.

Validação: **30 testes unitários afetados** em quatro arquivos; lint, TypeScript
e build aprovados. **22 cenários distintos de navegador** das suítes de abertura,
encerramento e recuperação de fontes foram aprovados em desktop/celular, com
reexecuções pontuais. Os contratos com fixtures verificam carregamento do episódio
seguinte, autoplay, aliases, teclado/tela cheia, retomada após reload, ausência
de navegação sem clique, pós-ending, evento `ended` e último episódio.

Separadamente, Conan E01→E02 passou em duas execuções reais, sem interceptação:
desktop e celular de 393px. O ED cadastrado é **1313,25–1405,125s**, compatível
com o vídeo de 1496,506s. O botão apareceu aos 1314s, abriu o E02 correto e o novo
vídeo começou do início com áudio e quadros decodificados em 1080p, sem erros,
alertas, requisições falhas ou overflow. O E01 contém cerca de 91s depois do ED;
esse trecho é preservado quando o usuário não solicita a troca.

Evidências numéricas sem URLs privadas ou tokens em
[validation/2026-10-27-ending-next-playback.json](validation/2026-10-27-ending-next-playback.json).
Capturas temporárias em `/tmp/hpmovies-ending-next-real/` e uma prévia móvel
completa em `/tmp/hpmovies-ending-next-mobile-preview/conan-mobile-before.png`.
O projeto segue em `http://127.0.0.1:5173`. Não houve commit, push ou deploy.

## Reinício local solicitado — 27/10/2026

Os quatro serviços foram encerrados e suas portas verificadas como inativas.
Em seguida, `npm run dev` iniciou novamente o frontend `:5173`, a API `:4000`,
o host de fontes `:8099` e o tradutor local `:5000`. Todos responderam HTTP 200
na checagem de disponibilidade; isso não representa uma nova auditoria de mídia.

Para o uso diário neste ambiente já configurado:

```bash
cd /home/arthu/Prog/HPmovies
npm run dev
```

Abrir `http://127.0.0.1:5173` e manter o terminal aberto. `Ctrl+C` encerra os
serviços; executar o mesmo comando novamente os reinicia. O modelo local já
está instalado, sem necessidade de repetir o setup a cada execução.
Não houve alteração funcional, commit, push ou deploy neste reinício.

## Viabilidade de hospedagem, Android e Fire TV — 28/10/2026

A pedido do usuário, foi feita auditoria de possibilidades sem alterar o
aplicativo. Resultado e fontes oficiais em
[DEPLOY-ANDROID-FIRE-TV-FEASIBILITY.md](DEPLOY-ANDROID-FIRE-TV-FEASIBILITY.md).

Hospedagem completa é viável, mas exige inicialização de produção do frontend,
API, host privado de fontes e tradutor quando habilitado. `npm start` inicia
somente a API. A recomendação inicial é uma VPS com proxy HTTPS e uma instância
da API, devido aos serviços restritos a loopback e tickets em memória. Revisar
rate limit atrás do proxy, provisionar os arquivos privados fora do Git e validar
fontes e transferência de mídia a partir do servidor escolhido.

Android pode reaproveitar o frontend via Capacitor/WebView; ainda não há projeto
nativo ou APK. Fire TV depende do sistema: Fire OS pode usar APK conforme versão
e WebView; Vega exige VPKG e wrapper próprio. Ambos precisam navegação completa
por controle e testes reais de mídia. Histórico e biblioteca continuam locais a
cada dispositivo.

O usuário confirmou Fire OS **6.7.1.1 (NS6711/5908)** e uso pessoal/familiar para
**8–10 pessoas no total**. O destino da TV é APK Fire OS; o sistema atende à API
mínima do Capacitor, mas falta medir o WebView. O Vite atual compila para Chrome
107 e equivalentes, sem polyfills automáticos de APIs modernas. Prever adaptação
do bundle conforme diagnóstico no aparelho, sem prometer compatibilidade pronta.

Simultaneidade ainda não foi informada. Referência inicial para avaliação: uma
VPS de 2 vCPU/4 GB RAM com uma API persistente e acesso restrito à família. Não é
capacidade medida. A 5 Mbps, dez sessões representariam 50 Mbps de saída; duas
horas por dia para dez pessoas representariam cerca de 1,35 TB em 30 dias, antes
de overhead. Dimensionar por medição e franquia de transferência. Distribuição
Android familiar também deve considerar o limite de aparelhos do caminho de
distribuição limitada documentado pelo Google. Nenhuma conta foi criada.

Verificação: 42 arquivos/436 testes unitários aprovados; lint e build aprovados.
O build mantém aviso do chunk do player acima de 500 kB. A API compilada foi
iniciada em produção local isolada, sem `.env` ou fontes externas: saúde e texto
original aprovados; raiz 404 confirmou ausência de servidor estático integrado.
Nenhuma reprodução real, carga, emulador, APK ou Fire TV foi validado nesta etapa.
Não houve instalação de ferramentas, alteração funcional, commit, push ou deploy.

## Primeira etapa recomendada — 28/10/2026

O usuário pediu uma recomendação para começar. A sequência recomendada é preparar
e validar a execução de produção local, criar um APK de teste para o Fire OS 6
informado e então escolher a hospedagem. O teste no Fire Stick deve ocorrer
antes da contratação, devido à versão ainda desconhecida do WebView.

A preparação proposta é servir o frontend compilado e `/api` pela mesma origem,
manter os serviços de fontes e tradução em loopback e coordenar seu início e
encerramento. Separar os artefatos públicos dos arquivos do backend e preservar
as rotas profundas do React Router. A inspeção confirmou que o `npm start`
atual continua iniciando somente a API. Nenhum launcher, servidor de produção,
Dockerfile ou projeto Android foi implementado nesta etapa; a aplicação e os
resultados dos testes registrados acima permanecem sem alterações.

## Hospedagem gratuita sem dependência do PC — 28/10/2026

O usuário definiu que todos os serviços deverão executar fora do computador
pessoal e pediu opções gratuitas. Testes locais continuam sendo uma etapa de
preparação; não representam a topologia de uso definitivo. A preferência atual
é pesquisar e escolher uma hospedagem gratuita antes de preparar sua implantação.

Fontes oficiais atuais foram consultadas e registradas no final de
[DEPLOY-ANDROID-FIRE-TV-FEASIBILITY.md](DEPLOY-ANDROID-FIRE-TV-FEASIBILITY.md).
Primeira candidata: Oracle Always Free, cuja documentação atual informa A1 ARM
com até 2 OCPU/12 GB RAM e 10 TB/mês de saída para a conta gratuita, sujeita a
cotas e disponibilidade regional. Cadastro exige verificação por cartão; VMs
ociosas podem ser retomadas. Não prometer os antigos 4 OCPU/24 GB.

Render/Koyeb gratuitos são candidatos a protótipos com suspensão e limitações.
Cloudflare Pages/Vercel gratuitos podem hospedar a interface; a arquitetura
atual ainda exige outro servidor para API, fontes e tradutor. Railway oferece
trial e crédito Free mensal pequeno; Google e2-micro tem franquia de saída
insuficiente para o cenário avaliado. Nenhum serviço foi contratado, conectado
ou publicado. Só documentação foi atualizada; não houve alteração funcional ou
nova execução de testes da aplicação.

## Produção compilada implementada e validada — 28/10/2026

O usuário priorizou concluir a preparação de produção e deixar a hospedagem para
depois. Essa é a etapa atual; a preferência de não depender do PC no uso futuro
continua válida para quando os serviços forem implantados na nuvem.

`npm run build` agora separa frontend em `dist/web` e backend em `dist/backend`.
`npm start` inicia o novo launcher de produção: site compilado e API Hono na
mesma origem, host privado de fontes e tradutor opcional instalado. Não inicia
Vite, não instala fontes ou modelos e não modifica o bundle privado. O servidor
recusa arquivos ocultos/privados, traversal e symlinks indevidos; entrega MIME
correto, HEAD, cache e fallback de rotas React, inclusive IDs com pontos.

O launcher verifica o build antes dos serviços, respeita o `.env` privado e
`DOTENV_CONFIG_PATH`, trata portas ocupadas e sinais durante o início, encerra
recursos próprios com prazo e preserva tradutor de outra execução. A API mantém
informações da conexão e headers de mídia. A validação de origem da tradução
passou a aceitar a própria origem de produção, preservando a rejeição de origens
externas fora da allowlist.

Verificações concluídas:

- 44 arquivos/454 testes unitários aprovados; lint e build final aprovados.
- 10 cenários Playwright em produção aprovados em desktop/celular: seis com
  fixtures de contratos, dois com texto original da API e dois com HLS externo
  de demonstração. Vite e fontes privadas não participam dessa suíte.
- Launcher compilado iniciado de fora da raiz do projeto, sem `.env` ou fontes:
  rotas profundas/decimais, API, WebVTT e bloqueio de arquivos privados aprovados.
  SIGTERM liberou as portas; ocupação da porta HTTP ou das fontes produziu erro
  explícito e limpeza correta dos serviços próprios.
- 24 arquivos públicos conferidos, sem arquivos ocultos/backend ou uma variável
  privada sentinela usada na compilação.
- Reprodução real de Detective Conan, E01, a partir da versão de produção:
  1080p, duração de 1.496,506 s, vídeo e áudio decodificados, seek, 350 cues PT-BR
  carregados e legenda visível, sem erros ou overflow. Cenas em 150, 700 e
  1.280 s foram inspecionadas e são compatíveis com o episódio. O idioma falado
  não foi auditado manualmente; a amostra não valida outros episódios.

O Chromium inicialmente não abriu por ausência de bibliotecas nativas no PATH
do loader. A validação foi concluída reutilizando as bibliotecas já existentes
em `/home/arthu/.cache/hpmovies-qa/libs/usr/lib/x86_64-linux-gnu` via
`LD_LIBRARY_PATH`, sem instalar pacotes do sistema. Permanece o aviso do chunk
do player acima de 500 kB; não impede o build.

Instruções em [PRODUCTION.md](PRODUCTION.md), evidência normalizada em
[validation/2026-10-28-production.json](validation/2026-10-28-production.json).
Capturas e resultados temporários em `/tmp/hpmovies-playback-1793191642224` e
`/tmp/hpmovies-production-content-review`, sem persistir URLs de mídia/tickets.

A execução final foi reiniciada com o build atualizado e está em
`http://127.0.0.1:4000`. Hospedagem, domínio/HTTPS, autenticação familiar, proxy
externo confiável, teste de carga e APK continuam pendentes. Não houve commit,
push ou deploy.

## Preferência atual: servidor doméstico e clientes na LAN — 28/10/2026

O usuário reconsiderou a hospedagem e propôs começar com uso individual,
mantendo o PC ligado com site, backend, fontes e tradução, e usando navegador
no computador e futuros APKs no celular e Fire Stick. Esse passa a ser o cenário
preferido de curto prazo; hospedagem na nuvem fica adiada.

A revisão confirmou que a produção atual atende à topologia após configurar
o bind do site/API para acesso pela rede doméstica. O padrão continua em
loopback; nenhuma configuração ou firewall foi alterado nesta conversa. Somente
site/API deve receber conexões dos aparelhos. Fontes e tradutor permanecem
privados em loopback. Reservar IP do PC, evitar suspensão durante uso e validar
primeiro no navegador do celular, depois no APK e controle do Fire Stick.

Na mesma LAN, o transporte de vídeo PC→aparelho usa a rede local; o cálculo
anterior de upload residencial para usuários remotos não se aplica a esse
trecho. Download das fontes e capacidade de Wi-Fi/Ethernet continuam relevantes.
Biblioteca e progresso permanecem locais a cada cliente; acesso fora de casa
e sincronização não estão configurados. APK ainda não foi criado, e o WebView
do Fire OS 6 continua exigindo medição e teste no aparelho.

Foi feita somente revisão de código e documentação das possibilidades. Não houve
alteração funcional, exposição de serviço na LAN, novo teste de dispositivo,
mudança de energia do PC, instalação, commit, push ou deploy.
