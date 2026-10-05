@echo off
chcp 65001 > nul
cd /d "%~dp0"

where python > nul 2>&1
if errorlevel 1 (
    echo [오류] 파이썬이 없습니다. https://www.python.org/downloads/ 에서 설치하세요.
    echo        설치할 때 "Add python.exe to PATH" 를 꼭 체크하세요.
    pause
    exit /b 1
)

if not exist ".installed" (
    echo 처음 실행: 필요한 프로그램을 설치합니다. 몇 분 걸릴 수 있습니다...
    python -m pip install --upgrade pip
    python -m pip install -r requirements.txt
    if errorlevel 1 (
        echo [오류] 설치 실패
        pause
        exit /b 1
    )
    echo ok> .installed
)

echo 브라우저가 자동으로 열립니다. 이 창은 닫지 마세요. (끄려면 이 창을 닫으면 됩니다)
python app.py
pause
