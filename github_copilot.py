import subprocess
from github import Github

class GitCopilotManager:
    def __init__(self, token=None, repo_name=None):
        self.token = token
        self.repo_name = repo_name
        self.gh = Github(token) if token else None

    def git_create_branch(self, branch_name: str) -> str:
        return self._run_git(f"git checkout -b {branch_name}")

    def git_commit_all(self, message: str) -> str:
        self._run_git("git add .")
        return self._run_git(f'git commit -m "{message}"')

    def git_push_branch(self, branch_name: str) -> str:
        return self._run_git(f"git push -u origin {branch_name}")

    def get_issue(self, issue_number: int) -> str:
        if not self.gh or not self.repo_name:
            return "Erro: Token do GitHub ou Repositório não configurado."
        try:
            repo = self.gh.get_repo(self.repo_name)
            issue = repo.get_issue(number=issue_number)
            return f"Issue #{issue.number}: {issue.title}\n\nDescrição:\n{issue.body}"
        except Exception as e:
            return f"Erro ao buscar Issue: {str(e)}"

    def create_pull_request(self, title: str, body: str, head_branch: str, base_branch: str = "main") -> str:
        if not self.gh or not self.repo_name:
            return "Erro: Configurações do GitHub incompletas."
        try:
            repo = self.gh.get_repo(self.repo_name)
            pr = repo.create_pull(title=title, body=body, head=head_branch, base=base_branch)
            return f"Pull Request criado com sucesso! URL: {pr.html_url}"
        except Exception as e:
            return f"Erro ao criar Pull Request: {str(e)}"

    def _run_git(self, cmd: str) -> str:
        try:
            res = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30)
            return res.stdout if res.stdout else res.stderr
        except Exception as e:
            return f"Erro no comando Git: {str(e)}"
