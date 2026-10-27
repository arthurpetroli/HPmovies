# Skills locais

Instaladas em 27/10/2026 por `skill-installer`, com revisões fixadas dos repositórios
solicitados. Os arquivos ficam em `.agents/skills`, versionados com o projeto.
Origem, revisão e hash de cada `SKILL.md`: `.agents/skills.lock.json`.

| Skill | Uso | Origem | Licença |
| --- | --- | --- | --- |
| `ui-ux-pro-max` | UX, acessibilidade, responsividade e pesquisa de referências | [Next Level Builder](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | MIT |
| `frontend-design` | Direção visual, tipografia, composição e revisão do frontend | [Anthropic](https://github.com/anthropics/skills/tree/main/skills/frontend-design) | Apache-2.0 |
| `caveman` | Respostas concisas, preservando precisão e detalhes técnicos necessários | [Julius Brussee](https://github.com/JuliusBrussee/caveman/tree/main/skills/caveman) | Apache-2.0 |

As orientações de aplicação estão em `AGENTS.md`. A descoberta automática das novas
skills fica disponível a partir do próximo turno; os arquivos também podem ser
lidos e aplicados diretamente nesta sessão.

A busca do UI/UX Pro Max usa Python 3 e os dados locais incluídos:

```bash
python3 .agents/skills/ui-ux-pro-max/scripts/search.py "pagination keyboard focus" --domain ux -n 2
python3 .agents/skills/ui-ux-pro-max/scripts/search.py "list rendering" --stack react -n 2
```

Para invocar explicitamente no Codex: `$ui-ux-pro-max`, `$frontend-design` e
`$caveman`. Use as duas primeiras nas tarefas de interface; a última orienta a
concisão da conversa. Os termos técnicos, a documentação e o código mantêm sua
forma completa. A instalação contém somente as skills e seus recursos locais;
não adiciona dependências ao aplicativo.

Para atualizar, instale a revisão desejada em um diretório temporário com o mesmo
helper, compare as alterações e atualize os arquivos e o registro de origem.
As atualizações não são automáticas.
