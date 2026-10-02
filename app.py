import os
import asyncio
from textual.app import App, ComposeResult
from textual.containers import Container, Horizontal, Vertical, ScrollableContainer
from textual.widgets import Header, Footer, TextArea, Button, Input, Static, Switch, Label, Select
from textual.reactive import reactive
import ollama

from docker_runner import DockerSandboxRunner
from github_copilot import GitCopilotManager

class NexusStudioApp(App):
    CSS = """
    Screen { background: $surface; }
    #main-container { layout: horizontal; height: 1fr; }
    #sidebar { width: 34; background: \(panel; border-right: heavy\)accent; padding: 1; }
    #editor-container { width: 1fr; height: 1fr; }
    #chat-container { width: 46; background: \(panel; border-left: heavy\)accent; padding: 1; }
    #code-editor { height: 1fr; border: solid $accent; }
    #chat-history { height: 1fr; border: solid \(secondary; padding: 1; background:\)surface-darken-1; }
    #terminal-logs { height: 10; border: solid $warning; background: black; color: green; padding: 1; }
    .chat-user { color: $accent; text-style: bold; margin-top: 1; }
    .chat-ai { color: $success; margin-top: 1; }
    .chat-tool { color: $warning; text-style: italic; }
    .setting-label { margin-top: 1; text-style: bold; }
    """

    BINDINGS = [("ctrl+q", "quit", "Sair")]

    current_filepath = reactive("main.py")
    autonomous_mode = reactive(False)

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        with Container(id="main-container"):
            with Vertical(id="sidebar"):
                yield Label("⚙️ Configurações Agente", classes="setting-label")
                yield Label("Modelo Ollama:")
                yield Select([("Qwen 2.5 Coder", "qwen2.5-coder"), ("DeepSeek R1", "deepseek-r1")], value="qwen2.5-coder", id="model-select")
                
                yield Label("Modo Autônomo:", classes="setting-label")
                yield Horizontal(
                    Switch(value=False, id="autonomous-switch"),
                    Label(" 🛡️ ASSISTIDO", id="mode-status")
                )

                yield Label("📂 Arquivo Atual:", classes="setting-label")
                yield Input(value=self.current_filepath, id="filepath-input")
                yield Button("Carregar / Criar", id="btn-load-file", variant="primary")

            with Vertical(id="editor-container"):
                yield Label("📝 Editor de Código (Nexus Studio)")
                yield TextArea.code_editor("# Escreva código ou solicite alterações para a IA\nprint('NexusAgent pronto no Ubuntu!')\n", language="python", id="code-editor")
                yield Label("🐳 Output do Runner Docker (Testes em Contêiner)")
                yield ScrollableContainer(Static("Aguardando execuções de testes em contêiner...", id="terminal-text"), id="terminal-logs")

            with Vertical(id="chat-container"):
                yield Label("🤖 Agente Local Copiloto")
                yield ScrollableContainer(Static("Agente iniciado. Digite comandos ou tarefas do repositório.", id="chat-text"), id="chat-history")
                yield Input(placeholder="Ex: Crie um script e rode os testes no Docker...", id="chat-input")
                yield Button("Enviar Prompt", id="btn-send-chat", variant="success")
        yield Footer()

    def on_mount(self):
        self.title = "NexusAgent Studio - Copiloto Git & Docker Runner"
        self.runner = DockerSandboxRunner()
        self.git_mgr = GitCopilotManager()
        self.messages = [
            {
                "role": "system",
                "content": (
                    "Você é um assistente avançado de desenvolvimento no Ubuntu Linux com suporte nativo a Git e Docker. "
                    "Por padrão, TODOS os testes e compilações devem ser rodados em contêineres Docker usando 'run_in_container'."
                )
            }
        ]

    def on_switch_changed(self, event: Switch.Changed) -> None:
        self.autonomous_mode = event.value
        status = self.query_one("#mode-status", Label)
        status.update(" 🔥 AUTÔNOMO" if event.value else " 🛡️ ASSISTIDO")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "btn-load-file":
            self.load_file(self.query_one("#filepath-input", Input).value)
        elif event.button.id == "btn-send-chat":
            self.process_chat()

    def load_file(self, path: str):
        self.current_filepath = path
        editor = self.query_one("#code-editor", TextArea)
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                editor.load_text(f.read())
            self.log_runner(f"Arquivo '{path}' carregado.")
        else:
            editor.load_text(f"# Novo arquivo: {path}\n")

    def log_runner(self, msg: str):
        t = self.query_one("#terminal-text", Static)
        t.update(f"{t.renderable}\n> {msg}")

    def append_chat(self, msg: str, css: str = "chat-ai"):
        c = self.query_one("#chat-text", Static)
        c.update(f"{c.renderable}\n[{css}]{msg}[/{css}]")

    def process_chat(self):
        inp = self.query_one("#chat-input", Input)
        prompt = inp.value.strip()
        if not prompt: return
        inp.value = ""
        self.append_chat(f"Você: {prompt}", "chat-user")
        self.messages.append({"role": "user", "content": prompt})
        asyncio.create_task(self.run_agent_loop())

    async def run_agent_loop(self):
        model = self.query_one("#model-select", Select).value
        tools = [
            {
                "type": "function",
                "function": {
                    "name": "write_file",
                    "description": "Grava ou altera o conteúdo de um arquivo de código.",
                    "parameters": {
                        "type": "object",
                        "properties": {"filepath": {"type": "string"}, "content": {"type": "string"}},
                        "required": ["filepath", "content"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "run_in_container",
                    "description": "Executa testes, compilações ou comandos dentro de um contêiner Docker isolado.",
                    "parameters": {
                        "type": "object",
                        "properties": {"command": {"type": "string"}, "image": {"type": "string"}},
                        "required": ["command"]
                    }
                }
            }
        ]

        try:
            # Assíncrono via thread para não travar a TUI
            res = await asyncio.to_thread(ollama.chat, model=model, messages=self.messages, tools=tools)
            msg = res["message"]
            self.messages.append(msg)

            if msg.get("tool_calls"):
                for tool in msg["tool_calls"]:
                    fn = tool["function"]["name"]
                    args = tool["function"]["arguments"]

                    if fn == "write_file":
                        path, content = args.get("filepath"), args.get("content")
                        parent_dir = os.path.dirname(path)
                        if parent_dir:
                            os.makedirs(parent_dir, exist_ok=True)

                        with open(path, "w", encoding="utf-8") as f:
                            f.write(content)

                        if path == self.current_filepath:
                            self.query_one("#code-editor", TextArea).load_text(content)
                        self.append_chat(f"🤖 Arquivo {path} atualizado.", "chat-tool")
                        self.messages.append({"role": "tool", "content": f"Arquivo {path} salvo."})

                    elif fn == "run_in_container":
                        cmd = args.get("command")
                        self.append_chat(f"🤖 Executando no Docker: {cmd}", "chat-tool")
                        out = await asyncio.to_thread(self.runner.execute_in_sandbox, cmd, args.get("image"))
                        self.log_runner(out)
                        self.messages.append({"role": "tool", "content": out})

                await self.run_agent_loop()
            else:
                if msg.get("content"):
                    self.append_chat(f"IA: {msg['content']}", "chat-ai")
        except Exception as e:
            self.append_chat(f"Erro: {str(e)}", "chat-tool")

if __name__ == "__main__":
    NexusStudioApp().run()
