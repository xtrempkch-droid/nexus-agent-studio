import os
import sys
import subprocess
import json
import requests
from flask import Flask, render_template, request, jsonify

# Configuração de caminhos para empacotamento com PyInstaller
if getattr(sys, 'frozen', False):
    base_dir = sys._MEIPASS
    template_folder = os.path.join(base_dir, 'templates')
    static_folder = os.path.join(base_dir, 'static')
    app = Flask(__name__, template_folder=template_folder, static_folder=static_folder)
else:
    app = Flask(__name__)

WORKSPACE_DIR = os.path.abspath(os.getcwd())

def get_relative_path(path):
    try:
        return os.path.relpath(path, WORKSPACE_DIR)
    except ValueError:
        return path

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/workspace', methods=['GET'])
def get_workspace_info():
    return jsonify({
        "workspace_dir": WORKSPACE_DIR,
        "status": "online"
    })

@app.route('/api/tree', methods=['GET'])
def list_files():
    """Retorna a árvore de arquivos do workspace."""
    file_list = []
    ignored_dirs = {'.git', '__pycache__', 'node_modules', '.venv', 'venv', 'dist', 'build'}
    
    for root, dirs, files in os.walk(WORKSPACE_DIR):
        dirs[:] = [d for d in dirs if d not in ignored_dirs]
        for file in files:
            full_path = os.path.join(root, file)
            rel_path = get_relative_path(full_path)
            file_list.append({
                "path": rel_path.replace("\\", "/"),
                "name": file,
                "is_dir": False
            })
            
    return jsonify({"files": sorted(file_list, key=lambda x: x["path"])})

@app.route('/api/file/read', methods=['POST'])
def read_file():
    """Lê o conteúdo de um arquivo específico."""
    data = request.json or {}
    rel_path = data.get('path')
    if not rel_path:
        return jsonify({"error": "Caminho do arquivo não informado"}), 400

    full_path = os.path.join(WORKSPACE_DIR, rel_path)
    if not os.path.exists(full_path):
        return jsonify({"error": "Arquivo não encontrado"}), 404

    try:
        with open(full_path, 'r', encoding='utf-8') as f:
            content = f.read()
        return jsonify({"path": rel_path, "content": content})
    except Exception as e:
        return jsonify({"error": f"Erro ao ler arquivo: {str(e)}"}), 500

@app.route('/api/file/save', methods=['POST'])
def save_file():
    """Salva alterações em um arquivo."""
    data = request.json or {}
    rel_path = data.get('path')
    content = data.get('content', '')

    if not rel_path:
        return jsonify({"error": "Caminho do arquivo não informado"}), 400

    full_path = os.path.join(WORKSPACE_DIR, rel_path)
    try:
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, 'w', encoding='utf-8') as f:
            f.write(content)
        return jsonify({"success": True, "path": rel_path})
    except Exception as e:
        return jsonify({"error": f"Erro ao salvar arquivo: {str(e)}"}), 500

@app.route('/api/execute', methods=['POST'])
def execute_command():
    """Executa comandos de terminal no diretório do workspace."""
    data = request.json or {}
    command = data.get('command')
    if not command:
        return jsonify({"error": "Comando não especificado"}), 400

    try:
        result = subprocess.run(
            command,
            shell=True,
            cwd=WORKSPACE_DIR,
            capture_output=True,
            text=True,
            timeout=30
        )
        return jsonify({
            "command": command,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "exit_code": result.returncode
        })
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Comando excedeu o tempo limite de execução (30s)"}), 500
    except Exception as e:
        return jsonify({"error": f"Falha na execução: {str(e)}"}), 500

@app.route('/api/ollama/models', methods=['POST'])
def list_ollama_models():
    """Consulta os modelos disponíveis no Ollama local."""
    data = request.json or {}
    ollama_url = data.get('ollama_url', 'http://localhost:11434').rstrip('/')
    try:
        response = requests.get(f"{ollama_url}/api/tags", timeout=5)
        if response.status_code == 200:
            models_data = response.json()
            models = [m['name'] for m in models_data.get('models', [])]
            return jsonify({"status": "connected", "models": models})
        return jsonify({"status": "error", "message": f"HTTP {response.status_code}"}), 400
    except Exception as e:
        return jsonify({"status": "offline", "message": str(e)}), 200

if __name__ == '__main__':
    print("=" * 60)
    print(" 🚀 NexusAgent Studio Web Server Iniciado!")
    print(f" 📂 Workspace Ativo: {WORKSPACE_DIR}")
    print(" 🌐 Acesse a interface em: http://127.0.0.1:5000")
    print("=" * 60)
    app.run(host='0.0.0.0', port=5000, debug=False)
