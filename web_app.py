import sys
import os
import socket
import asyncio
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import ollama

from system_checker import SystemEnvironmentManager
from docker_runner import DockerSandboxRunner
from github_copilot import GitCopilotManager

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

def find_available_port(start_port=8000, max_attempts=10):
    for port in range(start_port, start_port + max_attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('127.0.0.1', port)) != 0:
                return port
    return start_port

@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={"titulo": "NexusAgent Studio"}
    )

# --- Rotas da API de Diagnóstico e Infraestrutura ---

@app.get("/api/system/status")
async def get_system_status():
    return JSONResponse({
        "ollama": SystemEnvironmentManager.check_ollama_status(),
        "docker": SystemEnvironmentManager.check_docker_status()
    })

@app.post("/api/system/install-ollama")
async def api_install_ollama():
    msg = await asyncio.to_thread(SystemEnvironmentManager.install_ollama)
    return JSONResponse({"message": msg})

@app.post("/api/system/start-ollama")
async def api_start_ollama():
    msg = await asyncio.to_thread(SystemEnvironmentManager.start_ollama)
    return JSONResponse({"message": msg})

@app.post("/api/system/pull-model")
async def api_pull_model(data: dict):
    model_name = data.get("model", "qwen2.5-coder")
    msg = await asyncio.to_thread(SystemEnvironmentManager.pull_model, model_name)
    return JSONResponse({"message": msg})

# --- WebSockets para Chat / Agente ---

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
    except Exception as e:
        await websocket.send_json({"type": "ai_response", "content": f"⚠️ Erro no Ollama: {str(e)}"})

if __name__ == "__main__":
    port = find_available_port(8000)
    print(f"\n🌍 NexusAgent Studio Web disponível em: http://127.0.0.1:{port}\n")
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=port)
