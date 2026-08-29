#!/usr/bin/env python3
"""ChangeGuard repository runner: generate, validate, retain, and report tests."""

from __future__ import annotations

import argparse
import fnmatch
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any


@dataclass
class Config:
    test_commands: list[str] = field(default_factory=list)
    setup_commands: list[str] = field(default_factory=list)
    test_roots: list[str] = field(default_factory=lambda: ["tests", "test", "src", "app"])
    source_roots: list[str] = field(default_factory=lambda: ["src", "app", "lib", "packages"])
    exclude: list[str] = field(default_factory=lambda: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**", "**/*.lock", "**/.env*"])
    daily_change_hours: int = 24
    max_files: int = 20
    max_file_bytes: int = 18_000
    max_context_bytes: int = 180_000
    max_candidates: int = 12
    command_timeout_seconds: int = 900
    validation_command: str | None = None
    require_validation: bool = False
    product_context: str = ""


@dataclass
class Candidate:
    path: str
    target_file: str
    framework: str
    content: str
    rationale: str
    confidence: float
    status: str = "candidate"
    mutation_kills: int = 0
    evidence: str = ""
    created_by_runner: bool = False


@dataclass
class CommandResult:
    command: str
    returncode: int
    duration_ms: int
    output: str


def shell(command: str, cwd: Path, timeout: int, extra_env: dict[str, str] | None = None) -> CommandResult:
    started = time.monotonic()
    env = os.environ.copy()
    env.update({"CI": "1", "CHANGEGUARD": "1", "FORCE_COLOR": "0"})
    if extra_env:
        env.update(extra_env)
    try:
        process = subprocess.run(command, cwd=cwd, shell=True, text=True, capture_output=True, timeout=timeout, env=env)
        output = (process.stdout + "\n" + process.stderr).strip()[-12_000:]
        return CommandResult(command, process.returncode, int((time.monotonic() - started) * 1000), output)
    except subprocess.TimeoutExpired as error:
        output = ((error.stdout or "") + "\n" + (error.stderr or "")).strip()[-12_000:]
        return CommandResult(command, 124, int((time.monotonic() - started) * 1000), f"Timed out.\n{output}")


def load_config(repo: Path, explicit: str | None) -> Config:
    path = Path(explicit).resolve() if explicit else repo / ".changeguard" / "config.json"
    values: dict[str, Any] = {}
    if path.exists():
        values = json.loads(path.read_text(encoding="utf-8"))
    allowed = set(Config.__dataclass_fields__)
    unknown = set(values) - allowed
    if unknown:
        raise ValueError(f"Unknown config keys: {', '.join(sorted(unknown))}")
    config = Config(**values)
    if not path.exists() and not config.setup_commands:
        config.setup_commands = detect_setup_commands(repo)
    if not config.test_commands:
        config.test_commands = detect_test_commands(repo)
    return config


def detect_setup_commands(repo: Path) -> list[str]:
    commands: list[str] = []
    if (repo / "pnpm-lock.yaml").exists():
        commands.append("corepack enable && pnpm install --frozen-lockfile")
    elif (repo / "yarn.lock").exists():
        commands.append("corepack enable && yarn install --immutable")
    elif (repo / "package-lock.json").exists():
        commands.append("npm ci")
    if (repo / "requirements.txt").exists():
        commands.append(f'"{sys.executable}" -m pip install -r requirements.txt')
    elif (repo / "pyproject.toml").exists():
        commands.append(f'"{sys.executable}" -m pip install -e .')
    return commands


def detect_test_commands(repo: Path) -> list[str]:
    if (repo / "package.json").exists():
        package = json.loads((repo / "package.json").read_text(encoding="utf-8"))
        if "test" not in package.get("scripts", {}):
            raise ValueError("package.json has no test script; configure test_commands")
        if (repo / "pnpm-lock.yaml").exists():
            return ["pnpm test"]
        if (repo / "yarn.lock").exists():
            return ["yarn test"]
        return ["npm test"]
    if (repo / "pyproject.toml").exists() or (repo / "pytest.ini").exists() or (repo / "requirements.txt").exists():
        return [f'"{sys.executable}" -m pytest -q']
    if (repo / "go.mod").exists():
        return ["go test ./..."]
    raise ValueError("Could not detect a test command; create .changeguard/config.json")


def git(repo: Path, *args: str) -> str:
    process = subprocess.run(["git", *args], cwd=repo, text=True, capture_output=True)
    if process.returncode:
        raise RuntimeError(process.stderr.strip() or f"git {' '.join(args)} failed")
    return process.stdout.strip()


def changed_files(repo: Path, config: Config, base_ref: str | None) -> list[str]:
    if base_ref:
        names = git(repo, "diff", "--name-only", f"{base_ref}...HEAD").splitlines()
    else:
        commits = git(repo, "rev-list", f"--since={config.daily_change_hours} hours ago", "HEAD").splitlines()
        if commits:
            oldest_parent = f"{commits[-1]}^"
            names = git(repo, "diff", "--name-only", oldest_parent, "HEAD").splitlines()
        else:
            names = git(repo, "show", "--pretty=", "--name-only", "HEAD").splitlines()
    return [name for name in dict.fromkeys(names) if is_source_file(name, config)][: config.max_files]


def is_source_file(name: str, config: Config) -> bool:
    path = PurePosixPath(name.replace("\\", "/"))
    if not path.parts or path.suffix.lower() not in {".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".java", ".rb", ".rs", ".vue", ".svelte"}:
        return False
    normalized = path.as_posix()
    if any(fnmatch.fnmatch(normalized, pattern) for pattern in config.exclude):
        return False
    if any(part in {"test", "tests", "__tests__", "spec"} for part in path.parts):
        return False
    return not any(token in normalized.lower() for token in ("secret", "credential", "private_key"))


SECRET_PATTERN = re.compile(r"(?i)(api[_-]?key|token|secret|password)(\s*[:=]\s*)['\"]?[^\s,'\"]+")


def source_context(repo: Path, names: list[str], config: Config) -> list[dict[str, str]]:
    context: list[dict[str, str]] = []
    total = 0
    for name in names:
        path = (repo / name).resolve()
        if repo.resolve() not in path.parents or not path.is_file() or path.stat().st_size > config.max_file_bytes:
            continue
        content = path.read_text(encoding="utf-8", errors="replace")
        content = SECRET_PATTERN.sub(r"\1\2[REDACTED]", content)
        encoded = content.encode()
        if total + len(encoded) > config.max_context_bytes:
            break
        context.append({"path": name, "content": content})
        total += len(encoded)
    return context


def generate_candidates(context: list[dict[str, str]], config: Config) -> list[Candidate]:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY is required for generation")
    schema = {
        "type": "object", "additionalProperties": False,
        "properties": {"tests": {"type": "array", "maxItems": config.max_candidates, "items": {
            "type": "object", "additionalProperties": False,
            "properties": {
                "path": {"type": "string"}, "target_file": {"type": "string"}, "framework": {"type": "string"},
                "content": {"type": "string"}, "rationale": {"type": "string"}, "confidence": {"type": "number", "minimum": 0, "maximum": 1},
            }, "required": ["path", "target_file", "framework", "content", "rationale", "confidence"],
        }}}, "required": ["tests"],
    }
    payload = {
        "model": os.getenv("OPENAI_MODEL", "gpt-5-mini"), "store": False,
        "instructions": "You are a conservative staff test engineer. Generate only deterministic, valuable regression tests for boundary values, state transitions, failure paths, contracts, authorization, serialization, and concurrency visible in the supplied code. Never edit production code. Never use network access, sleeps, snapshots of large output, or assertions that merely restate mocks. Prefer public behavior. Return an empty list when evidence is insufficient.",
        "input": json.dumps({"task": "Generate cumulative regression-test candidates for recently changed production files.", "product_context": config.product_context, "allowed_test_roots": config.test_roots, "test_commands": config.test_commands, "files": context}),
        "text": {"format": {"type": "json_schema", "name": "changeguard_tests", "strict": True, "schema": schema}},
    }
    request = urllib.request.Request("https://api.openai.com/v1/responses", data=json.dumps(payload).encode(), headers={"authorization": f"Bearer {api_key}", "content-type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            body = json.loads(response.read())
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"Generation API failed ({error.code}): {error.read().decode(errors='replace')[:1000]}") from error
    text = body.get("output_text") or extract_output_text(body)
    parsed = json.loads(text)
    return [Candidate(**item) for item in parsed.get("tests", [])]


def extract_output_text(response: dict[str, Any]) -> str:
    for item in response.get("output", []):
        if item.get("type") == "message":
            for content in item.get("content", []):
                if content.get("type") == "output_text":
                    return content.get("text", "")
    raise ValueError("Generation response did not contain output text")


def safe_candidate_path(repo: Path, candidate: Candidate, config: Config) -> Path:
    posix = PurePosixPath(candidate.path.replace("\\", "/"))
    if posix.is_absolute() or ".." in posix.parts or not posix.parts:
        raise ValueError("unsafe test path")
    if posix.parts[0] not in config.test_roots:
        raise ValueError(f"path must start with one of {config.test_roots}")
    if posix.suffix.lower() not in {".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".java", ".rb", ".rs"}:
        raise ValueError("unsupported test extension")
    resolved = (repo / Path(*posix.parts)).resolve()
    if repo.resolve() not in resolved.parents:
        raise ValueError("test escaped repository")
    return resolved


def has_assertion(candidate: Candidate) -> bool:
    return bool(re.search(r"\b(assert|expect|should|assert_eq|require\.)\b", candidate.content))


def has_forbidden_side_effect(candidate: Candidate) -> bool:
    patterns = (r"\bsubprocess\b", r"\bchild_process\b", r"\bos\.system\b", r"\bsocket\.", r"\brequests\.", r"\bhttpx\.", r"\bfetch\s*\(", r"\bexec\s*\(")
    return any(re.search(pattern, candidate.content) for pattern in patterns)


def run_suite(repo: Path, config: Config) -> list[CommandResult]:
    results: list[CommandResult] = []
    for command in config.test_commands:
        result = shell(command, repo, config.command_timeout_seconds)
        results.append(result)
        if result.returncode:
            break
    return results


def suite_passed(results: list[CommandResult]) -> bool:
    return bool(results) and all(result.returncode == 0 for result in results)


def validate_candidates(repo: Path, candidates: list[Candidate], config: Config, changed_paths: set[str]) -> tuple[list[Candidate], list[dict[str, str]]]:
    accepted: list[Candidate] = []
    alerts: list[dict[str, str]] = []
    for candidate in candidates[: config.max_candidates]:
        try:
            path = safe_candidate_path(repo, candidate, config)
            if path.exists():
                raise ValueError("generated path already exists")
            if candidate.target_file not in changed_paths:
                raise ValueError("target_file is not in the bounded change set")
            if len(candidate.content.encode()) > 50_000:
                raise ValueError("candidate exceeds the 50 KB safety limit")
            if not has_assertion(candidate):
                raise ValueError("candidate contains no recognizable assertion")
            if has_forbidden_side_effect(candidate):
                raise ValueError("candidate contains a forbidden network or process side effect")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(candidate.content.rstrip() + "\n", encoding="utf-8")
            candidate.created_by_runner = True

            first = run_suite(repo, config)
            if not suite_passed(first):
                candidate.status = "breaking"
                candidate.evidence = first[-1].output[-4000:]
                alerts.append({"severity": "high", "title": candidate.rationale[:180], "evidence": f"New regression test {candidate.path} fails against the current revision.\n{candidate.evidence}"})
                path.unlink(missing_ok=True)
                candidate.created_by_runner = False
                continue

            second = run_suite(repo, config)
            if not suite_passed(second):
                candidate.status = "rejected"
                candidate.evidence = "The candidate passed once and failed on repetition; quarantined as flaky."
                path.unlink(missing_ok=True)
                candidate.created_by_runner = False
                continue

            if config.validation_command:
                validation = shell(config.validation_command.format(test_path=candidate.path, target_file=candidate.target_file), repo, config.command_timeout_seconds)
                if validation.returncode:
                    candidate.status = "rejected"
                    candidate.evidence = f"Usefulness validation failed.\n{validation.output[-3000:]}"
                    path.unlink(missing_ok=True)
                    candidate.created_by_runner = False
                    continue
                candidate.mutation_kills = 1
            elif config.require_validation:
                candidate.status = "rejected"
                candidate.evidence = "require_validation is enabled but validation_command is missing."
                path.unlink(missing_ok=True)
                candidate.created_by_runner = False
                continue

            candidate.status = "accepted"
            candidate.evidence = "Passed the full suite twice" + (" and passed the configured mutation/usefulness gate." if config.validation_command else ".")
            accepted.append(candidate)
        except (OSError, ValueError) as error:
            candidate.status = "rejected"
            candidate.evidence = str(error)
    return accepted, alerts


def report_event(api_url: str | None, token: str | None, event: dict[str, Any]) -> None:
    if not api_url:
        return
    request = urllib.request.Request(api_url.rstrip("/") + "/api/events", data=json.dumps(event).encode(), headers={"content-type": "application/json", **({"authorization": f"Bearer {token}"} if token else {})}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            if response.status >= 300:
                raise RuntimeError(f"dashboard returned {response.status}")
    except (urllib.error.URLError, TimeoutError) as error:
        print(f"warning: dashboard report failed: {error}", file=sys.stderr)


def cleanup_candidates(repo: Path, candidates: list[Candidate]) -> None:
    for candidate in candidates:
        if not candidate.created_by_runner:
            continue
        try:
            path = (repo / Path(*PurePosixPath(candidate.path.replace("\\", "/")).parts)).resolve()
            if repo.resolve() in path.parents:
                path.unlink(missing_ok=True)
                candidate.created_by_runner = False
        except (OSError, ValueError):
            pass


def write_manifest(repo: Path, run_id: str, candidates: list[Candidate], alerts: list[dict[str, str]]) -> Path:
    directory = repo / ".changeguard" / "runs"
    directory.mkdir(parents=True, exist_ok=True)
    manifest = directory / f"{run_id}.json"
    public_candidates = []
    for candidate in candidates:
        item = asdict(candidate)
        item.pop("content", None)
        item.pop("created_by_runner", None)
        public_candidates.append(item)
    manifest.write_text(json.dumps({"run_id": run_id, "candidates": public_candidates, "alerts": alerts}, indent=2) + "\n", encoding="utf-8")
    return manifest


def write_artifact(repo: Path, run_id: str, accepted: list[Candidate], manifest: Path, config: Config) -> Path:
    artifact = repo / ".changeguard" / "artifacts" / run_id
    artifact.mkdir(parents=True, exist_ok=True)
    shutil.copy2(manifest, artifact / "manifest.json")
    for candidate in accepted:
        source = safe_candidate_path(repo, candidate, config)
        destination = artifact / "corpus" / Path(*PurePosixPath(candidate.path).parts)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
    return artifact


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate and validate cumulative regression tests")
    parser.add_argument("--repo", default=".")
    parser.add_argument("--config")
    parser.add_argument("--base-ref")
    parser.add_argument("--api-url", default=os.getenv("CHANGEGUARD_API_URL"))
    parser.add_argument("--ingest-token", default=os.getenv("CHANGEGUARD_INGEST_TOKEN"))
    parser.add_argument("--run-id", default=os.getenv("CHANGEGUARD_RUN_ID") or str(uuid.uuid4()))
    parser.add_argument("--write-accepted", action="store_true", help="Leave accepted tests in the checkout for a test-only PR")
    parser.add_argument("--allow-dirty", action="store_true")
    args = parser.parse_args()

    repo = Path(args.repo).resolve()
    started = time.monotonic()
    if not (repo / ".git").exists():
        print(f"error: {repo} is not a git checkout", file=sys.stderr)
        return 2
    if not args.allow_dirty and git(repo, "status", "--porcelain"):
        print("error: working tree must be clean (or pass --allow-dirty in an ephemeral CI checkout)", file=sys.stderr)
        return 2

    try:
        config = load_config(repo, args.config)
        for command in config.setup_commands:
            result = shell(command, repo, config.command_timeout_seconds)
            if result.returncode:
                raise RuntimeError(f"Setup failed: {command}\n{result.output}")
        repository = os.getenv("GITHUB_REPOSITORY") or repo.name
        commit_sha = git(repo, "rev-parse", "HEAD")
        stack = detect_stack(repo)
        report_event(args.api_url, args.ingest_token, {"runId": args.run_id, "repository": repository, "stack": stack, "testCommand": " && ".join(config.test_commands), "trigger": "schedule", "commitSha": commit_sha, "status": "running"})

        baseline = run_suite(repo, config)
        if not suite_passed(baseline):
            alerts = [{"severity": "high", "title": "Existing regression suite is failing", "evidence": baseline[-1].output[-5000:]}]
            event = event_payload(args.run_id, repository, stack, config, commit_sha, "failed", False, [], alerts, started)
            report_event(args.api_url, args.ingest_token, event)
            print(json.dumps(event, indent=2))
            return 1

        files = changed_files(repo, config, args.base_ref)
        context = source_context(repo, files, config)
        if not context:
            event = event_payload(args.run_id, repository, stack, config, commit_sha, "passed", True, [], [], started)
            report_event(args.api_url, args.ingest_token, event)
            print("No eligible production changes; baseline suite passed.")
            return 0

        candidates = generate_candidates(context, config)
        accepted, alerts = validate_candidates(repo, candidates, config, set(files))
        manifest = write_manifest(repo, args.run_id, candidates, alerts)
        artifact = write_artifact(repo, args.run_id, accepted, manifest, config)
        accepted_file = repo / ".changeguard" / "accepted-paths.txt"
        accepted_file.write_text("".join(f"{candidate.path}\n" for candidate in accepted), encoding="utf-8")
        final_suite = run_suite(repo, config) if accepted else baseline
        status = "passed" if suite_passed(final_suite) and not alerts else "failed"
        event = event_payload(args.run_id, repository, stack, config, commit_sha, status, True, candidates, alerts, started)
        report_event(args.api_url, args.ingest_token, event)
        if not args.write_accepted:
            cleanup_candidates(repo, candidates)
        print(json.dumps({"summary": event, "manifest": str(manifest), "artifact": str(artifact), "accepted_paths": [candidate.path for candidate in accepted]}, indent=2))
        return 1 if alerts else 0
    except Exception as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


def detect_stack(repo: Path) -> str:
    parts: list[str] = []
    if (repo / "package.json").exists():
        package = json.loads((repo / "package.json").read_text(encoding="utf-8"))
        dependencies = {**package.get("dependencies", {}), **package.get("devDependencies", {})}
        if "react" in dependencies:
            parts.append("React")
        elif "vue" in dependencies:
            parts.append("Vue")
        else:
            parts.append("Node")
        for framework in ("playwright", "vitest", "jest"):
            if any(framework in name.lower() for name in dependencies):
                parts.append(framework.title())
                break
    if (repo / "pyproject.toml").exists() or (repo / "requirements.txt").exists():
        parts.extend(["Python", "Pytest"])
    if (repo / "go.mod").exists():
        parts.append("Go")
    return " · ".join(dict.fromkeys(parts)) or "Custom"


def event_payload(run_id: str, repository: str, stack: str, config: Config, commit_sha: str, status: str, existing_passed: bool, candidates: list[Candidate], alerts: list[dict[str, str]], started: float) -> dict[str, Any]:
    tests = [{"path": candidate.path, "targetFile": candidate.target_file, "framework": candidate.framework, "status": candidate.status, "mutationKills": candidate.mutation_kills, "confidence": candidate.confidence} for candidate in candidates]
    return {
        "runId": run_id, "repository": repository, "stack": stack, "testCommand": " && ".join(config.test_commands),
        "trigger": "schedule", "commitSha": commit_sha, "status": status, "existingPassed": existing_passed,
        "candidates": len(candidates), "accepted": sum(candidate.status == "accepted" for candidate in candidates),
        "rejected": sum(candidate.status == "rejected" for candidate in candidates), "durationMs": int((time.monotonic() - started) * 1000),
        "tests": tests, "alerts": alerts,
    }


if __name__ == "__main__":
    raise SystemExit(main())
