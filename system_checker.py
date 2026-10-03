import os
import shutil
import subprocess
import time
import ollama

class SystemEnvironmentManager:
    @staticmethod
    def check_ollama_status() -> dict:
        """Verifica se o Ollama está instalado e se o serviço está respondendo."""
        installed = shutil.which("ollama") is not None
        running = False
        models = []

        if installed:
            try:
                models_info = ollama.list()
                running = True
                models_list = models_info.get('models', []) if isinstance(models_info, dict) else getattr(models_info, 'models', [])
                models = [m.get('name', '') if isinstance(m, dict) else getattr(m, 'model', '') for m in models_list]
            except Exception:
                running = False

        return {
            "installed": installed,
            "running": running,
            "models": models
        }

    @staticmethod
    def check_docker_status() -> dict:
        """Verifica se o Docker está instalado e se o Daemon responde."""
        installed = shutil.which("docker") is not None
        running = False

        if installed:
            try:
                res = subprocess.run(["docker", "info"], capture_output=True, text=True, timeout=5)
                running = (res.returncode == 0)
            except Exception:
                running = False

        return {
            "installed": installed,
            "running": running
        }

    @classmethod
    def install_ollama(cls) -> str:
        """Executa o script de instalação oficial do Ollama."""
        try:
            cmd = "curl -fsSL https://ollama.com/install.sh | sh"
            res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            if res.returncode == 0:
                return "✅ Ollama instalado com sucesso!"
            return f"❌ Erro na instalação: {res.stderr}"
        except Exception as e:
            return f"❌ Falha de execução: {str(e)}"

    @classmethod
    def start_ollama(cls) -> str:
        """Inicia o processo background do Ollama."""
        try:
            subprocess.Popen(["ollama", "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            time.sleep(3)
            return "🚀 Serviço Ollama iniciado com sucesso!"
        except Exception as e:
            return f"❌ Erro ao iniciar Ollama: {str(e)}"

    @classmethod
    def pull_model(cls, model_name: str = "qwen2.5-coder") -> str:
        """Faz o download de um modelo via Ollama."""
        try:
            ollama.pull(model_name)
            return f"✅ Modelo '{model_name}' instalado com sucesso!"
        except Exception as e:
            return f"❌ Erro ao baixar modelo '{model_name}': {str(e)}"
