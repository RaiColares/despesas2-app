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

function renderizarMes(dados){
  dadosMes = dados;
  document.getElementById('lbl-mes-ref').textContent = dados.mesReferenciaLabel;
  document.getElementById('lbl-mes-pag').textContent = dados.mesPagamentoLabel;
  document.getElementById('lbl-mes-lista').textContent = dados.mesReferenciaLabel;
  document.getElementById('input-vencimento').value = dados.vencimento;

  const saldoEl = document.getElementById('val-saldo-anterior');
  const saldoRotulo = document.getElementById('lbl-saldo-rotulo');
  if(dados.saldoAnterior >= 0){
    saldoRotulo.textContent = 'Saldo do Mês Anterior';
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
  if(dados.saldoPendente >= 0){
    pendRotulo.textContent = 'Saldo Pendente';
    pendEl.textContent = formatarMoeda(dados.saldoPendente);
    pendEl.className = 'valor cor-saldo';
  } else {
    pendRotulo.textContent = 'Débito Pendente';
    pendEl.textContent = formatarMoeda(Math.abs(dados.saldoPendente));
    pendEl.className = 'valor cor-debito';
  }

  if(dados.valorAvulso !== null && dados.valorAvulso !== undefined && dados.valorAvulso !== ''){
    document.getElementById('input-avulso-valor').value = dados.valorAvulso;
    document.getElementById('input-avulso-data').value = paraInputDate(dados.dataAvulso);
    document.getElementById('campos-avulso').classList.add('aberto');
  } else {
    document.getElementById('input-avulso-valor').value = '';
    document.getElementById('input-avulso-data').value = '';
    document.getElementById('campos-avulso').classList.remove('aberto');
  }

  renderizarLista(dados.parcelas);
}

function renderizarLista(parcelas){
  const container = document.getElementById('lista-registros');
  if(!parcelas || parcelas.length === 0){
    container.innerHTML = '<div class="vazio">Nenhum registro para este mês ainda.</div>';
    return;
  }
  container.innerHTML = parcelas.map(function(p){
    const pagoClasse = p.pago ? 'registro pago' : 'registro';
    const badge = p.finalizado ? '<span class="badge-finalizado">Finalizado</span>' : '';
    return '<div class="'+pagoClasse+'" data-id="'+p.id+'">' +
      '<div class="principal">' +
        '<div class="desc">'+escapeHtml(p.descricao)+' '+badge+'</div>' +
        '<div class="meta">'+formatarDataBR(p.dataCompra)+' &middot; Parcela '+p.parcelaAtual+'/'+p.totalParcelas+'</div>' +
      '</div>' +
      '<div class="valores">' +
        '<div class="valor-parcela">'+formatarMoeda(p.valorParcela)+'</div>' +
      '</div>' +
      '<div class="linha-acoes">' +
        '<label class="check-pago">' +
          '<input type="checkbox" '+(p.pago?'checked':'')+' onchange="marcarPago(\''+p.id+'\', this.checked)"> Pago' +
        '</label>' +
        (p.pago ? (
          '<span class="campo-inline">Pago em '+formatarDataBR(p.dataPagamento)+'</span>' +
          '<span class="campo-inline">Valor: '+formatarMoeda(p.valorPago)+
            ' <button class="mini-btn" onclick="alterarValorPago(\''+p.id+'\')">Alterar valor</button></span>'
        ) : '') +
        '<button class="icon-btn" onclick="abrirEditar(\''+p.id+'\')">Editar</button>' +
        '<button class="icon-btn excluir" onclick="pedirExclusao(\''+p.id+'\')">Excluir</button>' +
      '</div>' +
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

function alternarAvulso(){
  document.getElementById('campos-avulso').classList.toggle('aberto');
}

function salvarAvulso(){
  const valor = document.getElementById('input-avulso-valor').value;
  const data = document.getElementById('input-avulso-data').value;
  apiPost('setMesConfig', { mes: mesAtual, dados: { valorAvulso: valor, dataAvulso: data } })
    .then(function(){ mostrarToast('Valor avulso salvo'); carregarMes(); })
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

  if(!data || !descricao || !valorTotal || !totalParcelas || !valorParcela){
    mostrarToast('Preencha todos os campos');
    return;
  }

  apiPost('addCompra', {
    dataCompra: data,
    descricao: descricao,
    valorTotal: valorTotal,
    totalParcelas: totalParcelas,
    valorParcela: valorParcela
  }).then(function(){
    mostrarToast('Despesa registrada');
    document.getElementById('f-data').value = '';
    document.getElementById('f-descricao').value = '';
    document.getElementById('f-valor-total').value = '';
    document.getElementById('f-total-parcelas').value = '1';
    document.getElementById('f-valor-parcela').value = '';
    carregarMes();
  }).catch(erroGenerico);
}

// ---------------------------------------------------------------
// PAGAMENTO
// ---------------------------------------------------------------
function marcarPago(id, pago){
  apiPost('updateParcela', { id: id, mudancas: { pago: pago } })
    .then(function(){ carregarMes(); })
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
  document.getElementById('edit-valor-parcela').value = p.valorParcela;
  document.getElementById('edit-data-compra').value = paraInputDate(p.dataCompra);
  document.getElementById('modal-editar').classList.add('aberto');
}

function fecharModalEditar(){
  document.getElementById('modal-editar').classList.remove('aberto');
  idParaEditar = null;
}

function salvarEdicao(){
  if(!confirm('Deseja realmente editar este registro?')) return;
  const descricao = document.getElementById('edit-descricao').value.trim();
  const valorParcela = document.getElementById('edit-valor-parcela').value;
  const dataCompra = document.getElementById('edit-data-compra').value;
  apiPost('editarParcela', { id: idParaEditar, dados: { descricao: descricao, valorParcela: valorParcela, dataCompra: dataCompra } })
    .then(function(){
      mostrarToast('Registro atualizado');
      fecharModalEditar();
      carregarMes();
    })
    .catch(erroGenerico);
}

// ---------------------------------------------------------------
// EXCLUIR
// ---------------------------------------------------------------
function pedirExclusao(id){
  idParaExcluir = id;
  document.getElementById('modal-confirmar-titulo').textContent = 'Excluir registro';
  document.getElementById('modal-confirmar-texto').textContent = 'Deseja realmente excluir este registro? Essa ação não pode ser desfeita.';
  const btn = document.getElementById('modal-confirmar-btn');
  btn.textContent = 'Excluir';
  btn.onclick = confirmarExclusao;
  document.getElementById('modal-confirmar').classList.add('aberto');
}

function confirmarExclusao(){
  apiPost('excluirParcela', { id: idParaExcluir })
    .then(function(){
      mostrarToast('Registro excluído');
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
