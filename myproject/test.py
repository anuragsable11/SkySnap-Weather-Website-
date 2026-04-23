import requests
weather_api='https://api.openweathermap.org/data/2.5/weather?q={city name},{country code}&appid={API key}'
city_name='Mumbai'
api_key='d345ac54196521bd2f2265e596a7d158'
resp=requests.get(f'https://api.openweathermap.org/data/2.5/weather?q={city_name}&appid={api_key}')
print(resp)#<Response [200]>
data=resp.json()
print(data)#{'coord': {'lon': 72.8479, 'lat': 19.0144}, 'weather': [{'id': 721, 'main': 'Haze', 'description': 'haze', 'icon': '50d'}], 'base': 'stations', 'main': {'temp': 304.14, 'feels_like': 310.72, 'temp_min': 304.09, 'temp_max': 304.14, 'pressure': 1008, 'humidity': 70, 'sea_level': 1008, 'grnd_level': 1008}, 'visibility': 4500, 'wind': {'speed': 5.66, 'deg': 280}, 'clouds': {'all': 40}, 'dt': 1776081534, 'sys': {'type': 1, 'id': 9052, 'country': 'IN', 'sunrise': 1776041580, 'sunset': 1776086700}, 'timezone': 19800, 'id': 1275339, 'name': 'Mumbai', 'cod': 200}