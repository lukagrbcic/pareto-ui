"""App-wide AI configuration; credentials never belong to a scenario."""
from urllib.parse import urlsplit
import openai

from app.internal.ai.client import OpenAIClientWrapper, cborg as environment_client


class AISettingsError(ValueError):
    pass


class AIConfiguration:
    def __init__(self, environment):
        self.environment = environment
        self._user_client = None

    @property
    def active_client(self):
        return self._user_client or self.environment

    def is_available(self):
        return self.active_client.is_available()

    def clear_history(self):
        """Reset the active client's conversation history."""
        self.active_client.clear_history()

    def describe(self):
        client = self.active_client
        return {
            "available": client.is_available(),
            "source": "user" if self._user_client else "environment" if client.is_available() else "none",
            "base_url": client.base_url or "",
            "model": client.model,
            "environment_available": self.environment.is_available(),
        }

    def configure(self, api_key, base_url, model):
        if not isinstance(base_url, str) or not isinstance(model, str):
            raise AISettingsError("Enter an API base URL and model.")
        base_url, model = base_url.strip().rstrip('/'), model.strip()
        try:
            url = urlsplit(base_url)
            valid = (url.hostname and not url.username and not url.password and not url.query and not url.fragment
                     and (url.scheme == 'https' or (url.scheme == 'http' and url.hostname in ('localhost', '127.0.0.1', '::1'))))
        except ValueError:
            valid = False
        if not valid:
            raise AISettingsError("Use an HTTPS API base URL, or HTTP for a local server, without credentials or query parameters.")
        if not model or len(model) > 200:
            raise AISettingsError("Enter a model identifier of at most 200 characters.")
        if api_key is not None and not isinstance(api_key, str):
            raise AISettingsError("Enter a valid API key.")
        key = (api_key or '').strip()
        if not key:
            # Never forward an existing key to a different endpoint or copy an
            # environment key into user settings without explicit key entry.
            if not self._user_client or base_url != self._user_client.base_url:
                raise AISettingsError("Enter an API key when configuring AI or changing the API endpoint.")
            key = self._user_client.api_key
        client = OpenAIClientWrapper(api_key=key, base_url=base_url, model=model, max_retries=2)
        self._user_client = client
        return self.describe()

    def reset(self):
        self._user_client = None
        return self.describe()

    def prompt(self, *args, **kwargs):
        # Keep one configuration throughout an in-flight request, even if the
        # user changes settings while the provider is responding.
        client = self.active_client
        try:
            return client.prompt(*args, **kwargs)
        except openai.AuthenticationError:
            raise RuntimeError("The AI service rejected the API key. Check AI connection settings.") from None
        except openai.RateLimitError:
            raise RuntimeError("The AI service's rate or usage limit was reached. Check your provider account or try again later.") from None
        except openai.APIConnectionError:
            raise RuntimeError("Unable to reach the AI service. Check the API endpoint and your connection.") from None
        except Exception:
            # Provider errors can echo credentials. Return actionable guidance
            # without passing raw SDK exceptions into logs or scenario data.
            raise RuntimeError("AI request failed. Check the API endpoint, model, and provider availability in Settings.") from None


ai_configuration = AIConfiguration(environment_client)
