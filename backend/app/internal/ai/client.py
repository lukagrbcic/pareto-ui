"""
openai_client_wrapper.py

A small wrapper around the OpenAI Python client that:
- encapsulates client creation
- provides methods to prompt the model
- stores chat history
- offers retry/backoff and basic streaming callback support
- allows model / api key swapping and saving/loading history

"""

import os
import time
import json
from typing import List, Optional, Dict, Callable, Any
from dotenv import load_dotenv
import openai

load_dotenv()


# Domain persona prepended to every AI request (see OpenAIClientWrapper.chat).
# It tells the model what PARETO is, which input tables and flow decisions exist,
# what the user can and cannot do in the app (no unit or source edits), and how
# to behave: cite real node/table/period names, never invent absent values,
# mark hypotheses as hypotheses, and answer in the pure-JSON contract the
# callers parse.
PARETO_SYSTEM_PROMPT = """You are a senior optimization engineer and subject-matter expert in strategic \
produced-water management with the PARETO framework, an open-source strategic planning tool for water \
management in shale oil and gas operations. You assist users of the PARETO UI desktop application with \
filling, reviewing, and diagnosing PARETO strategic optimization models.

Domain expertise:
- PARETO input data model: sets and tables such as ProductionPads, CompletionsPads, SWDSites, \
ExternalWaterSources, StorageSites, PadStorageSites, TreatmentSites, TreatmentTechnologies, ReuseOptions, \
NetworkNodes, and their flow decisions (piped and trucked sourcing, disposal, storage, treatment, reuse), \
pipeline capacities, hydraulics, water quality components, and air emissions.
- The optimization layer: the project-pareto Python package building a Pyomo model, objectives such as \
Minimize Cost and Maximize Reuse, solver choices (CBC, Gurobi), runtime and optimality-gap settings, \
scaled vs original units, and manual override values.
- The application: users edit scenario input tables, the network map, and optimization settings in the UI. \
They cannot edit units or source code, so only suggest changes achievable in the app.

Rules of engagement:
- Be precise and quantitative; reference the actual node names, table names, and periods from the \
provided scenario JSON.
- Never invent values that are absent from the provided data; clearly distinguish observations from \
hypotheses and acknowledge missing evidence.
- When modifying or generating input data, preserve referential integrity: use only node names, periods, \
and options that exist in the scenario, keep units consistent with the scenario, and change only what the \
user asked for.
- Respond exactly in the format the user message requests (typically pure JSON without markdown fences or \
commentary) so the application can parse the output.
- For failure diagnosis, be concise and practical: state the likely issue, propose realistic next steps \
ordered from most to least practical, and say clearly what remains uncertain."""


class OpenAIClientWrapper:
    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        model: str = "cborg-coder-max",
        default_temperature: float = 0.0,
        max_retries: int = 3,
        backoff_factor: float = 1.0,
        system_prompt: Optional[str] = PARETO_SYSTEM_PROMPT,
    ):
        """
        Create the wrapper.

        Args:
            api_key: API key string. If None, will use environment variable 'CBORG_API_KEY'.
            base_url: custom base_url for the OpenAI-compatible API (e.g., 'https://api.cborg.lbl.gov').
            model: default model to use for completions.
            default_temperature: default temperature for calls.
            max_retries: number of retries for transient errors.
            backoff_factor: multiplier for exponential backoff (seconds).
            system_prompt: system message prepended to every request; None disables it.
        """
        if api_key is None:
            api_key = os.environ.get("CBORG_API_KEY") or os.environ.get("OPENAI_API_KEY")

        self.api_key = api_key.strip() if api_key else None
        self.base_url = base_url
        self.client = None
        if self.api_key:
            client_kwargs = {"api_key": self.api_key}
            if base_url:
                client_kwargs["base_url"] = base_url
            self.client = openai.OpenAI(**client_kwargs)
        self.model = model
        self.default_temperature = default_temperature
        self.max_retries = max_retries
        self.backoff_factor = backoff_factor
        self.system_prompt = system_prompt

        # chat history (list of message dicts as expected by OpenAI chat API)
        # Example: {"role": "system", "content": "..."}
        self.history: List[Dict[str, str]] = []

    # -------------------------
    # History management
    # -------------------------
    def add_message_to_history(self, role: str, content: str) -> None:
        """Append a message to the conversation history."""
        self.history.append({"role": role, "content": content})

    def clear_history(self) -> None:
        """Clear conversation history."""
        self.history = []

    def save_history(self, path: str) -> None:
        """Save history to a JSON file."""
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(self.history, fh, ensure_ascii=False, indent=2)

    def load_history(self, path: str) -> None:
        """Load history from a JSON file (overwrites current history)."""
        with open(path, "r", encoding="utf-8") as fh:
            self.history = json.load(fh)

    # -------------------------
    # Model / Key helpers
    # -------------------------
    def set_model(self, model_name: str) -> None:
        """Change the model to use for subsequent calls."""
        self.model = model_name

    def set_system_prompt(self, system_prompt: Optional[str]) -> None:
        """Change the system prompt prepended to every request; None disables it."""
        self.system_prompt = system_prompt

    def set_api_key(self, api_key: Optional[str], base_url: Optional[str] = None) -> None:
        """Change API key (reinitializes underlying client)."""
        self.api_key = api_key.strip() if api_key else None
        if base_url is not None:
            self.base_url = base_url
        if not self.api_key:
            self.client = None
            return
        kwargs = {"api_key": self.api_key}
        if self.base_url:
            kwargs["base_url"] = self.base_url
        self.client = openai.OpenAI(**kwargs)

    def is_available(self) -> bool:
        """Return True if the client is configured with an API key."""
        return self.client is not None

    # -------------------------
    # Core call logic
    # -------------------------
    def _call_with_retries(self, payload_fn: Callable[[], Any]) -> Any:
        """Helper that runs payload_fn with simple retry/backoff on exceptions."""
        attempt = 0
        while True:
            try:
                return payload_fn()
            except Exception as e:
                attempt += 1
                if attempt > self.max_retries:
                    raise
                sleep_for = self.backoff_factor * (2 ** (attempt - 1))
                # small jitter
                jitter = min(1.0, sleep_for * 0.1)
                time.sleep(sleep_for + jitter)

    def chat(
        self,
        prompt: Optional[str] = None,
        messages: Optional[List[Dict[str, str]]] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        add_to_history: bool = True,
        stream: bool = False,
        stream_callback: Optional[Callable[[str], None]] = None,
    ) -> str:
        """
        Send a prompt (or messages) to the model and return the assistant's text content.

        Args:
            prompt: a single-user prompt string. If provided, it will be appended to messages.
            messages: fully-formed list of message dicts (role/content). If not provided, uses history.
            temperature: override default temperature for this call.
            max_tokens: optional max_tokens to pass.
            add_to_history: whether to append the user prompt and assistant response to history.
            stream: if True, try to stream results and call stream_callback for each chunk.
            stream_callback: function called with each text chunk when stream=True.

        Returns:
            assistant response string (concatenated if streaming).
        """
        if not self.is_available():
            raise RuntimeError("AI client is not configured; set an API key first.")

        if temperature is None:
            temperature = self.default_temperature

        # Build messages list: priority order -- explicit messages param, else history + prompt
        if messages is not None:
            request_messages = [m.copy() for m in messages]
        else:
            request_messages = [m.copy() for m in self.history]

        if prompt is not None:
            request_messages.append({"role": "user", "content": prompt})

        # Prepend the configured system prompt unless one is already present
        if self.system_prompt and (not request_messages or request_messages[0].get("role") != "system"):
            request_messages = [{"role": "system", "content": self.system_prompt}] + request_messages

        # use the client to call the chat completions endpoint
        def payload():
            create_kwargs = {
                "model": self.model,
                "messages": request_messages,
                "temperature": temperature,
            }
            if max_tokens is not None:
                create_kwargs["max_tokens"] = max_tokens

            # If streaming is requested, rely on the SDK's stream behavior (if supported)
            # Note, this is untested
            if stream:
                # SDK usually returns an iterator when stream=True; iterate and collect text
                create_kwargs["stream"] = True
                iterator = self.client.chat.completions.create(**create_kwargs)
                # Some SDKs yield events with 'choices' containing 'delta' or 'message' pieces.
                # We'll attempt to handle a few common patterns robustly.
                full_text = ""
                for event in iterator:
                    # event may be dict-like; try to extract incremental content
                    try:
                        # Newer SDK: event.choices[0].delta.content or event.choices[0].message.content
                        choices = getattr(event, "choices", None) or event.get("choices", None)
                        if choices:
                            # get the most recent choice piece
                            piece = choices[0]
                            # delta form
                            if isinstance(piece, dict):
                                delta = piece.get("delta", {})
                                chunk = delta.get("content")
                                if not chunk:
                                    # older variant
                                    message = piece.get("message", {})
                                    chunk = message.get("content")
                            else:
                                # try attribute access
                                delta = getattr(piece, "delta", None)
                                if delta:
                                    chunk = getattr(delta, "content", None)
                                else:
                                    message = getattr(piece, "message", None)
                                    chunk = getattr(message, "content", None) if message else None
                            if chunk:
                                full_text += chunk
                                if stream_callback:
                                    stream_callback(chunk)
                    except Exception:
                        # best-effort: if event itself is a str, append
                        try:
                            if isinstance(event, str):
                                full_text += event
                                if stream_callback:
                                    stream_callback(event)
                        except Exception:
                            pass
                return full_text
            else:
                # Non-streaming
                resp = self.client.chat.completions.create(**create_kwargs)
                # Accessing last choice
                # Support both dict-like and attribute-like responses
                try:
                    # prefer attribute access if available
                    content = resp.choices[-1].message.content
                except Exception:
                    # fallback for dict-like responses
                    content = resp.get("choices", [{}])[-1].get("message", {}).get("content", "")
                return content

        assistant_text = self._call_with_retries(payload)

        # Optionally update history
        if add_to_history:
            if prompt is not None:
                # append the user message we sent
                self.add_message_to_history("user", prompt)
            # append assistant response
            self.add_message_to_history("assistant", assistant_text)

        return assistant_text

    # A function for one-off prompts
    def prompt(
        self,
        text: str,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        **kwargs,
    ) -> str:
        """
        Convenience method to send a simple user prompt and get the response.
        Same args as `chat` but takes a single text string.
        """
        return self.chat(prompt=text, temperature=temperature, max_tokens=max_tokens, **kwargs)
        

# ---------------------------------------------------------------------------
# Environment-based provider selection
# ---------------------------------------------------------------------------
# Each supported provider keeps its API-key variable ALIGNED with that
# provider's OpenAI-compatible chat-completions endpoint, so a key is never
# sent to a different provider's URL. CBORG stays the historical default; the
# first provider (in order) whose key variable is set wins. All entries speak
# the OpenAI wire format: OpenAI and OpenRouter natively; Anthropic and Google
# Gemini through their official OpenAI-compatibility layers. Default models
# can be overridden with PARETO_AI_MODEL, and per-user connections configured
# in the app's AI Settings always take precedence over this environment client.
AI_PROVIDERS = [
    # (provider, API-key environment variable, OpenAI-compatible base URL, default model)
    ("cborg", "CBORG_API_KEY", "https://api.cborg.lbl.gov", "cborg-coder-max"),
    ("openai", "OPENAI_API_KEY", "https://api.openai.com/v1", "gpt-4.1"),
    ("anthropic", "ANTHROPIC_API_KEY", "https://api.anthropic.com/v1", "claude-sonnet-4-5"),
    ("google", "GOOGLE_API_KEY", "https://generativelanguage.googleapis.com/v1beta/openai", "gemini-2.5-pro"),
    ("google", "GEMINI_API_KEY", "https://generativelanguage.googleapis.com/v1beta/openai", "gemini-2.5-pro"),
    ("openrouter", "OPENROUTER_API_KEY", "https://openrouter.ai/api/v1", "openrouter/auto"),
]


def select_environment_client():
    """Build the environment AI client from the first provider whose API-key
    environment variable is set, pairing that key with the provider's matching
    base URL (never a mix). Without any recognized key, return the historical
    CBORG-shaped client in the unavailable state; user settings in the app can
    still configure any OpenAI-compatible endpoint.
    """
    for _name, key_var, base_url, model in AI_PROVIDERS:
        api_key = os.environ.get(key_var)
        if not api_key:
            continue
        if key_var == "CBORG_API_KEY":
            # Historical override for the CBORG endpoint only.
            base_url = os.environ.get("CBORG_BASE_URL", base_url)
        return OpenAIClientWrapper(
            api_key=api_key.strip(),
            base_url=base_url,
            model=os.environ.get("PARETO_AI_MODEL") or model,
            default_temperature=0.0,
            max_retries=2,
            backoff_factor=1.0,
        )
    # No recognized provider key: keep the CBORG shape (AI unavailable) so
    # describe()/settings behave exactly as before.
    return OpenAIClientWrapper(
        api_key=None,
        base_url=os.environ.get("CBORG_BASE_URL", "https://api.cborg.lbl.gov"),
        model=os.environ.get("PARETO_AI_MODEL") or "cborg-coder-max",
        default_temperature=0.0,
        max_retries=2,
        backoff_factor=1.0,
    )


# The app-wide environment client (see ai/configuration.py, which imports this
# as `environment_client`). The variable keeps the historical name `cborg` for
# import compatibility; it now resolves to whichever provider's key is present,
# with the aligned endpoint and default model.
cborg = select_environment_client()
