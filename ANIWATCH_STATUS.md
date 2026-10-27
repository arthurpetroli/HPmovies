# Reteste Aniwatch local — 13/10/2026

A integração foi testada diretamente pelo terminal e em uma instância Hono local com `ENABLE_LEGACY_HIANIME=true`. **Não foi obtido catálogo nem episódio reproduzível.** Nenhuma fonte foi conectada ao player como se funcionasse.

## Resultado observado

| Teste | Resultado |
| --- | --- |
| Hono local, porta 4001, `/health` | HTTP 200, `legacyEnabled: true`. |
| Hono local, `/api/v2/hianime/home` | Falha do scraper após aproximadamente 8,2 segundos. |
| Hono local, episódios de `steinsgate-3` | Falha do scraper após aproximadamente 8,2 segundos. |
| Hono local, servidores de `steinsgate-3?ep=230` | Falha do scraper após aproximadamente 8,2 segundos. |
| Aniwatch instalado 2.24.3, `getHomePage()` / `search('Frieren', 1)` | Ambos expiram em aproximadamente 8 segundos, com erro 500 encapsulado pela biblioteca. |
| Origem `hianimez.to/home` | HTTP 301 para `hianime.to/home`. |
| Origem `hianime.to/home`, GET direto IPv4 | DNS resolvido; conexão TCP e TLS em aproximadamente 36 ms; nenhuma resposta HTTP em 12 segundos. |
| Aniwatch 2.27.9, testado isoladamente em `/tmp` | `getHomePage()` e pesquisa retornam erro 404. Seu domínio padrão `aniwatchtv.to` redireciona para um site sem relação com o catálogo esperado. |

Os identificadores Steins;Gate acima foram retirados dos testes já existentes no repositório. Seu uso no diagnóstico não significa que continuam válidos na origem atual. Nenhuma lista de episódios, servidor ou URL de vídeo atual foi retornada.

A nova versão foi identificada pelo registro oficial npm (`npm view aniwatch version`) e instalada somente em uma pasta temporária para comparação. A dependência do projeto foi preservada. Não foram usados solvers, cookies de sessão, alteração de headers, proxy de vídeo ou troca de domínio para contornar restrições.

O endereço Koyeb antigo também foi auditado por estar no histórico do projeto: `/health` e `/api/v2/hianime/home` retornaram HTTP 404, “No active service”. Ele não é usado pela execução local nem pelo comando de diagnóstico padrão.

## Repetir os testes localmente

O site normal continua em http://127.0.0.1:5173, com API em http://127.0.0.1:4000. O diagnóstico padrão consulta a API local e a biblioteca diretamente:

```bash
npm run diagnose:aniwatch
```

O resultado distingue integração desativada, provedor indisponível, erro de rede, timeout e catálogo vazio/inválido. Retorna código de saída 1 quando nenhum catálogo funcional é encontrado. Uma resposta HTTP 200 ou um health check bem-sucedido não são tratados como prova de reprodução.

Para uma instância de teste local com as rotas antigas habilitadas, use outro terminal:

```bash
PORT=4001 ENABLE_LEGACY_HIANIME=true npm run dev:backend
```

E consulte:

```bash
npm run diagnose:aniwatch -- --backend http://127.0.0.1:4001
curl http://127.0.0.1:4001/health
curl http://127.0.0.1:4001/api/v2/hianime/home
curl http://127.0.0.1:4001/api/v2/hianime/anime/steinsgate-3/episodes
curl 'http://127.0.0.1:4001/api/v2/hianime/episode/servers?animeEpisodeId=steinsgate-3%3Fep%3D230'
```

Encerre somente essa instância de teste com `Ctrl+C` quando terminar. Nenhum deploy ou serviço hospedado é necessário.

## Integração com o player

O fluxo React → API local → Aniwatch → origem foi exercitado até o ponto de falha. O framework e as rotas locais iniciam; a origem não fornece os dados necessários neste ambiente. O tratamento das falhas do Aniwatch foi ajustado para retornar HTTP 503 com o código `ANIWATCH_UPSTREAM_UNAVAILABLE`, em vez de esconder a falha do provedor como um erro interno genérico.

Quando existir uma origem funcional, o adaptador deverá conferir o `anilistId` retornado pelo `getInfo(slug)` antes de associar o catálogo AniList a um título HiAnime; normalizar episódios e servidores; validar fontes autorizadas, CORS e idiomas das legendas; e então fornecer `Playback` ao player existente. IDs numéricos do AniList não são slugs HiAnime, e categoria `sub` não comprova PT-BR.

Neste reteste, essa condição não foi atendida. O catálogo AniList e o player demonstrativo continuam operacionais, sem episódios fictícios ou uma integração apresentada como concluída.

Verificação das alterações desta rodada: build completo aprovado; 56 testes aprovados, incluindo distinção entre serviço local desativado, falha da origem, timeout e catálogo inválido.
