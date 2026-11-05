"""Lance Rando Tracker : python run.py"""
import threading
import webbrowser

import uvicorn

from app.config import HOST, PORT

if __name__ == "__main__":
    url = f"http://{HOST}:{PORT}"
    print(f"\n  Rando Tracker tourne sur {url}\n  (Ctrl+C pour arrêter)\n")
    threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    uvicorn.run("app.main:app", host=HOST, port=PORT, log_level="warning")
