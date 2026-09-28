from datetime import datetime, timedelta, timezone

import requests
from django.conf import settings
from django.shortcuts import render

OPENWEATHER_URL = 'https://api.openweathermap.org/data/2.5/weather'
REQUEST_TIMEOUT = 10  # seconds

POPULAR_CITIES = ['London', 'New York', 'Tokyo', 'Mumbai', 'Paris', 'Sydney']

# OpenWeather's "main" condition -> background theme. Anything not listed
# (Mist, Haze, Fog, Dust, Smoke...) falls back to "mist".
SKY_THEMES = {
    'Clear': 'clear',
    'Clouds': 'clouds',
    'Rain': 'rain',
    'Drizzle': 'rain',
    'Thunderstorm': 'storm',
    'Snow': 'snow',
}

# OpenWeather icon code (without its d/n suffix) -> illustration drawn by
# base/weather_art.html. Conditions without an icon fall back to ART_BY_CONDITION.
ART_BY_ICON = {
    '01': 'clear',
    '02': 'partly',
    '03': 'cloudy',
    '04': 'cloudy',
    '09': 'rain',
    '10': 'rain',
    '11': 'storm',
    '13': 'snow',
    '50': 'mist',
}
ART_BY_CONDITION = {
    'Clear': 'clear',
    'Clouds': 'cloudy',
    'Rain': 'rain',
    'Drizzle': 'rain',
    'Thunderstorm': 'storm',
    'Snow': 'snow',
}


def home(request):
    """Show the search form, plus the weather for the city that was searched."""
    city = request.GET.get('city_name', '').strip()
    context = {
        'city': city,
        'popular_cities': POPULAR_CITIES,
        'api_key_missing': not settings.OPENWEATHER_API_KEY,
    }
    if city:
        context['weather'], context['error'] = fetch_weather(city)
    return render(request, 'base/home.html', context)


def fetch_weather(city):
    """Look up the current weather for a city.

    Returns a (weather, error) pair where exactly one of the two is None.
    """
    if not settings.OPENWEATHER_API_KEY:
        return None, 'No API key yet. Add API_KEY to your .env file, then restart the server.'

    try:
        response = requests.get(
            OPENWEATHER_URL,
            params={'q': city, 'appid': settings.OPENWEATHER_API_KEY, 'units': 'metric'},
            timeout=REQUEST_TIMEOUT,
        )
    except requests.Timeout:
        return None, 'The weather service took too long to respond. Please try again.'
    except requests.RequestException:
        return None, 'Could not reach the weather service. Check your internet connection.'

    try:
        payload = response.json()
    except ValueError:
        payload = None
    if not isinstance(payload, dict):
        return None, 'The weather service sent back a response that could not be read.'

    if response.status_code == 200:
        return build_weather(payload), None
    if response.status_code == 404:
        return None, f'No city called "{city}" was found. Check the spelling and try again.'
    if response.status_code == 401:
        return None, ('The API key was rejected. A new OpenWeather key can take up to a couple '
                      'of hours to activate; otherwise, check the key in your .env file.')
    if response.status_code == 429:
        return None, 'The free plan request limit was hit. Wait a minute and try again.'
    return None, f'The weather service returned an error ({response.status_code}). Please try again.'


def build_weather(payload):
    """Flatten an OpenWeather response into the values the template renders."""
    weather = (payload.get('weather') or [{}])[0]
    main = payload.get('main') or {}
    wind = payload.get('wind') or {}
    sun = payload.get('sys') or {}
    clouds = payload.get('clouds') or {}

    # OpenWeather gives the city's offset from UTC in seconds.
    offset = timedelta(seconds=payload.get('timezone') or 0)
    now = datetime.now(timezone.utc)
    local_now = now + offset

    condition = weather.get('main') or ''
    icon = weather.get('icon') or ''
    wind_speed = wind.get('speed')
    wind_gust = wind.get('gust')
    visibility = payload.get('visibility')

    return {
        'city': payload.get('name') or '',
        'country': sun.get('country') or '',
        'condition': condition,
        'description': (weather.get('description') or condition).capitalize(),
        'icon': icon,
        'sky': sky_theme(condition, icon),
        'art': weather_art(condition, icon),
        'temp': rounded(main.get('temp')),
        'feels_like': rounded(main.get('feels_like')),
        'humidity': main.get('humidity'),
        'pressure': main.get('pressure'),
        'cloud_cover': clouds.get('all'),
        # The API reports m/s; km/h reads more naturally.
        'wind_speed': rounded(wind_speed * 3.6) if wind_speed is not None else None,
        'wind_gust': rounded(wind_gust * 3.6) if wind_gust is not None else None,
        'wind_degrees': wind.get('deg'),
        'wind_direction': compass(wind.get('deg')),
        'visibility': round(visibility / 1000, 1) if visibility is not None else None,
        'local_date': f'{local_now:%a}, {local_now.day} {local_now:%b}',
        'local_time': clock(local_now),
        'sunrise': local_clock(sun.get('sunrise'), offset),
        'sunset': local_clock(sun.get('sunset'), offset),
        'daylight': daylight(sun.get('sunrise'), sun.get('sunset'), now.timestamp()),
    }


def sky_theme(condition, icon):
    """Pick the page background for a condition; clear skies get a night variant."""
    theme = SKY_THEMES.get(condition, 'mist')
    # "Few clouds" still reads as a clear sky.
    if theme == 'clouds' and icon.startswith('02'):
        theme = 'clear'
    if theme == 'clear' and icon.endswith('n'):
        return 'night'
    return theme


def weather_art(condition, icon):
    """Pick the illustration for a condition, e.g. 'rain' or 'partly-night'.

    Clear and partly cloudy skies have separate day and night drawings.
    """
    art = ART_BY_ICON.get(icon[:2]) or ART_BY_CONDITION.get(condition, 'mist')
    if art in ('clear', 'partly'):
        art += '-night' if icon.endswith('n') else '-day'
    return art


def daylight(sunrise, sunset, now):
    """Describe today's daylight from UTC timestamps.

    'progress' runs from 0 at sunrise to 1 at sunset and holds at either end
    outside those times. Returns None when a time is missing (polar day/night).
    """
    if not sunrise or not sunset or sunset <= sunrise:
        return None
    hours, minutes = divmod(round((sunset - sunrise) / 60), 60)
    progress = (now - sunrise) / (sunset - sunrise)
    return {
        'length': f'{hours}h {minutes:02d}m',
        'progress': round(min(max(progress, 0), 1), 3),
        'sun_is_up': sunrise <= now <= sunset,
    }


def rounded(value):
    """Round a number that may be missing from the API response."""
    return round(value) if value is not None else None


def clock(moment):
    """Format a time as e.g. '6:05 PM' (no leading zero, portable to Windows)."""
    return moment.strftime('%I:%M %p').lstrip('0')


def local_clock(epoch, offset):
    """Turn a UTC timestamp into a clock time in the city's own timezone.

    Polar day/night responses report 0, which is treated as missing.
    """
    if not epoch:
        return None
    return clock(datetime.fromtimestamp(epoch, tz=timezone.utc) + offset)


def compass(degrees):
    """Convert a wind bearing into a 16-point compass label such as 'WNW'."""
    if degrees is None:
        return ''
    points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
              'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
    return points[round(degrees / 22.5) % 16]
