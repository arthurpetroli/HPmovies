> Atualização V2 — 21/10/2026: o relatório da implementação atual, incluindo indisponibilidade externa, 148 testes e validação de navegador, está em [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md). O conteúdo abaixo preserva o histórico da rodada de 13/10/2026 e não comprova a disponibilidade atual das APIs.

# Auditoria e primeira rodada local — 13/10/2026

## Diagnóstico da base

O fluxo anterior era React → serviço Axios Aniwatch → proxy Vite apontando ao Koyeb → rotas Hono → scraper HiAnime. O player encaminhava manifestos, segmentos e legendas por um proxy aberto. Foram inspecionados as páginas de início, busca, detalhes, categorias, gêneros e reprodução; os componentes de navegação, filtros, cards, carrossel, hero, UI e player; os serviços, hooks, configurações, cache e rotas.

A base React/TypeScript, Router, Tailwind/Lucide, Hono e HLS.js foi preservada. Os limites dos componentes de cards, hero, carrossel, busca e navegação continuam reconhecíveis; o elemento de vídeo e HLS.js continuam no player. `Home` e `Navbar`, que duplicavam as implementações reais e continham placeholders, agora delegam aos componentes canônicos.

Problemas confirmados e corrigidos:

| Problema | Resultado |
| --- | --- |
| Backend remoto fixo no desenvolvimento | `/api` encaminha à API local; execução conjunta com `npm run dev`. |
| `VITE_API_URL` versus `VITE_API_BASE_URL` | Cliente atual centralizado em `VITE_API_BASE_URL`; documentação alinhada. |
| Chave global de cache e TTL em milissegundos usado como segundos | Chaves por rota, parâmetros/provedor; TTL em segundos; limites de memória e concorrência, deduplicação e Redis opcional. |
| Proxy aceitava qualquer URL e cabeçalhos de terceiros | Endpoint responde 410 sem requisição externa; fontes autorizadas carregadas diretamente. |
| Home requisitava os mesmos dados em dois efeitos | Um fluxo de carregamento por página; cliente deduplica consultas simultâneas. |
| Respostas incompatíveis e muitos `any` no fluxo principal | Contratos tipados e validação explícita entre catálogo, reprodução e frontend. |
| Build não verificava TypeScript do frontend | `build` inclui frontend, configuração Vite e backend. |
| Imports quebrados e componentes incompletos de filtros | Filtros funcionais e páginas canônicas usando os mesmos contratos. |
| Vitest 2 incompatível com transformações do Vite experimental existente | Vitest 3.2.7 compatível, sem substituir a stack; lockfile sincronizado. |
| Pular abertura usava tempos fixos | Somente metadados válidos de abertura habilitam a ação. |
| Legendas tratadas por parser manual e idioma presumido | WebVTT nativo; preferência por código PT-BR explícito; seleção/desativação e aparência. |
| Falhas, buffering, progresso e retomada frágeis | Controles por eventos reais; recuperação limitada; progresso por episódio em pausa, troca de fonte e saída. |
| HLS desativava a faixa WebVTT externa durante a inicialização | A legenda normalizada pelo provedor permanece ativa no carregamento do HLS. |
| Elemento de vídeo perdia seus metadados durante a saída da página | O progresso mantém um último registro válido e é salvo durante a desmontagem. |
| Camada de controles interceptava os botões de avanço no mobile | Ordem visual corrigida e avanço/retorno por toque validados. |

## Novo fluxo

React → cliente HTTP único → API Hono local → `AnimeCatalogProvider` (AniList) ou `AnimeStreamingProvider` (vídeo autorizado). Os contratos compartilhados ficam em `src/shared/providers.ts`. Detalhes de catálogo, quantidade de episódios e relações não são usados como prova de disponibilidade de vídeo, áudio ou legendas.

Foram implementados início cinematográfico com destaques e seções reais; exploração com sugestões, gênero, ano, formato, status, ordem e paginação; detalhes com relações e recomendações; biblioteca com lista, favoritos e histórico; navegação desktop/mobile; rodapé, skeletons e estados de erro/vazio. O player usa resoluções efetivamente presentes no manifesto, velocidade, volume, atalhos, legendas e retomada. Resoluções não são prometidas quando a fonte não as contém.

As principais mudanças abrangem `src/App.tsx`, `src/index.css`, páginas e componentes de `src/frontend`, serviços HTTP/catálogo/reprodução/biblioteca, `src/shared/providers.ts`, app/server/cache/provedores do backend, configuração Vite/TypeScript/scripts, assets locais de marca/legenda e testes em `tests/`. `git diff --stat` e `git status --short` mostram a relação completa.

## Integrações verificadas

- AniList: POST GraphQL real e rotas locais de home e detalhes retornaram 200; cinco seções com 12 títulos cada. Detalhes de Cowboy Bebop retornaram relações, recomendações e links.
- Busca real por Frieren, filtros combinados `Action + TV + 2024 + score` e `RELEASING + trending + página 2` retornaram resultados reais. Foi descoberta e corrigida a rejeição do AniList a comparações opcionais enviadas como `null`; variáveis ausentes são omitidas.
- HiAnime: teste sem contorno do domínio antigo expirou em 15 segundos; o `getHomePage` da biblioteca efetivamente instalada falhou em aproximadamente 8 segundos, com erro 500. A integração permanece desativada por padrão e não alimenta a interface nova.
- Demonstração: manifesto HLS Mux/video-dev retornou 200; MP4 oficial em `video.blender.org` retornou 206 e autorização CORS. As durações diferem entre as edições; o player usa os metadados do arquivo, sem inventar duração fixa.
- As referências de interface foram consultadas: Anime Nexus respondeu 403 e Crunchyroll redirecionou sem conteúdo utilizável. A organização seguiu o briefing fornecido, com identidade HPmovies própria, sem contornar restrições de acesso.

Fontes primárias: [AniList GraphQL](https://docs.anilist.co/guide/graphql/), [consultas AniList](https://docs.anilist.co/reference/query), [licença Big Buck Bunny](https://peach.blender.org/about/), [streams de teste Mux](https://test-streams.mux.dev/) e [vídeo oficial Blender](https://video.blender.org/videos/watch/bf1f3fb5-b119-4f9f-9930-8e20e892b898).

## Resultado das verificações

- `npm run build`: TypeScript e builds do frontend/backend aprovados. O player é carregado sob demanda para manter HLS.js fora do carregamento inicial do catálogo.
- `npm test`: 49 testes aprovados, em seis arquivos.
- ESLint dos arquivos novos/modificados do fluxo principal e `git diff --check`: aprovados.
- Navegador: fluxos reais desktop (1440 px) e mobile (390 px), busca, filtros combinados, navegação, detalhes, salvar/remover lista, favoritos e persistência aprovados; sem erros JavaScript ou requisições falhas nos fluxos testados.
- Mobile: detalhes sem overflow, cinco sugestões reais, seleção por teclado, estado vazio e recuperação após erro de API aprovados. O diálogo de filtros recebeu nomes acessíveis explícitos e mantém os filtros editados até a aplicação.
- Rotas locais: health e catálogo 200; filtro inválido 400; proxy arbitrário 410; anime sem fonte retorna `available: false` com episódios vazios, sem confundir metadados com vídeo.
- Reprodução real no Chrome: HLS e MP4 avançaram; guia PT-BR sincronizado, qualidades do manifesto (incluindo 1080p), seleção manual de 720p, velocidade, volume/mute, tela cheia e avanço/retorno funcionaram. A saída da página salvou 28 segundos; a nova visita retomou 28 segundos e a troca para MP4 preservou essa posição; recarregar a página retomou 45 segundos. O navegador temporário Chromium não tinha os codecs H.264/AAC, por isso a validação de reprodução foi feita no Chrome oficial, sem alterações nos pacotes do sistema.
- Player mobile em 390 px: configurações, velocidade de 1,25×, desativar/ativar legendas, cue PT-BR e botões de avanço/retorno por toque aprovados; sem overflow ou erros JavaScript.

## Limites e próximos passos

Episódios completos de anime, áudio e legendas PT-BR reais dependem de um provedor autorizado. A faixa PT-BR da demonstração é um guia original, explicitamente identificado. Não foram adicionados dados falsos, credenciais, contorno de autenticação, infraestrutura de publicação, contas ou banco de dados.

Prioridade seguinte: conectar um provedor autorizado pelo contrato existente; validar seus episódios, expiração das URLs, áudio, legendas e resoluções; então ampliar testes de reprodução nos dispositivos usados pelo proprietário. Autenticação, banco e publicação ficam para uma etapa futura.

## Reteste solicitado do Aniwatch

O reteste incluiu uma API Hono local com as rotas legadas habilitadas, biblioteca instalada, consultas diretas do terminal, episódios/servidores históricos e comparação isolada com Aniwatch 2.27.9. Nenhuma das versões forneceu um catálogo funcional. Foi adicionado o comando `npm run diagnose:aniwatch`, e falhas do provedor passaram a ter mensagem específica. Resultados e reprodução dos testes: [ANIWATCH_STATUS.md](ANIWATCH_STATUS.md).
