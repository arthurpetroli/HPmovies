# Estado de desenvolvimento — 27/10/2026

Execução local em `http://127.0.0.1:5173`, API em `:4000` e host de fontes em
`:8099`, iniciados por `npm run dev`. Branch integrada: `main`.

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
