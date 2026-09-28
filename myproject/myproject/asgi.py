"""
ASGI config for myproject project.

It exposes the ASGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/6.0/howto/deployment/asgi/
"""

import os
import sys
from pathlib import Path

# Vercel loads this file from the repository root, so the folder holding
# manage.py is not on the import path. Add it so "myproject" and "base" import.
PROJECT_DIR = str(Path(__file__).resolve().parent.parent)
if PROJECT_DIR not in sys.path:
    sys.path.insert(0, PROJECT_DIR)

from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'myproject.settings')

application = get_asgi_application()
