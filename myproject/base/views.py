import math
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, unquote

import requests
from django.conf import settings
from django.shortcuts import render

from .insights import weather_insights

OPENWEATHER_URL = 'https://api.openweathermap.org/data/2.5/weather'
REQUEST_TIMEOUT = 10  # seconds

# Offered in the search dropdown; six are also shown as chips (see CITY_IDEAS).
# Searching "Name,CC" makes OpenWeather pick the right country's city.
POPULAR_CITIES = [
    'London,GB', 'New York,US', 'Tokyo,JP', 'Mumbai,IN', 'Paris,FR', 'Sydney,AU',
    'Dubai,AE', 'Singapore,SG', 'Delhi,IN', 'Toronto,CA', 'Cape Town,ZA', 'Rio de Janeiro,BR',
]

# How many popular cities the welcome page suggests as one-tap links.
CITY_IDEAS = 6

# The last few cities found are kept in a cookie for the search dropdown.
RECENT_COOKIE = 'recent_cities'
RECENT_LIMIT = 5
RECENT_MAX_AGE = 365 * 24 * 60 * 60  # one year, in seconds

# The location map is a grid of OpenStreetMap tiles around the city, picked
# here so the page needs no JavaScript. Zoom 11 shows a city and its outskirts.
MAP_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
MAP_ZOOM = 11
TILE_SIZE = 256  # pixels
# Half the widest and tallest the map card gets, in pixels. The grid reaches
# this far from the city in every direction so the card is always covered.
MAP_REACH_X = 540
MAP_REACH_Y = 180

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
    recent = read_recent(request)
    context = {
        'city': city,
        'popular_cities': [place_option(query) for query in POPULAR_CITIES],
        'api_key_missing': not settings.OPENWEATHER_API_KEY,
    }
    place = ''
    if city:
        context['weather'], context['error'] = fetch_weather(city)
        if context['weather']:
            place = place_query(context['weather'])
            context['insights'] = weather_insights(context['weather'])
    if place:
        recent = remember(recent, place)
        # The dropdown skips the city already on screen.
        context['recent_cities'] = [place_option(query) for query in recent[1:]]
    else:
        context['recent_cities'] = [place_option(query) for query in recent]
    # Suggestions on the welcome page skip cities already offered as recent searches.
    offered = {query.lower() for query in recent}
    context['city_ideas'] = [
        place_option(query) for query in POPULAR_CITIES if query.lower() not in offered
    ][:CITY_IDEAS]

    response = render(request, 'base/home.html', context)
    if place:
        response.set_cookie(
            RECENT_COOKIE, quote('|'.join(recent)), max_age=RECENT_MAX_AGE,
            secure=request.is_secure(), httponly=True, samesite='Lax',
        )
    return response


def read_recent(request):
    """The recently found cities saved in the visitor's cookie, newest first."""
    saved = unquote(request.COOKIES.get(RECENT_COOKIE, ''))
    queries = [query.strip() for query in saved.split('|')]
    return [query for query in queries if 0 < len(query) <= 100][:RECENT_LIMIT]


def remember(recent, query):
    """Put a city at the front of the recent list, without repeating it."""
    others = [old for old in recent if old.lower() != query.lower()]
    return [query, *others][:RECENT_LIMIT]


def place_query(weather):
    """The search text that finds this exact place again, e.g. 'Mumbai,IN'.

    Empty when the response had no city name, so there is nothing to save.
    """
    if weather['city'] and weather['country']:
        return f"{weather['city']},{weather['country']}"
    return weather['city']


def place_option(query):
    """Split a search such as 'New York,US' into what the dropdown shows."""
    name, comma, country = query.rpartition(',')
    if not comma:
        name, country = query, ''
    return {'query': query, 'name': name.strip(), 'country': country.strip().upper()}


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
    coord = payload.get('coord') or {}
    lat, lon = coord.get('lat'), coord.get('lon')

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
        'lat': lat,
        'lon': lon,
        'coords': coordinates(lat, lon),
        'map': map_view(lat, lon),
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


def coordinates(lat, lon):
    """Format a position as e.g. '19.01° N, 72.85° E', or '' when unknown."""
    if lat is None or lon is None:
        return ''
    return f"{abs(lat):.2f}° {'N' if lat >= 0 else 'S'}, {abs(lon):.2f}° {'E' if lon >= 0 else 'W'}"


def map_view(lat, lon, zoom=MAP_ZOOM):
    """Pick the map tiles around a place, or None when its position is unknown.

    Tiles use the Web Mercator numbering shared by OpenStreetMap and most web
    maps. The template lays them out in a grid of 'columns' tiles, then shifts
    the grid by 'offset_x'/'offset_y' so the place sits in the card's centre.
    Rows beyond the poles have no tile (None); columns wrap round the date line.
    """
    if lat is None or lon is None:
        return None
    lat = max(min(lat, 85.0), -85.0)  # Web Mercator stops short of the poles
    tiles_across = 2 ** zoom

    # The place's position in pixels on the whole-world map at this zoom.
    x = (lon + 180) / 360 * tiles_across * TILE_SIZE
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * tiles_across * TILE_SIZE

    first_col = math.floor((x - MAP_REACH_X) / TILE_SIZE)
    last_col = math.floor((x + MAP_REACH_X) / TILE_SIZE)
    first_row = math.floor((y - MAP_REACH_Y) / TILE_SIZE)
    last_row = math.floor((y + MAP_REACH_Y) / TILE_SIZE)

    tiles = []
    for row in range(first_row, last_row + 1):
        for col in range(first_col, last_col + 1):
            if 0 <= row < tiles_across:
                tiles.append(MAP_TILE_URL.format(z=zoom, x=col % tiles_across, y=row))
            else:
                tiles.append(None)

    return {
        'tiles': tiles,
        'columns': last_col - first_col + 1,
        'offset_x': round(x - first_col * TILE_SIZE),
        'offset_y': round(y - first_row * TILE_SIZE),
        'link': f'https://www.openstreetmap.org/?mlat={lat:.4f}&mlon={lon:.4f}#map={zoom}/{lat:.4f}/{lon:.4f}',
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
