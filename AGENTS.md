# HPmovies

Priorize execução local e português brasileiro. Preserve React, TypeScript, Vite,
Tailwind, React Router, Hono e HLS.js. Não faça push ou deploy sem solicitação.

## Skills do projeto

Leia a skill pertinente antes de aplicá-la:

- `.agents/skills/ui-ux-pro-max/SKILL.md`: UX, acessibilidade, navegação, componentes
  e responsividade. Consulte apenas o domínio necessário para mudanças pontuais.
- `.agents/skills/frontend-design/SKILL.md`: direção visual e acabamento do frontend.
  Preserve a identidade existente e o briefing do HPmovies.
- `.agents/skills/caveman/SKILL.md`: comunicação concisa em português, mantendo
  fatos, comandos, limitações e resultados dos testes. Não comprima código ou docs.

No Codex, execute a busca UI/UX pelo caminho real do projeto:
`python3 .agents/skills/ui-ux-pro-max/scripts/search.py "consulta" --domain ux`.
Não dependa de `CLAUDE_PLUGIN_ROOT`. Carregue referências e dados sob demanda.

## Verificação

Use testes proporcionais à mudança. Para mudanças funcionais, execute os testes
afetados, lint e build; valide navegação e layout quando houver alteração de UI.
Separe fixtures de verificações reais. Índice de episódios e HTTP 200 não provam
que o vídeo corresponde ao anime, episódio ou idioma solicitado.

Preserve licenças e o bundle privado das fontes. Não registre `.env`, URLs com
tokens ou chaves de mídia. Registre o estado de retomada em
`docs/DEVELOPMENT-STATE.md` quando encerrar uma etapa.
