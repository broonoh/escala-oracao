import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
    getFirestore,
    doc,
    getDoc,
    setDoc,
    collection,
    onSnapshot,
    getCountFromServer,
    query,
    orderBy,
    limit,
    getDocs,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { firebaseConfig } from './firebase-config.js';

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// --- IDENTIFICADOR DO NAVEGADOR (usado só para saber, neste dispositivo, quem criou a escala) ---
if (!localStorage.getItem('user_uuid')) {
    localStorage.setItem('user_uuid', 'user_' + Math.random().toString(36).substring(2, 9));
}
const currentUserId = localStorage.getItem('user_uuid');

// --- LISTA LOCAL DE ESCALAS ---
// Os dados de cada escala vivem no Firestore (compartilhados por todos); aqui só guardamos
// quais IDs este navegador já criou ou abriu, para montar a tela "Minhas escalas".
function getEscalasLocaisIds() {
    try {
        const dados = localStorage.getItem('minhas_escalas_ids');
        const parsed = dados ? JSON.parse(dados) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function adicionarEscalaLocal(id) {
    const ids = getEscalasLocaisIds();
    if (!ids.includes(id)) {
        ids.push(id);
        localStorage.setItem('minhas_escalas_ids', JSON.stringify(ids));
    }
}

function removerEscalaLocal(id) {
    const ids = getEscalasLocaisIds().filter(existente => existente !== id);
    localStorage.setItem('minhas_escalas_ids', JSON.stringify(ids));
}

function getEscalaAtualId() {
    const params = new URLSearchParams(window.location.search);
    const idUrl = params.get('id');
    if (idUrl) {
        localStorage.setItem('escala_atual_id', idUrl);
        return idUrl;
    }
    return localStorage.getItem('escala_atual_id');
}

function setEscalaAtualId(id) {
    localStorage.setItem('escala_atual_id', id);
}

// --- GERADOR DE HORÁRIOS ---
function gerarHorarios(intervaloMinutos = 15) {
    const horarios = [];
    const totalBlocos = (24 * 60) / intervaloMinutos;

    for (let i = 0; i < totalBlocos; i++) {
        let horaInicioMin = i * intervaloMinutos;
        let horaFimMin = (i + 1) * intervaloMinutos;

        let hInicio = String(Math.floor(horaInicioMin / 60)).padStart(2, '0');
        let mInicio = String(horaInicioMin % 60).padStart(2, '0');
        let hFim = String(Math.floor(horaFimMin / 60) % 24).padStart(2, '0');
        let mFim = String(horaFimMin % 60).padStart(2, '0');

        horarios.push({
            id: i,
            horario: `${hInicio}:${mInicio} às ${hFim}:${mFim}`,
            nome: ""
        });
    }
    return horarios;
}

function formatarDataHora(timestamp) {
    if (!timestamp) return 'Nenhum registro';
    const data = timestamp.toDate();
    return `${data.toLocaleDateString('pt-BR')} ${data.toLocaleTimeString('pt-BR')}`;
}

// --- CONTROLE DA PÁGINA PRINCIPAL (index.html) ---
if (window.location.pathname.includes('index.html') || window.location.pathname.endsWith('/')) {
    window.addEventListener('DOMContentLoaded', () => {
        renderizarListaEscalas();
        const formCriacao = document.getElementById('form-escala');
        if (formCriacao) {
            formCriacao.addEventListener('submit', criarEscala);
        }
    });
}

async function criarEscala(event) {
    event.preventDefault();
    const igreja = document.getElementById('igreja').value.trim();
    const motivo = document.getElementById('motivo').value.trim();
    const dataInicio = document.getElementById('data-inicio').value;
    const dataFim = document.getElementById('data-fim').value;
    const intervalo = parseInt(document.getElementById('intervalo-tempo').value) || 15;

    const escalaId = 'esc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);

    const novaEscala = {
        criadorId: currentUserId,
        igreja: igreja,
        motivo: motivo,
        dataInicio: dataInicio ? dataInicio.split('-').reverse().join('/') : '',
        dataFim: dataFim ? dataFim.split('-').reverse().join('/') : '',
        intervalo: intervalo,
        criadoEm: serverTimestamp()
    };

    try {
        await setDoc(doc(db, 'escalas', escalaId), novaEscala);
        adicionarEscalaLocal(escalaId);
        setEscalaAtualId(escalaId);
        window.location.href = `escala.html?id=${escalaId}`;
    } catch (e) {
        console.error('Erro ao criar escala', e);
        alert('Não foi possível criar a escala. Verifique a configuração do Firebase (firebase-config.js) e tente novamente.');
    }
}

async function renderizarListaEscalas() {
    const ids = getEscalasLocaisIds();
    const listaDiv = document.getElementById('lista-escalas');
    const estadoVazio = document.getElementById('estado-vazio');

    if (ids.length === 0) {
        if (estadoVazio) estadoVazio.classList.remove('hidden');
        if (listaDiv) listaDiv.innerHTML = '';
        return;
    }

    if (listaDiv) listaDiv.innerHTML = '<p class="text-sm text-slate-400 col-span-2">Carregando...</p>';

    const cards = await Promise.all(ids.map(async (id) => {
        try {
            const escalaSnap = await getDoc(doc(db, 'escalas', id));
            if (!escalaSnap.exists()) return null;
            const e = escalaSnap.data();

            const total = (24 * 60) / e.intervalo;
            const horariosRef = collection(db, 'escalas', id, 'horarios');
            const contagem = await getCountFromServer(horariosRef);
            const ocupados = contagem.data().count;
            const porcentagem = total > 0 ? ((ocupados / total) * 100).toFixed(1) : '0.0';

            const ultimoSnap = await getDocs(query(horariosRef, orderBy('timestamp', 'desc'), limit(1)));
            const ultimoRegistro = ultimoSnap.empty ? 'Nenhum registro' : formatarDataHora(ultimoSnap.docs[0].data().timestamp);

            return `
                <div onclick="window.location.href='escala.html?id=${id}'" class="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition cursor-pointer flex flex-col justify-between group">
                    <div>
                        <span class="text-[10px] font-bold text-indigo-900 tracking-wider uppercase bg-indigo-50 px-2 py-0.5 rounded">Igreja</span>
                        <h3 class="font-bold text-indigo-950 text-base mt-2 mb-1 group-hover:text-indigo-700 transition">${e.igreja}</h3>
                        <p class="text-xs font-semibold text-slate-700 mb-1">Motivo: ${e.motivo}</p>
                        <p class="text-xs text-slate-500 mb-4">Período: ${e.dataInicio} - ${e.dataFim} (${e.intervalo} min)</p>

                        <div class="border-t border-slate-100 pt-3 text-xs text-slate-600 flex flex-col gap-1">
                            <div>Preenchidos: <span class="font-semibold text-slate-800">${ocupados}</span> de ${total} (<span class="font-semibold text-indigo-900">${porcentagem}%</span>)</div>
                            <div class="text-slate-400">Último registro: ${ultimoRegistro}</div>
                        </div>
                    </div>
                </div>
            `;
        } catch (e) {
            console.error('Erro ao carregar escala', id, e);
            return null;
        }
    }));

    const validCards = cards.filter(Boolean);
    if (listaDiv) {
        if (validCards.length === 0) {
            if (estadoVazio) estadoVazio.classList.remove('hidden');
            listaDiv.innerHTML = '';
        } else {
            if (estadoVazio) estadoVazio.classList.add('hidden');
            listaDiv.innerHTML = validCards.join('');
        }
    }
}

// --- CONTROLE DA PÁGINA DE DETALHES (escala.html) ---
let escalaAtual = null;
let horariosAtual = [];

if (window.location.pathname.includes('escala.html')) {
    window.addEventListener('DOMContentLoaded', () => {
        carregarDetalhesEscala();
    });
}

async function carregarDetalhesEscala() {
    const id = getEscalaAtualId();

    if (!id) {
        alert('ID da escala não fornecido.');
        window.location.href = 'index.html';
        return;
    }

    let escalaSnap;
    try {
        escalaSnap = await getDoc(doc(db, 'escalas', id));
    } catch (e) {
        console.error('Erro ao carregar escala', e);
        alert('Não foi possível carregar a escala. Verifique a configuração do Firebase (firebase-config.js).');
        return;
    }

    if (!escalaSnap.exists()) {
        alert('Escala não encontrada!');
        window.location.href = 'index.html';
        return;
    }

    escalaAtual = { id, ...escalaSnap.data() };
    adicionarEscalaLocal(id);
    setEscalaAtualId(id);

    const isCriador = escalaAtual.criadorId === currentUserId;
    const btnPdfContainer = document.getElementById('btn-pdf-container');
    const btnExcluirContainer = document.getElementById('btn-excluir-container');
    if (btnPdfContainer) btnPdfContainer.classList.toggle('hidden', !isCriador);
    if (btnExcluirContainer) btnExcluirContainer.classList.toggle('hidden', !isCriador);

    const pdfTitulo = document.getElementById('pdf-titulo-topo');
    const pdfSub = document.getElementById('pdf-subtitulo-topo');
    if (pdfTitulo) pdfTitulo.innerText = `Escala da Oração Ininterrupta - ${escalaAtual.igreja}`;
    if (pdfSub) pdfSub.innerHTML = `Motivo: ${escalaAtual.motivo}<br>Período: ${escalaAtual.dataInicio} - ${escalaAtual.dataFim}`;

    // Tempo real: assim que alguém confirma um horário, ele trava na hora para todo mundo que estiver com a página aberta
    onSnapshot(collection(db, 'escalas', id, 'horarios'), (snapshot) => {
        const horarios = gerarHorarios(escalaAtual.intervalo);
        let ultimoTimestamp = null;

        snapshot.forEach(docSnap => {
            const dados = docSnap.data();
            const horarioId = parseInt(docSnap.id, 10);
            const h = horarios.find(item => item.id === horarioId);
            if (h) h.nome = dados.nome;

            if (dados.timestamp && (!ultimoTimestamp || dados.timestamp.toMillis() > ultimoTimestamp.toMillis())) {
                ultimoTimestamp = dados.timestamp;
            }
        });

        horariosAtual = horarios;
        renderizarDetalhes(ultimoTimestamp);
    }, (erro) => {
        console.error('Erro ao escutar horários', erro);
    });
}

function renderizarDetalhes(ultimoTimestamp) {
    const ocupados = horariosAtual.filter(h => h.nome !== "").length;
    const total = horariosAtual.length;
    const porcentagem = total > 0 ? ((ocupados / total) * 100).toFixed(1) : '0.0';
    const ultimoRegistro = formatarDataHora(ultimoTimestamp);

    const detalheCard = document.getElementById('detalhe-card');
    if (detalheCard) {
        detalheCard.innerHTML = `
            <span class="text-[10px] font-bold text-indigo-900 tracking-wider uppercase bg-indigo-50 px-2 py-0.5 rounded">Igreja</span>
            <h2 class="font-bold text-indigo-950 text-xl mt-2 mb-1">${escalaAtual.igreja}</h2>
            <p class="text-sm font-semibold text-slate-700 mb-1"><span class="text-slate-400 font-normal">Motivo:</span> ${escalaAtual.motivo}</p>
            <p class="text-xs text-slate-500 mb-4"><span class="text-slate-400">Período:</span> ${escalaAtual.dataInicio} - ${escalaAtual.dataFim} (${escalaAtual.intervalo} em ${escalaAtual.intervalo} min)</p>
            <div class="text-xs font-medium text-slate-700 flex flex-col gap-1.5 border-t pt-3 border-slate-100">
                <div><i class="fa-solid fa-list-check text-indigo-900 mr-2"></i>Horários preenchidos: <span class="font-semibold text-slate-900">${ocupados}</span> de ${total} (<span class="text-indigo-900 font-semibold">${porcentagem}%</span> ocupado | ${total - ocupados} disponíveis)</div>
                <div><i class="fa-regular fa-clock text-indigo-900 mr-2"></i>Último registro: <span class="text-slate-900 font-medium">${ultimoRegistro}</span></div>
            </div>
        `;
    }

    const tbody = document.getElementById('tabela-horarios');
    if (tbody) {
        tbody.innerHTML = horariosAtual.map(h => {
            if (h.nome !== "") {
                return `
                    <tr class="bg-white">
                        <td class="p-3.5 border-r border-slate-100 font-medium text-slate-700">${h.horario}</td>
                        <td class="p-3.5 text-slate-800 font-medium bg-slate-50/50">${h.nome}</td>
                    </tr>
                `;
            } else {
                return `
                    <tr class="bg-slate-50/30 hover:bg-indigo-50/40 transition cursor-pointer" onclick="preencherHorario(${h.id})">
                        <td class="p-3.5 border-r border-slate-100 font-medium text-slate-700">${h.horario}</td>
                        <td class="p-3.5 text-indigo-600 font-medium hover:underline flex items-center gap-1.5">
                            <i class="fa-regular fa-hand-pointer text-xs"></i> Clique para selecionar!
                        </td>
                    </tr>
                `;
            }
        }).join('');
    }
}

let horarioSelecionadoId = null;

function preencherHorario(horarioId) {
    const horarioObj = horariosAtual.find(h => h.id === horarioId);

    // Um horário já registrado é definitivo: não pode ser editado por ninguém
    if (!horarioObj || horarioObj.nome) return;

    horarioSelecionadoId = horarioId;

    const modal = document.getElementById('modal-confirmar');
    const periodo = document.getElementById('modal-horario-periodo');
    const input = document.getElementById('modal-input-nome');
    if (periodo) periodo.innerText = `Horário selecionado: ${horarioObj.horario}`;
    if (input) input.value = '';
    if (modal) modal.classList.remove('hidden');
    if (input) input.focus();
}

function fecharModalConfirmar() {
    horarioSelecionadoId = null;
    const modal = document.getElementById('modal-confirmar');
    if (modal) modal.classList.add('hidden');
}

async function confirmarNomeModal() {
    if (horarioSelecionadoId === null) return;

    const input = document.getElementById('modal-input-nome');
    const nomeDigitado = input ? input.value : '';
    const nome = nomeDigitado.trim().replace(/[<>]/g, '');

    if (nome.length < 3 || nome.length > 60) {
        alert('O nome deve ter entre 3 e 60 caracteres.');
        return;
    }

    const horarioId = horarioSelecionadoId;

    try {
        // Se outra pessoa confirmar este mesmo horário um instante antes, o Firestore
        // rejeita esta escrita (regras só permitem criar, nunca sobrescrever um horário já preenchido)
        await setDoc(doc(db, 'escalas', escalaAtual.id, 'horarios', String(horarioId)), {
            nome: nome,
            timestamp: serverTimestamp()
        });
        fecharModalConfirmar();
    } catch (e) {
        console.error('Erro ao preencher horário', e);
        fecharModalConfirmar();
        alert('Alguém acabou de preencher esse horário! Escolha outro.');
    }
}

function excluirEscala() {
    if (!escalaAtual || escalaAtual.criadorId !== currentUserId) {
        alert("Somente quem criou a escala pode removê-la.");
        return;
    }
    if (!confirm("Remover esta escala da sua lista? Ela continua acessível a quem já tem o link.")) return;
    removerEscalaLocal(escalaAtual.id);
    window.location.href = "index.html";
}

// --- FUNÇÃO DE COMPARTILHAR LINK ---
function copiarLink() {
    if (!escalaAtual) {
        alert("Nenhuma escala selecionada para compartilhar.");
        return;
    }

    const urlBase = window.location.href.split('#')[0].split('?')[0];
    const linkCompleto = `${urlBase}?id=${escalaAtual.id}`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(linkCompleto).then(() => {
            alert("Link da escala copiado com sucesso!");
        }).catch(() => {
            copiarLinkAlternativo(linkCompleto);
        });
    } else {
        copiarLinkAlternativo(linkCompleto);
    }
}

function copiarLinkAlternativo(texto) {
    const textarea = document.createElement("textarea");
    textarea.value = texto;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
        document.execCommand('copy');
        alert("Link da escala copiado com sucesso!");
    } catch (err) {
        alert("Erro ao tentar copiar o link.");
    }
    document.body.removeChild(textarea);
}

function mostrarFormulario() {
    const secaoCriacao = document.getElementById('secao-criacao');
    const secaoBotaoNova = document.getElementById('secao-botao-nova');
    if (secaoCriacao) secaoCriacao.classList.remove('hidden');
    if (secaoBotaoNova) secaoBotaoNova.classList.add('hidden');
}

function esconderFormulario() {
    const secaoCriacao = document.getElementById('secao-criacao');
    const secaoBotaoNova = document.getElementById('secao-botao-nova');
    if (secaoCriacao) secaoCriacao.classList.add('hidden');
    if (secaoBotaoNova) secaoBotaoNova.classList.remove('hidden');
}

// --- FUNÇÃO DE GERAÇÃO DE PDF ---
function baixarPDF() {
    if (!escalaAtual || escalaAtual.criadorId !== currentUserId) {
        alert("Somente quem criou a escala pode baixar o PDF.");
        return;
    }

    const escala = escalaAtual;
    const totalHorarios = horariosAtual.length;
    const metade = Math.ceil(totalHorarios / 2);
    const col1 = horariosAtual.slice(0, metade);
    const col2 = horariosAtual.slice(metade);

    const fontSize = '8px';
    const paddingVal = '3px 5px';
    const headerPadding = '4px 5px';

    const gerarLinhas = (lista) => {
        return lista.map(h => `
            <tr>
                <td style="border: 1px solid #cbd5e1; padding: ${paddingVal}; font-size: ${fontSize}; width: 38%; color: #1e293b; background-color: #f8fafc; line-height: 1.1;">${h.horario}</td>
                <td style="border: 1px solid #cbd5e1; padding: ${paddingVal}; font-size: ${fontSize}; width: 62%; font-weight: ${h.nome ? 'bold' : 'normal'}; color: ${h.nome ? '#0f172a' : '#94a3b8'}; line-height: 1.1;">${h.nome || ''}</td>
            </tr>
        `).join('');
    };

    const elementoTemp = document.createElement('div');
    elementoTemp.style.width = '190mm';
    elementoTemp.style.backgroundColor = '#ffffff';
    elementoTemp.style.color = '#0f172a';
    elementoTemp.style.fontFamily = 'Arial, Helvetica, sans-serif';

    elementoTemp.innerHTML = `
        <div style="margin-bottom: 8px; border-bottom: 2px solid #1e3a8a; padding-bottom: 5px; text-align: center;">
            <h2 style="font-size: 11px; font-weight: bold; margin: 0 0 2px 0; color: #1e3a8a; text-transform: uppercase;">ESCALA DA ORAÇÃO ININTERRUPTA - ${escala.igreja}</h2>
            <p style="font-size: 8.5px; margin: 0 0 1px 0;"><strong>Motivo:</strong> ${escala.motivo}</p>
            <p style="font-size: 8.5px; margin: 0;"><strong>Período:</strong> ${escala.dataInicio} - ${escala.dataFim}</p>
        </div>

        <div style="display: flex; justify-content: space-between; width: 100%;">
            <div style="width: 49.2%;">
                <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background-color: #1e3a8a; color: #ffffff;">
                            <th style="border: 1px solid #1e3a8a; padding: ${headerPadding}; font-size: ${fontSize}; text-align: left;">Horário</th>
                            <th style="border: 1px solid #1e3a8a; padding: ${headerPadding}; font-size: ${fontSize}; text-align: left;">Nome</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${gerarLinhas(col1)}
                    </tbody>
                </table>
            </div>
            <div style="width: 49.2%;">
                <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background-color: #1e3a8a; color: #ffffff;">
                            <th style="border: 1px solid #1e3a8a; padding: ${headerPadding}; font-size: ${fontSize}; text-align: left;">Horário</th>
                            <th style="border: 1px solid #1e3a8a; padding: ${headerPadding}; font-size: ${fontSize}; text-align: left;">Horário/Nome</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${gerarLinhas(col2)}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    const options = {
        margin:       [6, 6, 6, 6],
        filename:     `escala-${escala.igreja.toLowerCase().replace(/\s+/g, '-')}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, logging: false },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    if (typeof html2pdf !== 'undefined') {
        html2pdf().from(elementoTemp).set(options).save();
    } else {
        alert('A biblioteca html2pdf não foi carregada.');
    }
}

// Funções chamadas via atributos onclick/onsubmit no HTML precisam ficar expostas no window,
// pois módulos ES não colocam nada no escopo global automaticamente.
window.mostrarFormulario = mostrarFormulario;
window.esconderFormulario = esconderFormulario;
window.copiarLink = copiarLink;
window.baixarPDF = baixarPDF;
window.excluirEscala = excluirEscala;
window.preencherHorario = preencherHorario;
window.fecharModalConfirmar = fecharModalConfirmar;
window.confirmarNomeModal = confirmarNomeModal;
