from dataclasses import dataclass


@dataclass
class TokenHubServiceError(Exception):
    status_code: int
    code: str
    detail: str

    def __str__(self) -> str:
        return self.detail
