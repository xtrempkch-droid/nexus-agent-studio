const ws = new WebSocket(`ws://${window.location.host}/ws/chat`);
const chatMessages = document.getElementById('chat-messages');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');

// --- WebSockets Chat ---
ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'ai_response') {
        appendMessage('IA', data.content, 'ai');
    }
};

function sendMessage() {
    const text = userInput.value.trim();
    if (!text) return;
    appendMessage('Você', text, 'user');
    ws.send(text);
    userInput.value = '';
}

function appendMessage(sender, msg, role) {
    const div = document.createElement('div');
    div.style.marginBottom = '10px';
    div.style.color = role === 'user' ? '#569cd6' : '#4ec9b0';
    div.innerHTML = `<strong>${sender}:</strong> ${msg}`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

if (sendBtn) sendBtn.addEventListener('click', sendMessage);
if (userInput) userInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

// --- Troca de Abas ---
function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));

    if (tabName === 'workspace') {
        document.getElementById('tab-workspace').style.display = 'flex';
    } else if (tabName === 'infra') {
        document.getElementById('tab-infra').style.display = 'block';
        checkSystemStatus();
    }
}

// --- Funções de Diagnóstico e Reparo ---
function logSystem(msg) {
    const logBox = document.getElementById('system-logs');
    if (logBox) {
        logBox.innerHTML += `<br>> ${msg}`;
        logBox.scrollTop = logBox.scrollHeight;
    }
}

async function checkSystemStatus() {
    try {
        const res = await fetch('/api/system/status');
        const data = await res.json();

        // Ollama Badge
        const oBadge = document.getElementById('ollama-status-badge');
        if (data.ollama.running) {
            oBadge.textContent = '🟢 Ativo e Rodando';
            oBadge.className = 'badge-status status-ok';
        } else if (data.ollama.installed) {
            oBadge.textContent = '🟡 Instalado (Inativo)';
            oBadge.className = 'badge-status status-warn';
        } else {
            oBadge.textContent = '🔴 Não Instalado';
            oBadge.className = 'badge-status status-error';
        }

        // Modelos
        const mList = document.getElementById('ollama-models-list');
        mList.textContent = data.ollama.models.length > 0 ? data.ollama.models.join(', ') : 'Nenhum modelo baixado';

        // Docker Badge
        const dBadge = document.getElementById('docker-status-badge');
        if (data.docker.running) {
            dBadge.textContent = '🟢 Daemon Ativo';
            dBadge.className = 'badge-status status-ok';
        } else if (data.docker.installed) {
            dBadge.textContent = '🟡 Daemon Inativo';
            dBadge.className = 'badge-status status-warn';
        } else {
            dBadge.textContent = '🔴 Não Instalado';
            dBadge.className = 'badge-status status-error';
        }
    } catch (e) {
        logSystem(`Erro ao consultar status: ${e}`);
    }
}

async function installOllama() {
    logSystem('Instalando Ollama no sistema (aguarde)...');
    const res = await fetch('/api/system/install-ollama', { method: 'POST' });
    const data = await res.json();
    logSystem(data.message);
    checkSystemStatus();
}

async function startOllama() {
    logSystem('Iniciando serviço do Ollama...');
    const res = await fetch('/api/system/start-ollama', { method: 'POST' });
    const data = await res.json();
    logSystem(data.message);
    checkSystemStatus();
}

async function pullModel(modelName) {
    logSystem(`Baixando modelo '${modelName}' (pode demorar alguns minutos)...`);
    const res = await fetch('/api/system/pull-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName })
    });
    const data = await res.json();
    logSystem(data.message);
    checkSystemStatus();
}
