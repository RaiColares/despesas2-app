# Registro de Despesas — Site (GitHub Pages) + API (Google Apps Script)

Essa é a versão com HTML, CSS e JS separados, pensada pra você subir num
repositório do GitHub e publicar com o GitHub Pages. O Google Sheets
continua sendo o banco de dados, e o Google Apps Script vira uma **API**
que o site chama via `fetch`.

```
apps-script/
  Code.gs        → cole no editor do Apps Script (é a API)
site/
  index.html     → estrutura da página
  style.css      → visual
  script.js      → toda a lógica (chama a API via fetch)
  config.js      → aqui você cola a URL da sua API
```

## Parte 1 — Publicar a API no Apps Script

1. Crie uma planilha nova no [sheets.google.com](https://sheets.google.com)
   (pode deixar em branco).
2. **Extensões → Apps Script**.
3. Apague o conteúdo de `Code.gs` e cole o conteúdo do arquivo
   **`apps-script/Code.gs`** que te entreguei.
4. Salve (Ctrl+S).
5. **Implantar → Nova implantação**:
   - Tipo: **App da Web**
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa**
   - Clique em **Implantar** e autorize o acesso quando pedir.
6. Copie o link gerado — ele termina em `/exec`. É a URL da sua API.

⚠️ Sempre que você editar o `Code.gs` depois, use **Implantar → Gerenciar
implantações → editar (lápis) → Nova versão → Implantar**, editando a
**mesma implantação** — assim a URL `/exec` continua a mesma e você não
corre o risco de ficar testando uma versão antiga sem perceber (isso foi o
que causou a maior parte da nossa dor de cabeça na v1 😅).

## Parte 2 — Publicar o site no GitHub Pages

1. Crie um repositório novo no GitHub (pode ser público ou privado, desde
   que o GitHub Pages esteja disponível no seu plano).
2. Suba os 4 arquivos da pasta `site/` para a raiz do repositório (ou para
   uma pasta `docs/`, se preferir — só ajuste a configuração do Pages de
   acordo).
3. Antes de subir, abra o **`config.js`** e troque:
   ```js
   const API_URL = 'COLE_AQUI_A_URL_DO_SEU_APPS_SCRIPT/exec';
   ```
   pela URL real que você copiou na Parte 1.
4. No repositório, vá em **Settings → Pages**, escolha a branch (geralmente
   `main`) e a pasta (`/root` ou `/docs`, conforme onde você colocou os
   arquivos), e salve.
5. Em alguns minutos, o GitHub te dá um link do tipo
   `https://seu-usuario.github.io/nome-do-repo/` — é esse o endereço fixo
   do seu sistema a partir de agora.

Esse link **não muda** a cada atualização — só dar `git push` que o site
já reflete as mudanças (o GitHub Pages atualiza sozinho, geralmente em menos
de 1 minuto).

## Login

- **Usuário:** Aline
- **Senha:** aurora08

(Continuam configuráveis no topo do `Code.gs`, nas constantes
`USUARIO_VALIDO` e `SENHA_VALIDA` — lembre de reimplantar depois de mudar.)

## Por que GET para ler e POST para escrever?

O `script.js` usa `fetch` de duas formas:
- **Leitura** (`getMonthData`): via **GET**, simples e sem restrição de
  CORS.
- **Escrita** (`addCompra`, `updateParcela` etc.): via **POST**, mas com
  `Content-Type: text/plain`. Isso é de propósito — evita que o navegador
  dispare uma requisição de "pre-flight" (OPTIONS) que o Apps Script não
  responde, o que quebraria a chamada. O `Code.gs` já sabe interpretar o
  corpo como JSON independentemente desse cabeçalho.

## Se algo não aparecer

Se os registros não aparecerem depois de tudo publicado, quase sempre é
por um destes três motivos (nessa ordem de probabilidade):
1. O `config.js` ainda está com a URL de exemplo, não a sua URL real.
2. Você editou o `Code.gs` mas esqueceu de reimplantar como **Nova
   versão** na implantação existente.
3. A primeira parcela de uma compra cai no **mês seguinte** ao da compra
   (regra do sistema) — então é preciso navegar pra frente uma vez pra
   ver o primeiro registro.
