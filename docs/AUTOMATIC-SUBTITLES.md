# Tradução automática local de legendas

O player pode traduzir uma faixa existente para português por solicitação do
usuário. O servidor preserva os tempos e a ordem das falas, traduz somente o
texto e identifica o resultado como automático. A opção utiliza uma faixa
emitida para aquela fonte e episódio; a API não aceita uma URL ou texto enviado
pelo navegador para iniciar a tradução.

Essa opção exige uma legenda de origem. Ela não transcreve o áudio de um vídeo
sem legendas e não corrige a sincronização de uma faixa já dessincronizada.
Também não valida a identidade do vídeo: essa correspondência depende da fonte.

## Instalação local

Com Python 3 e suporte a `venv` disponíveis, execute na raiz do projeto:

```bash
npm run setup:translator
npm run dev
```

O host local inicia o tradutor quando encontra o modelo instalado e reutiliza
um serviço já ativo. Para iniciar somente o tradutor, execute
`~/.cache/hpmovies/subtitle-translator/venv/bin/python scripts/subtitle-translator.py`.

O instalador cria um ambiente Python isolado em
`~/.cache/hpmovies/subtitle-translator`, instala CTranslate2 e SentencePiece e
baixa o modelo oficial Argos EN→PT-BR 1.9, de aproximadamente 66 MB. Nenhum modelo,
arquivo de legenda ou dependência Python entra no Git ou no bundle do frontend.
O download verifica o SHA-256 revisado antes de extrair o arquivo. O README com
a atribuição original permanece junto ao modelo instalado.

O serviço escuta somente em `127.0.0.1:5000`. A tradução funciona em CPU, sem chave
de API, cobrança por uso ou envio das falas a um serviço remoto. O download do
modelo e a instalação das dependências exigem internet; as traduções posteriores
usam o modelo local. `HPMOVIES_TRANSLATOR_HOME` altera o diretório de instalação
e `HPMOVIES_TRANSLATOR_PORT` altera a porta do serviço.
Para um cache personalizado, exporte `HPMOVIES_TRANSLATOR_HOME` no shell antes
do setup e do `npm run dev`; o instalador Python não lê o arquivo `.env`.

A configuração da API é:

```dotenv
AUTOMATIC_SUBTITLES_ENABLED=true
AUTOMATIC_SUBTITLES_URL=http://127.0.0.1:5000
```

A consulta de disponibilidade fica em cache por quinze segundos. Se o serviço
local não estiver ativo, a reprodução continua e a opção de tradução não é
anunciada. Para outra porta, configure a mesma porta na URL da API e no serviço.

## Contrato, limites e privacidade

O serviço Python implementa somente o subconjunto `/languages` e `/translate`
do [contrato de tradução do LibreTranslate](https://docs.libretranslate.com/api/operations/translate/).
Ele não instala nem executa o aplicativo LibreTranslate. Uma instalação local
compatível do LibreTranslate também pode ser configurada pela URL; ela precisa
aceitar lotes de textos sem chave e anunciar o destino `pt`. Apenas URLs de raiz
em localhost ou endereços de loopback, sem credenciais e parâmetros, são aceitas.

O serviço fornecido traduz apenas inglês para português brasileiro. A interface
do provider usa o código genérico `pt`, pois uma instância alternativa do
LibreTranslate pode oferecer outra variante de português. Não há inferência de
idioma a partir do nome da fonte.

Cada arquivo aceita até 4.000 falas e 200.000 caracteres de diálogo. Os lotes
contêm até 32 textos e 4.000 caracteres. A tradução recusa falas que excedam os
limites do modelo, em vez de truncá-las. Há limite de dois trabalhos simultâneos,
45 segundos por lote e cinco minutos por arquivo. Uma falha não entrega um
arquivo parcialmente traduzido. Os resultados completos são mantidos somente
em memória, por até uma hora, com limite de 64 arquivos e 16 MB. Reiniciar a API
invalida os tickets; o usuário pode solicitar a tradução novamente.

O serviço não registra as falas ou URLs das requisições. Apenas a API local
acessa o modelo. A geração deve ser iniciada pelo botão do player e o resultado
mantém o aviso “Tradução automática: pode conter erros.” no painel **Sua experiência**,
fora da imagem do vídeo, enquanto a faixa automática estiver selecionada. Faixas portuguesas já
disponíveis continuam preferidas na seleção inicial.

## Modelo e atribuição

O modelo consta no [índice oficial do Argos](https://github.com/argosopentech/argospm-index/blob/main/index.json)
como `translate-en_pb-1_9.argosmodel`. O README original atribui o OPUS-MT a
Jörg Tiedemann e Santhosh Thottingal, “OPUS-MT — Building open translation services
for the World”, EAMT 2020. O modelo de origem é distribuído sob
[Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
A aplicação não redistribui o modelo; o instalador conserva a atribuição no
cache local. CTranslate2 e SentencePiece mantêm suas licenças nas distribuições
instaladas pelo pip.

## Verificação desta etapa

Em 27/10/2026, o instalador foi executado e o serviço local traduziu duas falas
originais de teste em aproximadamente 55 ms. O resultado continha português
correto e preservava exatamente os dois intervalos. Essa amostra verifica o
caminho real do modelo, mas não comprova a qualidade ou sincronização de um
episódio de anime. Os testes unitários usam respostas isoladas para verificar
preservação dos tempos, lotes, falhas, cache, concorrência e limites.

Depois dessa amostra, o fallback também foi executado em Clevatess II S02E01:
400 entradas traduzidas, arquivo completo carregado pelo player, vídeo e áudio
decodificados, seek e texto português visível em desktop e celular. O aviso de
tradução automática permaneceu visível e não houve overflow ou erro observado.
Isso valida o fluxo real, sem constituir revisão de qualidade de todas as falas.
Veja a [revisão das fontes e suas evidências](SOURCE-REVIEW-2026-10-27.md).

```bash
npm test -- --run tests/automatic-subtitles.test.ts
```
