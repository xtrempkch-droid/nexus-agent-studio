import os
import subprocess
import shutil
import ollama

class SystemEnvironmentManager:
    @staticmethod
    def check_ollama_status() -> dict:
        """Verifica se o Ollama está instalado e rodando."""
        installed = shutil.which("ollama") is not None
        running = False
        if installed:
            try:
                ollama.list()
                running = True
            except Exception:
                running = False
        return {"installed": installed, "running": running}

    @staticmethod
    def check_docker_status() -> dict:
        """Verifica se o Docker está instalado e se o Daemon responde."""
        installed = shutil.which("docker") is not None
        running = False
        if installed:
            try:
                res = subprocess.run(["docker", "info"], capture_output=True, text=True)
                running = (res.returncode == 0)
            except Exception:
                running = False
        return {"installed": installed, "running": running}

    @classmethod
    def install_ollama_system(cls) -> str:
        """Tenta instalar o Ollama via script oficial."""
        try:
            cmd = "curl -fsSL https://ollama.com/install.sh | sh"
            res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            if res.returncode == 0:
                return "✅ Ollama instalado com sucesso!"
            return f"❌ Falha na instalação: {res.stderr}"
        except Exception as e:
            return f"❌ Erro ao executar instalador: {str(e)}"

    @classmethod
    def start_ollama_service(cls) -> str:
        """Inicia o processo background do Ollama."""
        try:
            subprocess.Popen(["ollama", "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return "🚀 Serviço do Ollama iniciado."
        except Exception as e:
            return f"❌ Erro ao iniciar Ollama: {str(e)}"
