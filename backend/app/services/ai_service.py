"""Unified AI service for SchoolAI backend.

Strategy (in order):
1. **Groq** — if `GROQ_API_KEY` env var is set, call the Groq OpenAI-compatible
   chat-completions endpoint with `llama-3.3-70b-versatile` (falls back to
   `llama-3.1-8b-instant` if the model is unavailable).
2. **z-ai CLI** — invoke `/usr/local/bin/z-ai chat -p <prompt> -s <system>`
   via `asyncio.create_subprocess_exec`, parse the JSON it returns, and
   extract `choices[0].message.content`. This is the default in dev / when
   no Groq key is configured.
3. **Canned fallback** — build a minimal data-driven markdown response from
   `data_context` so the principal/chairperson still gets *something* useful.

Every call returns ``{"answer": str, "source": "groq"|"z-ai"|"fallback"}``.

The agentic entry point ``ask_ai_agentic`` adds a tool-calling loop on top:
the LLM can request data-fetching tools, which the loop executes and feeds
back into the conversation (up to ``MAX_TOOL_ITERATIONS`` rounds).
"""
from __future__ import annotations

import asyncio
import json
import os
import re
from typing import Any, Optional

import httpx
from sqlalchemy.orm import Session

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "").strip()
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_PRIMARY_MODEL = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
GROQ_FALLBACK_MODEL = "llama-3.1-8b-instant"
GROQ_TIMEOUT = 60.0  # seconds

Z_AI_BIN = os.environ.get("Z_AI_BIN", "/usr/local/bin/z-ai")
Z_AI_TIMEOUT = 60.0  # seconds


# ─────────────────────────────────────────────────────────────────────────────
# Public entry point
# ─────────────────────────────────────────────────────────────────────────────
async def ask_ai(
    question: str,
    system_prompt: str,
    data_context: str | dict | None = None,
) -> dict:
    """Ask the LLM a question, returning ``{"answer": str, "source": str}``.

    Tries Groq → z-ai CLI → canned fallback, in that order.
    """
    # Normalise data_context to a string
    if data_context is None:
        ctx_str = ""
    elif isinstance(data_context, (dict, list)):
        ctx_str = json.dumps(data_context, indent=2, default=str, ensure_ascii=False)
    else:
        ctx_str = str(data_context)

    user_content = question
    if ctx_str:
        user_content = f"{question}\n\n--- DATA CONTEXT ---\n{ctx_str}"

    # 1) Groq
    if GROQ_API_KEY:
        answer = await _call_groq(system_prompt, user_content)
        if answer:
            return {"answer": answer, "source": "groq"}

    # 2) z-ai CLI
    answer = await _call_z_ai(system_prompt, user_content)
    if answer:
        return {"answer": answer, "source": "z-ai"}

    # 3) Canned fallback — derived from the data context so it's still useful
    return {
        "answer": _canned_fallback(question, data_context),
        "source": "fallback",
    }


# ─────────────────────────────────────────────────────────────────────────────
# Backend: Groq
# ─────────────────────────────────────────────────────────────────────────────
async def _call_groq(system_prompt: str, user_content: str) -> Optional[str]:
    """Call Groq's OpenAI-compatible chat completions API.

    Tries the primary model first, then a cheaper fallback model on any error.
    Returns the assistant message content or ``None`` on failure.
    """
    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json",
    }
    body = {
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        "temperature": 0.7,
        "max_tokens": 1500,
    }
    async with httpx.AsyncClient(timeout=GROQ_TIMEOUT) as client:
        for model in (GROQ_PRIMARY_MODEL, GROQ_FALLBACK_MODEL):
            try:
                resp = await client.post(
                    GROQ_URL,
                    headers=headers,
                    json={**body, "model": model},
                )
                if resp.status_code != 200:
                    # Try the fallback model next
                    continue
                payload = resp.json()
                choices = payload.get("choices") or []
                if not choices:
                    continue
                content = choices[0].get("message", {}).get("content")
                if content and content.strip():
                    return content.strip()
            except Exception:
                continue
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Backend: z-ai CLI
# ─────────────────────────────────────────────────────────────────────────────
async def _call_z_ai(system_prompt: str, user_content: str) -> Optional[str]:
    """Invoke the z-ai CLI and return the assistant message content (or None)."""
    try:
        proc = await asyncio.create_subprocess_exec(
            Z_AI_BIN, "chat",
            "-p", user_content,
            "-s", system_prompt,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _stderr = await asyncio.wait_for(
            proc.communicate(), timeout=Z_AI_TIMEOUT
        )
        if proc.returncode != 0:
            return None
        text = stdout.decode("utf-8", errors="replace").strip()
        # The CLI prints a banner + the JSON. Find the first `{` and parse from there.
        idx = text.find("{")
        if idx < 0:
            return None
        payload = json.loads(text[idx:])
        choices = payload.get("choices") or []
        if not choices:
            return None
        content = choices[0].get("message", {}).get("content")
        if content and content.strip():
            return content.strip()
        return None
    except Exception:
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Canned fallback (last resort)
# ─────────────────────────────────────────────────────────────────────────────
def _canned_fallback(question: str, data_context) -> str:
    """Build a minimal markdown answer from the data_context dict (if any).

    The result is *not* pretty — it's the "AI is down" baseline so the user
    still walks away with real numbers.
    """
    lines = [
        "## ⚠️ AI service unavailable — showing data-driven snapshot",
        "",
        f"**Question:** {question}",
        "",
    ]
    if isinstance(data_context, dict):
        # School name?
        if "school_name" in data_context:
            lines.append(f"**School:** {data_context['school_name']}")
        if "totals" in data_context and isinstance(data_context["totals"], dict):
            t = data_context["totals"]
            lines.append(
                f"**Totals:** {t.get('students', '?')} students · "
                f"{t.get('classes', '?')} classes · {t.get('exams', '?')} exams"
            )
        if "school_average_pct" in data_context:
            lines.append(f"**School average:** {data_context['school_average_pct']}%")
        if "top_performer" in data_context and data_context["top_performer"]:
            tp = data_context["top_performer"]
            lines.append(
                f"**Top performer:** {tp.get('name', '?')} ({tp.get('average', '?')}%)"
            )
        # schools (chairperson case)
        if "schools" in data_context and isinstance(data_context["schools"], list):
            lines.append("")
            lines.append("### Schools")
            for s in data_context["schools"]:
                lines.append(
                    f"- **{s.get('name', '?')}** — avg {s.get('average_pct', '?')}%, "
                    f"{s.get('students', '?')} students"
                )
        if "grade_breakdown" in data_context and data_context["grade_breakdown"]:
            lines.append("")
            lines.append("### Grade breakdown")
            for g in data_context["grade_breakdown"]:
                lines.append(
                    f"- Grade {g.get('grade', '?')}: avg {g.get('average_pct', '?')}% "
                    f"· attendance {g.get('attendance_pct', '?')}%"
                )
        if "subject_breakdown" in data_context and data_context["subject_breakdown"]:
            lines.append("")
            lines.append("### Subject breakdown")
            for s in data_context["subject_breakdown"]:
                lines.append(
                    f"- {s.get('subject', '?')}: avg {s.get('average_pct', '?')}% "
                    f"· pass rate {s.get('pass_rate', '?')}%"
                )
    elif data_context:
        lines.append("")
        lines.append("```")
        lines.append(str(data_context)[:2000])
        lines.append("```")
    lines.append("")
    lines.append("_This answer was generated from real school data because the AI service is currently unavailable._")
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# AGENTIC LOOP — tool-calling wrapper
# ─────────────────────────────────────────────────────────────────────────────
MAX_TOOL_ITERATIONS = 5
GROQ_TOOL_CALL_TIMEOUT = 60.0

# Regex that picks a JSON tool-call out of the LLM's text response. The model
# is instructed to print ONLY the JSON on its own line, but we are lenient:
# we accept the first `{"tool":"<name>","args":{...}}` we find anywhere in
# the text. (Non-greedy arg matching so we stop at the first `}` that closes
# the args object — handled by the JSON decoder, not the regex.)
_TOOL_CALL_RE = re.compile(
    r'\{\s*"tool"\s*:\s*"([^"]+)"\s*,\s*"args"\s*:\s*(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})\s*\}',
    re.DOTALL,
)


def _build_tool_list_section(tools: dict[str, dict]) -> str:
    """Markdown-formatted list of available tools for the system prompt."""
    lines = ["Available tools (call them by replying with ONLY the JSON "
             "`{\"tool\":\"<name>\",\"args\":{...}}` on its own line):"]
    for name, spec in tools.items():
        params = spec.get("params", {}) or {}
        param_str = ""
        if params:
            param_str = "; args: " + ", ".join(
                f"{k} ({v})" for k, v in params.items()
            )
        lines.append(f"- `{name}` — {spec['description']}{param_str}")
    return "\n".join(lines)


def _parse_tool_call_from_text(text: str) -> Optional[tuple[str, dict]]:
    """Parse the first ``{"tool":"<name>","args":{...}}`` block out of a
    free-text LLM response. Returns ``(tool_name, args_dict)`` or ``None``.
    """
    if not text:
        return None
    m = _TOOL_CALL_RE.search(text)
    if not m:
        # Try a simpler "tool"+"args" search using json parsing on any {...}
        for candidate in re.findall(r'\{[^{}]*\}', text):
            try:
                obj = json.loads(candidate)
            except Exception:
                continue
            if isinstance(obj, dict) and "tool" in obj and isinstance(obj.get("args"), dict):
                return obj["tool"], obj["args"]
        return None
    name = m.group(1)
    try:
        args = json.loads(m.group(2))
        if not isinstance(args, dict):
            args = {}
    except Exception:
        args = {}
    return name, args


def _execute_tool(tool_name: str, args: dict, tools: dict,
                  db: Session, ctx: dict) -> str:
    """Run a tool by name, injecting db + ctx + args. Returns the tool's
    string output (or an error message)."""
    spec = tools.get(tool_name)
    if not spec:
        avail = ", ".join(tools.keys())
        return f"Error: unknown tool '{tool_name}'. Available: {avail}."
    fn = spec["function"]
    # Clean args: only pass keys the function actually accepts (best-effort).
    cleaned = {k: v for k, v in (args or {}).items() if k != "_data"}
    try:
        return str(fn(db=db, **ctx, **cleaned))
    except TypeError as e:
        # Missing required arg — surface a helpful message back to the LLM.
        return (f"Error calling tool '{tool_name}': {e}. "
                f"Expected params: {spec.get('params', {})}.")
    except Exception as e:
        return f"Error executing tool '{tool_name}': {e}"


def _groq_tool_specs(tools: dict[str, dict]) -> list[dict]:
    """Convert our internal TOOLS dict into OpenAI-compatible tool specs
    (so Groq's API can do native tool calling)."""
    out = []
    for name, spec in tools.items():
        params = spec.get("params", {}) or {}
        properties = {}
        required = []
        for pname, pdesc in params.items():
            # Heuristic: integer-valued params (limit, n, grade) → integer;
            # everything else → string.
            ptype = "integer" if any(
                kw in pdesc.lower() for kw in ("integer", "number")
            ) or pname in ("limit", "n", "grade") else "string"
            properties[pname] = {"type": ptype, "description": pdesc}
            required.append(pname)
        out.append({
            "type": "function",
            "function": {
                "name": name,
                "description": spec["description"],
                "parameters": {
                    "type": "object",
                    "properties": properties,
                    "required": required,
                },
            },
        })
    return out


async def _call_groq_with_tools(
    messages: list[dict],
    tools: list[dict] | None,
) -> Optional[dict]:
    """Call Groq with messages + optional tools. Returns the raw assistant
    message dict (with `content` and/or `tool_calls`)."""
    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json",
    }
    body: dict[str, Any] = {
        "messages": messages,
        "temperature": 0.4,
        "max_tokens": 2000,
    }
    if tools:
        body["tools"] = tools
        body["tool_choice"] = "auto"
    async with httpx.AsyncClient(timeout=GROQ_TOOL_CALL_TIMEOUT) as client:
        for model in (GROQ_PRIMARY_MODEL, GROQ_FALLBACK_MODEL):
            try:
                resp = await client.post(
                    GROQ_URL,
                    headers=headers,
                    json={**body, "model": model},
                )
                if resp.status_code != 200:
                    continue
                payload = resp.json()
                choices = payload.get("choices") or []
                if not choices:
                    continue
                msg = choices[0].get("message") or {}
                return msg
            except Exception:
                continue
    return None


async def _call_z_ai_with_messages(messages: list[dict]) -> Optional[str]:
    """Call the z-ai CLI with a flattened message history (system + user turns
    only — z-ai doesn't accept arbitrary assistant messages). Returns the
    assistant content string."""
    sys_parts: list[str] = []
    prompt_parts: list[str] = []
    for m in messages:
        role = m.get("role")
        content = m.get("content") or ""
        if role == "system":
            sys_parts.append(content)
        elif role == "user":
            prompt_parts.append(content)
        elif role == "assistant":
            # Re-inject prior assistant turns as quoted context so the model
            # has continuity (z-ai CLI only takes a single -p / -s pair).
            prompt_parts.append(f"[Previous assistant response]\n{content}")
    system_prompt = "\n\n".join(sys_parts) or "You are a helpful assistant."
    user_content = "\n\n---\n\n".join(prompt_parts)
    return await _call_z_ai(system_prompt, user_content)


async def ask_ai_agentic(
    question: str,
    system_prompt: str,
    db: Session,
    tools: dict[str, dict],
    context_summary: str = "",
    ctx: Optional[dict] = None,
) -> dict:
    """Agentic LLM call with tool-calling.

    Parameters
    ----------
    question : str
        The user's natural-language question.
    system_prompt : str
        Base system prompt — describes the assistant's role and tone.
    db : Session
        SQLAlchemy session passed to each tool call.
    tools : dict[str, dict]
        ``TOOLS`` or ``CHAIRPERSON_TOOLS`` from ``ai_tools``.
    context_summary : str
        Compact text snapshot of the data the LLM needs as background.
    ctx : dict, optional
        Extra kwargs to inject into every tool call (e.g. ``{"school": school}``
        for the principal or ``{"schools": [school_objs]}`` for the chairperson).

    Returns
    -------
    dict  ``{"answer": str, "source": str, "tools_used": list[str]}``
    """
    ctx = ctx or {}
    tools_used: list[str] = []

    # Build the agentic system prompt: base role + tool list + context.
    full_system = system_prompt.strip() + "\n\n" + _build_tool_list_section(tools)
    if context_summary:
        full_system += "\n\n--- LIVE DATA SNAPSHOT ---\n" + context_summary
    full_system += (
        "\n\nIMPORTANT: To answer the question, decide whether you need more "
        "specific data. If you do, respond with ONLY a JSON tool call on its "
        "own line in the form {\"tool\":\"<name>\",\"args\":{...}}. After the "
        "tool returns data, either call another tool or give the final "
        "markdown answer. Do not include any other text when calling a tool."
    )

    # Track the full conversation so the model has continuity.
    messages: list[dict] = [
        {"role": "system", "content": full_system},
        {"role": "user", "content": question},
    ]

    use_groq = bool(GROQ_API_KEY)
    source = "fallback"

    for iteration in range(MAX_TOOL_ITERATIONS):
        if use_groq:
            msg = await _call_groq_with_tools(
                messages, _groq_tool_specs(tools) if tools else None
            )
            if msg is None:
                # Fall back to z-ai for this iteration
                use_groq = False
                continue
            source = "groq"
            # Check for native tool calls
            tool_calls = msg.get("tool_calls") or []
            content = msg.get("content") or ""
            if not tool_calls:
                # No native call — but the model may have emitted a JSON tool
                # call in its text content (rare with `tools=` set, but
                # possible). Parse defensively.
                parsed = _parse_tool_call_from_text(content)
                if parsed is None:
                    return {
                        "answer": content.strip() or
                                  "I couldn't find the information needed to answer.",
                        "source": source,
                        "tools_used": tools_used,
                    }
                tool_name, args = parsed
                result = _execute_tool(tool_name, args, tools, db, ctx)
                tools_used.append(tool_name)
                messages.append({"role": "assistant", "content": content})
                messages.append({"role": "user", "content": f"Tool {tool_name} result:\n{result}"})
                continue
            # Execute ALL native tool calls in order (Groq usually emits one,
            # but the spec allows parallel — we run them sequentially).
            messages.append(msg)
            for tc in tool_calls:
                fn_obj = tc.get("function") or {}
                tool_name = fn_obj.get("name", "")
                raw_args = fn_obj.get("arguments", "{}")
                try:
                    args = json.loads(raw_args) if isinstance(raw_args, str) else (raw_args or {})
                    if not isinstance(args, dict):
                        args = {}
                except Exception:
                    args = {}
                result = _execute_tool(tool_name, args, tools, db, ctx)
                tools_used.append(tool_name)
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.get("id", ""),
                    "name": tool_name,
                    "content": result,
                })
            # Loop back to let Groq synthesize the final answer or call again.
            continue

        # z-ai CLI path
        text = await _call_z_ai_with_messages(messages)
        if text is None:
            # Truly nothing we can do — return what we have.
            return {
                "answer": _canned_fallback(question, None) +
                          ("\n\n(Tool calls made: " + ", ".join(tools_used) + ".)"
                           if tools_used else ""),
                "source": "fallback",
                "tools_used": tools_used,
            }
        source = "z-ai"
        parsed = _parse_tool_call_from_text(text)
        if parsed is None:
            return {
                "answer": text.strip(),
                "source": source,
                "tools_used": tools_used,
            }
        tool_name, args = parsed
        result = _execute_tool(tool_name, args, tools, db, ctx)
        tools_used.append(tool_name)
        # Append the assistant's tool call (so the model sees what it asked)
        # and the tool result (so it can answer).
        messages.append({"role": "assistant", "content": text})
        messages.append({
            "role": "user",
            "content": f"Tool {tool_name} returned:\n{result}\n\n"
                       "Now either call another tool, or give the final answer "
                       "in detailed markdown with specific names and numbers.",
        })

    # Exhausted iterations — ask for the final synthesis.
    messages.append({
        "role": "user",
        "content": (
            "You've used your tool-call budget. Synthesize a final, "
            "detailed markdown answer now using everything you have. "
            "Be specific: cite real names, numbers, and percentages."
        ),
    })
    if use_groq:
        msg = await _call_groq_with_tools(messages, None)
        if msg:
            return {
                "answer": (msg.get("content") or "").strip() or
                          "I gathered the data but couldn't synthesize an answer.",
                "source": "groq",
                "tools_used": tools_used,
            }
    text = await _call_z_ai_with_messages(messages)
    if text:
        return {
            "answer": text.strip(),
            "source": "z-ai" if not use_groq else "groq",
            "tools_used": tools_used,
        }
    return {
        "answer": _canned_fallback(question, None),
        "source": "fallback",
        "tools_used": tools_used,
    }
