# 🏷️ Unificador de Etiquetas ML

Extensão para Chrome que intercepta o download de etiquetas de envio do Mercado Livre e entrega o PDF já unificado — etiqueta de transporte, DANFE simplificado com o código de acesso e código de barras, tudo em um único arquivo, automaticamente.

![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)
![Licença MIT](https://img.shields.io/badge/licença-MIT-green)

## ✨ O que ela faz

No fluxo padrão do Mercado Livre, imprimir etiquetas gera um PDF com a etiqueta de transporte em uma página e o DANFE completo na página seguinte, alternando assim para cada pedido. Isso deixa a impressão pouco prática para quem despacha vários pedidos por dia.

Esta extensão resolve isso automaticamente:

- Intercepta o clique em **"Imprimir arquivos de envio"** / **"Imprimir etiqueta"** antes do download começar
- Extrai a chave de acesso e o destinatário do DANFE de cada pedido
- Gera um código de barras (CODE128) a partir da chave de acesso
- Sobrepõe essas informações resumidas diretamente na página da etiqueta de transporte
- Baixa um único PDF já pronto para impressão, com sufixo `_unificado.pdf`

Todo o processamento acontece localmente, no navegador — nenhum arquivo é enviado a servidores externos.

## 📦 Instalação (modo desenvolvedor)

A extensão ainda não está publicada na Chrome Web Store. Para instalar manualmente:

1. Baixe ou clone este repositório
2. Abra `chrome://extensions` no Chrome
3. Ative o **"Modo do desenvolvedor"** no canto superior direito
4. Clique em **"Carregar sem compactação"**
5. Selecione a pasta do repositório
6. O ícone da extensão vai aparecer na barra de ferramentas — clique nele para confirmar que está **"Ativo"**

## 🖥️ Como usar

Com a extensão ativa, basta usar o Mercado Livre normalmente:

1. Acesse a área de vendas do Mercado Livre e clique para imprimir as etiquetas de envio
2. A extensão intercepta o download automaticamente, processa o PDF e baixa a versão unificada
3. Uma notificação do Chrome confirma o resultado

Se algo der errado durante o processamento, a extensão baixa o PDF original sem modificações como medida de segurança, para você nunca ficar sem o arquivo.

## 🏗️ Arquitetura

```
├── manifest.json         # Configuração da extensão (Manifest V3)
├── background.js         # Service worker — intercepta downloads e orquestra o processamento
├── content-main.js       # Content script (MAIN world) — captura os blobs PDF criados pela página
├── content-relay.js      # Content script (isolated world) — ponte entre o content-main.js e o background.js
├── offscreen.html/.js    # Offscreen document — processa o PDF (extração de dados, código de barras, merge)
├── popup.html/.js        # Popup da extensão — liga/desliga o processamento
├── lib/                  # Bibliotecas de terceiros, servidas localmente (pdf-lib, pdf.js, JsBarcode)
└── images/               # Ícones da extensão
```

### Por que essa arquitetura em três camadas?

O Mercado Livre gera a etiqueta como um `blob:` URL dentro da própria aba — e blob URLs só existem no documento que os criou. Um service worker (`background.js`) não tem acesso a esse blob, então a extensão usa duas camadas de content script:

- **`content-main.js`** roda no *MAIN world* da página, o único contexto com acesso direto ao blob. Ele intercepta `URL.createObjectURL` e lê os bytes do PDF assim que são criados.
- **`content-relay.js`** roda no *isolated world* padrão de extensões, com acesso a `chrome.runtime` e `chrome.storage`, mas sem acesso ao blob da página. Ele repassa os dados capturados para o `background.js`.

O processamento em si (extração de texto, geração de código de barras) acontece em um **offscreen document**, porque depende de `<canvas>`, indisponível em service workers.

## 🔒 Permissões utilizadas

| Permissão | Motivo |
|---|---|
| `downloads` | Interceptar e substituir o download da etiqueta original |
| `offscreen` | Processar o PDF em um contexto com DOM/canvas |
| `storage` | Guardar a preferência de ativado/desativado |
| `notifications` | Avisar sobre sucesso ou falha no processamento |

O `host_permissions` é restrito a `vendedores.mercadolivre.com.br/vendas/*` — a extensão não roda em nenhum outro site.

## 🛠️ Tecnologias

- [pdf-lib](https://pdf-lib.js.org/) — criação e manipulação do PDF final
- [pdf.js](https://mozilla.github.io/pdf.js/) — extração de texto do DANFE
- [JsBarcode](https://github.com/lindell/JsBarcode) — geração do código de barras CODE128

Todas as bibliotecas são servidas localmente (pasta `lib/`), como exige o CSP de extensões Manifest V3.

## ⚠️ Aviso

Este é um projeto independente, sem qualquer vínculo com o Mercado Livre. Use por sua conta e risco.

## 📄 Licença

Distribuído sob a licença MIT. Veja [LICENSE](LICENSE) para mais detalhes.
