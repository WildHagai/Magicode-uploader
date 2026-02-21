@echo off
setlocal

:: Find Visual Studio vcvarsall.bat
set "VCVARS="
for /f "usebackq tokens=*" %%i in (`"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -latest -find "VC\Auxiliary\Build\vcvarsall.bat" 2^>nul`) do set "VCVARS=%%i"
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

:: Find Windows SDK
set "SDK_VER="
for /f "delims=" %%d in ('dir /b /ad /on "%ProgramFiles(x86)%\Windows Kits\10\Include\" 2^>nul') do set "SDK_VER=%%d"
if "%SDK_VER%"=="" (
    echo ERROR: Windows SDK not found
    exit /b 1
)
set "SDK_INC=%ProgramFiles(x86)%\Windows Kits\10\Include\%SDK_VER%"
set "SDK_LIB=%ProgramFiles(x86)%\Windows Kits\10\Lib\%SDK_VER%"

set "SRC=%~dp0..\src\win11"
set "OUT=%SRC%\build"

if not exist "%OUT%" mkdir "%OUT%"

echo Building MagicodeNative.dll (x64)...
cl.exe /nologo /O2 /W3 /EHsc /std:c++17 ^
  /I"%SDK_INC%\um" /I"%SDK_INC%\shared" /I"%SDK_INC%\ucrt" ^
  /LD "%SRC%\MagicodeContextMenu.cpp" ^
  /Fo"%OUT%\MagicodeNative.obj" ^
  /Fe"%OUT%\MagicodeNative.dll" ^
  /link /DEF:"%SRC%\MagicodeContextMenu.def" ^
  /LIBPATH:"%SDK_LIB%\um\x64" /LIBPATH:"%SDK_LIB%\ucrt\x64" ^
  shlwapi.lib shell32.lib ole32.lib advapi32.lib

if %errorlevel% neq 0 (
    echo BUILD FAILED
    exit /b 1
)

:: Clean intermediate files
del /q "%OUT%\MagicodeNative.obj" 2>nul
del /q "%OUT%\MagicodeNative.exp" 2>nul
del /q "%OUT%\MagicodeNative.lib" 2>nul

echo Build succeeded: %OUT%\MagicodeNative.dll
