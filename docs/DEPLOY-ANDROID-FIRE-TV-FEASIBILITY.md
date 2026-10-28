# Viabilidade de hospedagem, Android e Fire TV — 28/10/2026

**Atualização posterior à auditoria:** o modo de produção compilada foi
implementado e validado. `npm start` agora inicia site/API e serviços auxiliares;
o frontend fica em `dist/web`. As observações abaixo sobre ausência desse modo
descrevem o estado no momento da análise. Uso atual e verificações em
[PRODUCTION.md](PRODUCTION.md). Hospedagem e APK permanecem pendentes.

O HPmovies pode ser hospedado e reaproveitado em um aplicativo Android. Em Fire
TV, o formato depende do sistema do aparelho: APK para Fire OS; VPKG para Vega
OS. Esta etapa avalia possibilidades e requisitos. Não implementa infraestrutura,
não gera aplicativo e não publica o projeto.

Perfil informado pelo usuário: Fire OS **6.7.1.1 (NS6711/5908)** e uso
pessoal/familiar por aproximadamente **8–10 pessoas no total**. O número de
reproduções simultâneas não foi informado. O sistema já permite selecionar o
caminho de APK para Fire OS; o modelo físico e o WebView ainda não foram medidos.

## Resultado por destino

| Destino | Viabilidade | Trabalho necessário |
| --- | --- | --- |
| Site com todas as funções atuais | Viável com preparação de produção | Frontend estático, API Node, host privado de fontes e tradutor local quando habilitado. |
| Android celular/tablet | Viável; ainda sem teste em aparelho | Wrapper Capacitor/WebView, API HTTPS, integração Android e assinatura. |
| Fire TV com Fire OS | Viável conforme versão e WebView | Wrapper Android, navegação por controle e validação de mídia no aparelho. |
| Fire TV com Vega OS | Possível por outro pacote; ainda sem protótipo | Wrapper Vega/WebView e pacote VPKG; não reutiliza o APK como binário nativo. |

## Hospedagem recomendada

A recomendação técnica inicial é uma VPS Linux com uma instância da API. A
inferência vem das dependências locais e dos tickets mantidos em memória:

```text
Navegador ou aplicativo
        |
HTTPS / domínio
        |
Proxy reverso + arquivos públicos do frontend
        |
API Hono / Node.js
        |
Host privado de fontes + tradutor local opcional
```

O proxy deve encaminhar `/api/*` sem remover esse prefixo, servir somente os
arquivos públicos do frontend e aplicar fallback para `index.html` nas rotas do
React Router. O diretório `dist` também contém o backend compilado; ele não deve
ser publicado integralmente como conteúdo estático. O padrão de SPA com API é
documentado pelo [Caddy](https://caddyserver.com/docs/caddyfile/patterns#single-page-apps-spas).

Uma plataforma gerenciada com processos persistentes, como Render ou Railway,
também é candidata. Exige resolver processos auxiliares, rede local, arquivos
privados e persistência. Hospedagem exclusivamente estática atende à interface;
as funções da API continuam exigindo um servidor.

O [Render gratuito](https://render.com/docs/free) suspende serviços sem tráfego
após 15 minutos e usa sistema de arquivos efêmero. Isso prejudica início de
reprodução e continuidade dos tickets. O [Railway](https://docs.railway.com/pricing/plans)
cobra recursos e tráfego de saída. Não foi contratado plano nem estimado custo
mensal: faltam volume de uso, simultaneidade e medição do tradutor.

O vídeo passa pela API. Como exemplo matemático, 5 Mbps durante uma hora
equivalem a aproximadamente 2,25 GB por espectador, sem overhead. Isso não é uma
medição dos streams atuais. A franquia de transferência precisa entrar na escolha
da hospedagem.

Para esse grupo, uma referência inicial de avaliação é uma VPS com 2 vCPU e
4 GB RAM, mantendo uma instância da API. Isso é um ponto de partida para testes,
não capacidade medida ou garantia de dez sessões. A tradução automática exige
medição própria de memória e CPU.

No cenário ilustrativo de 5 Mbps por stream, 8–10 reproduções simultâneas exigem
40–50 Mbps de saída, antes de overhead. Duas horas diárias para cada uma das
8–10 pessoas representam aproximadamente 1,08–1,35 TB em 30 dias. A banda real
varia com a qualidade e o tempo assistido. O limite atual de 12 downloads
concorrentes não corresponde a 12 espectadores: HLS faz requisições em rajadas.

O plano deve prever acesso restrito à família, sem necessidade de tornar o
catálogo um serviço público. A forma de controle de acesso ainda não foi
implementada. Uso familiar não altera as permissões das fontes.

### Ajustes concretos antes de publicar

1. Criar inicialização de produção completa. `npm start` inicia somente a API;
   não inicia o host de fontes, o tradutor ou o servidor de arquivos estáticos.
2. Provisionar o registro e bundle privado de fontes fora do Git. Uma instalação
   limpa não contém esses arquivos. Não incorporá-los ao APK ou a uma imagem
   pública; preservar as licenças e permissões registradas no projeto.
3. Se a tradução automática for mantida, instalar Python, suas dependências e o
   modelo. O serviço atual exige loopback, assim como o host de fontes. Containers
   independentes não compartilham `127.0.0.1`; a topologia precisa considerar isso.
4. Configurar domínio, HTTPS, origens CORS e bind da API conforme o ambiente. Na
   VPS, os serviços auxiliares podem continuar privados em loopback. Em PaaS,
   conferir porta e endereço exigidos pela plataforma.
5. Tratar o IP real de clientes por um proxy explicitamente confiável. O limitador
   usa o endereço da conexão; atrás de um proxy, usuários podem dividir a mesma
   quota. Não aceitar indiscriminadamente cabeçalhos de encaminhamento.
6. Começar com uma instância da API. Tickets de mídia, legendas e trabalhos de
   tradução ficam em memória. Reiniciar invalida tickets; múltiplas réplicas
   exigem afinidade ou armazenamento compartilhado. O Redis atual é cache e não
   resolve automaticamente esse problema.
7. Definir acesso pessoal/familiar ou público. O aplicativo atual não fornece
   contas ou controle de acesso por usuário. CORS não equivale a autenticação.

Os arquivos Docker/Render/Vercel sob `src/aniwatch-apis` são herdados da API antiga;
não empacotam o HPmovies completo. O build TypeScript também não copia o host CJS
de fontes para `dist/backend`.

Evidências locais: `package.json`, `vite.config.ts`, `tsconfig.backend.json`,
`src/aniwatch-apis/src/app.ts`, `src/aniwatch-apis/src/config/runtime.ts`,
`src/aniwatch-apis/src/middleware/apiLimit.ts`,
`src/aniwatch-apis/src/providers/stream-media.ts`,
`src/aniwatch-apis/src/providers/portuguese-subtitles.ts`,
`src/aniwatch-apis/src/providers/automatic-subtitle-jobs.ts`,
`src/aniwatch-apis/src/providers/automatic-subtitles.ts`,
`src/aniwatch-apis/src/providers/tatakai-runtime/local-server.cjs`,
`scripts/start-source-host.cjs` e `scripts/start-subtitle-translator.cjs`.

## Aplicativo Android

O caminho de menor mudança é empacotar o frontend existente em Capacitor,
preservando React, TypeScript, Vite, Tailwind, React Router e HLS.js. O backend
Hono continua no servidor. Um APK não leva os serviços Node/Python locais para o
celular ou para a TV.

O projeto ainda não possui dependências Capacitor, diretório Android, manifest
nativo ou configuração Gradle. Também não possui PWA configurada. No ambiente
inspecionado, `java`, `adb`, `gradle` e `sdkmanager` não foram encontrados no PATH;
isso não verifica instalações fora dele. Não foram instaladas ferramentas.

O [Capacitor Android atual](https://capacitorjs.com/docs/android) documenta Android
7/API 24 ou superior e requisitos de WebView. O [ambiente de desenvolvimento](https://capacitorjs.com/docs/getting-started/environment-setup)
inclui Android Studio e SDK. Em Fire OS 5, baseado em Android 5.1/API 22, essa
versão do Capacitor não atende ao requisito mínimo de API. Atender à API mínima
também não comprova compatibilidade de vídeo no WebView do aparelho.

Preparação necessária: API pública HTTPS em `VITE_API_BASE_URL`, CORS para a
origem efetivamente usada pelo wrapper, ícones, identificação do pacote,
assinatura, botão Voltar, ciclo de vida, orientação e tela cheia. O proxy Vite é
de desenvolvimento e não acompanha o APK. A raiz estática do aplicativo deve
conter apenas o frontend, sem `dist/backend`.

O player já possui HLS.js, fallback HLS nativo/MP4, legendas, controles e retomada.
Ainda exige validação de WebView, codecs, áudio, seek e fullscreen. O próprio
[HLS.js](https://hlsjs.video-dev.org/api-docs/hls.js.hls.issupported) verifica
MediaSource Extensions e codecs básicos antes de habilitar seu transporte.

Biblioteca e histórico usam `localStorage`. Navegador, APK e TV terão dados locais
separados; hospedar o backend não cria sincronização entre dispositivos.

Evidências: `src/frontend/services/http.ts`,
`src/frontend/services/library.ts`,
`src/frontend/components/player/VideoPlayer.tsx` e `playwright.config.ts`.

## Fire TV e controle remoto

Para o aparelho informado, o destino é **APK Fire OS**. A [documentação Fire OS 6](https://developer.amazon.com/docs/fire-tv/fire-os-6.html)
confirma base Android 7.1/API 25, acima do mínimo API 24 documentado pelo Capacitor
atual. Isso confirma o requisito de API, mas não garante compatibilidade do
WebView ou reprodução.

A configuração resolvida do Vite instalado usa `build.target` e `cssTarget`
`chrome107`, `edge107`, `firefox104` e `safari16`. Não há configuração de alvo
legado ou polyfills no projeto. O bundle mantém chamadas a APIs modernas como
`flatMap`, `replaceAll`, `ResizeObserver`, `Object.hasOwn` e `AbortSignal.any`/
`timeout`. O [Vite 7](https://v7.vite.dev/guide/build) transforma sintaxe sem
adicionar automaticamente os polyfills dessas APIs.

O requisito Chrome 60 do wrapper Capacitor não equivale ao suporte do bundle
atual. Fire OS 6.7.1.1 não informa a versão efetiva do WebView; ela pode variar
com o aparelho e suas atualizações. Antes de fechar o empacotamento, medir
modelo, versão/User-Agent do WebView e recursos disponíveis no aparelho,
ajustar a compilação e os fallbacks necessários e testar navegação e HLS.

A [tabela oficial da Amazon](https://developer.amazon.com/docs/fire-tv/fire-os-overview.html)
separa sistemas por modelo. Exemplos com Vega OS: Fire TV Stick 4K Select (2025),
Fire TV Stick HD (2026) e Fire TV Stick 4K de 3ª geração (2026). O nome “Fire
Stick” sozinho não determina o formato de aplicativo.

Fire OS permite [instalar APK por ADB para testes](https://developer.amazon.com/docs/fire-tv/installing-and-running-your-app.html).
Para Vega, a Amazon documenta [WebView para aplicações web](https://developer.amazon.com/docs/vega/0.22/develop-your-app-with-webview),
permitindo reaproveitar a interface React por um wrapper próprio. Seu pacote é
VPKG, com [Developer Mode e ferramentas Vega](https://developer.amazon.com/docs/vega/0.24/developer-mode).
Esses caminhos ainda não foram implementados ou testados no HPmovies.

A interface possui botões, links e alguns atalhos de teclado, mas falta navegação
espacial completa por D-pad. São necessárias seleção pelas quatro direções,
foco inicial e restaurado entre rotas, rolagem acompanhando o foco, confirmação,
Voltar e teclas de mídia. O player atualmente usa esquerda/direita para seek;
esse comportamento precisa coexistir com a seleção dos controles. Menus usam
Escape e não têm integração nativa com o controle da TV.

Esses ajustes podem preservar a identidade visual. Devem considerar legibilidade
à distância e uso sem touchscreen, conforme as [diretrizes Fire TV](https://developer.amazon.com/docs/fire-tv/design-and-user-experience-guidelines.html).
A configuração nativa também requer launcher/banner de TV e recursos adequados
ao aparelho; o [guia Android TV](https://developer.android.com/training/tv/get-started/create)
descreve os requisitos iniciais.

Gerar um pacote e publicá-lo em loja são etapas distintas. A [submissão Amazon](https://developer.amazon.com/docs/app-submission/submitting-apps-to-amazon-appstore.html)
recebe APK/AAB para Fire OS e VPKG para Vega, sujeita à revisão. Esta auditoria
não valida elegibilidade de loja nem permissões de distribuição de conteúdo.

Para os celulares Android certificados, a distribuição familiar também pode
considerar a [conta de distribuição limitada](https://developer.android.com/developer-verification/guides/limited-distribution)
do Android Developer Console, documentada para até 20 dispositivos autorizados.
O limite conta aparelhos, não pessoas. As [regras de distribuição e sideload](https://developer.android.com/developer-verification/guides?hl=pt-BR)
precisam ser consideradas para os celulares brasileiros; isso não descreve a
instalação no Fire OS. Não foi criada conta nem registrado pacote nesta etapa.

## Verificações executadas e limites

- `npm test`: 42 arquivos e 436 testes aprovados. A suíte injeta clientes e
  desativa fontes externas; isso não comprova reprodução real.
- `npm run lint`: aprovado.
- `npm run build`: aprovado, incluindo TypeScript, frontend e backend. Permanece
  aviso de chunk do player acima de 500 kB; não impediu a compilação.
- API compilada iniciada com `NODE_ENV=production`, porta isolada, sem carregar
  `.env` e sem provedores externos: `/health` aprovado e capítulo de texto
  original local carregado com parágrafos.
- A raiz da API retornou o 404 JSON esperado, confirmando que ela não serve o
  frontend. O arquivo `dist/index.html` foi gerado; o host CJS não foi copiado
  para `dist/backend`, como previsto pela configuração atual.

Não foram executados Playwright, testes de carga, reprodução real, instalação
Android, emulador ou testes em Fire TV nesta etapa. A configuração Playwright
existente cobre Chromium desktop e emulação de Pixel 7; não cobre Android WebView
nem hardware Fire TV.

Antes de chamar o deploy de funcional, validar pelo domínio final: rotas profundas,
HTTPS/CORS, fontes a partir do IP do servidor, vídeo e áudio reais, identidade do
anime/episódio/idioma, legendas, seek/Range, leitores, reinício e sessões
simultâneas. Índice de episódios, build e HTTP 200 não substituem essa validação.

Ordem recomendada: preparar a execução de produção para uso familiar; validar
hospedagem; gerar e testar Android; adaptar TV para o Fire OS 6 informado e medir
o WebView do aparelho. A simultaneidade permanece indefinida; os 8–10 usuários
não devem ser tratados automaticamente como 8–10 sessões simultâneas. A resposta
do usuário refinou a análise sem autorizar contratação ou deploy. Sem alteração
funcional, commit, push ou deploy.

## Prioridade atual: nuvem gratuita e PC desligado — 28/10/2026

O usuário esclareceu que não quer manter nenhum serviço no computador pessoal e
pediu opções de hospedagem gratuita. Essa restrição orienta a próxima etapa:
frontend, API, fontes e tradutor habilitado precisam executar na nuvem. Preparação
e testes locais não significam dependência do PC durante o uso definitivo.

Pesquisa em fontes oficiais consultadas nesta data:

| Opção | Oferta relevante | Aplicação ao HPmovies |
| --- | --- | --- |
| [Oracle Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) | Conta gratuita: A1 ARM com até 2 OCPU/12 GB RAM no total, 200 GB de discos e 10 TB/mês de saída, dentro das cotas. | Primeira candidata para o conjunto completo. Depende de capacidade na região principal; VMs consideradas ociosas podem ser retomadas. |
| [Render Free](https://render.com/docs/free) | Serviço gratuito com suspensão após 15 minutos sem tráfego e disco efêmero. Pode suspender por volume incomum de tráfego iniciado pelo serviço. | Mais adequado a demonstração. Proxy contínuo de vídeo e tickets em memória tornam essas restrições relevantes. |
| [Koyeb Free](https://www.koyeb.com/docs/reference/instances) | Um serviço de 512 MB RAM, 0,1 vCPU e 2 GB SSD; suspende após uma hora sem tráfego e não permite volume persistente. | Protótipo reduzido; recursos pequenos para API, fontes e tradução. |
| [Cloudflare Pages](https://developers.cloudflare.com/pages/functions/pricing/) ou [Vercel Hobby](https://vercel.com/docs/plans/hobby) | Hospedagem gratuita de arquivos do frontend, sujeita às regras de cada plano. | O frontend pode sair do PC; o conjunto atual de serviços persistentes ainda precisa de servidor. As plataformas também oferecem Functions, mas elas não equivalem à arquitetura atual. |
| [Railway Free](https://docs.railway.com/pricing/free-trial) | Trial de US$ 5 por até 30 dias, seguido de US$ 1 mensal no plano Free. | Crédito pequeno para avaliar o deploy; não fundamenta promessa de streaming familiar gratuito contínuo. |

A [FAQ Oracle](https://www.oracle.com/cloud/free/faq/) informa exigência de cartão
para verificação e ausência de SLA no Always Free. O trial de 30 dias é separado
dos recursos Always Free. A quota antiga de 4 OCPU/24 GB não deve ser prometida a
uma conta gratuita: a documentação atual de Always Free informa 2 OCPU/12 GB;
a [lista de preços](https://www.oracle.com/cloud/price-list/) distingue franquias
de contas pagas. Confirmar cotas efetivas no console antes de criar recursos.

Na Oracle, validar Node, fontes e dependências do tradutor na arquitetura ARM.
Considerar HTTPS diretamente na VM: o balanceador gratuito tem limite de 10 Mbps,
abaixo do cenário ilustrativo de dez streams a 5 Mbps. O exemplo anterior de
1,35 TB/mês cabe numericamente na franquia anunciada de 10 TB; isso não comprova
capacidade real, disponibilidade das fontes ou permissões de distribuição.

No [Google Cloud Free Tier](https://docs.cloud.google.com/free/docs/free-cloud-features#compute),
a VM e2-micro inclui apenas 1 GB mensal de saída nos destinos elegíveis. Esse
limite não atende ao cenário de vídeo avaliado. Créditos temporários de testes
não são equivalentes a hospedagem gratuita contínua.

A recomendação é verificar primeiro elegibilidade de cadastro e disponibilidade
Always Free na Oracle. Não existe garantia de serviço gratuito permanente ou de
dez reproduções simultâneas. Nenhum provedor foi conectado ou testado com a
aplicação; não houve criação de conta, contratação, alteração funcional ou deploy.
