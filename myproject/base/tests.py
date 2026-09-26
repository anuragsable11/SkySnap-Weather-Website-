from unittest import mock

import requests
from django.test import SimpleTestCase, override_settings
from django.urls import reverse

from .views import build_weather

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
