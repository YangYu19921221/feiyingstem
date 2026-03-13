@echo off
chcp 65001 >nul
title 英语学习助手 - 安装依赖

echo ========================================
echo     英语学习助手 - 依赖安装程序
echo ========================================
echo.

:: 检查Python是否安装
python --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到Python，请先安装Python 3.8+
    echo 下载地址: https://www.python.org/downloads/
    echo.
    echo 安装Python时请注意:
    echo   1. 勾选 "Add Python to PATH"
    echo   2. 选择 "Customize installation"
    echo   3. 勾选 "pip" 和 "py launcher"
    echo.
    pause
    exit /b 1
)

for /f "tokens=2" %%i in ('python --version 2^>^&1') do set PYTHON_VERSION=%%i
echo [信息] 检测到 Python %PYTHON_VERSION%
echo.

:: 进入后端目录
cd /d "%~dp0backend"

:: 创建虚拟环境
echo [信息] 创建Python虚拟环境...
python -m venv venv
if errorlevel 1 (
    echo [错误] 创建虚拟环境失败
    pause
    exit /b 1
)
echo [信息] 虚拟环境创建成功
echo.

:: 激活虚拟环境
call venv\Scripts\activate.bat

:: 升级pip
echo [信息] 升级pip...
python -m pip install --upgrade pip -i https://pypi.tuna.tsinghua.edu.cn/simple
echo.

:: 安装依赖
echo [信息] 安装项目依赖（使用清华镜像加速）...
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
if errorlevel 1 (
    echo [错误] 安装依赖失败
    pause
    exit /b 1
)

echo.
echo ========================================
echo     安装完成！
echo ========================================
echo.
echo [提示] 现在可以双击"启动服务.bat"运行程序
echo.
pause
