import sys
import os
import socket
import subprocess
import asyncio
import time
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import ollama

from docker_runner import DockerSandboxRunner
from github_copilot import GitCopilotManager

# ---------------------------------------------------------
# 1. Ajuste de Caminhos para Executável do PyInstaller
# ---------------------------------------------------------
if getattr(sys, 'frozen', False):
    base_dir = sys._MEIPASS
else:
    base_dir = os.path.dirname(os.path.abspath(__file__))

templates_dir = os.path.join(base_dir, "templates")
static_dir = os.path.join(base_dir, "static")

os.makedirs(templates_dir, exist_ok=True)
os.makedirs(static_dir, exist_ok=True)

app = FastAPI(title="NexusAgent Studio Web")

app.mount("/static", StaticFiles(directory=static_dir), name="static")
templates = Jinja2Templates(directory=templates_dir)

runner = DockerSandboxRunner()
git_mgr = GitCopilotManager()

# ---------------------------------------------------------
# 2. Funções de Garantia de Infraestrutura (Health Checks)
# ---------------------------------------------------------
def find_available_port(start_port=8000, max_attempts=10):
    """Encontra uma porta TCP livre a partir de start_port."""
    for port in range(start_port, start_port + max_attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('127.0.0.1', port)) != 0:
                return port
    return start_port

def ensure_ollama_running(model_name="qwen2.5-coder"):
    """Garante que o Ollama está ativo e o modelo baixado."""
    print("🔍 Verificando serviço do Ollama...")
    try:
        ollama.list()
        print("✅ Ollama está ativo!")
    except Exception:
        print("⚠️ Ollama não respondeu. Tentando iniciar 'ollama serve'...")
        try:
            subprocess.Popen(["ollama", "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            time.sleep(3)
        except FileNotFoundError:
            print("❌ Ollama não está instalado no sistema. Instale via: curl -fsSL https://ollama.com/install.sh | sh")
            return

    # Verificar se o modelo especificado está baixado
    try:
        models_info = ollama.list()
        # ollama.list() pode retornar objeto ou dicionário dependendo da versão
        models_list = models_info.get('models', []) if isinstance(models_info, dict) else getattr(models_info, 'models', [])
        model_names = [m.get('name', '') if isinstance(m, dict) else getattr(m, 'model', '') for m in models_list]
        
        if not any(model_name in m for m in model_names):
            print(f"📥 Baixando modelo '{model_name}' (pode levar alguns minutos)...")
            ollama.pull(model_name)
            print(f"✅ Modelo '{model_name}' instalado com sucesso!")
        else:
            print(f"✅ Modelo '{model_name}' pronto para uso.")
    except Exception as e:
        print(f"⚠️ Não foi possível verificar/baixar modelo automaticamente: {e}")

# ---------------------------------------------------------
# 3. Rotas da Aplicação e WebSockets
# ---------------------------------------------------------
@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket):
    await websocket.accept()
    messages = [
        {
            "role": "system",
            "content": "Você é o assistente NexusAgent Studio rodando na Web com suporte a Docker e Git."
        }
    ]
    try:
        while True:
            user_input = await websocket.receive_text()
            messages.append({"role": "user", "content": user_input})
            
            res = await asyncio.to_thread(
                ollama.chat, 
                model="qwen2.5-coder", 
                messages=messages
            )
            
            ai_msg = res["message"]["content"]
            messages.append({"role": "assistant", "content": ai_msg})
            
            await websocket.send_json({"type": "ai_response", "content": ai_msg})
    except WebSocketDisconnect:
        print("Cliente desconectado do WebSocket.")

# ---------------------------------------------------------
# 4. Inicialização Principal
# ---------------------------------------------------------
if __name__ == "__main__":
    print("\n--------------------------------------------------")
    print("🚀 Inicializando Verificações de Infraestrutura...")
    print("--------------------------------------------------")
    
    ensure_ollama_running()
    
    port = find_available_port(8000)
    print(f"\n🌍 Servidor pronto! Acesse: http://127.0.0.1:{port}\n")
    
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=port)
