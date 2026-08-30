"""Encryption helpers for write-only provider credentials."""

import base64
import binascii
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

MASTER_KEY_ENV_VAR = "LLM_EVAL_MASTER_KEY"
ENVELOPE_VERSION = "v1"


class CredentialConfigurationError(RuntimeError):
    """Raised when the application cannot safely access stored credentials."""


def _master_key() -> bytes:
    value = os.getenv(MASTER_KEY_ENV_VAR)
    if not value:
        raise CredentialConfigurationError(
            f"{MASTER_KEY_ENV_VAR} must be configured before the application starts."
        )
    try:
        key = base64.urlsafe_b64decode(value.encode("ascii"))
    except (UnicodeEncodeError, binascii.Error) as exc:
        raise CredentialConfigurationError(
            f"{MASTER_KEY_ENV_VAR} must be URL-safe base64 encoded."
        ) from exc
    if len(key) != 32:
        raise CredentialConfigurationError(
            f"{MASTER_KEY_ENV_VAR} must decode to exactly 32 bytes."
        )
    return key


def validate_master_key() -> None:
    """Fail fast when the deployment key is absent or malformed."""
    _master_key()


def _aad(provider_id: int, provider_kind: str) -> bytes:
    return f"provider:{provider_id}:{provider_kind}".encode()


def encrypt_api_key(api_key: str, *, provider_id: int, provider_kind: str) -> str:
    """Encrypt a credential with authenticated provider metadata."""
    nonce = os.urandom(12)
    ciphertext = AESGCM(_master_key()).encrypt(
        nonce, api_key.encode("utf-8"), _aad(provider_id, provider_kind)
    )
    encoded = base64.urlsafe_b64encode(nonce + ciphertext).decode("ascii")
    return f"{ENVELOPE_VERSION}:{encoded}"


def decrypt_api_key(ciphertext: str, *, provider_id: int, provider_kind: str) -> str:
    """Decrypt a stored credential or fail without revealing secret details."""
    version, separator, encoded = ciphertext.partition(":")
    if version != ENVELOPE_VERSION or not separator:
        raise CredentialConfigurationError("Stored provider credential is invalid.")
    try:
        payload = base64.urlsafe_b64decode(encoded.encode("ascii"))
        if len(payload) <= 12:
            raise ValueError
        plaintext = AESGCM(_master_key()).decrypt(
            payload[:12], payload[12:], _aad(provider_id, provider_kind)
        )
        return plaintext.decode("utf-8")
    except (
        UnicodeEncodeError,
        UnicodeDecodeError,
        ValueError,
        binascii.Error,
        InvalidTag,
    ) as exc:
        raise CredentialConfigurationError(
            "Stored provider credential cannot be decrypted."
        ) from exc
