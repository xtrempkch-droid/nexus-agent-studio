import asyncio
import os
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import ollama

from docker_runner import DockerSandboxRunner
from github_copilot import GitCopilotManager

app = FastAPI(title="NexusAgent Studio Web")

# Configurar arquivos estáticos e templates
os.makedirs("static/css", exist_ok=True)
os.makedirs("static/js", exist_ok=True)
os.makedirs("templates", exist_ok=True)

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

runner = DockerSandboxRunner()
git_mgr = GitCopilotManager()

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
            
            # Resposta síncrona do Ollama em thread separada
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

if __name__ == "__main__":
    import uvicorn
    print("🚀 Iniciando NexusAgent Studio Web em http://127.0.0.1:8000")
    uvicorn.run(app, host="127.0.0.1", port=8000)
