import os
import logging

logger = logging.getLogger(__name__)

_anon_client = None
_service_client = None


def get_supabase():
    """Singleton Supabase client using the anon key — for web server reads."""
    global _anon_client
    if _anon_client is not None:
        return _anon_client
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_ANON_KEY")
    if not url or not key:
        logger.debug("SUPABASE_URL / SUPABASE_ANON_KEY not set — screener unavailable")
        return None
    try:
        from supabase import create_client
        _anon_client = create_client(url, key)
        return _anon_client
    except Exception as e:
        logger.warning("Failed to create Supabase client: %s", e)
        return None


def get_supabase_service():
    """Singleton Supabase client using the service role key — for the refresh script."""
    global _service_client
    if _service_client is not None:
        return _service_client
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    from supabase import create_client
    _service_client = create_client(url, key)
    return _service_client
