# Direção visual do HPmovies

Referência inicial: [descoberta do Crunchyroll](https://www.crunchyroll.com/pt-br/discover).
A página redirecionou para o início e a inspeção no navegador recebeu HTTP 403
com desafio Cloudflare. A implementação aproxima a composição de streaming;
não foi possível fazer uma comparação visual direta da página atual.

## Identidade e composição

- Fundo `#0b0d0f`, superfícies `#171a1e`, navegação `#23252b`, texto `#f1f3f5`,
  secundário `#a4a8af` e acento existente `#58e0bc`.
- Família existente: Inter, quando disponível, com alternativas do sistema.
  Títulos fortes, texto à esquerda e metadados legíveis também no celular.
- Navegação fixa de 64px; destaque com arte horizontal, gradiente de leitura,
  informações reais e controles manuais; fileiras de seis pôsteres no desktop.
  No celular, arte acima do texto e fileiras com rolagem por toque.
- Arte do catálogo como elemento principal. Poucos contornos, cantos discretos,
  seções editoriais e gêneros ilustrados com imagens dos próprios títulos.

O sistema sugerido pela skill UI/UX foi revisado contra o briefing: preservamos
o verde do HPmovies e a organização de catálogo, em vez da paleta índigo e da
estrutura promocional genérica sugeridas pela busca.

## Interações e imagens

Cada card contém um único link para o anime. A capa, o texto, a sinopse e o espaço
livre da prévia fazem parte desse link. Salvar e abrir/fechar a prévia são botões
independentes, sem controles interativos dentro do link. A prévia funciona com
mouse, foco por teclado e botão de toque; Escape fecha e devolve o foco ao controle.

As imagens usam os pôsteres `extraLarge` e banners já entregues pelo AniList.
Não foram criadas resoluções artificiais nem prometida qualidade HD. O destaque
limita a ampliação do banner conforme suas dimensões reais e usa a capa quando
o banner falha. Notas e sinopses vêm do catálogo; o idioma da descrição depende
da fonte. Botões e foco permanecem visíveis, e movimento reduzido é respeitado.

O carrossel da lista salva fica depois das demais fileiras para que a primeira
adição não desloque o card que a pessoa está usando.

## Atualização Miruro — 28/10/2026

O usuário ampliou a referência para o fluxo e a interface do Miruro. A gravação
local e o site em um navegador Chromium foram inspecionados. A página textual
não expunha a SPA; no navegador, a origem oficial respondeu e permitiu conferir
cards, player, detalhes, menu, configurações e agenda. A identidade HPmovies,
Inter, o verde `#58e0bc` e os catálogos existentes foram preservados.

- Cards, destaque e resultados rápidos abrem o player diretamente, com fade
  nativo quando disponível. “Ver anime” e o nome abaixo do vídeo acessam os
  detalhes. Links preservam teclado, nova aba e movimento reduzido.
- A barra superior foi removida. Busca flutuante compacta, com campo visual de 36px e fundo externo
  transparente no topo; após rolar, uma faixa de 50px com desfoque dá contraste.
  Navegação lateral transparente, apenas ícones no modo compacto, seta para expandir os nomes.
  O destaque usa a arte até o topo e atrás da lateral. No celular, os controles
  mantêm alvos acessíveis e o menu expandido sobrepõe o conteúdo.
- Player e lista de episódios compartilham uma estrutura estável. A arte fica
  visível enquanto as fontes são resolvidas; erro e retry mantêm a navegação.
  Fullscreen, progresso e preferências continuam entre trocas. O índice completo
  já não bloqueia a mídia. Preparação por intenção e perto do término reduz
  trabalho no momento do clique, sem prometer latência fixa dos providers.
- Miniaturas reais do índice são preservadas. Quando faltam ou falham, a imagem
  do anime serve de fallback; a interface não gera uma cena inexistente.
- Detalhes incluem arte ambiente, capa, ações, sinopse, metadados, trailer,
  personagens, episódios e relacionados. Dados opcionais não viram valores
  inventados. Estúdios, popularidade, datas e trailer vêm do AniList.
- A agenda organiza a semana de segunda a domingo, com contagens, dias,
  manhã/tarde/noite, busca, filtros e fusos São Paulo, Tóquio e UTC. A estreia
  mantém seu número ao abrir o player. Os horários são da exibição original;
  não comprovam mídia, legenda ou dublagem disponível.
- Legendas: no refinamento mais recente, média usa a antiga pequena; grande usa
  a antiga média; pequena recebe um tamanho menor. Presets normais: 16/20/24 px
  no celular e 24/30/36 px no desktop.
  Fullscreen escala com a largura do player. Diálogos excepcionalmente longos
  se ajustam ao espaço do vídeo para permanecer visíveis em telas estreitas.

Evidências de referência e verificações reais estão em `docs/validation/`.
Capturas de QA ficam em `/tmp`, sem URLs privadas de mídia persistidas.
