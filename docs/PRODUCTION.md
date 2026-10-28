# Produção compilada — HPmovies

O modo de produção serve os arquivos compilados do site e a API Hono no mesmo
endereço. O host de fontes fica privado em loopback; o tradutor opcional usa o
modelo já instalado. O comando não inicia Vite, não baixa extensões e não faz
deploy. Esta etapa prepara a aplicação para futura hospedagem.

## Compilar e iniciar

Requer Node.js 22.12+ e as dependências do projeto. Na primeira instalação:

```bash
npm ci
```

Após alterar código, compile novamente:

```bash
npm run build
npm start
```

Abra `http://127.0.0.1:4000`. `BACKEND_PORT` altera a porta; `BACKEND_HOST` continua
`127.0.0.1` por padrão. `npm start` não recompila automaticamente: build ausente
ou incompleto causa erro antes de iniciar os serviços auxiliares.

O comando lê o `.env` privado da raiz do projeto. `DOTENV_CONFIG_PATH` pode
selecionar outro arquivo local; caminhos relativos são resolvidos a partir da
raiz. Não coloque dados privados em variáveis `VITE_*`, pois elas pertencem ao
frontend público. Para manter site e API na mesma origem, deixe
`VITE_API_BASE_URL` vazio durante a compilação.

Encerre a execução com `Ctrl+C`. O launcher fecha servidor, host de fontes,
tradutor que ele iniciou e cache. Um tradutor compatível já em execução é
reutilizado e permanece sob responsabilidade de quem o iniciou. SIGTERM também
encerra os serviços; o prazo global de encerramento é de oito segundos.

Não execute desenvolvimento e produção nas mesmas portas. Porta ocupada causa
erro explícito, sem selecionar outra porta silenciosamente. Os padrões continuam
sendo `4000` para site/API, `8099` para fontes e `5000` para o tradutor opcional.

## Arquivos e serviços

| Item | Local | Exposição |
| --- | --- | --- |
| Frontend compilado | `dist/web` | Arquivos estáticos e fallback para navegação React Router. |
| Backend compilado | `dist/backend` | Executado pelo Node; não servido como arquivo público. |
| Host de fontes e licenças | `src/aniwatch-apis/src/providers/tatakai-runtime` | Código de runtime usado pelo launcher, sem expor suas rotas diretamente. |
| Extensões escolhidas pelo operador | Registro indicado por `HPMOVIES_EXTENSIONS_FILE` | Arquivos privados, fora do Git e fora da raiz pública. |
| Tradutor opcional | Cache local ou `HPMOVIES_TRANSLATOR_HOME` | Serviço em loopback com modelo provisionado separadamente. |

O servidor HTTP entrega `/api`, `/api/*` e `/health` à API existente, preservando
método, headers, corpo e informações da conexão. Não usa um proxy HTTP adicional
para essa comunicação interna, preservando as quotas pelo endereço do cliente.
Uma navegação HTML para `/anime/21`, `/library` ou outra rota React recebe
`index.html`; um asset ausente recebe 404, sem virar HTML. JavaScript, CSS, SVG e
WebVTT recebem seus tipos MIME próprios. IDs com pontos em rotas conhecidas,
como um episódio `12.5` ou um capítulo, também aceitam entrada direta e reload.

O frontend público fica separado dos arquivos do backend. Dotfiles, diretórios
privados, traversal e links simbólicos que escapem da raiz pública são recusados.
O HTML é revalidado; assets com hash recebem cache longo. URLs de mídia e
legendas continuam usando as rotas e os tickets opacos da API.

`dist` sozinho não é um pacote de instalação completo: o launcher também usa
`scripts`, o runtime CJS de fontes e dependências Node. Preserve as licenças do
runtime. Não copie `.env`, extensões privadas, chaves ou modelos para `dist/web`.

## Fontes e tradução

Uma instalação nova não recebe o bundle privado de extensões. Configure os
arquivos locais autorizados, hashes, namespace, provedores e domínios conforme
[LOCAL-SOURCE-HOST.md](LOCAL-SOURCE-HOST.md). Sem fonte configurada, catálogo,
biblioteca e demonstrações continuam independentes, mas isso não habilita vídeos
de animes automaticamente.

O tradutor segue `AUTOMATIC_SUBTITLES_ENABLED` e o setup existente:

```bash
npm run setup:translator
```

Execute esse setup somente quando desejar instalar o modelo. `npm start` não o
instala. Sua ausência não impede abrir o site; a tradução aparece indisponível.
O modelo fica fora do build e seu desempenho depende do ambiente de execução.

## Verificar

```bash
npm test
npm run lint
npm run build
npm run test:e2e:production
```

Os testes unitários cobrem roteamento, isolamento do frontend, manutenção dos
headers da API, início/encerramento e falhas de portas. A suíte Playwright de
produção inicia o launcher em portas isoladas e reutiliza os cenários existentes
de plataforma. Ela desativa fontes privadas e tradução, sem carregar `.env`.
Catálogos e mangás usam fixtures; a leitura original usa a API real local; o
vídeo de demonstração usa mídia externa. Nenhum desses cenários prova que uma
fonte de anime entrega a obra, episódio e idioma corretos.

Com `npm start` e as fontes reais já configuradas, a verificação de mídia
existente também aceita a origem de produção:

```bash
STREAM_CHECK_ORIGIN=http://127.0.0.1:4000 npm run test:streaming:real -- 235
```

Esse comando depende dos provedores externos e salva evidências temporárias em
`/tmp`. Seus resultados devem ser registrados separadamente das fixtures, com
inspeção da identidade do conteúdo. Índice de episódios e HTTP 200 não comprovam
reprodução correta.

## Limites desta entrega

O servidor permanece local por padrão. Domínio, HTTPS, autenticação familiar,
supervisão do processo pela hospedagem e regras de proxy confiável ficam para a
etapa de implantação. Não habilite confiança indiscriminada em headers de proxy.
Tickets continuam em memória: reinícios invalidam tickets existentes e múltiplas
réplicas exigem tratamento específico. Biblioteca e histórico são locais ao
cliente; esta etapa não cria sincronização ou APK.

Quando a aplicação for hospedada, os serviços executarão na nuvem. O computador
pessoal não precisará permanecer ligado. O modo local é a preparação verificável
antes dessa implantação.

## Validação em 28/10/2026

44 arquivos/454 testes unitários, lint, build e dez cenários Playwright em
produção foram aprovados. A amostra real de Detective Conan E01 reproduziu
vídeo, áudio decodificado, seek e legenda PT-BR; foram conferidas cenas do
episódio em três posições. Essa amostra é independente das fixtures da suíte e
não comprova disponibilidade de outras obras ou idioma falado por auditoria.

Também foram conferidos início fora da raiz do projeto, portas ocupadas,
encerramento e isolamento do diretório público. Evidências e limites estão em
[validation/2026-10-28-production.json](validation/2026-10-28-production.json).

Neste ambiente, o navegador precisou das bibliotecas nativas já existentes no
cache. Para repetir a suíte aqui:

```bash
LD_LIBRARY_PATH=/home/arthu/.cache/hpmovies-qa/libs/usr/lib/x86_64-linux-gnu npm run test:e2e:production
```

Esse caminho é específico do ambiente de validação; outras máquinas precisam
das dependências nativas do Chromium ou de um navegador compatível configurado
por `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.

## Possibilidade de uso doméstico na rede local

A preferência inicial atual do usuário é manter o PC como servidor e usar
celular e Fire Stick na mesma rede de casa. Essa topologia é compatível com a
estrutura de produção, mas o acesso LAN ainda não foi configurado ou testado.

O site/API precisa escutar o IP da rede doméstica, selecionado por
`BACKEND_HOST`; o padrão `127.0.0.1` permite acesso apenas pelo próprio PC.
O endereço nos outros aparelhos será `http://IP-DO-PC:4000`, e não o localhost
desses aparelhos. Reservar o IP no roteador e restringir o acesso à rede de casa.
Fontes e tradutor continuam em loopback e não precisam ser expostos aos clientes.

Começar validando o navegador do celular permite conferir conexão e reprodução
antes de criar um aplicativo. O APK ainda exige wrapper e adaptação para a TV.
Se empacotar o frontend localmente, configurar a base da API e a origem CORS; se
o wrapper carregar o site do PC, pode manter a mesma origem. O acesso HTTP local
também deve ser considerado na [configuração de segurança de rede Android](https://developer.android.com/privacy-and-security/security-config).
O sistema Fire OS 6 informado não comprova por si só a versão do WebView.

O PC precisa permanecer ligado e sem suspensão durante a reprodução. Dentro
da LAN, o trecho PC→cliente usa Wi-Fi/Ethernet local; o upload do plano de
internet não é o mesmo gargalo do cenário de espectadores fora de casa.
Histórico e biblioteca continuam separados por cliente, e o acesso externo
não é habilitado automaticamente.
