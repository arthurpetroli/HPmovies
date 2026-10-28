# Miruro e SugoiAPI: verificação de viabilidade

Verificação em 28/10/2026. As duas indicações foram investigadas como possíveis fontes de reprodução. Nenhuma foi adicionada como fonte funcional: não houve reprodução externa validada nesta etapa. O vídeo local do Miruro continua servindo como referência de interação e layout.

## Miruro

A [página oficial de domínios](https://www.miruro.com/) aponta `www.miruro.cx` como domínio principal. Essa página é uma apresentação do serviço; não documenta um contrato HTTP público de episódios e reprodução.

Nesta máquina, uma requisição HTTPS via `curl` às duas origens `https://www.miruro.cx/` e `https://miruro.cx/` recebeu **403**. Uma navegação normal posterior em Chromium recebeu **200** e permitiu conferir a interface, o menu lateral e as preferências. A diferença depende do cliente; o site não foi classificado como indisponível. Não houve tentativa de contornar o bloqueio. O mapa de interface observado está em [validation/2026-10-28-miruro-reference.json](validation/2026-10-28-miruro-reference.json).

Resultados de busca ainda indicavam o antigo repositório `Miruro-no-kuon/Miruro` e um backend Consumet. As verificações atuais retornaram:

| Recurso consultado | Resultado nesta conexão |
| --- | --- |
| `https://api.github.com/repos/Miruro-no-kuon/Miruro` | 404 |
| `https://public-miruro-consumet-api.vercel.app/` | 404 |

Esses endereços antigos não foram configurados no HPmovies. Não foi possível confirmar um contrato público atual, a licença do código atual ou disponibilidade de áudio/legendas PT-BR pelo serviço. Rótulos genéricos como “subbed” e “dubbed” não identificam português brasileiro.

## SugoiAPI

Foi analisada a revisão [`f37c70ea71ba2d3687e2904ecd73f85a03382fa5`](https://github.com/yzPeedro/SugoiAPI/commit/f37c70ea71ba2d3687e2904ecd73f85a03382fa5), de 28/11/2025. O [README](https://github.com/yzPeedro/SugoiAPI/blob/f37c70ea71ba2d3687e2904ecd73f85a03382fa5/README.md) informa execução local com Docker e não fornece um endpoint hospedado para consumo. O projeto usa PHP/Symfony; não é um pacote TypeScript para importar no backend Hono.

### Contrato encontrado

O [controller](https://github.com/yzPeedro/SugoiAPI/blob/f37c70ea71ba2d3687e2904ecd73f85a03382fa5/src/Controller/MediaController.php) define:

```text
GET /episode/{slug}/{season}/{episodeNumber}
```

A [documentação de providers](https://github.com/yzPeedro/SugoiAPI/wiki/Providers) e o [serviço de resolução](https://github.com/yzPeedro/SugoiAPI/blob/f37c70ea71ba2d3687e2904ecd73f85a03382fa5/src/Services/MediaService.php) permitem selecionar uma fonte com `?provider=anime-fire`. A resposta possui `data[]` com `name`, `slug`, `has_ads`, `is_embed` e `episodes[]`; cada resultado de episódio contém `error`, `searched_endpoint` e `episode`.

| Provider declarado | Tipo declarado no código |
| --- | --- |
| [Anime Fire](https://github.com/yzPeedro/SugoiAPI/blob/f37c70ea71ba2d3687e2904ecd73f85a03382fa5/src/Providers/AnimeFireProvider.php) | URL direta; escolhe o primeiro resultado do upstream |
| [Animes Online CC](https://github.com/yzPeedro/SugoiAPI/blob/f37c70ea71ba2d3687e2904ecd73f85a03382fa5/src/Providers/AnimesOnlineCCProvider.php) | Embed |
| [Superflix](https://github.com/yzPeedro/SugoiAPI/blob/f37c70ea71ba2d3687e2904ecd73f85a03382fa5/src/Providers/SuperflixProvider.php) | Embed com anúncios |

O contrato não inclui índice de episódios, associação ao AniList, identidade normalizada da obra, idioma ou qualidade. Um slug não pode ser deduzido com segurança de um título. Anime Fire e Animes Online CC também não usam o parâmetro de temporada para construir a URL upstream; a temporada deve estar corretamente representada no slug da fonte.

### Problema de execução identificado no código

O trait [SearchEngine.php](https://github.com/yzPeedro/SugoiAPI/blob/f37c70ea71ba2d3687e2904ecd73f85a03382fa5/src/Support/Traits/SearchEngine.php) chama `canUserSuffix()`. A [interface](https://github.com/yzPeedro/SugoiAPI/blob/f37c70ea71ba2d3687e2904ecd73f85a03382fa5/src/Providers/Contracts/MediaProviderRulesInterface.php) e os providers implementam `canUseSuffix()`. A chamada ocorre na montagem de endpoints, antes do bloco que captura erros HTTP. Pela leitura do código, essa revisão precisa de correção antes de resolver episódios. **Esse achado é análise estática, não um teste de execução PHP.**

### Licença e possibilidade de integração

O [composer.json](https://github.com/yzPeedro/SugoiAPI/blob/f37c70ea71ba2d3687e2904ecd73f85a03382fa5/composer.json) declara `license: "proprietary"`. Os [metadados GitHub](https://api.github.com/repos/yzPeedro/SugoiAPI) retornaram `license: null` e a árvore consultada não continha arquivo `LICENSE`. A descrição de “open source” no README não esclarece essa divergência. Nenhum código PHP, dependência ou imagem Docker do projeto foi incorporado ao HPmovies.

Um cliente HTTP independente pode ser considerado quando houver uma instância corrigida e um mapeamento explícito entre AniList, slug e temporada. A integração precisa filtrar embeds, validar URLs diretas pelos controles de mídia já existentes e preservar idioma desconhecido como `und`. Ainda seria necessário conferir reprodução, identidade do episódio e idioma; o exemplo de JSON do README não comprova esses itens.

## Evidência e retomada

- **Verificações reais:** requisições HTTPS e navegação Chromium no Miruro, consulta atual da revisão e arquivos públicos do SugoiAPI pelo GitHub.
- **Análise estática:** contrato PHP, providers, ausência de metadados de idioma e divergência entre nomes de métodos.
- **Não realizado:** instalação/execução do SugoiAPI, reprodução de mídia pelos dois serviços ou validação audiovisual de PT-BR.
- **Sem fixtures de mídia:** exemplos do README não foram apresentados como vídeos funcionais.
- **Próxima condição útil:** endpoint atual documentado do Miruro ou instância SugoiAPI corrigida, acompanhada dos slugs reais das obras a validar.
