import logging
import logging.config
import os


def setup_logging(level: str = "INFO") -> None:
    """Configure root logger with rotating file + console handlers.

    Must be called once, early in main.py, before any service modules
    create child loggers. Uvicorn's own loggers are intentionally left
    out of this config so uvicorn can manage them after startup.
    """
    os.makedirs("logs", exist_ok=True)

    config = {
        "version": 1,
        "disable_existing_loggers": False,  # critical: don't silence uvicorn/library loggers
        "formatters": {
            "standard": {
                "format": "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
                "datefmt": "%Y-%m-%d %H:%M:%S",
            },
        },
        "handlers": {
            "console": {
                "class": "logging.StreamHandler",
                "formatter": "standard",
                "stream": "ext://sys.stderr",
            },
            "file": {
                "class": "logging.handlers.RotatingFileHandler",
                "formatter": "standard",
                "filename": "logs/app.log",
                "maxBytes": 10485760,  # 10 MB
                "backupCount": 5,
                "encoding": "utf-8",
            },
        },
        "root": {
            "level": level,
            "handlers": ["console", "file"],
        },
    }
    logging.config.dictConfig(config)
