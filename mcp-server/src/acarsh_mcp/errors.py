from __future__ import annotations


class MCPDomainError(Exception):
    code = "domain_error"

    def __init__(self, message: str, *, details: dict | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}

    def as_result(self) -> dict:
        return {
            "status": "error",
            "error": {
                "code": self.code,
                "message": self.message,
                "details": self.details,
            },
        }


class ValidationError(MCPDomainError):
    code = "validation_error"


class NotFoundError(MCPDomainError):
    code = "not_found"


class ConflictError(MCPDomainError):
    code = "conflict"


class ConfigurationError(MCPDomainError):
    code = "configuration_error"


class AccessDeniedError(MCPDomainError):
    code = "access_denied"
