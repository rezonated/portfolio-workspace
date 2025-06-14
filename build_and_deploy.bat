@echo off
setlocal ENABLEEXTENSIONS

:: Auto-detect root directory
cd /d "%~dp0"

:: Commit message
set COMMIT_PREFIX=Auto-deploy
set COMMIT_MSG=%COMMIT_PREFIX%: Automated Hugo deploy

echo =============================
echo Building Hugo site...
echo =============================

hugo --gc --minify

IF %ERRORLEVEL% NEQ 0 (
    echo Hugo build failed. Exiting...
    exit /b 1
)

echo =============================
echo Hugo build completed successfully!
echo =============================

cd public

echo =============================
echo Pulling latest from GitHub Pages repo...
echo =============================

git pull origin main

echo =============================
echo Staging changes...
echo =============================

git add .

git diff --cached --quiet

IF %ERRORLEVEL% EQU 0 (
    echo No changes to commit. Deployment skipped.
) ELSE (
    git commit -m "%COMMIT_MSG%"
    git push origin main
    echo Deployment pushed to GitHub Pages.
)

pause
endlocal
