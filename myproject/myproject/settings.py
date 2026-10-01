"""
Django settings for the SkySnap project.

Secrets and per-machine configuration are read from a .env file that is never
committed. See .env.example for the list of supported variables.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

# BASE_DIR is the folder that holds manage.py.
BASE_DIR = Path(__file__).resolve().parent.parent

# Load .env from beside manage.py, or from the repository root, whichever exists.
for _env_file in (BASE_DIR / ".env", BASE_DIR.parent / ".env"):
    if _env_file.is_file():
        load_dotenv(_env_file)
        break


def env_flag(name, default=False):
    """Read a boolean from the environment, accepting 1/true/yes/on."""
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


# ── Core ──────────────────────────────────────────────────────────────────────

# Override SECRET_KEY in .env before deploying anywhere public.
SECRET_KEY = os.environ.get(
    "SECRET_KEY",
    "django-insecure-lx#%-yezvwyv-9w7vyh@ah2zz*@q*+5x1felz@to3g#a)ufj_!",
)

DEBUG = env_flag("DEBUG", default=True)

ALLOWED_HOSTS = [
    host.strip()
    for host in os.environ.get("ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
    if host.strip()
]

# The OpenWeather key used by base.views. Empty until you fill in .env.
OPENWEATHER_API_KEY = os.environ.get("API_KEY", "").strip()

# Keys and chat models for the AI weather notes (base.insights). Optional:
# with neither key the page leaves the notes out. Groq is used when both are
# set, because its free plan has a daily limit instead of a monthly credit.
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "").strip()
GROQ_MODEL = os.environ.get("GROQ_MODEL", "").strip() or "openai/gpt-oss-20b"

# The ":novita" suffix pins Hugging Face's provider: it answered in under 2s,
# where automatic routing took 4-10s.
HF_TOKEN = os.environ.get("HF_TOKEN", "").strip()
HF_MODEL = os.environ.get("HF_MODEL", "").strip() or "meta-llama/Llama-3.1-8B-Instruct:novita"


# ── Applications ──────────────────────────────────────────────────────────────

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'base',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'myproject.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'myproject.wsgi.application'
ASGI_APPLICATION = 'myproject.asgi.application'


# ── Database ──────────────────────────────────────────────────────────────────

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
    }
}


# ── Authentication ────────────────────────────────────────────────────────────

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]


# ── Internationalisation ──────────────────────────────────────────────────────

LANGUAGE_CODE = 'en-us'

# Kept as UTC on purpose: each city's local time is derived from the timezone
# offset that OpenWeather returns, not from the server clock.
TIME_ZONE = 'UTC'

USE_I18N = True
USE_TZ = True


# ── Static files ──────────────────────────────────────────────────────────────

STATIC_URL = 'static/'
STATICFILES_DIRS = [BASE_DIR / 'static']
STATIC_ROOT = BASE_DIR / 'staticfiles'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
