# 🌤️ SkySnap - Weather Web App

A clean, minimal weather app built with Django. Search any city in the world to see live conditions from the OpenWeather API.

---

## 🚀 Features

* 🔍 Search the weather for any city (add a country code to be specific, e.g. `Paris,FR`)
* 📋 Clicking the search bar opens a dropdown of your recent searches (saved in a cookie, no account needed) and popular cities
* 🌡️ Temperature and "feels like" in °C
* 💧 Humidity, wind speed and direction, pressure and visibility
* 🌅 Sunrise and sunset in the city's own timezone
* 🤖 AI weather notes (optional, needs a free Groq key): a short summary of the coming hours, what to wear, and health tips that take air quality and UV into account
* 🗺️ A dark map of where the city is, tinted to match the weather, with a link to the full map on OpenStreetMap
* 🕒 The city's local date and time
* 🎨 Glass-style UI whose background changes with the weather (clear, night, clouds, rain, storm, snow, mist)
* ✨ Lots of pure-CSS animation: numbers count up, the compass needle swings to the wind, the sun climbs its arc, shooting stars cross the night sky, and searches glide smoothly into their results. All of it stops for people who turn on reduced motion
* 📱 Responsive down to small phones, with no JavaScript
* ⚠️ Clear messages for unknown cities, missing or rejected API keys, and network problems

---

## 🛠️ Tech Stack

* **Backend:** Python 3.12+, Django 6.1
* **Frontend:** Django templates and plain CSS
* **APIs:** OpenWeather (current weather and air quality), Open-Meteo (UV and hourly forecast, no key needed), Groq or Hugging Face Inference Providers (AI notes)

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

**Optional: AI weather notes.** To show the AI summary, outfit and health cards, add a free Groq key too:

```env
GROQ_API_KEY=gsk_your_key
```

Create it at [console.groq.com/keys](https://console.groq.com/keys). No credit card is needed. The free plan allows 1,000 requests a day, and the notes for each city are reused for 30 minutes. The default model is `openai/gpt-oss-20b`; set `GROQ_MODEL` to use another (for example `qwen/qwen3.8-27b`).

You can use a Hugging Face token (`HF_TOKEN`) instead. It is only used when `GROQ_API_KEY` is empty. Its free plan has just a small monthly credit; when that runs out, the API answers "402: You have depleted your monthly included credits".

Without a key, or if the model can't be reached, the cards are simply left out, and the reason is printed in the server console.

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

The tests mock OpenWeather, Open-Meteo, Groq and Hugging Face, so they need no API keys or internet connection.

---

## 🔐 Environment Variables

| Variable        | Required       | Description                                                        |
| --------------- | -------------- | ------------------------------------------------------------------ |
| `API_KEY`       | Yes            | Your OpenWeather API key                                           |
| `GROQ_API_KEY`  | No             | Free Groq key. Turns on the AI weather notes.                      |
| `GROQ_MODEL`    | No             | Groq chat model. Defaults to `openai/gpt-oss-20b`.                 |
| `HF_TOKEN`      | No             | Hugging Face token, used for the notes when there is no Groq key.  |
| `HF_MODEL`      | No             | Hugging Face chat model. Defaults to `meta-llama/Llama-3.1-8B-Instruct:novita`. |
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
    │   ├── insights.py       # AI weather notes (Groq / Hugging Face), air quality and UV
    │   ├── tests.py
    │   └── templates/base/home.html
    ├── templates/main.html   # Base page layout
    └── static/               # CSS and logo
```

---

## 📌 API Used

* Weather and air quality data provided by [OpenWeather](https://openweathermap.org/)
* UV index and hourly forecast from [Open-Meteo](https://open-meteo.com/)
* AI notes written by a chat model on [Groq](https://groq.com/) or [Hugging Face Inference Providers](https://huggingface.co/docs/inference-providers)

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
