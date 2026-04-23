from django.shortcuts import render
import requests

weather_api='https://api.openweathermap.org/data/2.5/weather?q={city name},{country code}&appid={API key}'
api_key=''

# Create your views here.
def home(request):
    if request.method=="GET":
        if 'city_name' in request.GET:
            city_name=request.GET['city_name']
            resp=requests.get(f'https://api.openweathermap.org/data/2.5/weather?q={city_name}&appid={api_key}&units=metric')
            
            return render(request,'home.html',{'data':resp.json()})
        else:
            return render(request,'home.html')