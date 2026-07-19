from collections.abc import Generator

from fastapi import Depends, Header, HTTPException, status
import httpx
from typing_extensions import Annotated

from .config import Settings, get_settings


def resolve_tokenhub_api_key(
    authorization: Annotated[str | None, Header()] = None,
    settings: Settings = Depends(get_settings),
) -> str:
    """Resolve a TokenHub key, preferring ``Authorization: Bearer <key>``.

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
                detail="Authorization must use the format: Bearer <TokenHub API key>",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return token.strip()

    if settings.tokenhub_api_key is not None:
        server_key = settings.tokenhub_api_key.get_secret_value().strip()
        if server_key:
            return server_key

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=(
            "Tencent TokenHub API key is required. Send Authorization: Bearer <key> "
            "or configure TOKENHUB_API_KEY on the server."
        ),
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_tokenhub_client(
    api_key: Annotated[str, Depends(resolve_tokenhub_api_key)],
    settings: Settings = Depends(get_settings),
) -> Generator[httpx.Client, None, None]:
    """Create and close a request-scoped TokenHub client for BYOK isolation."""

    with httpx.Client(
        base_url=settings.tokenhub_base_url.rstrip("/"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        timeout=httpx.Timeout(settings.tokenhub_timeout_seconds),
    ) as client:
        yield client


TokenHubClient = Annotated[httpx.Client, Depends(get_tokenhub_client)]
