@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul
title Convertir nubes de puntos a COPC (Visor 3D)

rem ============================================================
rem  Arrastra uno o varios archivos (.las .laz .e57 .ply ...)
rem  sobre este archivo. Crea "nombre.copc.laz" en la misma
rem  carpeta, listo para subir al Visor 3D.
rem  Usa el conversor "untwine" que viene incluido en QGIS
rem  (gratis: https://qgis.org/download/).
rem ============================================================

if "%~1"=="" (
  echo.
  echo  Arrastra tus archivos de nube de puntos sobre este archivo .bat
  echo  ^(no lo abras con doble clic^).
  echo.
  pause
  exit /b
)

rem --- buscar untwine.exe (QGIS u OSGeo4W) ---
set "UNTWINE="
for /d %%Q in ("%ProgramFiles%\QGIS*") do if exist "%%Q\bin\untwine.exe" set "UNTWINE=%%Q\bin\untwine.exe"
if not defined UNTWINE if exist "C:\OSGeo4W\bin\untwine.exe" set "UNTWINE=C:\OSGeo4W\bin\untwine.exe"
if not defined UNTWINE if exist "C:\OSGeo4W64\bin\untwine.exe" set "UNTWINE=C:\OSGeo4W64\bin\untwine.exe"
if not defined UNTWINE (
  echo.
  echo  No encontre QGIS en este equipo.
  echo  Instala QGIS ^(gratis^) desde https://qgis.org/download/ y vuelve a intentarlo.
  echo.
  start "" "https://qgis.org/download/"
  pause
  exit /b 1
)
for %%U in ("%UNTWINE%") do set "QBIN=%%~dpU"
set "PATH=%QBIN%;%PATH%"
echo Usando: %UNTWINE%

set /a OK=0, FALLA=0
:siguiente
if "%~1"=="" goto fin
set "ENTRADA=%~f1"
set "NOMBRE=%~n1"
set "NOMBRE=!NOMBRE:.copc=!"
set "SALIDA=%~dp1!NOMBRE!.copc.laz"
echo.
echo ------------------------------------------------------------
echo  Convirtiendo: %~nx1  ^(%~z1 bytes^)
echo  Salida:       !SALIDA!
echo  Puede tardar varios minutos en nubes grandes. No cierres esta ventana.
echo ------------------------------------------------------------
"%UNTWINE%" --files="!ENTRADA!" --output_dir="!SALIDA!" --single_file
if errorlevel 1 (
  echo  ERROR al convertir %~nx1
  set /a FALLA+=1
) else if exist "!SALIDA!" (
  echo  LISTO: !SALIDA!
  set /a OK+=1
) else (
  echo  ERROR: no se genero el archivo de salida.
  set /a FALLA+=1
)
shift
goto siguiente

:fin
echo.
echo ============================================================
echo  Convertidos: %OK%    Con error: %FALLA%
echo  Sube los archivos .copc.laz desde el Visor 3D ^> Administrar.
echo ============================================================
start "" "https://visor3dqh.github.io/"
pause
