"""AI notes on a city's weather: a short summary, what to wear, and health tips.

The weather on the page is topped up with air quality (OpenWeather) and the UV
index plus the next few hours' forecast (Open-Meteo, which needs no key). A chat
model then writes the three notes from it, on Groq (free plan) or Hugging Face
Inference Providers, whichever has a key. Both speak the same OpenAI-style API.

All of this is optional. Without a key, or when a service fails, the page
simply leaves the notes out; problems are logged as warnings.
"""

import json
import logging
from datetime import datetime

import requests
from django.conf import settings
from django.core.cache import cache

log = logging.getLogger(__name__)

GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions'
HF_CHAT_URL = 'https://router.huggingface.co/v1/chat/completions'
AIR_URL = 'https://api.openweathermap.org/data/2.5/air_pollution'
FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'

DATA_TIMEOUT = 5   # seconds, for air quality and the forecast
AI_TIMEOUT = 12    # seconds; writing the notes usually takes 1-2
FORECAST_HOURS = 12

# Thinking models such as gpt-oss reason before they answer. Short notes need
# little of that, and it keeps replies fast and inside the free token limits.
# The thinking counts towards max_tokens, so leave room for it.
REASONING_MODELS = ('openai/gpt-oss',)
MAX_TOKENS = 600

# Notes are kept per place for half an hour, so reloading a city costs nothing.
# After a failure, the page waits a few minutes before asking the model again.
CACHE_SECONDS = 30 * 60
RETRY_SECONDS = 5 * 60

# OpenWeather's air quality index runs from 1 (best) to 5 (worst).
AIR_LABELS = {1: 'Good', 2: 'Fair', 3: 'Moderate', 4: 'Poor', 5: 'Very poor'}
# The WHO's UV index bands, from 0-2 up to 11+.
UV_LABELS = ['Low', 'Moderate', 'High', 'Very high', 'Extreme']

NOTE_KEYS = ('summary', 'wear', 'health')
NOTE_MAX_LENGTH = 500  # characters; a guard against a runaway reply

SYSTEM_PROMPT = """You are SkySnap's friendly weather assistant. From the weather data you are given, write three short notes for someone in that city right now.

Reply with only a JSON object, no other text, in exactly this shape:
{"summary": "...", "wear": "...", "health": "..."}

- summary: 2 sentences on how the weather feels now (from the Temperature line) and how it changes over the next hours. If rain or a big change is coming, say roughly when (for example "rain likely after 4 PM").
- wear: 1-2 sentences on what to wear and carry, plus one activity that suits the weather.
- health: 1-2 sentences of practical health and comfort advice using the air quality, UV, heat, humidity and wind. For example: sunscreen, drinking water, heat stroke risk, whether it is a good time to run, and a word for people with asthma when the air is poor.

Keep each note under 45 words. Plain sentences only: no markdown, lists or emoji. Use only the numbers in the data; never invent any."""


def weather_insights(weather):
    """The AI notes for the weather on screen, or None when there are none.

    Returns the three notes ('summary', 'wear', 'health') together with the
    air quality and UV readings ('air', 'uv_now', 'uv_peak') they draw on,
    each of which may be None.
    """
    lat, lon = weather.get('lat'), weather.get('lon')
    service = chat_service()
    if service is None or lat is None or lon is None:
        return None

    key = f'insights:{lat:.2f},{lon:.2f}'
    cached = cache.get(key)
    if cached is not None:
        return cached or None  # False marks a recent failure

    air = fetch_air_quality(lat, lon)
    forecast = fetch_forecast(lat, lon) or {}
    notes = ask_model(service, describe(weather, air, forecast))
    if notes is None:
        cache.set(key, False, RETRY_SECONDS)
        return None

    insights = {
        **notes,
        'air': air,
        'uv_now': forecast.get('uv_now'),
        'uv_peak': forecast.get('uv_peak'),
    }
    cache.set(key, insights, CACHE_SECONDS)
    return insights


def chat_service():
    """The chat service to ask, as (name, url, key, model), or None without a key.

    Groq comes first: its free plan allows thousands of requests a day, where
    Hugging Face's free plan has a small monthly credit.
    """
    if settings.GROQ_API_KEY:
        return 'Groq', GROQ_CHAT_URL, settings.GROQ_API_KEY, settings.GROQ_MODEL
    if settings.HF_TOKEN:
        return 'Hugging Face', HF_CHAT_URL, settings.HF_TOKEN, settings.HF_MODEL
    return None


def fetch_air_quality(lat, lon):
    """Air quality from OpenWeather, e.g. {'index': 2, 'label': 'Fair', ...}, or None."""
    data = get_json(AIR_URL, {'lat': lat, 'lon': lon, 'appid': settings.OPENWEATHER_API_KEY})
    try:
        reading = data['list'][0]
        index = reading['main']['aqi']
        parts = reading.get('components') or {}
    except (KeyError, IndexError, TypeError):
        return None
    if index not in AIR_LABELS:
        return None
    return {
        'index': index,
        'label': AIR_LABELS[index],
        'tone': index,  # 1-5, the colour the page shows it in
        'pm2_5': number(parts.get('pm2_5')),
        'pm10': number(parts.get('pm10')),
    }


def fetch_forecast(lat, lon):
    """UV now and at today's peak, and the coming hours, from Open-Meteo, or None.

    Times are in the city's own timezone, e.g. {'time': '4 PM', 'temp': 32, 'rain': 45}.
    """
    data = get_json(FORECAST_URL, {
        'latitude': lat,
        'longitude': lon,
        'current': 'uv_index',
        'hourly': 'temperature_2m,precipitation_probability',
        'daily': 'uv_index_max',
        'timezone': 'auto',
        'forecast_days': 2,  # so the next 12 hours fit even late in the evening
    })
    try:
        now = data['current']['time']
        uv_now = data['current'].get('uv_index')
        uv_peak = data['daily']['uv_index_max'][0]
        hourly = zip(data['hourly']['time'], data['hourly']['temperature_2m'],
                     data['hourly']['precipitation_probability'])
        # The hours start at midnight; keep those after the current one. The
        # current hour is left out because the page's own reading covers now,
        # and the two sources can disagree by a few degrees.
        hours = [
            {'time': hour_label(time), 'temp': number(temp), 'rain': number(rain)}
            for time, temp, rain in hourly
            if time[:13] > now[:13] and temp is not None
        ][:FORECAST_HOURS]
    except (KeyError, IndexError, TypeError, ValueError):
        return None
    return {'uv_now': uv_reading(uv_now), 'uv_peak': uv_reading(uv_peak), 'hours': hours}


def get_json(url, params):
    """Fetch a JSON object, or None if the service fails in any way."""
    try:
        response = requests.get(url, params=params, timeout=DATA_TIMEOUT)
        data = response.json() if response.status_code == 200 else None
    except (requests.RequestException, ValueError):
        return None
    return data if isinstance(data, dict) else None


def describe(weather, air, forecast):
    """The facts the model writes from, one per line."""
    w = weather
    place = f"{w['city']}, {w['country']}" if w['country'] else w['city']
    lines = [f'Place: {place}', f"Local time: {w['local_date']}, {w['local_time']}",
             f"Sky: {w['description']}"]
    if w['temp'] is not None:
        feels = f", feels like {w['feels_like']}°C" if w['feels_like'] is not None else ''
        lines.append(f"Temperature: {w['temp']}°C{feels}")
    if w['humidity'] is not None:
        lines.append(f"Humidity: {w['humidity']}%")
    if w['wind_speed'] is not None:
        wind = f"Wind: {w['wind_speed']} km/h"
        if w['wind_direction']:
            wind += f" from the {w['wind_direction']}"
        if w['wind_gust'] is not None:
            wind += f", gusts up to {w['wind_gust']} km/h"
        lines.append(wind)
    if w['cloud_cover'] is not None:
        lines.append(f"Cloud cover: {w['cloud_cover']}%")
    if w['visibility'] is not None:
        lines.append(f"Visibility: {w['visibility']} km")
    if w['sunrise'] and w['sunset']:
        lines.append(f"Sunrise {w['sunrise']}, sunset {w['sunset']}")

    if air:
        line = f"Air quality: {air['label']} ({air['index']} on a 1-5 scale where 5 is worst)"
        if air['pm2_5'] is not None:
            line += f", PM2.5 {air['pm2_5']} µg/m³"
        if air['pm10'] is not None:
            line += f", PM10 {air['pm10']} µg/m³"
        lines.append(line)
    uv_now, uv_peak = forecast.get('uv_now'), forecast.get('uv_peak')
    if uv_now:
        line = f"UV index now: {uv_now['value']} ({uv_now['label']})"
        if uv_peak:
            line += f", today's peak {uv_peak['value']} ({uv_peak['label']})"
        lines.append(line)
    if forecast.get('hours'):
        hours = [f"{h['time']} {h['temp']}°C" + (f" {h['rain']}% rain" if h['rain'] is not None else '')
                 for h in forecast['hours']]
        lines.append('Next hours: ' + '; '.join(hours))
    return '\n'.join(lines)


def ask_model(service, facts):
    """Ask the chat model for the three notes, or return None if that fails."""
    name, url, key, model = service
    request = {
        'model': model,
        'messages': [
            {'role': 'system', 'content': SYSTEM_PROMPT},
            {'role': 'user', 'content': facts},
        ],
        'max_tokens': MAX_TOKENS,
        'temperature': 0.4,
    }
    if model.startswith(REASONING_MODELS):
        request['reasoning_effort'] = 'low'
    try:
        response = requests.post(url, headers={'Authorization': f'Bearer {key}'},
                                 json=request, timeout=AI_TIMEOUT)
    except requests.RequestException as error:
        log.warning('AI weather notes: could not reach %s (%s)', name, error)
        return None

    if response.status_code != 200:
        log.warning('AI weather notes: %s returned %s: %s',
                    name, response.status_code, response.text[:300])
        return None
    try:
        reply = response.json()['choices'][0]['message']['content'] or ''
    except (ValueError, KeyError, IndexError, TypeError):
        log.warning('AI weather notes: unexpected response from %s: %s', name, response.text[:300])
        return None

    notes = parse_notes(reply)
    if notes is None:
        log.warning('AI weather notes: could not read the model reply: %r', reply[:300])
    return notes


def parse_notes(reply):
    """Pull the three notes out of the model's JSON reply, or None if any is missing.

    Models sometimes wrap the JSON in a code fence or add a sentence around it,
    so only the part between the outer braces is read.
    """
    start, end = reply.find('{'), reply.rfind('}')
    if start == -1 or end < start:
        return None
    try:
        data = json.loads(reply[start:end + 1])
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None

    notes = {}
    for key in NOTE_KEYS:
        text = data.get(key)
        if not isinstance(text, str) or not text.strip():
            return None
        notes[key] = ' '.join(text.split())[:NOTE_MAX_LENGTH]
    return notes


def uv_reading(value):
    """A UV index with its WHO band, e.g. {'value': 7, 'label': 'High', 'tone': 3}."""
    if not isinstance(value, (int, float)):
        return None
    index = round(value)
    tone = 1 + (index >= 3) + (index >= 6) + (index >= 8) + (index >= 11)
    return {'value': index, 'label': UV_LABELS[tone - 1], 'tone': tone}


def hour_label(stamp):
    """Turn an Open-Meteo time such as '2026-10-01T16:00' into '4 PM'."""
    return datetime.fromisoformat(stamp).strftime('%I %p').lstrip('0')


def number(value):
    """Round a reading that may be missing or not a number."""
    return round(value) if isinstance(value, (int, float)) else None
