from datetime import datetime, timezone
from unittest import mock
from urllib.parse import quote

import json

import requests
from django.core.cache import cache
from django.test import RequestFactory, SimpleTestCase, override_settings
from django.urls import reverse

from .insights import (AIR_URL, FORECAST_URL, GROQ_CHAT_URL, HF_CHAT_URL, describe, parse_notes,
                       uv_reading, weather_insights)
from .templatetags.weather_format import minus
from .views import (RECENT_COOKIE, build_weather, daylight, map_view, place_option,
                    read_recent, remember, sky_theme, weather_art)

# A real OpenWeather response for Mumbai, trimmed to the fields the app uses.
MUMBAI = {
    'coord': {'lon': 72.8479, 'lat': 19.0144},
    'weather': [{'id': 721, 'main': 'Haze', 'description': 'haze', 'icon': '50d'}],
    'main': {'temp': 30.99, 'feels_like': 37.57, 'pressure': 1008, 'humidity': 70},
    'visibility': 4500,
    'wind': {'speed': 5.66, 'deg': 280},
    'sys': {'country': 'IN', 'sunrise': 1776041580, 'sunset': 1776086700},
    'timezone': 19800,
    'name': 'Mumbai',
    'cod': 200,
}


def fake_response(status_code, payload):
    response = mock.Mock(status_code=status_code)
    response.json.return_value = payload
    return response


@override_settings(OPENWEATHER_API_KEY='test-key', GROQ_API_KEY='', HF_TOKEN='')
@mock.patch('base.views.requests.get')
class HomeViewTests(SimpleTestCase):

    def search(self, city):
        return self.client.get(reverse('home'), {'city_name': city})

    def test_no_search_shows_welcome(self, mock_get):
        response = self.client.get(reverse('home'))
        self.assertContains(response, 'Search any city')
        self.assertContains(response, 'Try one of these')
        mock_get.assert_not_called()

    def test_dropdown_offers_popular_cities_with_their_country(self, mock_get):
        response = self.client.get(reverse('home'))
        self.assertContains(response, 'Popular cities')
        self.assertContains(response, '?city_name=Rio%20de%20Janeiro%2CBR')
        self.assertContains(response, '<span class="suggest-name">Rio de Janeiro</span>', html=True)
        self.assertNotContains(response, 'Recent searches')  # nothing searched yet

    def test_found_city_is_saved_as_a_recent_search(self, mock_get):
        mock_get.return_value = fake_response(200, MUMBAI)
        response = self.search('mumbai')
        self.assertEqual(response.cookies[RECENT_COOKIE].value, quote('Mumbai,IN'))
        self.assertTrue(response.cookies[RECENT_COOKIE]['httponly'])
        # The box is cleared so focusing it opens the dropdown again.
        self.assertContains(response, 'placeholder="Search another city…"')
        self.assertContains(response, 'value=""')

    def test_recent_searches_are_listed(self, mock_get):
        self.client.cookies[RECENT_COOKIE] = quote('Paris,FR|Tokyo,JP')
        response = self.client.get(reverse('home'))
        self.assertContains(response, 'Recent searches')
        self.assertContains(response, '?city_name=Paris%2CFR')
        self.assertEqual([p['name'] for p in response.context['recent_cities']], ['Paris', 'Tokyo'])
        # The welcome page also offers them as one-tap links, and its popular
        # suggestions leave them out so no city is offered twice.
        self.assertContains(response, '<p class="chips-label">Recent</p>', html=True)
        ideas = [p['name'] for p in response.context['city_ideas']]
        self.assertEqual(ideas, ['London', 'New York', 'Mumbai', 'Sydney', 'Dubai', 'Singapore'])

    def test_new_search_moves_to_the_front_without_repeats(self, mock_get):
        mock_get.return_value = fake_response(200, MUMBAI)
        self.client.cookies[RECENT_COOKIE] = quote('Tokyo,JP|mumbai,in|Paris,FR')
        response = self.search('Mumbai')
        self.assertEqual(response.cookies[RECENT_COOKIE].value, quote('Mumbai,IN|Tokyo,JP|Paris,FR'))
        # The city on screen is left out of its own dropdown.
        self.assertEqual([p['name'] for p in response.context['recent_cities']], ['Tokyo', 'Paris'])

    def test_failed_search_is_not_saved(self, mock_get):
        mock_get.return_value = fake_response(404, {'cod': '404'})
        response = self.search('Atlantis')
        self.assertNotIn(RECENT_COOKIE, response.cookies)
        self.assertContains(response, 'value="Atlantis"')  # kept so the typo can be fixed

    def test_blank_search_does_not_call_api(self, mock_get):
        response = self.search('   ')
        self.assertContains(response, 'Search any city')
        mock_get.assert_not_called()

    def test_found_city_shows_weather(self, mock_get):
        mock_get.return_value = fake_response(200, MUMBAI)
        response = self.search('Mumbai')

        self.assertContains(response, 'Mumbai')
        self.assertContains(response, 'Haze')
        self.assertContains(response, 'data-sky="mist"')
        self.assertContains(response, 'class="art-haze"')  # the mist drawing
        self.assertContains(response, '--deg: 280deg')     # compass arrow
        self.assertContains(response, 'class="sun-track')
        # The temperature counts up on load, with the real value kept for screen readers.
        self.assertContains(response, '<span class="count" style="--to: 31"><span class="count-num">31</span></span>', html=True)
        self.assertContains(response, '<span class="reading-value">1008<small>hPa</small></span>', html=True)
        # The location map, centred on the city.
        self.assertContains(response, 'class="card map-card"')
        self.assertContains(response, '19.01° N, 72.85° E')
        self.assertContains(response, 'https://tile.openstreetmap.org/11/')
        self.assertContains(response, 'https://www.openstreetmap.org/?mlat=19.0144&amp;mlon=72.8479')
        self.assertEqual(mock_get.call_args.kwargs['params']['q'], 'Mumbai')
        self.assertEqual(mock_get.call_args.kwargs['params']['appid'], 'test-key')

    def test_found_city_hands_its_conditions_to_the_weather_scene(self, mock_get):
        mock_get.return_value = fake_response(200, MUMBAI)
        response = self.search('Mumbai')
        self.assertContains(response, '<script id="weather-data" type="application/json">')
        self.assertEqual(response.context['weather']['scene']['code'], 721)
        self.assertContains(response, 'js/weather/boot.js')
        mock_get.assert_called_once()  # the scene reuses this page's weather, no second request

    def test_pages_without_weather_have_no_scene_data(self, mock_get):
        response = self.client.get(reverse('home'))
        self.assertContains(response, 'js/weather/boot.js')  # the welcome page's own quiet scene
        self.assertNotContains(response, 'id="weather-data"')

    def test_scene_data_is_escaped(self, mock_get):
        mock_get.return_value = fake_response(200, {**MUMBAI, 'weather': [{'id': 800, 'main': '</script><b>', 'icon': '01d'}]})
        response = self.search('Mumbai')
        self.assertNotContains(response, '</script><b>')
        self.assertContains(response, '\\u003C/script\\u003E\\u003Cb\\u003E')

    def test_unknown_city(self, mock_get):
        mock_get.return_value = fake_response(404, {'cod': '404', 'message': 'city not found'})
        response = self.search('Atlantis')
        self.assertContains(response, 'No city called &quot;Atlantis&quot; was found')
        self.assertIsNone(response.context['weather'])

    def test_rejected_key(self, mock_get):
        mock_get.return_value = fake_response(401, {'cod': 401, 'message': 'Invalid API key.'})
        self.assertContains(self.search('Mumbai'), 'API key was rejected')

    def test_rate_limited(self, mock_get):
        mock_get.return_value = fake_response(429, {'cod': 429})
        self.assertContains(self.search('Mumbai'), 'request limit was hit')

    def test_timeout(self, mock_get):
        mock_get.side_effect = requests.Timeout
        self.assertContains(self.search('Mumbai'), 'took too long to respond')

    def test_no_connection(self, mock_get):
        mock_get.side_effect = requests.ConnectionError
        self.assertContains(self.search('Mumbai'), 'Could not reach the weather service')

    def test_unreadable_response(self, mock_get):
        mock_get.return_value = fake_response(200, None)
        mock_get.return_value.json.side_effect = ValueError
        self.assertContains(self.search('Mumbai'), 'could not be read')

    def test_search_text_is_escaped(self, mock_get):
        mock_get.return_value = fake_response(404, {'cod': '404'})
        response = self.search('<script>alert(1)</script>')
        self.assertNotContains(response, '<script>alert(1)</script>')
        self.assertContains(response, '&lt;script&gt;')

    def test_sparse_response_still_renders(self, mock_get):
        mock_get.return_value = fake_response(200, {'name': 'Nowhere', 'main': {'temp': 1.4}})
        response = self.search('Nowhere')
        self.assertContains(response, 'Nowhere')
        self.assertContains(response, '—')

    def test_temperatures_below_zero_use_a_minus_sign(self, mock_get):
        mock_get.return_value = fake_response(200, {**MUMBAI, 'main': {'temp': -2.4, 'feels_like': -6.8}})
        response = self.search('Mumbai')
        self.assertContains(response, '<span class="count" style="--to: -2"><span class="count-num">−2</span></span>', html=True)
        self.assertContains(response, 'Feels like −7°C')
        self.assertContains(response, '<title>Mumbai · −2°C · SkySnap</title>', html=True)

    @override_settings(OPENWEATHER_API_KEY='')
    def test_missing_key_prompts_setup_without_calling_api(self, mock_get):
        self.assertContains(self.client.get(reverse('home')), 'One step left')
        self.assertContains(self.search('Mumbai'), 'Add API_KEY to your .env file')
        mock_get.assert_not_called()

    def test_ai_notes_are_left_out_without_a_token(self, mock_get):
        mock_get.return_value = fake_response(200, MUMBAI)
        response = self.search('Mumbai')
        self.assertIsNone(response.context['insights'])
        self.assertNotContains(response, 'Today in brief')
        self.assertNotContains(response, 'Plan your day')
        self.assertNotContains(response, 'Open-Meteo')  # its data is only used for the notes
        mock_get.assert_called_once()  # only the weather itself

    @mock.patch('base.views.weather_insights')
    def test_ai_notes_are_shown_under_the_weather(self, mock_insights, mock_get):
        mock_get.return_value = fake_response(200, MUMBAI)
        mock_insights.return_value = {
            **NOTES,
            'air': {'index': 5, 'label': 'Very poor', 'tone': 5},
            'uv_now': uv_reading(5.3),
            'uv_peak': uv_reading(7.5),
        }
        response = self.search('Mumbai')
        self.assertEqual(mock_insights.call_args.args[0]['city'], 'Mumbai')
        self.assertContains(response, 'Today in brief')  # the summary leads the hero
        self.assertContains(response, 'Plan your day')
        self.assertContains(response, 'https://open-meteo.com/')  # credited for the UV and forecast
        self.assertContains(response, 'Rain likely after 4 PM.')
        self.assertContains(response, 'Light cotton and an umbrella.')
        self.assertContains(response, 'Wear a mask outdoors.')
        self.assertContains(response, '<li class="fact" data-tone="5"><small>Air</small>Very poor</li>', html=True)
        self.assertContains(response, '<li class="fact" data-tone="2"><small>UV now</small>5 · Moderate</li>', html=True)
        self.assertContains(response, '<li class="fact" data-tone="4"><small>UV peak</small>8 · Very high</li>', html=True)

    @mock.patch('base.views.weather_insights')
    def test_ai_notes_are_escaped(self, mock_insights, mock_get):
        mock_get.return_value = fake_response(200, MUMBAI)
        mock_insights.return_value = {**NOTES, 'summary': '<b>Hot</b>', 'air': None,
                                      'uv_now': None, 'uv_peak': None}
        response = self.search('Mumbai')
        self.assertContains(response, '&lt;b&gt;Hot&lt;/b&gt;')
        self.assertNotContains(response, 'class="insight-facts"')


# What the model is asked to write, as it comes back from parse_notes.
NOTES = {
    'summary': 'Rain likely after 4 PM.',
    'wear': 'Light cotton and an umbrella.',
    'health': 'Wear a mask outdoors.',
}

# Real Open-Meteo and OpenWeather air pollution responses, trimmed.
FORECAST = {
    'current': {'time': '2026-10-01T11:15', 'uv_index': 5.3},
    'hourly': {
        'time': ['2026-10-01T10:00', '2026-10-01T11:00', '2026-10-01T12:00', '2026-10-01T16:00'],
        'temperature_2m': [31.7, 32.9, 33.3, 32.0],
        'precipitation_probability': [0, 0, 7, 45],
    },
    'daily': {'uv_index_max': [7.5]},
}
AIR = {'list': [{'main': {'aqi': 5}, 'components': {'pm2_5': 122.91, 'pm10': 130.3}}]}


def chat_response(content, status_code=200):
    """A chat completion whose reply is `content`."""
    response = fake_response(status_code, {'choices': [{'message': {'content': content}}]})
    response.text = 'error details'
    return response


def fake_get(url, params, timeout):
    """Answer the air quality and forecast requests like the real services."""
    return fake_response(200, {AIR_URL: AIR, FORECAST_URL: FORECAST}[url])


@override_settings(OPENWEATHER_API_KEY='test-key', GROQ_API_KEY='groq-test', GROQ_MODEL='test/groq',
                   HF_TOKEN='hf-test', HF_MODEL='test/hf')
@mock.patch('base.insights.requests.post')
@mock.patch('base.insights.requests.get', side_effect=fake_get)
class WeatherInsightsTests(SimpleTestCase):

    def setUp(self):
        cache.clear()  # notes are cached per place
        self.weather = build_weather(MUMBAI)

    def test_writes_notes_from_the_weather_air_and_uv(self, mock_get, mock_post):
        mock_post.return_value = chat_response(json.dumps(NOTES))
        insights = weather_insights(self.weather)

        self.assertEqual({key: insights[key] for key in NOTES}, NOTES)
        self.assertEqual(insights['air']['label'], 'Very poor')
        self.assertEqual(insights['uv_now'], {'value': 5, 'label': 'Moderate', 'tone': 2})
        self.assertEqual(insights['uv_peak'], {'value': 8, 'label': 'Very high', 'tone': 4})

        # Groq is asked first when both keys are set.
        self.assertEqual(mock_post.call_args.args[0], GROQ_CHAT_URL)
        request = mock_post.call_args.kwargs
        self.assertEqual(request['headers']['Authorization'], 'Bearer groq-test')
        self.assertEqual(request['json']['model'], 'test/groq')
        self.assertNotIn('reasoning_effort', request['json'])
        facts = request['json']['messages'][1]['content']
        self.assertIn('Place: Mumbai, IN', facts)
        self.assertIn('Temperature: 31°C, feels like 38°C', facts)
        self.assertIn('Air quality: Very poor (5 on a 1-5 scale where 5 is worst), PM2.5 123 µg/m³', facts)
        self.assertIn("UV index now: 5 (Moderate), today's peak 8 (Very high)", facts)
        # The forecast starts after the current hour (11 AM), not at 10 AM.
        self.assertIn('Next hours: 12 PM 33°C 7% rain; 4 PM 32°C 45% rain', facts)

    def test_reuses_notes_for_the_same_place(self, mock_get, mock_post):
        mock_post.return_value = chat_response(json.dumps(NOTES))
        first = weather_insights(self.weather)
        self.assertEqual(weather_insights(self.weather), first)
        mock_post.assert_called_once()

    @override_settings(GROQ_API_KEY='')
    def test_hugging_face_is_used_without_a_groq_key(self, mock_get, mock_post):
        mock_post.return_value = chat_response(json.dumps(NOTES))
        self.assertEqual(weather_insights(self.weather)['summary'], NOTES['summary'])
        self.assertEqual(mock_post.call_args.args[0], HF_CHAT_URL)
        self.assertEqual(mock_post.call_args.kwargs['headers']['Authorization'], 'Bearer hf-test')
        self.assertEqual(mock_post.call_args.kwargs['json']['model'], 'test/hf')

    @override_settings(GROQ_MODEL='openai/gpt-oss-20b')
    def test_thinking_models_are_asked_to_think_briefly(self, mock_get, mock_post):
        mock_post.return_value = chat_response(json.dumps(NOTES))
        weather_insights(self.weather)
        self.assertEqual(mock_post.call_args.kwargs['json']['reasoning_effort'], 'low')

    def test_no_key_means_no_requests(self, mock_get, mock_post):
        with self.settings(GROQ_API_KEY='', HF_TOKEN=''):
            self.assertIsNone(weather_insights(self.weather))
        mock_get.assert_not_called()
        mock_post.assert_not_called()

    def test_unknown_position_means_no_notes(self, mock_get, mock_post):
        self.assertIsNone(weather_insights(build_weather({'name': 'Nowhere'})))
        mock_post.assert_not_called()

    def test_model_error_is_logged_and_not_retried_at_once(self, mock_get, mock_post):
        mock_post.return_value = chat_response('', status_code=403)
        with self.assertLogs('base.insights', 'WARNING') as logs:
            self.assertIsNone(weather_insights(self.weather))
        self.assertIn('Groq returned 403', logs.output[0])
        self.assertIsNone(weather_insights(self.weather))
        mock_post.assert_called_once()

    def test_unreachable_model(self, mock_get, mock_post):
        mock_post.side_effect = requests.Timeout
        with self.assertLogs('base.insights', 'WARNING'):
            self.assertIsNone(weather_insights(self.weather))

    def test_unreadable_reply(self, mock_get, mock_post):
        mock_post.return_value = chat_response('Sorry, I cannot help with that.')
        with self.assertLogs('base.insights', 'WARNING') as logs:
            self.assertIsNone(weather_insights(self.weather))
        self.assertIn('could not read the model reply', logs.output[0])

    def test_notes_still_come_without_air_and_uv(self, mock_get, mock_post):
        mock_get.side_effect = requests.ConnectionError
        mock_post.return_value = chat_response(json.dumps(NOTES))
        insights = weather_insights(self.weather)
        self.assertEqual(insights['summary'], NOTES['summary'])
        self.assertIsNone(insights['air'])
        self.assertIsNone(insights['uv_now'])
        facts = mock_post.call_args.kwargs['json']['messages'][1]['content']
        self.assertNotIn('Air quality', facts)
        self.assertNotIn('Next hours', facts)


class ParseNotesTests(SimpleTestCase):

    def test_reads_json_wrapped_in_a_code_fence(self):
        reply = 'Here you go:\n```json\n' + json.dumps(NOTES) + '\n```'
        self.assertEqual(parse_notes(reply), NOTES)

    def test_tidies_whitespace(self):
        reply = json.dumps({**NOTES, 'wear': '  Light cotton,\n  sunglasses. '})
        self.assertEqual(parse_notes(reply)['wear'], 'Light cotton, sunglasses.')

    def test_missing_or_empty_note_rejects_the_reply(self):
        self.assertIsNone(parse_notes(json.dumps({'summary': 'Hot.', 'wear': 'Shorts.'})))
        self.assertIsNone(parse_notes(json.dumps({**NOTES, 'health': '  '})))
        self.assertIsNone(parse_notes(json.dumps({**NOTES, 'health': ['Drink water.']})))
        self.assertIsNone(parse_notes('{not json}'))
        self.assertIsNone(parse_notes(''))


class UvReadingTests(SimpleTestCase):

    def test_who_bands(self):
        labels = [uv_reading(value)['label'] for value in (0, 2.4, 2.6, 5, 6, 7.4, 8, 10, 11, 13)]
        self.assertEqual(labels, ['Low', 'Low', 'Moderate', 'Moderate', 'High', 'High',
                                  'Very high', 'Very high', 'Extreme', 'Extreme'])

    def test_missing_value(self):
        self.assertIsNone(uv_reading(None))


class DescribeTests(SimpleTestCase):

    def test_sparse_weather_skips_missing_facts(self):
        facts = describe(build_weather({'name': 'Nowhere', 'main': {'temp': 1.4}}), None, {})
        self.assertIn('Place: Nowhere', facts)
        self.assertIn('Temperature: 1°C', facts)
        self.assertNotIn('feels like', facts)
        self.assertNotIn('Humidity', facts)
        self.assertNotIn('Wind', facts)


class BuildWeatherTests(SimpleTestCase):

    def test_converts_units_and_local_times(self):
        weather = build_weather(MUMBAI)
        self.assertEqual(weather['temp'], 31)
        self.assertEqual(weather['feels_like'], 38)
        self.assertEqual(weather['wind_speed'], 20)  # 5.66 m/s
        self.assertEqual(weather['wind_direction'], 'W')
        self.assertEqual(weather['visibility'], 4.5)  # 4500 m
        self.assertEqual(weather['description'], 'Haze')
        # Sunrise/sunset are shown in Mumbai time (UTC+5:30), not server time.
        self.assertEqual(weather['sunrise'], '6:23 AM')
        self.assertEqual(weather['sunset'], '6:55 PM')

    def test_clear_sky_at_night_uses_night_theme(self):
        payload = {**MUMBAI, 'weather': [{'main': 'Clear', 'description': 'clear sky', 'icon': '01n'}]}
        self.assertEqual(build_weather(payload)['sky'], 'night')

    def test_clear_sky_by_day_uses_clear_theme(self):
        payload = {**MUMBAI, 'weather': [{'main': 'Clear', 'description': 'clear sky', 'icon': '01d'}]}
        self.assertEqual(build_weather(payload)['sky'], 'clear')

    def test_missing_fields_become_none(self):
        weather = build_weather({'name': 'Nowhere'})
        self.assertIsNone(weather['temp'])
        self.assertIsNone(weather['wind_speed'])
        self.assertIsNone(weather['visibility'])
        self.assertIsNone(weather['sunrise'])
        self.assertEqual(weather['wind_direction'], '')

    def test_polar_day_has_no_sunrise(self):
        payload = {**MUMBAI, 'sys': {'country': 'NO', 'sunrise': 0, 'sunset': 0}}
        self.assertIsNone(build_weather(payload)['sunrise'])
        self.assertIsNone(build_weather(payload)['daylight'])

    def test_converts_gusts_and_cloud_cover(self):
        payload = {**MUMBAI, 'wind': {'speed': 5.66, 'deg': 280, 'gust': 10}, 'clouds': {'all': 40}}
        weather = build_weather(payload)
        self.assertEqual(weather['wind_gust'], 36)  # 10 m/s
        self.assertEqual(weather['wind_degrees'], 280)
        self.assertEqual(weather['cloud_cover'], 40)

    def test_few_clouds_use_the_clear_sky(self):
        self.assertEqual(sky_theme('Clouds', '02d'), 'clear')
        self.assertEqual(sky_theme('Clouds', '02n'), 'night')
        self.assertEqual(sky_theme('Clouds', '04d'), 'clouds')

    def test_scene_readings_keep_the_raw_conditions(self):
        payload = {**MUMBAI, 'clouds': {'all': 40}}
        scene = build_weather(payload)['scene']
        # The condition code and the API's own units, for static/js/weather/mapper.js.
        self.assertEqual(scene['code'], 721)
        self.assertEqual(scene['main'], 'Haze')
        self.assertEqual(scene['icon'], '50d')
        self.assertEqual(scene['sky'], 'mist')
        self.assertEqual(scene['clouds'], 40)
        self.assertEqual(scene['wind'], 5.66)
        self.assertEqual(scene['wind_deg'], 280)
        self.assertEqual(scene['visibility'], 4500)

    def test_scene_readings_follow_the_sun(self):
        with mock.patch('base.views.datetime') as fake_datetime:
            fake_datetime.now.return_value = datetime.fromtimestamp(
                (MUMBAI['sys']['sunrise'] + MUMBAI['sys']['sunset']) / 2, tz=timezone.utc)
            fake_datetime.fromtimestamp.side_effect = datetime.fromtimestamp
            self.assertEqual(build_weather(MUMBAI)['scene']['daylight'], 0.5)

    def test_sparse_response_has_empty_scene_readings(self):
        scene = build_weather({'name': 'Nowhere'})['scene']
        self.assertIsNone(scene['code'])
        self.assertIsNone(scene['daylight'])
        self.assertEqual(scene['sky'], 'mist')


class WeatherArtTests(SimpleTestCase):

    def test_clear_and_partly_cloudy_have_day_and_night_versions(self):
        self.assertEqual(weather_art('Clear', '01d'), 'clear-day')
        self.assertEqual(weather_art('Clear', '01n'), 'clear-night')
        self.assertEqual(weather_art('Clouds', '02d'), 'partly-day')
        self.assertEqual(weather_art('Clouds', '02n'), 'partly-night')

    def test_icon_code_picks_the_drawing(self):
        self.assertEqual(weather_art('Clouds', '04n'), 'cloudy')
        self.assertEqual(weather_art('Drizzle', '09d'), 'rain')
        self.assertEqual(weather_art('Thunderstorm', '11d'), 'storm')
        self.assertEqual(weather_art('Snow', '13n'), 'snow')
        self.assertEqual(weather_art('Haze', '50d'), 'mist')

    def test_missing_icon_falls_back_to_condition(self):
        self.assertEqual(weather_art('Rain', ''), 'rain')
        self.assertEqual(weather_art('Clear', ''), 'clear-day')
        self.assertEqual(weather_art('Tornado', ''), 'mist')


class DaylightTests(SimpleTestCase):
    SUNRISE = 1_000_000
    SUNSET = SUNRISE + 12 * 3600 + 17 * 60  # 12h 17m later

    def test_midday(self):
        info = daylight(self.SUNRISE, self.SUNSET, (self.SUNRISE + self.SUNSET) / 2)
        self.assertEqual(info, {'length': '12h 17m', 'progress': 0.5, 'sun_is_up': True})

    def test_before_sunrise_and_after_sunset_hold_at_the_ends(self):
        before = daylight(self.SUNRISE, self.SUNSET, self.SUNRISE - 60)
        after = daylight(self.SUNRISE, self.SUNSET, self.SUNSET + 60)
        self.assertEqual((before['progress'], before['sun_is_up']), (0, False))
        self.assertEqual((after['progress'], after['sun_is_up']), (1, False))

    def test_missing_times(self):
        self.assertIsNone(daylight(0, self.SUNSET, self.SUNRISE))
        self.assertIsNone(daylight(self.SUNRISE, None, self.SUNRISE))


class MapViewTests(SimpleTestCase):

    def tile(self, view, row, col):
        return view['tiles'][row * view['columns'] + col]

    def test_centre_tile_matches_openstreetmap(self):
        # Central London is tile 1023/681 at zoom 11 on openstreetmap.org.
        view = map_view(51.5074, -0.1278)
        self.assertIn('https://tile.openstreetmap.org/11/1023/681.png', view['tiles'])
        # The offsets point at the city inside the grid of tiles.
        col, row = view['offset_x'] // 256, view['offset_y'] // 256
        self.assertEqual(self.tile(view, row, col), 'https://tile.openstreetmap.org/11/1023/681.png')

    def test_grid_covers_the_widest_card(self):
        view = map_view(19.0144, 72.8479)
        rows = len(view['tiles']) // view['columns']
        self.assertGreaterEqual(view['offset_x'], 540)                        # left of the city
        self.assertGreaterEqual(view['columns'] * 256 - view['offset_x'], 540)  # right
        self.assertGreaterEqual(view['offset_y'], 180)                        # above
        self.assertGreaterEqual(rows * 256 - view['offset_y'], 180)           # below

    def test_wraps_round_the_date_line(self):
        view = map_view(-17.7, 179.99)  # Fiji
        self.assertTrue(any('/11/0/' in url for url in view['tiles']))
        self.assertFalse(any('/11/2048/' in url for url in view['tiles']))

    def test_no_tiles_past_the_poles(self):
        # Only a zoomed-out map reaches past the top of the world.
        view = map_view(89.9, 0, zoom=2)
        self.assertIn(None, view['tiles'])
        self.assertFalse(any('/-1.png' in url for url in view['tiles'] if url))

    def test_missing_position_means_no_map(self):
        self.assertIsNone(map_view(None, 72.8))
        weather = build_weather({'name': 'Nowhere'})
        self.assertIsNone(weather['map'])
        self.assertEqual(weather['coords'], '')

    def test_coordinates_in_every_hemisphere(self):
        self.assertEqual(build_weather(MUMBAI)['coords'], '19.01° N, 72.85° E')
        self.assertEqual(build_weather({'coord': {'lat': -33.87, 'lon': -70.65}})['coords'], '33.87° S, 70.65° W')


class RecentSearchTests(SimpleTestCase):

    def read(self, cookie):
        request = RequestFactory().get('/')
        request.COOKIES[RECENT_COOKIE] = cookie
        return read_recent(request)

    def test_keeps_at_most_five(self):
        recent = []
        for n in range(8):
            recent = remember(recent, f'City {n}')
        self.assertEqual(recent, ['City 7', 'City 6', 'City 5', 'City 4', 'City 3'])

    def test_ignores_blank_and_oversized_cookie_entries(self):
        cookie = quote('Paris,FR||  |' + 'x' * 200 + '|Tokyo,JP')
        self.assertEqual(self.read(cookie), ['Paris,FR', 'Tokyo,JP'])
        self.assertEqual(self.read(''), [])

    def test_splits_name_from_country(self):
        self.assertEqual(place_option('New York,US'), {'query': 'New York,US', 'name': 'New York', 'country': 'US'})
        self.assertEqual(place_option('Washington, D.C.,US')['name'], 'Washington, D.C.')
        self.assertEqual(place_option('Nowhere'), {'query': 'Nowhere', 'name': 'Nowhere', 'country': ''})


class MinusFilterTests(SimpleTestCase):

    def test_negative_readings_get_a_minus_sign(self):
        self.assertEqual(minus(-2), '\u22122')
        self.assertEqual(minus(-0.5), '\u22120.5')

    def test_other_readings_are_unchanged(self):
        self.assertEqual(minus(31), '31')
        self.assertEqual(minus(0), '0')
        self.assertIsNone(minus(None))
