// --- IDENTIFICADOR DO USUÁRIO ---
if (!localStorage.getItem('user_uuid')) {
    localStorage.setItem('user_uuid', 'user_' + Math.random().toString(36).substring(2, 9));
}
const currentUserId = localStorage.getItem('user_uuid');

// --- FUNÇÕES DE PERSISTÊNCIA (LOCALSTORAGE + NPOINT.IO PARA NUVEM) ---
function getEscalas() {
    try {
        const dados = localStorage.getItem('escalas_oracao');
        if (!dados) return [];
        const parsed = JSON.parse(dados);
        return Array.isArray(parsed) ? parsed : [parsed];
    } catch (e) {
        return [];
    }
}

function saveEscalas(escalas) {
    localStorage.setItem('escalas_oracao', JSON.stringify(escalas));
}

// Sincronização automática via nuvem pública (npoint.io) para links curtos
async function carregarEscalaDaNuvem(idEscala) {
    if (!idEscala || idEscala.length < 10) return; // Se for um ID local antigo, ignora

    try {
        const response = await fetch(`https://api.npoint.io/${idEscala}`);
        if (response.ok) {
            const escalaRemota = await response.json();
            let escalas = getEscalas();
            const index = escalas.findIndex(e => e.id === escalaRemota.id);
            if (index >= 0) {
                escalas[index] = escalaRemota;
            } else {
                escalas.push(escalaRemota);
            }
            saveEscalas(escalas);
        }
    } catch (e) {
        console.error("Erro ao sincronizar com a nuvem:", e);
    }
}

async function processarEscalaViaUrl() {
    const params = new URLSearchParams(window.location.search);
    const idUrl = params.get('id');

    // Compatibilidade com o sistema antigo de hash caso ainda exista
    const hash = window.location.hash.substring(1);
    let idFinal = idUrl || (hash && !hash.startsWith('data=') ? hash : null);

    if (hash && hash.startsWith('data=')) {
        try {
            const jsonString = decodeURIComponent(hash.replace('data=', ''));
            const escalaRecebida = JSON.parse(jsonString);
            if (escalaRecebida && escalaRecebida.id) {
                let escalas = getEscalas();
                const index = escalas.findIndex(e => e.id === escalaRecebida.id);
                if (index >= 0) escalas[index] = escalaRecebida;
                else escalas.push(escalaRecebida);
                saveEscalas(escalas);
                localStorage.setItem('escala_atual_id', escalaRecebida.id);
                return escalaRecebida.id;
            }
        } catch (err) {}
    }

    if (idFinal) {
        localStorage.setItem('escala_atual_id', idFinal);
        await carregarEscalaDaNuvem(idFinal);
        return idFinal;
    }

    return localStorage.getItem('escala_atual_id');
}

function getEscalaAtualId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('id') || localStorage.getItem('escala_atual_id');
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

    const novasEscalas = getEscalas();
    const novaEscala = {
        id: 'temp_' + Date.now(),
        criadorId: currentUserId,
        igreja: igreja,
        motivo: motivo,
        dataInicio: dataInicio ? dataInicio.split('-').reverse().join('/') : '',
        dataFim: dataFim ? dataFim.split('-').reverse().join('/') : '',
        ultimoRegistro: 'Nenhum registro',
        intervalo: intervalo,
        horarios: gerarHorarios(intervalo)
    };

    // Salva na nuvem para gerar um ID curto na npoint.io
    try {
        const response = await fetch('https://api.npoint.io', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(novaEscala)
        });
        if (response.ok) {
            const resultado = await response.json();
            // O npoint retorna o bin id (ex: id: "abc123xyz")
            if (resultado && resultado.id) {
                novaEscala.id = resultado.id;
            }
        }
    } catch (e) {
        console.warn("Aviso: Não foi possível salvar na nuvem instantaneamente, usando ID local.", e);
        novaEscala.id = 'esc_' + Date.now();
    }

    novasEscalas.push(novaEscala);
    saveEscalas(novasEscalas);
    setEscalaAtualId(novaEscala.id);

    setTimeout(() => {
        window.location.href = `escala.html?id=${novaEscala.id}`;
    }, 100);
}

function renderizarListaEscalas() {
    const escalas = getEscalas();
    const listaDiv = document.getElementById('lista-escalas');
    const estadoVazio = document.getElementById('estado-vazio');

    if (escalas.length === 0) {
        if (estadoVazio) estadoVazio.classList.remove('hidden');
        if (listaDiv) listaDiv.innerHTML = '';
        return;
    }

    if (estadoVazio) estadoVazio.classList.add('hidden');
    if (listaDiv) {
        listaDiv.innerHTML = escalas.map(e => {
            const ocupados = e.horarios.filter(h => h.nome !== "").length;
            const total = e.horarios.length;
            const porcentagem = total > 0 ? ((ocupados / total) * 100).toFixed(1) : '0.0';

            return `
                <div onclick="setEscalaAtualId('${e.id}'); window.location.href='escala.html?id=${e.id}'" class="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition cursor-pointer flex flex-col justify-between group">
                    <div>
                        <span class="text-[10px] font-bold text-indigo-900 tracking-wider uppercase bg-indigo-50 px-2 py-0.5 rounded">Igreja</span>
                        <h3 class="font-bold text-indigo-950 text-base mt-2 mb-1 group-hover:text-indigo-700 transition">${e.igreja}</h3>
                        <p class="text-xs font-semibold text-slate-700 mb-1">Motivo: ${e.motivo}</p>
                        <p class="text-xs text-slate-500 mb-4">Período: ${e.dataInicio} - ${e.dataFim} (${e.intervalo} min)</p>
                        
                        <div class="border-t border-slate-100 pt-3 text-xs text-slate-600 flex flex-col gap-1">
                            <div>Preenchidos: <span class="font-semibold text-slate-800">${ocupados}</span> de ${total} (<span class="font-semibold text-indigo-900">${porcentagem}%</span>)</div>
                            <div class="text-slate-400">Último registro: ${e.ultimoRegistro}</div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }
}

// --- CONTROLE DA PÁGINA DE DETALHES (escala.html) ---
if (window.location.pathname.includes('escala.html')) {
    window.addEventListener('DOMContentLoaded', async () => {
        await processarEscalaViaUrl();
        carregarDetalhesEscala();
    });
}

function carregarDetalhesEscala() {
    const id = getEscalaAtualId();
    const escalas = getEscalas();

    if (!id) {
        alert('ID da escala não fornecido.');
        window.location.href = 'index.html';
        return;
    }

    const escala = escalas.find(e => e.id === id);

    if (!escala) {
        alert('Escala não encontrada!');
        window.location.href = 'index.html';
        return;
    }

    const ocupados = escala.horarios.filter(h => h.nome !== "").length;
    const total = escala.horarios.length;
    const porcentagem = ((ocupados / total) * 100).toFixed(1);

    const detalheCard = document.getElementById('detalhe-card');
    if (detalheCard) {
        detalheCard.innerHTML = `
            <span class="text-[10px] font-bold text-indigo-900 tracking-wider uppercase bg-indigo-50 px-2 py-0.5 rounded">Igreja</span>
            <h2 class="font-bold text-indigo-950 text-xl mt-2 mb-1">${escala.igreja}</h2>
            <p class="text-sm font-semibold text-slate-700 mb-1"><span class="text-slate-400 font-normal">Motivo:</span> ${escala.motivo}</p>
            <p class="text-xs text-slate-500 mb-4"><span class="text-slate-400">Período:</span> ${escala.dataInicio} - ${escala.dataFim} (${escala.intervalo} em ${escala.intervalo} min)</p>
            <div class="text-xs font-medium text-slate-700 flex flex-col gap-1.5 border-t pt-3 border-slate-100">
                <div><i class="fa-solid fa-list-check text-indigo-900 mr-2"></i>Horários preenchidos: <span class="font-semibold text-slate-900">${ocupados}</span> de ${total} (<span class="text-indigo-900 font-semibold">${porcentagem}%</span> ocupado | ${total - ocupados} disponíveis)</div>
                <div><i class="fa-regular fa-clock text-indigo-900 mr-2"></i>Último registro: <span class="text-slate-900 font-medium">${escala.ultimoRegistro}</span></div>
            </div>
        `;
    }

    if (escala.criadorId !== currentUserId) {
        const btnExcluir = document.getElementById('btn-excluir-container');
        const btnPdf = document.getElementById('btn-pdf-container');
        if (btnExcluir) btnExcluir.style.display = 'none';
        if (btnPdf) btnPdf.style.display = 'none';
    }

    const pdfTitulo = document.getElementById('pdf-titulo-topo');
    const pdfSub = document.getElementById('pdf-subtitulo-topo');
    if (pdfTitulo) pdfTitulo.innerText = `Escala da Oração Ininterrupta - ${escala.igreja}`;
    if (pdfSub) pdfSub.innerHTML = `Motivo: ${escala.motivo}<br>Período: ${escala.dataInicio} - ${escala.dataFim}`;

    const tbody = document.getElementById('tabela-horarios');
    if (tbody) {
        tbody.innerHTML = escala.horarios.map(h => {
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

async function preencherHorario(horarioId) {
    const nome = prompt("Digite seu nome completo para confirmar o horário de oração:");
    if (!nome || nome.trim() === "") return;

    const id = getEscalaAtualId();
    let escalas = getEscalas();
    let escala = escalas.find(e => e.id === id);

    if (!escala) return;

    const horarioObj = escala.horarios.find(h => h.id === horarioId);
    if (horarioObj) {
        horarioObj.nome = nome.trim();

        const agora = new Date();
        const dataStr = agora.toLocaleDateString('pt-BR');
        const horaStr = agora.toLocaleTimeString('pt-BR');
        escala.ultimoRegistro = `${dataStr} ${horaStr}`;

        saveEscalas(escalas);

        // Atualiza também na nuvem para que outras pessoas vejam a alteração
        if (id && id.length > 8 && !id.startsWith('esc_') && !id.startsWith('temp_')) {
            try {
                await fetch(`https://api.npoint.io/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(escala)
                });
            } catch (e) {
                console.warn("Erro ao atualizar na nuvem:", e);
            }
        }

        carregarDetalhesEscala();
    }
}

function excluirEscala() {
    if (!confirm("Tem certeza que deseja excluir esta escala permanentemente?")) return;
    const id = getEscalaAtualId();
    let escalas = getEscalas();
    escalas = escalas.filter(e => e.id !== id);
    saveEscalas(escalas);
    window.location.href = "index.html";
}

// --- FUNÇÃO DE COMPARTILHAR LINK CURTO ---
function copiarLink() {
    const id = getEscalaAtualId();
    if (!id) {
        alert("Nenhuma escala selecionada para compartilhar.");
        return;
    }

    const urlBase = window.location.href.split('#')[0].split('?')[0];
    const linkCompleto = `${urlBase}?id=${id}`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(linkCompleto).then(() => {
            alert("Link curto copiado com sucesso! Envie para os irmãos.");
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
        alert("Link curto copiado com sucesso! Envie para os irmãos.");
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
    const escalaId = getEscalaAtualId();
    const escalas = getEscalas();
    const escala = escalas.find(e => e.id === escalaId);

    if (!escala) return;

    const totalHorarios = escala.horarios.length;
    const metade = Math.ceil(totalHorarios / 2);
    const col1 = escala.horarios.slice(0, metade);
    const col2 = escala.horarios.slice(metade);

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
                            <th style="border: 1px solid #1e3a8a; padding: ${headerPadding}; font-size: ${fontSize}; text-align: left;">Nome</th>
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