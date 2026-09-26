# 🌤️ SkySnap - Weather Web App

A clean, minimal weather app built with Django. Search any city in the world to see live conditions from the OpenWeather API.

---

## 🚀 Features

* 🔍 Search the weather for any city (add a country code to be specific, e.g. `Paris,FR`)
* 🌡️ Temperature and "feels like" in °C
* 💧 Humidity, wind speed and direction, pressure and visibility
* 🌅 Sunrise and sunset in the city's own timezone
* 🕒 The city's local date and time
* 🎨 Glass-style UI whose background changes with the weather (clear, night, clouds, rain, storm, snow, mist)
* 📱 Responsive down to small phones, with no JavaScript
* ⚠️ Clear messages for unknown cities, missing or rejected API keys, and network problems

---

## 🛠️ Tech Stack

* **Backend:** Python 3.12+, Django 6.1
* **Frontend:** Django templates and plain CSS
* **API:** OpenWeather Current Weather API

---

## ⚙️ Setup Instructions

### 1. Clone the repository

```bash
git clone https://github.com/anuragsable11/SkySnap-Weather-Website-.git
cd SkySnap-Weather-Website-
```

### 2. Create and activate a virtual environment

Windows (PowerShell):

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
```

macOS / Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

> If PowerShell says running scripts is disabled, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, then activate again.

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Add your API key

Copy the example environment file to `.env`:

```bash
copy .env.example .env    # Windows
cp .env.example .env      # macOS / Linux
```

Open `.env` and paste in your key:

```env
API_KEY=your_openweather_key
```

Get a free key at [home.openweathermap.org/api_keys](https://home.openweathermap.org/api_keys). A new key can take up to a couple of hours to activate. Until it does, searches show "The API key was rejected".

### 5. Set up the database and run the server

```bash
cd myproject
python manage.py migrate
python manage.py runserver
```

Open your browser at:

```
http://127.0.0.1:8000/
```

> The site also runs without a key. It shows a reminder to add one instead of weather results. Restart the server after you edit `.env`.

---

## 🧪 Running Tests

```bash
cd myproject
python manage.py test
```

The tests mock the OpenWeather API, so they need no API key or internet connection.

---

## 🔐 Environment Variables

| Variable        | Required       | Description                                                        |
| --------------- | -------------- | ------------------------------------------------------------------ |
| `API_KEY`       | Yes            | Your OpenWeather API key                                           |
| `SECRET_KEY`    | For deployment | Django secret key. A development-only fallback is used if unset.   |
| `DEBUG`         | No             | `True` by default. Set to `False` in production.                   |
| `ALLOWED_HOSTS` | For deployment | Comma-separated host names. Defaults to `localhost,127.0.0.1`.     |

`.env` is listed in `.gitignore`, so your key is never committed.

---

## 📁 Project Structure

```
SkySnap-Weather-Website-/
├── .env.example              # Template for your .env file
├── requirements.txt
└── myproject/
    ├── manage.py
    ├── myproject/            # Settings and root URL config
    ├── base/                 # The weather app
    │   ├── views.py          # Calls OpenWeather and prepares the data
    │   ├── tests.py
    │   └── templates/base/home.html
    ├── templates/main.html   # Base page layout
    └── static/               # CSS and logo
```

---

## 📌 API Used

* Weather data provided by [OpenWeather](https://openweathermap.org/)

---

## 🤝 Contributing

Contributions are welcome! Feel free to fork this repo and submit a pull request.

---

## 📄 License

This project is for educational purposes.

---

## 👨‍💻 Author

**Anurag Sable**
Python Developer | Django | Web Development

---

⭐ If you like this project, give it a star on GitHub!
