// ---------------------------------------------------------------
// COMUNICAÇÃO COM A API (Google Apps Script)
// ---------------------------------------------------------------

/**
 * Ações de LEITURA vão por GET (mais simples, sem problema de CORS).
 */
function apiGet(action, params) {
  params = params || {};
  const query = Object.keys(params)
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
    .join('&');
  const url = API_URL + '?action=' + encodeURIComponent(action) + (query ? '&' + query : '');
  return fetch(url).then(r => r.json());
}

/**
 * Ações de ESCRITA vão por POST. Usamos Content-Type: text/plain de
 * propósito: isso evita que o navegador dispare uma requisição de
 * "preflight" (OPTIONS) antes do POST, que o Apps Script não sabe
 * responder e quebraria a chamada.
 */
function apiPost(action, payload) {
  return fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: action, payload: payload || {} })
  }).then(r => r.json());
}

// ---------------------------------------------------------------
// ESTADO
// ---------------------------------------------------------------
let mesAtual = mesKeyHoje();
let dadosMes = null;
let idParaExcluir = null;
let idParaEditar = null;
let filtroAtivo = 'tudo';

const NOMES_MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

function mesKeyHoje(){
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
}

// ---------------------------------------------------------------
// LOGIN
// ---------------------------------------------------------------
function fazerLogin(){
  const usuario = document.getElementById('login-usuario').value.trim();
  const senha = document.getElementById('login-senha').value;
  document.getElementById('login-erro').textContent = '';

  apiPost('login', { usuario: usuario, senha: senha })
    .then(function(resp){
      if(resp.ok){
        document.getElementById('tela-login').style.display = 'none';
        document.getElementById('app').style.display = 'block';
        carregarMes();
      } else {
        document.getElementById('login-erro').textContent = 'Usuário ou senha incorretos.';
      }
    })
    .catch(erroGenerico);
}

function alternarSenha(){
  const input = document.getElementById('login-senha');
  input.type = input.type === 'password' ? 'text' : 'password';
}

function sair(){
  document.getElementById('app').style.display = 'none';
  document.getElementById('tela-login').style.display = 'flex';
  document.getElementById('login-usuario').value = '';
  document.getElementById('login-senha').value = '';
}

document.addEventListener('keydown', function(e){
  if(e.key === 'Enter' && document.getElementById('tela-login').style.display !== 'none'){
    fazerLogin();
  }
});

// ---------------------------------------------------------------
// CARREGAR MÊS
// ---------------------------------------------------------------
function carregarMes(){
  document.getElementById('lista-registros').innerHTML = '<div class="vazio">Carregando...</div>';
  apiGet('getMonthData', { mes: mesAtual })
    .then(function(resp){
      if(resp.ok){
        renderizarMes(resp.dados);
      } else {
        erroGenerico(resp.erro);
      }
    })
    .catch(erroGenerico);
}

function mudarMes(delta){
  const [y,m] = mesAtual.split('-').map(Number);
  const d = new Date(y, (m-1)+delta, 1);
  mesAtual = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
  carregarMes();
}

function formatarMoeda(v){
  v = Number(v) || 0;
  return v.toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
}

function formatarDataBR(v){
  if(!v) return '—';
  const d = new Date(v);
  if(isNaN(d)) return v;
  return d.toLocaleDateString('pt-BR', {timeZone:'UTC'});
}

function paraInputDate(v){
  if(!v) return '';
  const d = new Date(v);
  if(isNaN(d)) return '';
  return d.toISOString().slice(0,10);
}

function filtrar(tipo){
  filtroAtivo = tipo;
  document.querySelectorAll('.filtro-btn').forEach(function(b){ b.classList.remove('ativo'); });
  document.getElementById('filtro-' + tipo).classList.add('ativo');
  renderizarLista(dadosMes.parcelas);
}

function renderizarMes(dados){
  dadosMes = dados;
  document.getElementById('lbl-mes-ref').textContent = dados.mesReferenciaLabel;
  document.getElementById('lbl-mes-pag').textContent = dados.mesPagamentoLabel;
  document.getElementById('lbl-mes-lista').textContent = dados.mesReferenciaLabel;
  document.getElementById('input-vencimento').value = dados.vencimento;

  const saldoEl = document.getElementById('val-saldo-anterior');
  const saldoRotulo = document.getElementById('lbl-saldo-rotulo');
  if(dados.saldoAnterior >= 0){
    saldoRotulo.textContent = 'Crédito do Mês Anterior';
    saldoEl.textContent = formatarMoeda(dados.saldoAnterior);
    saldoEl.className = 'valor cor-saldo';
  } else {
    saldoRotulo.textContent = 'Débito do Mês Anterior';
    saldoEl.textContent = formatarMoeda(Math.abs(dados.saldoAnterior));
    saldoEl.className = 'valor cor-debito';
  }

  document.getElementById('val-debito-mes').textContent = formatarMoeda(dados.totalDebitoMesAtual);
  document.getElementById('val-debito-geral').textContent = formatarMoeda(dados.totalDebitoGeral);
  document.getElementById('val-total-pago').textContent = formatarMoeda(dados.totalPago);

  const pendEl = document.getElementById('val-pendente');
  const pendRotulo = document.getElementById('lbl-pendente-rotulo');
  if(dados.totalPago > dados.totalDebitoGeral){
    pendRotulo.textContent = 'Crédito Pendente';
    pendEl.textContent = formatarMoeda(dados.totalPago - dados.totalDebitoGeral);
    pendEl.className = 'valor cor-saldo';
  } else {
    pendRotulo.textContent = 'Débito Pendente';
    pendEl.textContent = formatarMoeda(dados.totalDebitoGeral - dados.totalPago);
    pendEl.className = 'valor cor-debito';
  }

  renderizarAvulsos(dados.avulsos || []);
  renderizarLista(dados.parcelas);
}

function renderizarAvulsos(avulsos){
  const container = document.getElementById('lista-avulsos');
  if(!avulsos || avulsos.length === 0){
    container.innerHTML = '<div class="vazio-avulsos">Nenhum pagamento avulso.</div>';
    return;
  }
  container.innerHTML = avulsos.map(function(a){
    return '<div class="avulso-item" data-id="'+a.id+'">' +
      '<div class="avulso-info">' +
        '<span class="avulso-valor">'+formatarMoeda(a.valor)+'</span>' +
        '<span class="avulso-data">'+formatarDataBR(a.data)+'</span>' +
      '</div>' +
      '<div class="avulso-acoes">' +
        '<button class="mini-btn" onclick="abrirModalAvulso({id:\''+a.id+'\',valor:\''+a.valor+'\',data:\''+a.data+'\'})">Editar</button>' +
        '<button class="mini-btn avulso-excluir" onclick="excluirAvulso(\''+a.id+'\')">Excluir</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function renderizarLista(parcelas){
  const container = document.getElementById('lista-registros');

  // calcular totais dos filtros
  const totalTudo = parcelas.reduce(function(s, p){ return s + Number(p.valorParcela); }, 0);
  const totalCompras = parcelas.filter(function(p){ return !p.ehEmprestimo; }).reduce(function(s, p){ return s + Number(p.valorParcela); }, 0);
  const totalEmprestimos = parcelas.filter(function(p){ return p.ehEmprestimo; }).reduce(function(s, p){ return s + Number(p.valorParcela); }, 0);

  document.getElementById('total-tudo').textContent = formatarMoeda(totalTudo);
  document.getElementById('total-compras').textContent = formatarMoeda(totalCompras);
  document.getElementById('total-emprestimos').textContent = formatarMoeda(totalEmprestimos);

  // aplicar filtro
  var filtradas = parcelas;
  if(filtroAtivo === 'compras'){
    filtradas = parcelas.filter(function(p){ return !p.ehEmprestimo; });
  } else if(filtroAtivo === 'emprestimos'){
    filtradas = parcelas.filter(function(p){ return p.ehEmprestimo; });
  }

  var todasPagas = filtradas.every(function(p){ return p.pago; });
  var btn = document.getElementById('btn-marcar-todos');
  if(todasPagas){
    btn.textContent = '✗ Desmarcar todos como pago';
    btn.className = 'btn-marcar-todos btn-desmarcar';
  } else {
    btn.textContent = '✓ Marcar todos como pago';
    btn.className = 'btn-marcar-todos';
  }

  if(!filtradas || filtradas.length === 0){
    container.innerHTML = '<div class="vazio">Nenhum registro para este mês ainda.</div>';
    return;
  }

  container.innerHTML =
    '<div class="registro-header">' +
      '<span class="r-data">Data</span>' +
      '<span class="r-desc">Descrição</span>' +
      '<span class="r-valor-total">Valor Total</span>' +
      '<span class="r-parcelas">Parcelas</span>' +
      '<span class="r-valor-parcela">Valor Parc.</span>' +
      '<span class="r-check">Pago</span>' +
      '<span class="r-edit"></span>' +
      '<span class="r-excluir"></span>' +
    '</div>' +
    filtradas.map(function(p){
    const pagoClasse = p.pago ? 'registro pago' : 'registro';
    var badges = '';
    if(p.finalizado) badges += '<span class="badge-finalizado">Finalizado</span> ';
    if(p.ehEmprestimo) badges += '<span class="badge-emprestimo">Empréstimo</span>';
    var pagoInfo = '';
    if(p.pago){
      pagoInfo = '<span class="r-pago-info" title="Pago em '+formatarDataBR(p.dataPagamento)+' - '+formatarMoeda(p.valorPago)+'">' +
        '<button class="mini-btn" onclick="alterarValorPago(\''+p.id+'\')" title="Alterar valor pago">'+formatarMoeda(p.valorPago)+'</button></span>';
    }
    return '<div class="'+pagoClasse+'" data-id="'+p.id+'">' +
      '<span class="r-data">'+formatarDataBR(p.dataCompra)+'</span>' +
      '<span class="r-desc">'+escapeHtml(p.descricao)+' '+badges+'</span>' +
      '<span class="r-valor-total">'+formatarMoeda(p.valorTotal)+'</span>' +
      '<span class="r-parcelas">'+p.parcelaAtual+'/'+p.totalParcelas+'</span>' +
      '<span class="r-valor-parcela">'+formatarMoeda(p.valorParcela)+'</span>' +
      '<span class="r-check">' +
        '<label class="check-pago">' +
          '<input type="checkbox" '+(p.pago?'checked':'')+' onchange="marcarPago(\''+p.id+'\', this.checked)">' +
        '</label>' +
      '</span>' +
      (pagoInfo ? '<span class="r-pago-valor">'+pagoInfo+'</span>' : '') +
      '<span class="r-edit"><button class="icon-btn" onclick="abrirEditar(\''+p.id+'\')">Editar</button></span>' +
      '<span class="r-excluir"><button class="icon-btn excluir" onclick="pedirExclusao(\''+p.id+'\')">Excluir</button></span>' +
    '</div>';
  }).join('');
}

function escapeHtml(s){
  const div = document.createElement('div');
  div.textContent = s || '';
  return div.innerHTML;
}

// ---------------------------------------------------------------
// VENCIMENTO E VALOR AVULSO
// ---------------------------------------------------------------
function salvarVencimento(){
  const v = document.getElementById('input-vencimento').value;
  apiPost('setMesConfig', { mes: mesAtual, dados: { vencimento: Number(v) } })
    .then(function(){ mostrarToast('Vencimento salvo'); carregarMes(); })
    .catch(erroGenerico);
}

// ---------------------------------------------------------------
// PAGAMENTOS AVULSOS
// ---------------------------------------------------------------
let idAvulsoEditando = null;

function abrirModalAvulso(avulso){
  idAvulsoEditando = avulso ? avulso.id : null;
  document.getElementById('modal-avulso-titulo').textContent = avulso ? 'Editar Pagamento Avulso' : 'Adicionar Pagamento Avulso';
  document.getElementById('btn-salvar-avulso').textContent = avulso ? 'Salvar' : 'Adicionar';
  document.getElementById('avulso-valor').value = avulso ? avulso.valor : '';
  document.getElementById('avulso-data').value = avulso ? avulso.data : '';
  document.getElementById('modal-avulso').classList.add('aberto');
}

function fecharModalAvulso(){
  document.getElementById('modal-avulso').classList.remove('aberto');
  document.getElementById('avulso-valor').value = '';
  document.getElementById('avulso-data').value = '';
  idAvulsoEditando = null;
}

function salvarAvulso(){
  const valor = document.getElementById('avulso-valor').value;
  const data = document.getElementById('avulso-data').value;

  if(!valor || !data){
    mostrarToast('Preencha o valor e a data');
    return;
  }

  if(idAvulsoEditando){
    apiPost('editarAvulso', { id: idAvulsoEditando, dados: { valor: valor, data: data } })
      .then(function(){
        mostrarToast('Pagamento avulso atualizado');
        fecharModalAvulso();
        carregarMes();
      })
      .catch(erroGenerico);
  } else {
    apiPost('addAvulso', { mes: mesAtual, valor: valor, data: data })
      .then(function(){
        mostrarToast('Pagamento avulso adicionado');
        fecharModalAvulso();
        carregarMes();
      })
      .catch(erroGenerico);
  }
}

function excluirAvulso(id){
  if(!confirm('Deseja realmente excluir este pagamento avulso?')) return;
  apiPost('excluirAvulso', { id: id })
    .then(function(){
      mostrarToast('Pagamento avulso excluído');
      carregarMes();
    })
    .catch(erroGenerico);
}

// ---------------------------------------------------------------
// FORMULÁRIO DE NOVA DESPESA
// ---------------------------------------------------------------
function alternarPainelForm(){
  document.getElementById('painel-form-corpo').classList.toggle('aberto');
  const seta = document.getElementById('seta-form');
  seta.innerHTML = document.getElementById('painel-form-corpo').classList.contains('aberto') ? '&#9650;' : '&#9660;';
}

function calcularParcela(){
  const total = Number(document.getElementById('f-valor-total').value) || 0;
  const parcelas = Number(document.getElementById('f-total-parcelas').value) || 1;
  if(total > 0 && parcelas > 0){
    document.getElementById('f-valor-parcela').value = (total/parcelas).toFixed(2);
  }
}

function registrarCompra(){
  const data = document.getElementById('f-data').value;
  const descricao = document.getElementById('f-descricao').value.trim();
  const valorTotal = document.getElementById('f-valor-total').value;
  const totalParcelas = document.getElementById('f-total-parcelas').value;
  const valorParcela = document.getElementById('f-valor-parcela').value;

  const ehEmprestimo = document.getElementById('f-emprestimo').checked;
  if(ehEmprestimo && !descricao) descricao = 'Empréstimo';
  if(!data || !descricao || !valorTotal || !totalParcelas || !valorParcela){
    mostrarToast('Preencha todos os campos');
    return;
  }

  apiPost('addCompra', {
    dataCompra: data,
    descricao: descricao,
    valorTotal: valorTotal,
    totalParcelas: totalParcelas,
    valorParcela: valorParcela,
    ehEmprestimo: ehEmprestimo
  }).then(function(){
    mostrarToast('Despesa registrada');
    document.getElementById('f-data').value = '';
    document.getElementById('f-descricao').value = '';
    document.getElementById('f-valor-total').value = '';
    document.getElementById('f-total-parcelas').value = '1';
    document.getElementById('f-valor-parcela').value = '';
    document.getElementById('f-emprestimo').checked = false;
    carregarMes();
  }).catch(erroGenerico);
}

// ---------------------------------------------------------------
// PAGAMENTO
// ---------------------------------------------------------------
function marcarPago(id, pago){
  apiPost('updateParcela', { id: id, mudancas: { pago: pago } })
    .then(function(resp){
      if(!resp.ok) mostrarToast(resp.erro || 'Erro ao atualizar');
      carregarMes();
    })
    .catch(erroGenerico);
}

function marcarTodosPagos(){
  var btn = document.getElementById('btn-marcar-todos');
  var marcar = btn.textContent.indexOf('Marcar') !== -1;
  if(marcar){
    if(!confirm('Marcar todas as parcelas não pagas deste mês como pagas?')) return;
  } else {
    if(!confirm('Desmarcar todas as parcelas pagas deste mês?')) return;
  }
  apiPost('marcarTodosPagos', { mes: mesAtual, pago: marcar })
    .then(function(resp){
      if(resp.ok){
        mostrarToast(resp.marcadas + ' parcela(s) marcada(s) como paga(s)');
        carregarMes();
      } else {
        mostrarToast(resp.erro || 'Erro ao marcar pagamentos');
        carregarMes();
      }
    })
    .catch(erroGenerico);
}

function alterarValorPago(id){
  const novoValor = prompt('Novo valor pago:');
  if(novoValor === null || novoValor === '') return;
  apiPost('updateParcela', { id: id, mudancas: { pago: true, valorPago: novoValor } })
    .then(function(){ mostrarToast('Valor atualizado'); carregarMes(); })
    .catch(erroGenerico);
}

// ---------------------------------------------------------------
// EDITAR
// ---------------------------------------------------------------
function abrirEditar(id){
  const p = dadosMes.parcelas.find(function(x){ return x.id === id; });
  if(!p) return;
  idParaEditar = id;
  document.getElementById('edit-descricao').value = p.descricao;
  document.getElementById('edit-valor-total').value = p.valorTotal;
  document.getElementById('edit-total-parcelas').value = p.totalParcelas;
  document.getElementById('edit-valor-parcela').value = p.valorParcela;
  document.getElementById('edit-data-compra').value = paraInputDate(p.dataCompra);
  document.getElementById('edit-emprestimo').checked = p.ehEmprestimo;
  document.getElementById('edit-data-primeira-parcela').value = p.dataCompra ? p.dataCompra.slice(0,10) : '';
  document.getElementById('modal-editar').classList.add('aberto');
}

function fecharModalEditar(){
  document.getElementById('modal-editar').classList.remove('aberto');
  idParaEditar = null;
}

function recalcularParcelaEdit(){
  const total = Number(document.getElementById('edit-valor-total').value) || 0;
  const parcelas = Number(document.getElementById('edit-total-parcelas').value) || 1;
  if(total > 0 && parcelas > 0){
    document.getElementById('edit-valor-parcela').value = (total/parcelas).toFixed(2);
  }
}

function salvarEdicao(){
  if(!confirm('Deseja realmente editar este registro?')) return;
  const p = dadosMes.parcelas.find(function(x){ return x.id === idParaEditar; });
  if(!p) return;
  const descricao = document.getElementById('edit-descricao').value.trim();
  const valorTotal = document.getElementById('edit-valor-total').value;
  const totalParcelas = document.getElementById('edit-total-parcelas').value;
  const valorParcela = document.getElementById('edit-valor-parcela').value;
  const dataCompra = document.getElementById('edit-data-compra').value;
  const dataPrimeiraParcela = document.getElementById('edit-data-primeira-parcela').value;
  const ehEmprestimo = document.getElementById('edit-emprestimo').checked;

  apiPost('editarCompra', {
    idCompra: p.idCompra,
    descricao: descricao,
    valorTotal: valorTotal,
    totalParcelas: totalParcelas,
    valorParcela: valorParcela,
    dataCompra: dataCompra,
    mesPrimeiraParcela: dataPrimeiraParcela,
    ehEmprestimo: ehEmprestimo
  }).then(function(resp){
      if(resp.ok){
        mostrarToast('Registro atualizado');
        fecharModalEditar();
        carregarMes();
      } else {
        mostrarToast(resp.erro || 'Erro ao editar');
        fecharModalEditar();
      }
    })
    .catch(erroGenerico);
}

// ---------------------------------------------------------------
// EXCLUIR
// ---------------------------------------------------------------
function pedirExclusao(id){
  idParaExcluir = id;
  const p = dadosMes.parcelas.find(function(x){ return x.id === id; });
  var temMaisParcelas = p && Number(p.totalParcelas) > 1;

  document.getElementById('modal-confirmar-titulo').textContent = 'Excluir registro';
  document.getElementById('modal-confirmar-texto').textContent = 'Deseja realmente excluir este registro? Essa ação não pode ser desfeita.';

  var acoes = document.getElementById('modal-confirmar-acoes');
  if(temMaisParcelas){
    acoes.innerHTML =
      '<button class="btn btn-secundario" onclick="fecharModalConfirmar()">Cancelar</button>' +
      '<button class="btn btn-perigo" onclick="confirmarExclusaoParcela()">Apenas esta parcela</button>' +
      '<button class="btn btn-perigo" onclick="confirmarExclusaoTodas()">Esta e todas as próximas</button>';
  } else {
    acoes.innerHTML =
      '<button class="btn btn-secundario" onclick="fecharModalConfirmar()">Cancelar</button>' +
      '<button class="btn btn-perigo" onclick="confirmarExclusaoParcela()">Excluir</button>';
  }
  document.getElementById('modal-confirmar').classList.add('aberto');
}

function confirmarExclusaoParcela(){
  apiPost('excluirParcela', { id: idParaExcluir })
    .then(function(resp){
      if(resp.ok){
        mostrarToast('Registro excluído');
      } else {
        mostrarToast(resp.erro || 'Erro ao excluir');
      }
      fecharModalConfirmar();
      carregarMes();
    })
    .catch(erroGenerico);
}

function confirmarExclusaoTodas(){
  apiPost('excluirParcelasApartir', { id: idParaExcluir })
    .then(function(resp){
      if(resp.ok){
        mostrarToast(resp.excluidas + ' registro(s) excluído(s)');
      } else {
        mostrarToast(resp.erro || 'Erro ao excluir');
      }
      fecharModalConfirmar();
      carregarMes();
    })
    .catch(erroGenerico);
}

function fecharModalConfirmar(){
  document.getElementById('modal-confirmar').classList.remove('aberto');
  idParaExcluir = null;
}

// ---------------------------------------------------------------
// UTIL
// ---------------------------------------------------------------
function mostrarToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('mostrar');
  setTimeout(function(){ t.classList.remove('mostrar'); }, 2200);
}

function erroGenerico(erro){
  console.error(erro);
  mostrarToast('Ocorreu um erro: ' + (erro && erro.message ? erro.message : erro));
}
