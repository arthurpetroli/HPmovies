# Conteúdo real validado localmente

Verificação em 21/10/2026. A instalação e os testes abaixo foram solicitados pelo usuário para rodar localmente; não houve push, publicação nem deploy.

## Implementação e fontes

O HPmovies executa o host HTTP do Tatakai sob MPL-2.0 e o **pacote original Toko 4.5.5**, obtido da [release do autor](https://github.com/Snozxyx/Toko/releases/tag/toko-v4.5.5). O bundle continua intacto em `.local/sources/toko-4.5.5/`, ignorado pelo Git. Não foi incorporado código do Toko ao projeto. Os hashes, a origem e a configuração estão em [LOCAL-SOURCE-HOST.md](LOCAL-SOURCE-HOST.md).

O host limita os registros exportados em memória a três provedores do próprio pacote: Nebula para vídeo, Webtoons para quadrinhos e Syosetu para texto. Recursos opcionais de navegador, resolução de desafios e instalação automática de navegador permanecem desativados. Não é uma validação dos demais provedores oferecidos pelo Toko.

A tela `/sources` permite consultar diretamente a obra por ID AniList, título e número de episódio, sem exigir que o catálogo responda. Os títulos permanecem nas URLs de abertura, recarga e navegação. O player e os leitores existentes foram reaproveitados.

## Resultados externos no navegador

| Tipo | Obra e fonte | Resultado observado |
| --- | --- | --- |
| Vídeo | One Piece, AniList 21, episódio 1, Nebula | Sete fontes retornadas; HLS reproduziu em 1440×1080, duração informada 1477,974s. A amostra final avançou 14 s e continuou após seek para 122 s. Os 28 pedidos de mídia da amostra responderam 200; sem erros de página. |
| Legenda | Faixa English do mesmo vídeo | WebVTT carregado pelo gateway, idioma normalizado `en`, 285 entradas. A faixa foi selecionada pelo controle do player. Nenhuma faixa PT-BR foi retornada nesse episódio. |
| Mangá/manhwa | Tower of God, AniList 85143, Webtoons | 652 capítulos em inglês. O primeiro capítulo abriu 8 painéis; a primeira imagem retornou 200 JPEG, 56.662 bytes e 700×1140 no navegador. Leitura validada em desktop e 393 px, sem overflow nem erros de página. |
| Novel | Ascendance of a Bookworm: Part 5, AniList 113869, Syosetu | 217 capítulos em japonês, do original do autor; primeiro capítulo retornou 122 parágrafos. Abertura e recarga no leitor existente validadas em desktop e celular, sem erros de página. |

Os identificadores foram conferidos: [One Piece](https://anilist.co/anime/21), [Tower of God](https://anilist.co/manga/85143) e [Bookworm: Part 5](https://anilist.co/manga/113869). O texto original vem de [Syosetu](https://ncode.syosetu.com/n4830bu/461/); o quadrinho é obtido pelo provedor da publicação [Webtoons](https://www.webtoons.com/en/fantasy/tower-of-god/list?title_no=95).

Essas amostras validam o caminho extensão→host→API→player/leitor, com respostas reais. Não representam assistir o episódio inteiro, ler todos os capítulos ou confirmar todos os títulos/idiomas da fonte. Os registros técnicos e capturas da sessão ficam em `/tmp/hpmovies-real-*`; não são arquivos de conteúdo redistribuídos no repositório.

## Correções que tornaram o conteúdo acessível

- Navegador opcional deixou de bloquear o carregamento de todo o pacote. O modo HTTP é uma opção explícita do registro local.
- O catálogo Webtoons pagina centenas de episódios e excedia o limite fixo de 15 s do agregador. O host usa os mesmos métodos originais, com orçamento explícito de 55 s; a API local está configurada para 60 s. A interface espera até 65 s para operações de conteúdo.
- Imagens, HLS/MP4, segmentos e legendas com Referer/Origin configurados usam tickets opacos. As rotas não recebem URLs arbitrárias; cada destino precisa estar na allowlist e resolver para IP público fixado na conexão TLS.
- Alguns segmentos MPEG-TS chegam rotulados como JPEG, HTML, JavaScript ou CSS. O gateway verifica **todos os pacotes de 188 bytes** e só corrige o MIME de uma sequência MPEG-TS válida; páginas HTML, scripts e imagens reais são recusados.
- Formatos de legenda são preservados antes de trocar URLs por tickets; SRT chega identificado ao conversor do player. Idiomas ambíguos continuam desconhecidos, sem inventar PT-BR.
- HLS mantém buffer limitado, inclusive após seek. A quota de mídia é independente da quota de consultas, evitando que imagens/segmentos consumam a quota de catálogo.

Cookies, autenticação, redirecionamentos, destinos privados e playlists criptografadas não são aceitos pelo transporte. Addons e fontes podem falhar ou mudar de domínio; nesses casos a interface deve informar a falha, sem liberar novos destinos automaticamente.

## Execução e limites atuais

```bash
npm run dev
```

Abra [http://127.0.0.1:5173/sources](http://127.0.0.1:5173/sources). Há atalhos para os três casos validados. O comando inicia frontend 5173, API 4000 e host de fontes 8099; os arquivos privados de registro e `.env` desta máquina já apontam ao pacote instalado. Em uma nova cópia do repositório, é necessário obter o pacote do autor e preparar a configuração local conforme a documentação do host.

AniList e MangaDex continuam com seu tratamento de indisponibilidade, sem alteração para contornar a manutenção. A listagem automática de episódios não é inventada a partir de metadados; fontes sem índice podem ser consultadas pelo número do episódio em `/sources`. O acesso direto também está ligado aos detalhes dos animes.

As fontes validadas oferecem inglês/japonês nos casos acima. PT-BR continua prioritário quando uma fonte realmente o retorna; não há garantia para títulos, capítulos, regiões ou traduções que não foram testados. Integrações com browser/Electron, playlists criptografadas, ASS com headers e outros provedores/CDNs continuam fora da validação desta entrega.

## Verificação automatizada

Os testes unitários usam clientes e bundles de teste explícitos, independentes do `.env` privado. A suíte de navegador distingue fixtures de catálogo/conteúdo dos cenários com backend local e HLS remoto autorizado. A validação externa da tabela foi executada separadamente, sem substituir os cenários por mocks de produção.

Resultado final: **214 testes automatizados em 24 arquivos, 18 testes de navegador em desktop/celular, lint, TypeScript, build e `git diff --check` aprovados.** Os testes externos da tabela são adicionais a essa suíte. Permanece o aviso de build do chunk HLS de aproximadamente 541 kB, carregado sob demanda; não impede a execução.
