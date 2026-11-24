# Conteúdo adulto (18+)

Seção opcional com títulos `isAdult` do AniList (hentai) e reprodução pelas
fontes conectadas. Fica desligada por padrão em dois níveis:

1. **Servidor**: `ADULT_CONTENT_ENABLED=true` no `.env` do backend. Sem isso, as
   rotas `/api/adult/*` respondem 404 (exceto `/api/adult/status`).
2. **Navegador**: em Configurações › Sua experiência, “Mostrar conteúdo adulto
   (18+)” pede a confirmação de idade. A escolha fica em
   `hpmovies.adult-mode.v1` no `localStorage`. O frontend envia
   `X-HPMovies-Adult: 18+` somente com o modo ativo; sem esse cabeçalho, o
   backend responde 403.

Com o modo ativo, o menu mostra “Conteúdo adulto” (`/adult`). As páginas
adultas são carregadas sob demanda. Títulos adultos não entram no histórico,
em Continuar assistindo nem em Minha lista. As respostas usam
`Cache-Control: private, no-store`.

## Rotas

| Rota | Função |
| --- | --- |
| `GET /api/adult/status` | `{ enabled }` do servidor, sem cabeçalho |
| `GET /api/adult/catalog/home` | Em alta, populares, recentes e mais bem avaliados |
| `GET /api/adult/catalog/search?search=&tag=&sort=&page=` | Busca; `sort`: popular, score, trending, newest |
| `GET /api/adult/catalog/tags` | Tags adultas do AniList permitidas |
| `GET /api/adult/catalog/anime/:id` | Detalhes, relacionados e recomendações adultas |
| `GET /api/adult/anime/:id/episodes` | Índice das fontes, ou contagem do AniList como alternativa |
| `GET /api/adult/anime/:id/episodes/:n[?refresh=1]` | Reprodução do episódio `n` |
| `GET /api/adult/sources` | Diagnóstico da hentai-api, Tatakai e Toko |

## Filtro de proteção a menores

Obras que retratam menores são sempre bloqueadas, com o modo adulto ativo ou
não. O filtro não é configurável e usa só sinais fortes
(`src/aniwatch-apis/src/providers/adult-safety.ts`):

- Tags do AniList: Primarily Child Cast, Primarily Teen Cast, Kids, Age
  Regression, School, School Club e Boarding School. O AniList também as exclui
  na consulta (`tag_not_in`), e cada resultado é conferido de novo.
- Idade de personagem informada no AniList abaixo de 18.
- Tags da hentai-api: loli, shota, school girl e similares, por nome exato.
- Termos explícitos no título, sinônimos ou sinopse: loli, shota, high school,
  middle school, teen, “body of a child”, JK etc. “child” e “kids” isolados não
  bloqueiam (“quer ter filhos”, “desde crianças”).
- Sem lista de tags legível, o título fica de fora.

Sinais fracos foram retirados porque bloqueavam títulos só com adultos: Age
Gap, Flat Chest, Coming of Age, a tag de público Teens' Love, a demografia
Shoujo e “young” genérico. Amostra de 528 títulos adultos do AniList em
24/11/2026: 185 bloqueados (35%), principalmente por School (95) e Primarily
Teen Cast (42).

## Fontes de vídeo

O catálogo vem do AniList. Cada pedido carrega antes o título pelo catálogo
adulto, que aplica o filtro, e então consulta em paralelo:

- **Fontes de anime existentes** (Tatakai/Toko com as extensões locais), pelo
  ID do AniList e por até cinco títulos (limite do Toko HTTP).
- **Sites de streaming** (`ADULT_SITES`), lidos pelo próprio HPmovies. Detalhes
  abaixo.
- **hentai-api** (opcional), em `HENTAI_API_URL`. O HPmovies só consome o HTTP
  da sua instância; o código dela não é copiado. As URLs de vídeo passam pelo
  gateway de mídia com `HENTAI_API_CONTENT_AUTHORIZED=true` e os domínios em
  `HENTAI_API_ALLOWED_STREAM_DOMAINS` / `HENTAI_API_ALLOWED_MEDIA_HOSTS`.
  `HENTAI_API_KEY` vai em `x-api-key` (sem chave, a API limita a 15 pedidos por
  minuto).

### Sites de streaming (animeshentai, assistirhentai, muitohentai)

Nenhum dos três tem API. Todos embutem o player do Blogger, e o provedor
(`src/aniwatch-apis/src/providers/adult-sites.ts`) lê só páginas públicas:

| Site | Busca | Obra | Episódio | Player |
| --- | --- | --- | --- | --- |
| animeshentai.biz | `/search/<título>` | `/hentai/<slug>/` | `/episodio/<slug>-episodio-N/` | Blogger direto (aba "HD") |
| assistirhentai.com | `/?s=<título>` (já lista episódios) | — | `/episodio/<slug>-episodio-NN/` | Blogger direto ou player próprio com MP4 720p |
| muitohentai.com | `/buscar/<título+com+mais>/` | `/info/<slug>/` | `/episodios/<slug>-episodio-N/` | `hentaitube.online` → Blogger, ou só `/players/p2/` |

- O slug é o título romaji do AniList em kebab-case, e a correspondência é
  exata.
- Os gêneros da obra (bloco `.sgeneros`) passam pelo filtro: Lolicon,
  Shotacon, Vida Escolar etc. bloqueiam. O assistirhentai não lista gêneros, e
  nesse caso vale o filtro do AniList.
- A página do Blogger oferece MP4 progressivos (vídeo e áudio no mesmo
  arquivo): itag 18 (**360p**) sempre, e itag 22 (**720p**) quando o envio é HD
  (itag 37, 1080p, também é aceito). Os links vêm assinados, presos ao IPv4 de
  quem pediu e valem por cerca de 8 horas. As páginas são lidas por IPv4, a
  mesma família do gateway. O player mostra o 720p primeiro e o 360p como
  reserva. Os formatos adaptativos (SABR do YouTube, que exige PoToken) e os
  só de vídeo não são usados. Atenção: a primeira análise, num vídeo sem
  versão HD, concluiu que o Blogger só tinha 360p. Isso estava errado para
  envios HD.
- **720p:** alguns episódios do assistirhentai usam um player video.js
  próprio, com MP4 em `videos.assistirhentai.com/pubfolder/hentai/<Título>/epNN.mp4`.
  Esse servidor responde sem Referer. Antes de oferecer o arquivo, o HPmovies
  lê os primeiros 256 KB para confirmar o `ftyp` e a altura do vídeo no
  `tkhd`. Essa fonte aparece primeiro, seguida dos espelhos de 360p. O nome do
  arquivo nem sempre bate com o episódio: o episódio 04 de Hitozukiai aponta
  para `ep01.mp4`, mas a duração (416,363 s) é a do episódio 4 no Blogger
  (416,380 s), e não a do 1 (461,589 s). Por isso vale o link da página, e não
  o nome do arquivo. Só são aceitos arquivos em `*.assistirhentai.com`.
- O "HD" do animeshentai é o player do Blogger. O 720p dele vem do itag 22
  quando o envio é HD, e o mesmo vale para o assistirhentai e para o
  muitohentai (via `hentaitube.online`).
- O player `/players/p2/` do muitohentai (`baixarhentais.com`) recusa
  conexões sem o Referer do site. Ele não é usado, porque forjar o Referer
  contornaria a proteção. Nos episódios que só têm esse player, o muitohentai
  não oferece fonte.
- Nenhum login, captcha ou desafio do Cloudflare é tocado. O Turnstile do
  assistirhentai pertence ao sistema de membros e não protege o player.
- Configuração: `ADULT_SITES=animeshentai,assistirhentai,muitohentai`,
  `ADULT_SITES_CONTENT_AUTHORIZED=true` e
  `ADULT_SITES_ALLOWED_STREAM_DOMAINS=googlevideo.com,assistirhentai.com`.
  Sem `assistirhentai.com`, só os espelhos de 360p aparecem. Cada arquivo
  encontrado vira uma fonte no player, da maior para a menor qualidade.

Teste real em 24/11/2026 com AniList 212667 (Hitozukiai ga Nigate na Miboujin
no Yukionna-san to Noroi no Yubiwa): 7 episódios listados.
- **Episódio 1:** 3 fontes de 360p, uma por site.
- **Episódio 4:** "Assistir Hentai · 720p · servidor do site" (1280×720 no
  `tkhd`, 59 MB) e "AnimesHentai · 360p".

O gateway entregou `206 video/mp4` no início, no meio e perto do fim dos
arquivos.

Depois do suporte ao itag 22, também em 24/11/2026:
- **212667, episódios 1 e 6:** 720p e 360p de AnimesHentai, Assistir Hentai e
  Muito Hentai.
- **173489 (Yoasobi Gurashi!), episódio 1:** 720p e 360p de AnimesHentai e
  Muito Hentai. O assistirhentai não tem esse título.

O 720p pelo gateway tem 1280×720 no `tkhd`.

### Estado da hentai-api em 24/11/2026

A versão publicada (commit `fb172ed`, jan/2025) não fornece vídeo hoje:

- `search.htv-services.com`, usado na busca do HAnime, não resolve mais no DNS.
  O hanime.tv agora usa Turnstile e token CSRF. O HPmovies não contorna essas
  proteções.
- `hentaihaven.xxx` responde 403.
- Os schemas zod dela não batem com os próprios dados. A busca do HAnime valida
  uma página com o schema de um item. A busca e os detalhes do HentaiHaven
  exigem string onde recebem DateTime. As fontes do HentaiHaven validam
  `{ sources }` como uma única fonte. Essas rotas respondem 422.
- Ela exige Bun e Redis. O Dockerfile termina em `node:20` executando
  `bun run start`.

O cliente aceita as duas formas de resposta (lista ou `{ results }`,
`{ sources }` ou lista) e deriva o slug do HAnime pelo título, pois a busca não
valida. Com uma versão corrigida da API, a integração funciona sem mudanças no
HPmovies. O erro 422 aparece como `HENTAI_API_SCHEMA_ERROR`.

## Limitações conhecidas

- Filmes e séries live-action adultos não têm catálogo: o Cinemeta não inclui
  títulos adultos, e os addons Stremio são consultados por IMDb.
- Mangás e novels adultos continuam filtrados nos provedores de leitura.
- As rotas gerais de reprodução por ID do AniList (`/api/content/anime/...`)
  não verificam `isAdult`. Elas só devolvem vídeo quando uma fonte configurada
  tem o título.
