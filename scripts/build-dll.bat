@echo off
setlocal

:: Find Visual Studio vcvarsall.bat
set "VCVARS="
:: (vswhere's path is kept in a variable: the ")" in "%ProgramFiles(x86)%" would close the for-loop parentheses)
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
for /f "usebackq tokens=*" %%i in (`"%VSWHERE%" -latest -products * -find "VC\Auxiliary\Build\vcvarsall.bat" 2^>nul`) do set "VCVARS=%%i"
if "%VCVARS%"=="" (
    if exist "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvarsall.bat" (
        set "VCVARS=C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvarsall.bat"
    ) else if exist "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvarsall.bat" (
        set "VCVARS=C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvarsall.bat"
    ) else (
        echo ERROR: Visual Studio not found
        exit /b 1
    )
)

call "%VCVARS%" x64

:: vcvarsall puts the Windows SDK on INCLUDE and LIB when it is installed
if "%WindowsSdkDir%"=="" (
    echo ERROR: Windows SDK not found - install it with the Visual Studio Installer
    exit /b 1
)

set "SRC=%~dp0..\src\win11"
set "OUT=%SRC%\build"

if not exist "%OUT%" mkdir "%OUT%"

echo Building MagicodeNative.dll (x64)...
rc.exe /nologo /fo "%OUT%\MagicodeNative.res" "%SRC%\MagicodeNative.rc" || exit /b 1
cl.exe /nologo /O2 /W3 /EHsc /std:c++17 ^
  /LD "%SRC%\MagicodeContextMenu.cpp" ^
  /Fo"%OUT%\MagicodeNative.obj" ^
  /Fe"%OUT%\MagicodeNative.dll" ^
  /link /DEF:"%SRC%\MagicodeContextMenu.def" "%OUT%\MagicodeNative.res" ^
  shlwapi.lib shell32.lib ole32.lib advapi32.lib

if %errorlevel% neq 0 (
    echo BUILD FAILED
    exit /b 1
)

:: Clean intermediate files
del /q "%OUT%\MagicodeNative.obj" 2>nul
del /q "%OUT%\MagicodeNative.exp" 2>nul
del /q "%OUT%\MagicodeNative.lib" 2>nul
del /q "%OUT%\MagicodeNative.res" 2>nul

echo Build succeeded: %OUT%\MagicodeNative.dll
