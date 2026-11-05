@echo off
cd /d "%~dp0"
echo Verification des dependances...
python -m pip install -q -r requirements.txt
python run.py
pause
