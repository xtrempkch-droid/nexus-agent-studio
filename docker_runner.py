import os
import docker

class DockerSandboxRunner:
    def __init__(self, workspace_path=None, default_image="python:3.11-slim"):
        self.workspace_path = os.path.abspath(workspace_path or os.getcwd())
        self.default_image = default_image
        try:
            self.client = docker.from_env()
        except Exception as e:
            self.client = None
            print(f"Aviso: Não foi possível conectar ao Docker Daemon: {e}")

    def execute_in_sandbox(self, command: str, image: str = None) -> str:
        """Executa um comando de compilação ou teste dentro de um contêiner isolado."""
        if not self.client:
            return "Erro: Docker não está ativo no sistema. Inicie o serviço Docker no Ubuntu."

        target_image = image or self.default_image
        try:
            container_output = self.client.containers.run(
                image=target_image,
                command=["sh", "-c", command],
                volumes={
                    self.workspace_path: {
                        'bind': '/app',
                        'mode': 'rw'
                    }
                },
                working_dir='/app',
                detach=False,
                stdout=True,
                stderr=True,
                auto_remove=True
            )
            out_str = container_output.decode('utf-8')
            return f"✅ [Runner Docker Sucesso]:\n{out_str if out_str.strip() else 'Comando concluído sem saída.'}"

        except docker.errors.ContainerError as e:
            err_str = e.stderr.decode('utf-8') if e.stderr else str(e)
            return f"❌ [Runner Docker Falha no Teste/Build]:\n{err_str}"
        except Exception as e:
            return f"⚠️ [Erro de Infraestrutura do Docker]: {str(e)}"
