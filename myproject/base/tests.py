from unittest import mock
from urllib.parse import quote

import requests
from django.test import RequestFactory, SimpleTestCase, override_settings
from django.urls import reverse

from .views import (RECENT_COOKIE, build_weather, daylight, place_option, read_recent,
                    remember, sky_theme, weather_art)

# A real OpenWeather response for Mumbai, trimmed to the fields the app uses.
MUMBAI = {
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


@override_settings(OPENWEATHER_API_KEY='test-key')
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
        # Numbers count up on load, with the real value kept for screen readers.
        self.assertContains(response, '<span class="count" style="--to: 31"><span class="count-num">31</span></span>', html=True)
        self.assertContains(response, 'style="--to: 1008"')  # pressure
        self.assertEqual(mock_get.call_args.kwargs['params']['q'], 'Mumbai')
        self.assertEqual(mock_get.call_args.kwargs['params']['appid'], 'test-key')

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

    @override_settings(OPENWEATHER_API_KEY='')
    def test_missing_key_prompts_setup_without_calling_api(self, mock_get):
        self.assertContains(self.client.get(reverse('home')), 'One step left')
        self.assertContains(self.search('Mumbai'), 'Add API_KEY to your .env file')
        mock_get.assert_not_called()


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
