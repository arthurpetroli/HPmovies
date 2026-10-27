# Direção visual do HPmovies

Referência solicitada: [descoberta do Crunchyroll](https://www.crunchyroll.com/pt-br/discover).
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
