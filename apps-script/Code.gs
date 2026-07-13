/**
 * REGISTRO DE DESPESAS — API (Google Apps Script)
 * -------------------------------------------------
 * Este arquivo funciona como uma API JSON. Ele NÃO serve mais o HTML —
 * quem serve o HTML/CSS/JS agora é o GitHub P  ages (pasta /site). Este
 * projeto aqui só recebe requisições (fetch) do site e lê/grava na
 * planilha do Google Sheets.
 *
 * Abas usadas na planilha (criadas automaticamente no primeiro acesso):
 *  - "Parcelas"   -> cada linha é UMA parcela de UMA compra/empréstimo
 *  - "MesConfig"  -> vencimento (1ª linha do mês) + pagamentos avulsos (demais linhas)
 */

// ======================= CONFIGURAÇÃO =======================

const USUARIO_VALIDO = 'Aline';
const SENHA_VALIDA = 'aurora08';

const ABA_PARCELAS = 'Parcelas';
const ABA_MESCONFIG = 'MesConfig';

const COLS_PARCELAS = [
  'ID', 'ID_Compra', 'Descricao', 'Data_Compra', 'Valor_Total',
  'Parcela_Atual', 'Total_Parcelas', 'Valor_Parcela', 'Mes_Referencia',
  'Status_Pago', 'Valor_Pago', 'Data_Pagamento', 'Finalizado', 'EhEmprestimo'
];

const COLS_MESCONFIG = ['ID', 'Mes', 'Vencimento', 'Valor_Avulso', 'Data_Avulso'];

// ======================= ENTRADA DA API (doGet / doPost) =======================

/**
 * Requisições de LEITURA vêm por GET, como:
 * .../exec?action=getMonthData&mes=2026-08
 */
function doGet(e) {
  const params = (e && e.parameter) ? e.parameter : {};
  return responderJson_(executarAcao_(params.action, params));
}

/**
 * Requisições de ESCRITA (ou leitura, tanto faz) vêm por POST, com corpo
 * em JSON: { "action": "addCompra", "payload": {...} }
 */
function doPost(e) {
  let body = {};
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    body = { action: (e.parameter && e.parameter.action), payload: e.parameter };
  }
  return responderJson_(executarAcao_(body.action, body.payload || {}));
}

function responderJson_(objeto) {
  return ContentService
    .createTextOutput(JSON.stringify(objeto))
    .setMimeType(ContentService.MimeType.JSON);
}

function executarAcao_(action, payload) {
  payload = payload || {};
  try {
    switch (action) {
      case 'login':
        return { ok: login(payload.usuario, payload.senha) };
      case 'getMonthData':
        return { ok: true, dados: getMonthData(payload.mes) };
      case 'addCompra':
        return addCompra(payload);
      case 'updateParcela':
        return updateParcela(payload.id, payload.mudancas || {});
      case 'editarParcela':
        return editarParcela(payload.id, payload.dados || {});
      case 'editarCompra':
        return editarCompra(payload);
      case 'excluirParcela':
        return excluirParcela(payload.id);
      case 'excluirParcelasApartir':
        return excluirParcelasApartir(payload.id);
      case 'setMesConfig':
        return setMesConfig(payload.mes, payload.dados || {});
      case 'addAvulso':
        return addAvulso(payload);
      case 'editarAvulso':
        return editarAvulso(payload.id, payload.dados || {});
      case 'excluirAvulso':
        return excluirAvulso(payload.id);
      case 'marcarTodosPagos':
        return marcarTodosPagos(payload.mes);
      case 'debugInfo':
        return { ok: true, dados: debugInfo() };
      default:
        return { ok: false, erro: 'Ação desconhecida: ' + action };
    }
  } catch (err) {
    return { ok: false, erro: err.message };
  }
}

// ======================= AUTENTICAÇÃO =======================

function login(usuario, senha) {
  return usuario === USUARIO_VALIDO && senha === SENHA_VALIDA;
}

// ======================= HELPERS DE PLANILHA =======================

function getSheet_(nome, cols) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(nome);
  if (!sheet) {
    sheet = ss.insertSheet(nome);
    sheet.appendRow(cols);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Colunas que representam um "mês" no formato texto "YYYY-MM". O Google
// Sheets às vezes converte esse texto automaticamente para uma data real
// dentro da célula; aqui a gente normaliza de volta para "YYYY-MM" para
// que as comparações por string continuem funcionando.
const COLUNAS_MES_ = ['Mes_Referencia', 'Mes'];

function sheetToObjects_(sheet, cols) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, cols.length).getValues();
  const out = [];
  values.forEach((row, idx) => {
    if (row.every(c => c === '' || c === null)) return;
    const obj = {};
    cols.forEach((c, i) => {
      let valor = row[i];
      if (COLUNAS_MES_.indexOf(c) !== -1 && valor instanceof Date) {
        valor = mesKeyFromDate_(valor);
      }
      obj[c] = valor;
    });
    obj._row = idx + 2;
    out.push(obj);
  });
  return out;
}

function gerarId_() {
  return Utilities.getUuid();
}

// ======================= HELPERS DE MÊS (YYYY-MM) =======================

function mesKeyFromDate_(date) {
  const d = (date instanceof Date) ? date : new Date(date);
  const y = d.getFullYear();
  const m = ('0' + (d.getMonth() + 1)).slice(-2);
  return y + '-' + m;
}

function addMonths_(mesKey, n) {
  const [y, m] = mesKey.split('-').map(Number);
  const d = new Date(y, (m - 1) + n, 1);
  return mesKeyFromDate_(d);
}

const NOMES_MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

function formatarMes_(mesKey) {
  const [y, m] = mesKey.split('-').map(Number);
  return NOMES_MESES[m - 1] + ' de ' + y;
}

// ======================= LÓGICA FINANCEIRA =======================

/**
 * Convenção: valor positivo = "Saldo" (crédito); valor negativo = "Débito".
 */
function getSaldoAnterior_(mesAlvo, parcelasPorMes, configPorMes, avulsosPorMes) {
  const mesesSet = new Set(Object.keys(parcelasPorMes).concat(Object.keys(configPorMes)).concat(Object.keys(avulsosPorMes)));
  const meses = Array.from(mesesSet);
  if (meses.length === 0) return 0;
  meses.sort();
  let mesAtual = meses[0];

  if (mesAtual >= mesAlvo) return 0;

  let saldo = 0;
  while (mesAtual < mesAlvo) {
    const parcelas = parcelasPorMes[mesAtual] || [];
    const totalDebitoMesAtual = parcelas.reduce((s, p) => s + (Number(p.Valor_Parcela) || 0), 0);
    const totalDebitoGeral = totalDebitoMesAtual - saldo;

    const avulsos = avulsosPorMes[mesAtual] || [];
    const totalAvulsos = avulsos.reduce((s, a) => s + (Number(a.Valor_Avulso) || 0), 0);
    const totalPago = parcelas.reduce((s, p) => {
      return s + (p.Status_Pago === true ? (Number(p.Valor_Pago) || Number(p.Valor_Parcela) || 0) : 0);
    }, 0) + totalAvulsos;

    saldo = totalPago - totalDebitoGeral;
    mesAtual = addMonths_(mesAtual, 1);
  }
  return saldo;
}

function agruparPorMes_(lista, chave) {
  const mapa = {};
  lista.forEach(item => {
    const mes = item[chave];
    if (!mapa[mes]) mapa[mes] = [];
    mapa[mes].push(item);
  });
  return mapa;
}

function agruparConfigPorMes_(lista) {
  const mapa = {};
  lista.forEach(item => {
    if (item.Vencimento !== '' && item.Vencimento !== undefined && item.Vencimento !== null) {
      mapa[item.Mes] = item;
    }
  });
  return mapa;
}

function agruparAvulsosPorMes_(lista) {
  const mapa = {};
  lista.forEach(item => {
    if (item.Valor_Avulso !== '' && item.Valor_Avulso !== undefined && item.Valor_Avulso !== null) {
      if (!mapa[item.Mes]) mapa[item.Mes] = [];
      mapa[item.Mes].push(item);
    }
  });
  return mapa;
}

function getMonthData(mesKey) {
  const sheetParcelas = getSheet_(ABA_PARCELAS, COLS_PARCELAS);
  const sheetConfig = getSheet_(ABA_MESCONFIG, COLS_MESCONFIG);

  const todasParcelas = sheetToObjects_(sheetParcelas, COLS_PARCELAS);
  const todosConfigs = sheetToObjects_(sheetConfig, COLS_MESCONFIG);

  const parcelasPorMes = agruparPorMes_(todasParcelas, 'Mes_Referencia');
  const configPorMes = agruparConfigPorMes_(todosConfigs);
  const avulsosPorMes = agruparAvulsosPorMes_(todosConfigs);

  const parcelasDoMes = (parcelasPorMes[mesKey] || []).sort((a, b) => {
    return new Date(a.Data_Compra) - new Date(b.Data_Compra);
  });

  let cfg = configPorMes[mesKey];
  if (!cfg) {
    cfg = { Mes: mesKey, Vencimento: 10, Valor_Avulso: '', Data_Avulso: '' };
  }

  const totalDebitoMesAtual = parcelasDoMes.reduce((s, p) => s + (Number(p.Valor_Parcela) || 0), 0);
  const saldoAnterior = getSaldoAnterior_(mesKey, parcelasPorMes, configPorMes, avulsosPorMes);
  const totalDebitoGeral = totalDebitoMesAtual - saldoAnterior;

  const avulsos = getAvulsos(mesKey);
  const totalAvulsos = avulsos.reduce((s, a) => s + (Number(a.Valor_Avulso) || 0), 0);
  const totalPago = parcelasDoMes.reduce((s, p) => {
    return s + (p.Status_Pago === true ? (Number(p.Valor_Pago) || Number(p.Valor_Parcela) || 0) : 0);
  }, 0) + totalAvulsos;

  const saldoPendente = totalDebitoGeral - totalPago;

  return {
    mesReferencia: mesKey,
    mesReferenciaLabel: formatarMes_(mesKey),
    mesPagamento: addMonths_(mesKey, 1),
    mesPagamentoLabel: formatarMes_(addMonths_(mesKey, 1)),
    vencimento: cfg.Vencimento || 10,
    avulsos: avulsos.map(a => ({
      id: a.ID,
      valor: a.Valor_Avulso,
      data: a.Data_Avulso
    })),
    saldoAnterior: saldoAnterior,
    totalDebitoMesAtual: totalDebitoMesAtual,
    totalDebitoGeral: totalDebitoGeral,
    totalPago: totalPago,
    saldoPendente: saldoPendente,
    parcelas: parcelasDoMes.map(p => ({
      id: p.ID,
      idCompra: p.ID_Compra,
      descricao: p.Descricao,
      dataCompra: p.Data_Compra,
      valorTotal: p.Valor_Total,
      parcelaAtual: p.Parcela_Atual,
      totalParcelas: p.Total_Parcelas,
      valorParcela: p.Valor_Parcela,
      pago: p.Status_Pago === true,
      valorPago: p.Valor_Pago,
      dataPagamento: p.Data_Pagamento,
      finalizado: p.Finalizado === true,
      ehEmprestimo: p.EhEmprestimo === true,
      mesReferencia: p.Mes_Referencia
    }))
  };
}

// ======================= CRUD: COMPRAS / PARCELAS =======================

function addCompra(dados) {
  const sheet = getSheet_(ABA_PARCELAS, COLS_PARCELAS);
  const idCompra = gerarId_();
  const mesCompra = mesKeyFromDate_(dados.dataCompra);
  const totalParcelas = Number(dados.totalParcelas) || 1;
  const valorParcela = Number(dados.valorParcela);
  const valorTotal = Number(dados.valorTotal);

  const ehEmprestimo = dados.ehEmprestimo === true || dados.ehEmprestimo === 'true';
  const dataCompra = new Date(dados.dataCompra);
  const diaCompra = dataCompra.getDate();
  const offsetBase = ehEmprestimo ? 1 : ((diaCompra >= 3 && diaCompra <= 28) ? 0 : 1);

  const linhas = [];
  for (let i = 1; i <= totalParcelas; i++) {
    const mesRef = addMonths_(mesCompra, offsetBase + i - 1);
    linhas.push([
      gerarId_(), idCompra, dados.descricao, dados.dataCompra, valorTotal,
      i, totalParcelas, valorParcela, mesRef,
      false, '', '', false, ehEmprestimo
    ]);
  }
  sheet.getRange(sheet.getLastRow() + 1, 1, linhas.length, COLS_PARCELAS.length).setValues(linhas);
  return { ok: true, idCompra: idCompra };
}

function editarCompra(dados) {
  const sheet = getSheet_(ABA_PARCELAS, COLS_PARCELAS);
  const todas = sheetToObjects_(sheet, COLS_PARCELAS);
  const existentes = todas.filter(function(p) { return p.ID_Compra === dados.idCompra; });

  if (existentes.length === 0) return { ok: false, erro: 'Registro não encontrado.' };

  // Excluir linhas existentes (de baixo para cima)
  existentes.sort(function(a, b) { return b._row - a._row; });
  existentes.forEach(function(p) { sheet.deleteRow(p._row); });

  // Criar novas parcelas
  const totalParcelas = Number(dados.totalParcelas) || 1;
  const valorParcela = Number(dados.valorParcela);
  const valorTotal = Number(dados.valorTotal);
  const ehEmprestimo = dados.ehEmprestimo === true || dados.ehEmprestimo === 'true';
  const mesBase = dados.mesPrimeiraParcela || mesKeyFromDate_(dados.dataCompra);

  var linhas = [];
  for (var i = 1; i <= totalParcelas; i++) {
    var mesRef = addMonths_(mesBase, i - 1);
    linhas.push([
      gerarId_(), dados.idCompra, dados.descricao, dados.dataCompra, valorTotal,
      i, totalParcelas, valorParcela, mesRef,
      false, '', '', false, ehEmprestimo
    ]);
  }
  if (linhas.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, linhas.length, COLS_PARCELAS.length).setValues(linhas);
  }

  return { ok: true };
}

function encontrarLinhaPorId_(sheet, id) {
  const dados = sheetToObjects_(sheet, COLS_PARCELAS);
  return dados.find(d => d.ID === id);
}

function updateParcela(id, mudancas) {
  const sheet = getSheet_(ABA_PARCELAS, COLS_PARCELAS);
  const linha = encontrarLinhaPorId_(sheet, id);
  if (!linha) return { ok: false, erro: 'Registro não encontrado.' };

  const colIndex = {};
  COLS_PARCELAS.forEach((c, i) => colIndex[c] = i + 1);

  if (mudancas.pago !== undefined) {
    sheet.getRange(linha._row, colIndex['Status_Pago']).setValue(mudancas.pago);
    if (mudancas.pago) {
      const valorPago = mudancas.valorPago !== undefined && mudancas.valorPago !== ''
        ? Number(mudancas.valorPago) : Number(linha.Valor_Parcela);
      sheet.getRange(linha._row, colIndex['Valor_Pago']).setValue(valorPago);
      sheet.getRange(linha._row, colIndex['Data_Pagamento']).setValue(mudancas.dataPagamento || new Date());
      if (Number(linha.Parcela_Atual) === Number(linha.Total_Parcelas)) {
        sheet.getRange(linha._row, colIndex['Finalizado']).setValue(true);
      }
    } else {
      sheet.getRange(linha._row, colIndex['Valor_Pago']).setValue('');
      sheet.getRange(linha._row, colIndex['Data_Pagamento']).setValue('');
      sheet.getRange(linha._row, colIndex['Finalizado']).setValue(false);
    }
  }

  if (mudancas.valorPago !== undefined && mudancas.pago === undefined) {
    sheet.getRange(linha._row, colIndex['Valor_Pago']).setValue(Number(mudancas.valorPago));
  }
  if (mudancas.dataPagamento !== undefined && mudancas.pago === undefined) {
    sheet.getRange(linha._row, colIndex['Data_Pagamento']).setValue(mudancas.dataPagamento);
  }

  return { ok: true };
}

function editarParcela(id, dados) {
  const sheet = getSheet_(ABA_PARCELAS, COLS_PARCELAS);
  const linha = encontrarLinhaPorId_(sheet, id);
  if (!linha) return { ok: false, erro: 'Registro não encontrado.' };

  const colIndex = {};
  COLS_PARCELAS.forEach((c, i) => colIndex[c] = i + 1);

  if (dados.descricao !== undefined) sheet.getRange(linha._row, colIndex['Descricao']).setValue(dados.descricao);
  if (dados.valorParcela !== undefined) sheet.getRange(linha._row, colIndex['Valor_Parcela']).setValue(Number(dados.valorParcela));
  if (dados.dataCompra !== undefined) sheet.getRange(linha._row, colIndex['Data_Compra']).setValue(dados.dataCompra);
  if (dados.valorTotal !== undefined) sheet.getRange(linha._row, colIndex['Valor_Total']).setValue(Number(dados.valorTotal));
  if (dados.ehEmprestimo !== undefined) sheet.getRange(linha._row, colIndex['EhEmprestimo']).setValue(dados.ehEmprestimo === true || dados.ehEmprestimo === 'true');

  return { ok: true };
}

function excluirParcela(id) {
  const sheet = getSheet_(ABA_PARCELAS, COLS_PARCELAS);
  const linha = encontrarLinhaPorId_(sheet, id);
  if (!linha) return { ok: false, erro: 'Registro não encontrado.' };
  sheet.deleteRow(linha._row);
  return { ok: true };
}

function excluirParcelasApartir(id) {
  const sheet = getSheet_(ABA_PARCELAS, COLS_PARCELAS);
  const linha = encontrarLinhaPorId_(sheet, id);
  if (!linha) return { ok: false, erro: 'Registro não encontrado.' };

  const idCompra = linha.ID_Compra;
  const parcelaAtual = Number(linha.Parcela_Atual);
  const todas = sheetToObjects_(sheet, COLS_PARCELAS);
  const aExcluir = todas.filter(function(p) {
    return p.ID_Compra === idCompra && Number(p.Parcela_Atual) >= parcelaAtual;
  });

  // Excluir de baixo para cima para não bagunçar os índices
  aExcluir.sort(function(a, b) { return b._row - a._row; });
  aExcluir.forEach(function(p) { sheet.deleteRow(p._row); });

  return { ok: true, excluidas: aExcluir.length };
}

function marcarTodosPagos(mesKey) {
  const sheet = getSheet_(ABA_PARCELAS, COLS_PARCELAS);
  const todas = sheetToObjects_(sheet, COLS_PARCELAS);
  const doMes = todas.filter(function(p) {
    return p.Mes_Referencia === mesKey && p.Status_Pago !== true;
  });

  const colIndex = {};
  COLS_PARCELAS.forEach(function(c, i) { colIndex[c] = i + 1; });

  var contagem = 0;
  doMes.forEach(function(p) {
    sheet.getRange(p._row, colIndex['Status_Pago']).setValue(true);
    sheet.getRange(p._row, colIndex['Valor_Pago']).setValue(Number(p.Valor_Parcela));
    sheet.getRange(p._row, colIndex['Data_Pagamento']).setValue(new Date());
    if (Number(p.Parcela_Atual) === Number(p.Total_Parcelas)) {
      sheet.getRange(p._row, colIndex['Finalizado']).setValue(true);
    }
    contagem++;
  });

  return { ok: true, marcadas: contagem };
}

// ======================= CONFIGURAÇÃO DO MÊS =======================

function setMesConfig(mesKey, dados) {
  const sheet = getSheet_(ABA_MESCONFIG, COLS_MESCONFIG);
  const registros = sheetToObjects_(sheet, COLS_MESCONFIG);
  const existente = registros.find(r => r.Mes === mesKey && r.Vencimento !== '' && r.Vencimento !== undefined && r.Vencimento !== null);

  const colIndex = {};
  COLS_MESCONFIG.forEach((c, i) => colIndex[c] = i + 1);

  if (existente) {
    if (dados.vencimento !== undefined) sheet.getRange(existente._row, colIndex['Vencimento']).setValue(dados.vencimento);
  } else {
    sheet.appendRow([
      gerarId_(), mesKey,
      dados.vencimento !== undefined ? dados.vencimento : 10,
      '', ''
    ]);
  }
  return { ok: true };
}

// ======================= AVULSOS (armazenados na aba MesConfig) =======================

function getAvulsos(mesKey) {
  const sheet = getSheet_(ABA_MESCONFIG, COLS_MESCONFIG);
  const todos = sheetToObjects_(sheet, COLS_MESCONFIG);
  return todos.filter(a => a.Mes === mesKey && a.Valor_Avulso !== '' && a.Valor_Avulso !== undefined && a.Valor_Avulso !== null)
    .sort((a, b) => new Date(a.Data_Avulso) - new Date(b.Data_Avulso));
}

function addAvulso(dados) {
  const sheet = getSheet_(ABA_MESCONFIG, COLS_MESCONFIG);
  sheet.appendRow([gerarId_(), dados.mes, '', Number(dados.valor), dados.data]);
  return { ok: true };
}

function editarAvulso(id, dados) {
  const sheet = getSheet_(ABA_MESCONFIG, COLS_MESCONFIG);
  const registros = sheetToObjects_(sheet, COLS_MESCONFIG);
  const registro = registros.find(r => r.ID === id);
  if (!registro) return { ok: false, erro: 'Registro não encontrado.' };

  const colIndex = {};
  COLS_MESCONFIG.forEach((c, i) => colIndex[c] = i + 1);

  if (dados.valor !== undefined) sheet.getRange(registro._row, colIndex['Valor_Avulso']).setValue(Number(dados.valor));
  if (dados.data !== undefined) sheet.getRange(registro._row, colIndex['Data_Avulso']).setValue(dados.data);

  return { ok: true };
}

function excluirAvulso(id) {
  const sheet = getSheet_(ABA_MESCONFIG, COLS_MESCONFIG);
  const registros = sheetToObjects_(sheet, COLS_MESCONFIG);
  const registro = registros.find(r => r.ID === id);
  if (!registro) return { ok: false, erro: 'Registro não encontrado.' };
  sheet.deleteRow(registro._row);
  return { ok: true };
}

// ======================= DIAGNÓSTICO =======================

function debugInfo() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getSheet_(ABA_PARCELAS, COLS_PARCELAS);
  const dados = sheetToObjects_(sheet, COLS_PARCELAS);
  return {
    planilhaId: ss.getId(),
    planilhaNome: ss.getName(),
    totalLinhasNaAba: sheet.getLastRow(),
    totalRegistrosLidos: dados.length,
    primeirosRegistros: dados.slice(0, 3)
  };
}
