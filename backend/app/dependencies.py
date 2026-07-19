from collections.abc import Generator

from fastapi import Depends, Header, HTTPException, status
from google import genai
from typing_extensions import Annotated

from .config import Settings, get_settings


def resolve_gemini_api_key(
    authorization: Annotated[str | None, Header()] = None,
    settings: Settings = Depends(get_settings),
) -> str:
    """Resolve a Gemini key, preferring ``Authorization: Bearer <key>``.

    An explicitly supplied but malformed Authorization header is rejected
    instead of silently falling back to the server key.
    """

    if authorization is not None:
        scheme, separator, token = authorization.partition(" ")
        if (
            not separator
            or scheme.lower() != "bearer"
            or not token.strip()
        ):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authorization must use the format: Bearer <Gemini API key>",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return token.strip()

    if settings.gemini_api_key is not None:
        server_key = settings.gemini_api_key.get_secret_value().strip()
        if server_key:
            return server_key

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=(
            "Gemini API key is required. Send Authorization: Bearer <key> "
            "or configure GEMINI_API_KEY on the server."
        ),
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_gemini_client(
    api_key: Annotated[str, Depends(resolve_gemini_api_key)],
) -> Generator[genai.Client, None, None]:
    """Create and close a request-scoped Gemini client for BYOK isolation."""

    client = genai.Client(api_key=api_key)
    try:
        yield client
    finally:
        client.close()


GeminiClient = Annotated[genai.Client, Depends(get_gemini_client)]
