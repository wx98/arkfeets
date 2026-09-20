@echo off
chcp 65001 >nul
title FootTrackNet 脚部检测
cd /d %~dp0

where python >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Python。
    echo 请先安装 Python 3.9-3.12（https://www.python.org/downloads/），
    echo 安装时务必勾选 "Add Python to PATH"，然后重新运行本脚本。
    pause
    exit /b 1
)

rem 如果 7860 端口已被占用，说明可能已有界面在运行，直接打开浏览器
netstat -ano | findstr ":7860 " >nul 2>nul
if not errorlevel 1 (
    echo 检测到 7860 端口已在运行（可能上一个界面没关）。
    echo 正在打开浏览器访问已有界面：http://127.0.0.1:7860
    start http://127.0.0.1:7860
    echo 如需重启，请先关闭旧的命令行窗口，再运行本脚本。
    pause
    exit /b 0
)

echo [1/2] 检查依赖...
python -c "import ai_edge_litert, cv2, numpy, gradio" >nul 2>nul
if errorlevel 1 (
    echo 正在安装依赖，首次安装可能需要几分钟...
    pip install -r requirements.txt
) else (
    echo 依赖已就绪。
)

echo [2/2] 启动检测界面（浏览器将自动打开）...
python foot_detect_gui.py

pause
