const ws = new WebSocket(`ws://${window.location.host}/ws/chat`);
const chatMessages = document.getElementById('chat-messages');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');

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

sendBtn.addEventListener('click', sendMessage);
userInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
