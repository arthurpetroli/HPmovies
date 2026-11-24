# Direção visual do HPmovies

Este documento descreve o sistema visual vigente e o histórico das decisões.
A seção "Redesign de 23/11/2026" substitui as direções anteriores (Crunchyroll,
27/10, e Miruro, 28/10), que ficam registradas ao final apenas como contexto.

## Redesign de 23/11/2026

### Por que mudou

A interface anterior foi avaliada como "brusca, pouco moderna e pouco sofisticada".
O diagnóstico, feito com capturas reais do aplicativo, apontou causas concretas:

- A fonte Inter era declarada, mas nunca carregada. Sem ela instalada, o navegador
  caía para DejaVu/Segoe, o que deixava títulos pesados e largos.
- Superfícies chapadas, cantos de 2–6 px, contornos duros e muito texto entre
  8 e 12 px.
- No celular, o menu lateral de 48 px ocupava a tela inteira e o destaque virava
  uma faixa de 140 px de altura.
- Cores fixas espalhadas por 14 arquivos de CSS e por classes Tailwind inline.

### Direção: noite de cinema

O catálogo é feito de arte colorida; a interface é o palco escuro que a ilumina.

- **Tinta, não cinza.** O fundo é um azul-noite (`--ink-1` `#080b11`) em camadas
  (`--ink-2` a `--ink-5`), com uma luz fria quase imperceptível no `body`.
- **A arte como luz.** Na página inicial a arte do destaque atual vira um brilho
  ambiente desfocado (`.home-ambient`) que tinge o início da página. Nos detalhes
  e no player, o mesmo recurso já existia e continua respeitando a preferência
  "Fundo com arte do anime" em Configurações.
- **Verde-menta como sinal.** `--accent` `#58e0bc` marca ação e estado ativo.
  Âmbar (`--warm` `#ffc762`) é reservado às notas, para a nota não competir com
  as ações.
- **Uma ousadia só.** O destaque da página inicial é o elemento memorável:
  arte nítida limitada à resolução real, título em fonte de exibição, seletor
  com os pôsteres dos cinco destaques e brilho ambiente. O restante é contido.

### Tokens (`src/index.css`, bloco `:root`)

| Grupo | Tokens |
| --- | --- |
| Tinta | `--ink-0` … `--ink-5` |
| Linhas | `--line`, `--line-2`, `--line-3` (brancos com 7%, 12% e 22%) |
| Texto | `--text` `#f3f6f9`, `--text-2` `#b8c1cd`, `--text-3` `#8b95a5` |
| Acento | `--accent`, `--accent-2`, `--accent-ink`, `--accent-wash`, `--accent-line` |
| Raios | `--r-xs` 6, `--r-sm` 10, `--r-md` 14, `--r-lg` 20, `--r-xl` 28 px; pílula `999px` |
| Movimento | `--ease` `cubic-bezier(.22, 1, .36, 1)` |

Os raios variam por função: pôsteres e cartões 14–20 px, botões 14 px, campos
de busca e chips em pílula, painéis grandes 28 px. Os nomes antigos
(`--background`, `--surface`, `--muted`, `--border`…) continuam existindo como
apelidos dos novos valores. Contrastes WCAG calculados para os pares dos tokens:
`text-3` fica entre 5,2:1 (sobre `ink-4`) e 6,5:1 (sobre `ink-1`); `text-2` acima
de 8,5:1; `text` acima de 14:1; `accent` acima de 9:1 sobre qualquer tinta, e o
texto escuro dos botões sobre o verde fica acima de 9:1.

### Tipografia

Duas famílias variáveis, auto-hospedadas pelos pacotes `@fontsource-variable`
(licença OFL, carregadas por `src/main.tsx`; funcionam offline e sem pedidos a
terceiros):

- **Bricolage Grotesque** (com eixo de tamanho óptico) para títulos: destaque,
  seções, páginas, nome da marca e numerais do ranking.
- **Inter** para interface e texto corrido.

O Tailwind aponta `font-sans` e `font-display` para as mesmas famílias, e as
paletas `teal-*` e `slate-*` foram mapeadas para os tokens, de modo que as classes
inline antigas seguem a marca. O texto mínimo é 12 px; o corpo usa 14–16 px.

### Navegação

- **Desktop:** dock de vidro flutuante à esquerda (64 px, 232 px quando expandida,
  conforme "Menu lateral expandido"). O item ativo ganha fundo menta e um marcador
  luminoso. Dicas de ferramenta aparecem em foco e hover. A busca é uma pílula de
  vidro no topo, com atalho `/`, que ganha uma faixa de vidro após rolar.
- **Celular (≤ 900 px):** barra inferior com Início, Explorar, Buscar, Minha lista
  e Menu. "Menu" abre uma gaveta com todos os destinos, Fontes e Configurações.
  Escape, a cortina e os links fecham a gaveta; com um diálogo aberto, Escape
  fecha apenas o diálogo. O cabeçalho mostra a marca e a busca.

### Destaque, cartões e fileiras

- O destaque mostra a arte nítida no máximo a 1,5× da resolução real do banner;
  se faltar banner, usa o pôster. Os cinco pôsteres funcionam como seletor
  (rótulos `Destaque N`, `aria-current`). No celular viram barras e é possível
  deslizar para trocar. Não há troca automática: o movimento é sempre iniciado
  pela pessoa.
- Cada cartão continua sendo um único link. A prévia (mouse, foco por teclado ou
  botão de toque; Escape fecha) agora cobre só o pôster, como vidro, mantendo o
  título e os metadados visíveis. O botão de ação se adapta à largura do cartão
  por container query: ícone e texto, só texto ou só ícone.
- As fileiras têm esmaecimento nas bordas quando há mais itens e setas para quem
  usa mouse. A trilha de gêneros usa uma arte diferente por gênero.

### Movimento e acessibilidade

- Um único momento orquestrado: a entrada do destaque (arte, título, metadados,
  botões em cascata de ~60 ms). As demais animações respondem a ações: elevar o
  cartão, abrir a prévia, expandir o menu.
- `prefers-reduced-motion` zera animações e transições.
- Foco visível em todos os controles, alvos de 44 px em controles principais,
  textos secundários acima de 4,5:1.
- `backdrop-filter` aparece na dock, na busca, nos chips e botões do destaque,
  na prévia dos cartões e em painéis; os cartões em repouso usam apenas sombras
  e anéis simples.

### Onde alterar

| Quero mudar… | Arquivo |
| --- | --- |
| Cores, raios, fontes, botões, campos, estados | `src/index.css` |
| Dock, barra inferior, gaveta, busca flutuante, configurações | `src/frontend/components/navigation/navigationRail.css` |
| Destaque | `src/frontend/components/anime/animeHero.css` |
| Cartões e prévia | `src/frontend/components/anime/AnimeCard.css` |
| Início (abas, gêneros, destaque editorial, atalhos de leitura) | `src/frontend/discover.css` |
| Detalhes do anime e episódios | `animeDetails.css`, `components/anime/animeEpisodes.css` |
| Player e lista de episódios | `watch.css`, `components/player/*.css` |
| Agenda, mangás, light novels | `schedule.css`, `manga.css`, `pages/novel.css` |

Para páginas novas, use `.field-control` (campos), `.surface-card` (painéis),
`.button-primary|secondary|ghost` e os tokens; evite cores fixas.

### Limites conhecidos

- Os recursos CSS novos (container queries, `:has()`, máscaras com composição)
  degradam sem quebrar em WebViews antigos; o desempenho de `backdrop-filter` e
  de desfoque grande em um Fire Stick não foi medido. A preferência "Fundo com
  arte do anime" remove o brilho ambiente.
- As capturas de verificação desta etapa usam o catálogo real do AniList e do
  Cinemeta; a reprodução de vídeo real não foi reavaliada porque o redesign não
  alterou fontes, legendas nem o fluxo do player.

## Histórico das direções anteriores

### Descoberta (27/10/2026)

Referência: [descoberta do Crunchyroll](https://www.crunchyroll.com/pt-br/discover).
A página redirecionou para o início e a inspeção recebeu HTTP 403 com desafio
Cloudflare, então a composição foi aproximada, sem comparação visual direta.
Decisões que permanecem: cada card tem um único link, a prévia funciona por
mouse, teclado e toque, as imagens usam as resoluções reais do AniList e não se
promete qualidade HD, e o carrossel da lista salva fica depois das demais
fileiras para não deslocar o card em uso.

### Miruro (28/10/2026)

O usuário ampliou a referência para o fluxo do Miruro. Decisões que permanecem:
cards, destaque e resultados rápidos abrem o player diretamente (com fade nativo
quando disponível); "Ver anime" e o nome abaixo do vídeo acessam os detalhes;
player e lista de episódios compartilham uma estrutura estável; miniaturas reais
do índice são preservadas, com a imagem do anime como alternativa; a agenda
organiza a semana de segunda a domingo com fusos São Paulo, Tóquio e UTC e não
comprova mídia, legenda ou dublagem; presets de legenda 16/20/24 px no celular
e 24/30/36 px no desktop.

Superado em 23/11/2026: a barra superior e a lateral transparente de 56 px, o
verde sobre cinza neutro com cantos de 2–6 px e o rail fixo no celular.

Evidências de referência e verificações reais estão em `docs/validation/`.
Capturas de QA ficam em `/tmp`, sem URLs privadas de mídia persistidas.
